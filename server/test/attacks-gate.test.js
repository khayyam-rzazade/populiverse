// ATTACKS ON THE GATE. Every one of them must fail.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { makeWorld, Browser, setOpen, SITE } from "./helpers.js";
import { ROUTES } from "../src/routes.js";

const sample = (path) => path.replace(":id", "00000000-0000-0000-0000-000000000000");

describe("Attacks that try to skip the sign-in", () => {
  beforeEach(() => setOpen(true));

  it("1. every route behind the gate refuses a visitor with no session", async () => {
    const b = new Browser(makeWorld());
    for (const r of ROUTES.filter((r) => r.access !== "public")) {
      const res = await b.fetch(sample(r.path), { method: r.method, body: r.method === "GET" ? undefined : {} });
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it("2. every route refuses a forged session cookie", async () => {
    const b = new Browser(makeWorld());
    for (const cookie of [
      "__Secure-pv.session_token=forged.forged",
      "__Secure-pv.session_token=" + "a".repeat(32) + "." + "b".repeat(43),
      "pv.session_token=forged"
    ]) {
      for (const r of ROUTES.filter((r) => r.access !== "public")) {
        const res = await b.fetch(sample(r.path), { method: r.method, cookie, body: r.method === "GET" ? undefined : {} });
        expect(res.status, `${r.method} ${r.path} with ${cookie}`).toBe(401);
      }
    }
  });

  it("3. a session taken from the database without its signature does not work", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    const { token } = await env.DB.prepare("SELECT token FROM session LIMIT 1").first();
    const thief = new Browser(w);
    const res = await thief.fetch("/api/me", { cookie: `__Secure-pv.session_token=${token}` });
    expect(res.status).toBe(401);
  });

  it("4. after signing out, the old cookie opens nothing", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    const old = ada.cookieHeader();
    await ada.fetch("/api/auth/sign-out", { method: "POST", body: {} });
    const res = await new Browser(w).fetch("/api/me", { cookie: old });
    expect(res.status).toBe(401);
  });

  it("5. after 'sign out everywhere', no session of the account works", async () => {
    const w = makeWorld();
    const one = new Browser(w);
    await one.signUp("ada@example.org");
    const two = new Browser(w);
    await two.signIn("ada@example.org");
    const res1 = await two.fetch("/api/auth/revoke-sessions", { method: "POST", body: {} });
    expect(res1.status).toBe(200);
    expect((await one.fetch("/api/me")).status).toBe(401);
    expect((await two.fetch("/api/me")).status).toBe(401);
  });

  it("6. an expired session is refused", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    await env.DB.prepare("UPDATE session SET expiresAt = ?").bind("2020-01-01T00:00:00.000Z").run();
    expect((await ada.fetch("/api/me")).status).toBe(401);
  });

  it("7. a request from another site, or from no site, is refused", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    for (const origin of ["https://evil.example", "https://populiverse.com.evil.example", "http://populiverse.com", "null", null]) {
      expect((await ada.fetch("/api/me", { origin })).status, String(origin)).toBe(403);
      expect((await ada.fetch("/api/pages", { method: "POST", origin, body: { title: "x" } })).status).toBe(403);
      expect((await ada.fetch("/api/auth/sign-out", { method: "POST", origin, body: {} })).status).toBe(403);
    }
    // and the answer to the site itself names only the site
    const ok = await ada.fetch("/api/me");
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
    const pre = await ada.fetch("/api/me", { method: "OPTIONS", origin: "https://evil.example" });
    expect(pre.status).toBe(403);
  });

  it("8. the doors of the sign-in library that the workspace does not use are shut", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    const shut = [
      ["POST", "/api/auth/sign-up/email", { email: "x@example.org", password: "longpassword1", name: "x" }],
      ["POST", "/api/auth/sign-in/email", { email: "ada@example.org", password: "x" }],
      ["POST", "/api/auth/update-user", { name: "Hacked", image: "https://evil.example/x.png" }],
      ["POST", "/api/auth/change-email", { newEmail: "evil@example.org" }],
      ["POST", "/api/auth/delete-user", {}],
      ["GET", "/api/auth/list-accounts"],
      ["GET", "/api/auth/list-sessions"],
      ["POST", "/api/auth/unlink-account", { providerId: "orcid" }],
      ["POST", "/api/auth/email-otp/request-email-change", { newEmail: "evil@example.org" }],
      ["POST", "/api/auth/email-otp/send-verification-otp", { email: "ada@example.org", type: "forget-password" }],
      ["POST", "/api/auth/email-otp/send-verification-otp", { email: "ada@example.org", type: "email-verification" }],
      ["POST", "/api/auth/delete-anonymous-user", {}],
      ["GET", "/api/auth/ok"],
      ["GET", "/api/auth/reference"],
      ["POST", "/api/auth/sign-in/social", { provider: "google", callbackURL: "https://populiverse.com/" }],
      ["POST", "/api/auth/link-social", { provider: "github", callbackURL: "https://populiverse.com/" }]
    ];
    for (const [method, path, body] of shut) {
      const res = await ada.fetch(path, { method, body });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const me = await ada.json("/api/me");
    expect(me.data.name).toBe("Test Person");
    expect(me.data.email).toBe("ada@example.org");
  });

  it("9. the session cookie cannot be read by scripts and travels only over HTTPS", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.askCode("ada@example.org");
    const res = await ada.fetch("/api/auth/sign-in/email-otp", {
      method: "POST",
      body: { email: "ada@example.org", otp: ada.lastCode("ada@example.org") }
    });
    const sc = res.headers.getSetCookie().find((c) => c.includes("session_token"));
    expect(sc).toMatch(/^__Secure-pv\.session_token=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=Lax/i);
  });
});
