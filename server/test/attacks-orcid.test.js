// ATTACKS THROUGH ORCID. Every one of them must fail.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { makeWorld, Browser, setOpen, SITE } from "./helpers.js";
import { ORCID_SUB } from "./outside.js";

const BACK = SITE + "/workspace/";
const ERR = SITE + "/workspace/?orcid=no";

async function startOrcid(b, door = "/api/auth/sign-in/social") {
  const r = await b.json(door, { method: "POST", body: { provider: "orcid", callbackURL: BACK, errorCallbackURL: ERR } });
  return r;
}

async function orcidReturns(b, start, code = "good-code") {
  const state = new URL(start.data.url).searchParams.get("state");
  return b.fetch(`/api/auth/callback/orcid?code=${code}&state=${encodeURIComponent(state)}`, { origin: null });
}

describe("Attacks through ORCID", () => {
  beforeEach(() => setOpen(true));

  it("40. an ORCID iD that no account has connected opens no account", async () => {
    const b = new Browser(makeWorld());
    const s = await startOrcid(b);
    expect(s.status).toBe(200);
    expect(s.data.url).toContain("https://orcid.org/oauth/authorize");
    const back = await orcidReturns(b, s);
    expect(back.status).toBe(302);
    expect(back.headers.get("Location")).toContain(ERR);
    expect((await b.fetch("/api/me")).status).toBe(401);
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM "user"').first();
    expect(n).toBe(0);
  });

  it("41. connecting ORCID inside an account, then signing in with it, opens that account", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    const s = await startOrcid(ada, "/api/auth/link-social");
    expect(s.status).toBe(200);
    const back = await orcidReturns(ada, s);
    expect(back.status).toBe(302);
    expect(back.headers.get("Location")).toBe(BACK);
    expect((await ada.json("/api/me")).data.orcid).toBe(ORCID_SUB);
    // the name and email of the account do not change
    expect((await ada.json("/api/me")).data.email).toBe("ada@example.org");

    const later = new Browser(w);
    const s2 = await startOrcid(later);
    const back2 = await orcidReturns(later, s2);
    expect(back2.headers.get("Location")).toBe(BACK);
    const me = await later.json("/api/me");
    expect(me.data.email).toBe("ada@example.org");
  });

  it("42. one ORCID iD cannot be connected to a second account", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    await orcidReturns(ada, await startOrcid(ada, "/api/auth/link-social"));
    const bob = new Browser(w);
    await bob.signUp("bob@example.org");
    const back = await orcidReturns(bob, await startOrcid(bob, "/api/auth/link-social"));
    expect(back.headers.get("Location")).not.toBe(BACK);
    expect((await bob.json("/api/me")).data.orcid).toBe(null);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM account WHERE providerId = 'orcid'").first();
    expect(n).toBe(1);
  });

  it("43. a return from ORCID with a forged state, or someone else's state, signs nobody in", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    await orcidReturns(ada, await startOrcid(ada, "/api/auth/link-social"));
    await ada.fetch("/api/auth/sign-out", { method: "POST", body: {} });

    const victimStart = await startOrcid(ada);
    const attacker = new Browser(w);
    // the attacker has the state from the link, but not the cookie that goes with it
    const r1 = await orcidReturns(attacker, victimStart);
    expect((await attacker.fetch("/api/me")).status).toBe(401);
    const r2 = await attacker.fetch(`/api/auth/callback/orcid?code=good-code&state=forged`, { origin: null });
    expect((await attacker.fetch("/api/me")).status).toBe(401);
    expect([r1.status, r2.status].every((s) => s === 302 || s >= 400)).toBe(true);
  });

  it("44. a code that ORCID did not give is refused", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    await orcidReturns(ada, await startOrcid(ada, "/api/auth/link-social"));
    const b = new Browser(w);
    const back = await orcidReturns(b, await startOrcid(b), "bad-code");
    expect(back.headers.get("Location")).not.toBe(BACK);
    expect((await b.fetch("/api/me")).status).toBe(401);
  });

  it("45. the sign-in will not send a person back to another site", async () => {
    const b = new Browser(makeWorld());
    for (const callbackURL of ["https://evil.example/", "//evil.example/", "https://populiverse.com.evil.example/"]) {
      const r = await b.json("/api/auth/sign-in/social", { method: "POST", body: { provider: "orcid", callbackURL } });
      expect(r.status, callbackURL).toBe(403);
    }
  });

  it("46. disconnecting ORCID leaves the account, and ORCID then opens nothing", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    await orcidReturns(ada, await startOrcid(ada, "/api/auth/link-social"));
    expect((await ada.json("/api/me/orcid", { method: "DELETE" })).status).toBe(200);
    expect((await ada.json("/api/me")).data.orcid).toBe(null);
    const b = new Browser(w);
    await orcidReturns(b, await startOrcid(b));
    expect((await b.fetch("/api/me")).status).toBe(401);
  });
});
