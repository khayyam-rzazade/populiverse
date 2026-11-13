// THE REVIEWER'S ATTACKS (Fable, 2026-11-13; master plan, section 18, the row
// on the review of batch 1). Written without having seen the build. Like the
// other attack tests, each one must fail as an attack: the test passes only
// when the server is safe.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { makeWorld, Browser, setOpen, invite, SITE, EDITOR } from "./helpers.js";
import { nightly } from "../src/cleanup.js";

const BACK = SITE + "/workspace/";
const ERR = SITE + "/workspace/?orcid=no";
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const count = async (sql) => (await env.DB.prepare(sql).first()).n;

async function orcidReturns(b, start, code = "good-code") {
  const state = new URL(start.data.url).searchParams.get("state");
  return b.fetch(`/api/auth/callback/orcid?code=${code}&state=${encodeURIComponent(state)}`, { origin: null });
}

describe("Reviewer: signing in without a code", () => {
  beforeEach(() => setOpen(true));

  it("R1. ORCID with 'requestSignUp' opens no account without an email code", async () => {
    const b = new Browser(makeWorld());
    const s = await b.json("/api/auth/sign-in/social", {
      method: "POST",
      body: { provider: "orcid", callbackURL: BACK, errorCallbackURL: ERR, requestSignUp: true }
    });
    expect(s.status).toBe(200);
    await orcidReturns(b, s);
    const users = (await env.DB.prepare('SELECT email, emailVerified FROM "user"').all()).results;
    expect(users).toEqual([]);
    expect((await b.fetch("/api/me")).status).toBe(401);
  });

  it("R1b. a guest cannot turn into an ORCID-only account that way either", async () => {
    const b = new Browser(makeWorld());
    await b.guest();
    await b.newPage("guest page", "x");
    const s = await b.json("/api/auth/sign-in/social", {
      method: "POST",
      body: { provider: "orcid", callbackURL: BACK, errorCallbackURL: ERR, requestSignUp: true }
    });
    await orcidReturns(b, s);
    expect(await count(`SELECT COUNT(*) AS n FROM "user" WHERE email LIKE '%orcid.populiverse.invalid'`)).toBe(0);
  });

  it("R2. a hand-made ORCID token in the request body signs nobody in", async () => {
    const b = new Browser(makeWorld());
    for (const door of ["/api/auth/sign-in/social", "/api/auth/link-social"]) {
      const r = await b.json(door, {
        method: "POST",
        body: { provider: "orcid", idToken: { token: "eyJhbGciOiJub25lIn0.eyJzdWIiOiIwMDAwLTAwMDItMTgyNS0wMDk3In0.", accessToken: "orcid-access" }, requestSignUp: true }
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect(await count('SELECT COUNT(*) AS n FROM "user"')).toBe(0);
  });

  it("R3. codes for ONE address, asked from many places, are stopped", async () => {
    const w = makeWorld();
    const victim = new Browser(w);
    await victim.signUp("ada@example.org");
    const statuses = [];
    for (let i = 0; i < 40; i++) {
      const b = new Browser(w);
      b.ip = `198.51.100.${i + 1}`;
      statuses.push((await b.askCode("ada@example.org")).status);
    }
    // 40 codes in a minute for one inbox: some of them must be refused.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it("R3b. guesses at ONE address's code, from many places, are stopped", async () => {
    const w = makeWorld();
    const victim = new Browser(w);
    await victim.signUp("ada@example.org");
    let guesses = 0;
    for (let i = 0; i < 40; i++) {
      const b = new Browser(w);
      b.ip = `198.51.100.${i + 1}`;
      if ((await b.askCode("ada@example.org")).status !== 200) continue;
      for (let k = 0; k < 3; k++) {
        const r = await b.useCode("ada@example.org", String(100000 + i * 3 + k));
        if (r.status !== 429) guesses++;
      }
    }
    // 120 guesses in a minute against one account is far too many.
    expect(guesses).toBeLessThan(30);
  });

  it("R4. the sign-in door takes the email and the code only: no name, picture or flag", async () => {
    const w = makeWorld();
    const b = new Browser(w);
    await b.askCode("mal@example.org");
    const otp = b.lastCode("mal@example.org");
    const long = "=cmd|' /C calc'!A0\n" + "x".repeat(5000);
    for (const extra of [{ name: long }, { image: "https://evil.example/x.png" }, { isAnonymous: true }, { emailVerified: false }]) {
      const r = await b.json("/api/auth/sign-in/email-otp", { method: "POST", body: { email: "mal@example.org", otp, ...extra } });
      expect(r.status, JSON.stringify(Object.keys(extra))).toBeGreaterThanOrEqual(400);
    }
    expect(await count('SELECT COUNT(*) AS n FROM "user"')).toBe(0);
    // and the plain request still works
    expect((await b.useCode("mal@example.org", otp)).status).toBe(200);
  });
});

describe("Reviewer: the closed workspace and the desk", () => {
  beforeEach(() => setOpen(false));

  it("R5. while closed, ORCID with 'requestSignUp' opens nothing", async () => {
    const b = new Browser(makeWorld());
    const s = await b.json("/api/auth/sign-in/social", {
      method: "POST",
      body: { provider: "orcid", callbackURL: BACK, errorCallbackURL: ERR, requestSignUp: true }
    });
    if (s.status === 200) await orcidReturns(b, s);
    expect(await count('SELECT COUNT(*) AS n FROM "user"')).toBe(0);
  });

  it("R6. odd spellings of the desk's address open nothing for a reader", async () => {
    const w = makeWorld();
    await invite("ada@example.org");
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    const paths = [
      "/api/desk/summary/", "/API/desk/summary", "/api/desk/./summary", "/api/pages/../desk/summary",
      "/api/desk/%73ummary", "//api/desk/summary", "/api/desk/summary?x=1", "/api/desk/accounts.csv", "/api/desk/invites"
    ];
    for (const p of paths) {
      const r = await ada.fetch(p);
      expect([403, 404], p).toContain(r.status);
      expect(await r.text(), p).not.toContain("ada@example.org");
    }
    for (const method of ["HEAD", "PUT", "POST"]) {
      const r = await ada.fetch("/api/desk/summary", { method });
      expect([403, 404, 405], method).toContain(r.status);
    }
    const open = await ada.json("/api/desk/open", { method: "POST", body: { open: true } });
    expect(open.status).toBe(403);
    expect((await env.DB.prepare("SELECT value FROM setting WHERE key='open'").first()).value).toBe("no");
  });

  it("R7. an address that only looks like the editor's gets no desk", async () => {
    const w = makeWorld();
    await setOpen(true);
    for (const email of ["editor@populiverse.com.evil.org", "editor+x@populiverse.com", "editor@api.populiverse.com"]) {
      const b = new Browser(w);
      await b.signUp(email);
      expect((await b.fetch("/api/desk/summary")).status, email).toBe(403);
    }
  });
});

describe("Reviewer: is the Privacy page true?", () => {
  beforeEach(() => setOpen(true));

  it("R8. the Workspace sets the sign-in cookie and, during an ORCID sign-in, one short one; nothing else", async () => {
    const w = makeWorld();
    const names = new Set();
    const watch = async (res) => {
      for (const sc of (await res).headers.getSetCookie()) if (!/max-age=0/i.test(sc)) names.add(sc.split("=")[0]);
    };
    const g = new Browser(w);
    await watch(g.fetch("/api/auth/sign-in/anonymous", { method: "POST", body: {} }));
    const a = new Browser(w);
    await a.askCode("ada@example.org");
    await watch(a.fetch("/api/auth/sign-in/email-otp", { method: "POST", body: { email: "ada@example.org", otp: a.lastCode("ada@example.org") } }));
    await a.finish();
    await watch(a.fetch("/api/auth/get-session"));
    const s = await a.fetch("/api/auth/link-social", { method: "POST", body: { provider: "orcid", callbackURL: BACK, errorCallbackURL: ERR } });
    await watch(Promise.resolve(s));
    const start = { data: await s.json() };
    await watch(orcidReturns(a, start));
    expect([...names].filter((n) => !/pv\.(session_token|state)$/.test(n))).toEqual([]);
    expect([...names].some((n) => /session_token$/.test(n))).toBe(true);
  });

  it("R9. deleting an account leaves nothing with the person's email", async () => {
    const w = makeWorld();
    await setOpen(false);
    await invite("ada@example.org");
    const b = new Browser(w);
    await b.signUp("ada@example.org");
    const r = await b.json("/api/me", { method: "DELETE", body: { confirm: "delete" } });
    expect(r.status).toBe(200);
    const left = [];
    for (const [t, col] of [["user", "email"], ["invite", "email"], ["verification", "identifier"]]) {
      const n = await count(`SELECT COUNT(*) AS n FROM "${t}" WHERE ${col} LIKE '%ada@example.org%'`);
      if (n) left.push(t);
    }
    expect(left).toEqual([]);
  });

  it("R10. an account is never deleted without the warning email having gone out", async () => {
    const w = makeWorld();
    const b = new Browser(w);
    await b.signUp("ada@example.org");
    await b.newPage("ada", "x");
    const now = Date.now();
    await env.DB.prepare("UPDATE profile SET last_seen_at = ?").bind(iso(now - 731 * DAY)).run();
    // the mail service is down on the night of the warning
    const broken = { ...w.env, EMAIL: { async send() { throw new Error("mail is down"); } } };
    await nightly(broken, now);
    await nightly(w.env, now + 31 * DAY);
    expect(await count('SELECT COUNT(*) AS n FROM "user" WHERE email = \'ada@example.org\'')).toBe(1);
  });

  it("R11. a guest who signs out is gone from the database by the second night", async () => {
    const w = makeWorld();
    const b = new Browser(w);
    await b.guest();
    await b.newPage("guest", "secret");
    await b.fetch("/api/auth/sign-out", { method: "POST", body: {} });
    await nightly(w.env, Date.now() + 2 * DAY);
    expect(await count("SELECT COUNT(*) AS n FROM notebook_page")).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM "user"')).toBe(0);
  });

  it("R12. the session cookie is renewed when the workspace is used", async () => {
    const w = makeWorld();
    const b = new Browser(w);
    await b.signUp("ada@example.org");
    // two days pass
    const s = await env.DB.prepare("SELECT expiresAt, updatedAt FROM session").first();
    await env.DB.prepare("UPDATE session SET expiresAt = ?, updatedAt = ?, createdAt = ?")
      .bind(iso(Date.parse(s.expiresAt) - 2 * DAY), iso(Date.now() - 2 * DAY), iso(Date.now() - 2 * DAY)).run();
    const r = await b.fetch("/api/auth/get-session");
    const renewed = r.headers.getSetCookie().some((c) => /session_token=/.test(c) && /max-age=\d+/i.test(c));
    expect(renewed).toBe(true);
  });
});
