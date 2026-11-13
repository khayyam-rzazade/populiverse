// THE REVIEWER'S SECOND RUN (Fable, 2026-11-13; master plan, section 18, the
// row on the second run). Attacks on the six fixes themselves. As before, each
// one must fail as an attack: the test passes only when the server is safe.
import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";
import { makeWorld, Browser, setOpen, invite, SITE, API } from "./helpers.js";
import { nightly } from "../src/cleanup.js";

const DAY = 86400000;
const HOUR = 3600000;
const iso = (ms) => new Date(ms).toISOString();
const count = async (sql) => (await env.DB.prepare(sql).first()).n;
const from = (w, i) => { const b = new Browser(w); b.ip = `198.51.100.${(i % 250) + 1}`; return b; };
// A request made by hand, so that its Content-Type can be anything.
async function raw(w, i, type, body) {
  const headers = new Headers({ Origin: SITE, "cf-connecting-ip": `198.51.100.${(i % 250) + 1}`, "Content-Type": type });
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(API + "/api/auth/email-otp/send-verification-otp", { method: "POST", headers, body }), w.env, ctx);
  await waitOnExecutionContext(ctx);
  return res.status;
}
const allowed = (statuses) => statuses.filter((s) => s !== 429).length;

describe("Second run: the counter of codes for one address", () => {
  beforeEach(() => setOpen(true));

  it("S1. five codes an hour for one address, from many places, and no sixth", async () => {
    const w = makeWorld();
    const st = [];
    for (let i = 0; i < 12; i++) st.push((await from(w, i).askCode("ada@example.org")).status);
    expect(st.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(allowed(st)).toBe(5);
    expect(w.outbox.length).toBe(5);
  });

  it("S2. ten a day: after an hour five more, then none until a day has passed", async () => {
    const w = makeWorld();
    for (let i = 0; i < 5; i++) await from(w, i).askCode("ada@example.org");
    await env.DB.prepare("UPDATE code_ask SET asked_at = asked_at - ?").bind(HOUR + 1000).run();
    const st = [];
    for (let i = 5; i < 12; i++) st.push((await from(w, i).askCode("ada@example.org")).status);
    expect(allowed(st)).toBe(5);
    await env.DB.prepare("UPDATE code_ask SET asked_at = asked_at - ?").bind(HOUR + 1000).run();
    expect((await from(w, 20).askCode("ada@example.org")).status).toBe(429);
    await env.DB.prepare("UPDATE code_ask SET asked_at = asked_at - ?").bind(DAY).run();
    expect((await from(w, 21).askCode("ada@example.org")).status).toBe(200);
  });

  it("S3. twenty requests at the same moment do not slip past the limit", async () => {
    const w = makeWorld();
    const st = await Promise.all(Array.from({ length: 20 }, (_, i) => from(w, i).askCode("ada@example.org").then((r) => r.status)));
    expect(allowed(st)).toBeLessThanOrEqual(5);
  });

  it("S4. other spellings of the address do not get a count of their own", async () => {
    const w = makeWorld();
    const spellings = ["ada@example.org", "ADA@EXAMPLE.ORG", "Ada@Example.Org", " ada@example.org", "ada@example.org ", "ada@example.org\n", "\tada@example.org", "ada@EXAMPLE.org"];
    let i = 0;
    for (let round = 0; round < 3; round++) for (const e of spellings) await from(w, i++).askCode(e);
    // whatever the spelling, the inbox got five codes at most
    expect(w.outbox.filter((m) => m.to === "ada@example.org").length).toBeLessThanOrEqual(5);
    expect(await count("SELECT COUNT(DISTINCT fingerprint) AS n FROM code_ask")).toBe(1);
  });

  it("S5. the limit holds while the mail service is down", async () => {
    const w = makeWorld();
    w.env.EMAIL = { async send() { throw new Error("mail is down"); } };
    const st = [];
    for (let i = 0; i < 12; i++) st.push((await from(w, i).askCode("ada@example.org")).status);
    expect(allowed(st)).toBeLessThanOrEqual(5);
  });

  it("S6. a body dressed as a form, or with two emails, does not reach the library past the counter", async () => {
    const w = makeWorld();
    const v = new Browser(w);
    await v.signUp("ada@example.org");
    w.outbox.length = 0;
    await env.DB.prepare("DELETE FROM code_ask").run();
    let i = 0;
    for (let k = 0; k < 8; k++) {
      // read as JSON the email is a throwaway; read as a form it is the victim's
      const body = `{"email":"t${k}@example.net","type":"sign-in","x":"&email=ada@example.org&type=sign-in&y="}`;
      for (const type of ["application/x-www-form-urlencoded", "text/plain", "application/json; charset=utf-16"]) {
        await raw(w, i++, type, body);
      }
      // two "email" keys: the counter and the library must see the same one
      await from(w, i++).fetch("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        body: `{"email":"u${k}@example.net","type":"sign-in","email":"ada@example.org"}`
      });
    }
    expect(w.outbox.filter((m) => m.to === "ada@example.org").length).toBeLessThanOrEqual(5);
  });

  it("S7. the counter keeps no address, and the nightly job empties it after a day", async () => {
    const w = makeWorld();
    await from(w, 1).askCode("ada@example.org");
    const rows = (await env.DB.prepare("SELECT * FROM code_ask").all()).results;
    expect(rows.length).toBe(1);
    expect(JSON.stringify(rows)).not.toMatch(/ada|example/i);
    expect(rows[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    await nightly(w.env, Date.now() + 12 * HOUR);
    expect(await count("SELECT COUNT(*) AS n FROM code_ask")).toBe(1);
    await nightly(w.env, Date.now() + DAY + HOUR);
    expect(await count("SELECT COUNT(*) AS n FROM code_ask")).toBe(0);
  });

  it("S8. using up one address's codes does not lock anybody else out, nor a person already signed in", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    for (let i = 0; i < 15; i++) await from(w, i).askCode("ada@example.org");
    expect((await ada.fetch("/api/me")).status).toBe(200);
    expect((await from(w, 30).askCode("bob@example.org")).status).toBe(200);
  });

  it("S9. guesses at one address's code stay few over a whole day", async () => {
    const w = makeWorld();
    const v = new Browser(w);
    await v.signUp("ada@example.org");
    let guesses = 0, i = 0;
    for (let hour = 0; hour < 24; hour++) {
      for (let k = 0; k < 8; k++) {
        const b = from(w, i++);
        if ((await b.askCode("ada@example.org")).status !== 200) continue;
        for (let g = 0; g < 4; g++) {
          const r = await b.useCode("ada@example.org", String(100000 + i * 7 + g));
          if (r.status === 200) throw new Error("a guess signed in");
          if (r.status !== 429 && !/TOO_MANY|ATTEMPT/i.test(JSON.stringify(r.data))) guesses++;
        }
      }
      await env.DB.prepare("UPDATE code_ask SET asked_at = asked_at - ?").bind(HOUR + 1000).run();
      await env.DB.prepare("DELETE FROM rateLimit").run();
    }
    // 10 codes a day, 3 tries each
    expect(guesses).toBeLessThanOrEqual(30);
  });
});

describe("Second run: the sign-in door", () => {
  beforeEach(() => setOpen(true));

  it("S10. nothing but the email and the code, however it is dressed", async () => {
    const w = makeWorld();
    const b = new Browser(w);
    await b.askCode("mal@example.org");
    const otp = b.lastCode("mal@example.org");
    const bodies = [
      { email: "mal@example.org", otp, role: "editor" },
      { email: "mal@example.org", otp, id: "chosen-id" },
      { email: "mal@example.org", otp, createdAt: "2000-01-01" },
      { email: "mal@example.org", otp: Number(otp) },
      { email: ["mal@example.org"], otp },
      [{ email: "mal@example.org", otp }],
      `{"email":"mal@example.org","otp":"${otp}","__proto__":{"name":"x"}}`,
      `{"email":"mal@example.org","otp":"${otp}","name":"x","name":"y"}`
    ];
    for (const body of bodies) {
      const r = await b.json("/api/auth/sign-in/email-otp", { method: "POST", body });
      expect(r.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
    }
    expect(await count('SELECT COUNT(*) AS n FROM "user"')).toBe(0);
    const ok = await b.useCode("mal@example.org", otp);
    expect(ok.status).toBe(200);
    const u = await env.DB.prepare('SELECT name, image FROM "user"').first();
    expect(u.name).toBe("");
    expect(u.image).toBeNull();
  });
});

describe("Second run: ORCID after the two settings", () => {
  beforeEach(() => setOpen(true));
  const BACK = SITE + "/workspace/";
  const orcidReturns = (b, start) => {
    const state = new URL(start.data.url).searchParams.get("state");
    return b.fetch(`/api/auth/callback/orcid?code=good-code&state=${encodeURIComponent(state)}`, { origin: null });
  };

  it("S11. a person who connected ORCID can still sign in with it, and nobody else's iD lands on the account", async () => {
    const w = makeWorld();
    const a = new Browser(w);
    await a.signUp("ada@example.org");
    const link = await a.json("/api/auth/link-social", { method: "POST", body: { provider: "orcid", callbackURL: BACK } });
    expect(link.status).toBe(200);
    await orcidReturns(a, link);
    expect(await count("SELECT COUNT(*) AS n FROM account WHERE providerId = 'orcid'")).toBe(1);
    // a fresh browser signs in with the same ORCID iD
    const b = new Browser(w);
    const s = await b.json("/api/auth/sign-in/social", { method: "POST", body: { provider: "orcid", callbackURL: BACK } });
    await orcidReturns(b, s);
    const me = await b.json("/api/me");
    expect(me.status).toBe(200);
    expect(me.data.email).toBe("ada@example.org");
    // a second account cannot take the same iD
    const c = new Browser(w);
    await c.signUp("carl@example.org");
    const l2 = await c.json("/api/auth/link-social", { method: "POST", body: { provider: "orcid", callbackURL: BACK } });
    if (l2.status === 200) await orcidReturns(c, l2);
    expect(await count("SELECT COUNT(*) AS n FROM account WHERE providerId = 'orcid'")).toBe(1);
    expect((await c.json("/api/me")).data.orcid).toBeNull();
  });
});

describe("Second run: deleting, and the warning", () => {
  it("S12. the nightly job's deletion takes the email off the invitation list too", async () => {
    const w = makeWorld();
    await setOpen(false);
    await invite("ada@example.org");
    await invite("bob@example.org");
    const b = new Browser(w);
    await b.signUp("ada@example.org");
    const now = Date.now();
    await env.DB.prepare("UPDATE profile SET last_seen_at = ?").bind(iso(now - 731 * DAY)).run();
    await nightly(w.env, now);
    await nightly(w.env, now + 31 * DAY);
    expect(await count(`SELECT COUNT(*) AS n FROM "user" WHERE email = 'ada@example.org'`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM invite WHERE email = 'ada@example.org'`)).toBe(0);
    // and nobody else's invitation went with it
    expect(await count(`SELECT COUNT(*) AS n FROM invite WHERE email = 'bob@example.org'`)).toBe(1);
  });

  it("S13. deleting one's own account leaves other people's invitations alone", async () => {
    const w = makeWorld();
    await setOpen(false);
    await invite("ada@example.org");
    await invite("bob@example.org");
    const b = new Browser(w);
    await b.signUp("ada@example.org");
    expect((await b.json("/api/me", { method: "DELETE", body: { confirm: "delete" } })).status).toBe(200);
    expect((await env.DB.prepare("SELECT email FROM invite").all()).results).toEqual([{ email: "bob@example.org" }]);
    // the deleted person is a stranger again: a note, no code
    w.outbox.length = 0;
    await new Browser(w).askCode("ada@example.org");
    expect(w.outbox.length).toBe(1);
    expect(w.outbox[0].subject).not.toMatch(/\d{6}/);
  });

  it("S14. forty nights without mail delete nobody; the count of 30 days starts when the warning goes out", async () => {
    const w = makeWorld();
    await setOpen(true);
    const b = new Browser(w);
    await b.signUp("ada@example.org");
    const now = Date.now();
    await env.DB.prepare("UPDATE profile SET last_seen_at = ?").bind(iso(now - 731 * DAY)).run();
    const broken = { ...w.env, EMAIL: { async send() { throw new Error("mail is down"); } } };
    for (let d = 0; d < 40; d++) await nightly(broken, now + d * DAY);
    expect(await count(`SELECT COUNT(*) AS n FROM "user" WHERE email = 'ada@example.org'`)).toBe(1);
    expect((await env.DB.prepare("SELECT warned_at FROM profile").first()).warned_at).toBeNull();
    w.outbox.length = 0;
    await nightly(w.env, now + 40 * DAY); // the warning goes out
    expect(w.outbox.length).toBe(1);
    await nightly(w.env, now + 60 * DAY); // 20 days later: still there
    expect(await count(`SELECT COUNT(*) AS n FROM "user" WHERE email = 'ada@example.org'`)).toBe(1);
    expect(w.outbox.length).toBe(1); // and warned once, not every night
    await nightly(w.env, now + 71 * DAY); // 31 days after the warning
    expect(await count(`SELECT COUNT(*) AS n FROM "user" WHERE email = 'ada@example.org'`)).toBe(0);
  });
});
