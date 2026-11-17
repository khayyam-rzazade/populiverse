// ATTACKS ON THE SIGN-IN CODES. Every one of them must fail.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { makeWorld, Browser, setOpen, invite, EDITOR } from "./helpers.js";

describe("Attacks on the sign-in codes", () => {
  beforeEach(() => setOpen(true));

  it("18. an old code (past its 10 minutes) does not work", async () => {
    const b = new Browser(makeWorld());
    await b.askCode("ada@example.org");
    const code = b.lastCode("ada@example.org");
    await env.DB.prepare("UPDATE verification SET expiresAt = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    const r = await b.useCode("ada@example.org", code);
    expect(r.status).toBe(400);
    expect((await b.fetch("/api/me")).status).toBe(401);
  });

  it("19. a code works once only", async () => {
    const w = makeWorld();
    const b = new Browser(w);
    await b.askCode("ada@example.org");
    const code = b.lastCode("ada@example.org");
    expect((await b.useCode("ada@example.org", code)).status).toBe(200);
    const thief = new Browser(w);
    expect((await thief.useCode("ada@example.org", code)).status).toBe(400);
    expect((await thief.fetch("/api/me")).status).toBe(401);
  });

  it("20. after three wrong tries even the right code is refused", async () => {
    const b = new Browser(makeWorld());
    await b.askCode("ada@example.org");
    const code = b.lastCode("ada@example.org");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect((await b.useCode("ada@example.org", wrong)).status).not.toBe(200);
    expect((await b.useCode("ada@example.org", code)).status).not.toBe(200);
    expect((await b.fetch("/api/me")).status).toBe(401);
  });

  it("21. a code sent to one address does not open another", async () => {
    const b = new Browser(makeWorld());
    await b.askCode("ada@example.org");
    const code = b.lastCode("ada@example.org");
    expect((await b.useCode("bob@example.org", code)).status).toBe(400);
    expect((await b.useCode("ADA@example.org ", code)).status).not.toBe(200);
  });

  it("22. the codes are kept only as a fingerprint, never as the code itself", async () => {
    const b = new Browser(makeWorld());
    await b.askCode("ada@example.org");
    const code = b.lastCode("ada@example.org");
    const { results } = await env.DB.prepare("SELECT * FROM verification").all();
    expect(results.length).toBe(1);
    expect(JSON.stringify(results)).not.toContain(code);
  });

  it("23. asking for codes again and again is stopped", async () => {
    const b = new Browser(makeWorld());
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await b.askCode("ada@example.org")).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5)).toContain(429);
  });

  it("24. guessing codes again and again is stopped", async () => {
    const b = new Browser(makeWorld());
    await b.askCode("ada@example.org");
    const statuses = [];
    // One address may try 60 times in 10 minutes since the limits were made
    // wide enough for a room (the wrap-up before the opening, Part B); the code
    // itself died after its third wrong try long before that.
    for (let i = 0; i < 70; i++) statuses.push((await b.useCode("ada@example.org", String(100000 + i))).status);
    expect(statuses).toContain(429);
    expect(statuses).not.toContain(200);
  });
});

describe("Attacks on the closed workspace", () => {
  beforeEach(() => setOpen(false));

  it("25. while closed, an uninvited address gets no code, only a note, and the page cannot tell", async () => {
    const w = makeWorld();
    const b = new Browser(w);
    await invite("invited@example.org");
    const a = await b.askCode("stranger@example.org");
    const c = await b.askCode("invited@example.org");
    expect(a.status).toBe(200);
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(c.data));
    const note = w.outbox.find((m) => m.to === "stranger@example.org");
    expect(note.subject).not.toMatch(/\d{6}/);
    expect(note.text).not.toMatch(/\b\d{6}\b/);
    expect(note.text).toContain("by invitation");
    expect(b.lastCode("invited@example.org")).toMatch(/^\d{6}$/);
  });

  it("26. while closed, a stranger cannot open an account even with a stolen look at the database", async () => {
    // the library still makes a code for the stranger; we try every way to use it
    const w = makeWorld();
    const b = new Browser(w);
    await b.askCode("stranger@example.org");
    for (let i = 0; i < 3; i++) await b.useCode("stranger@example.org", String(123450 + i));
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM "user"').first();
    expect(n).toBe(0);
  });

  it("27. while closed, the guest door is shut", async () => {
    const b = new Browser(makeWorld());
    const r = await b.guest();
    expect(r.status).not.toBe(200);
    expect((await b.fetch("/api/me")).status).toBe(401);
  });

  it("28. while closed, the invited and the editor can sign up", async () => {
    const w = makeWorld();
    await invite("invited@example.org");
    const a = new Browser(w);
    expect((await a.signIn("invited@example.org")).status).toBe(200);
    const e = new Browser(w);
    expect((await e.signIn(EDITOR)).status).toBe(200);
  });
});
