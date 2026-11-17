// A ROOM ON ONE NETWORK (the wrap-up before the opening, Part B; master plan,
// section 17, item 37). A seminar room, a conference hall or a university can
// sit behind one internet address. Before this round the sixth person there to
// ask for a code in 10 minutes was stopped, and the eleventh guest of the hour.
// The limits by address are now wide enough for a room, and every guard that
// keeps a guess hard stays as it was: each email has its own counter, and a
// code dies after three wrong tries.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { makeWorld, Browser, setOpen, SITE } from "./helpers.js";

const ROOM = "192.0.2.10";
const inRoom = (w) => {
  const b = new Browser(w);
  b.ip = ROOM;
  return b;
};

describe("A room on one network", () => {
  beforeEach(() => setOpen(true));

  it("L1. 25 people in one room, each with an email, all get their code within a minute", async () => {
    const w = makeWorld();
    const st = [];
    for (let i = 0; i < 25; i++) st.push((await inRoom(w).askCode(`person${i}@example.org`)).status);
    expect(st.every((s) => s === 200)).toBe(true);
    for (let i = 0; i < 25; i++) expect(w.outbox.some((m) => m.to === `person${i}@example.org` && /\d{6}/.test(m.subject))).toBe(true);
  });

  it("L2. 25 people in one room sign in with their codes", async () => {
    const w = makeWorld();
    const people = Array.from({ length: 25 }, () => inRoom(w));
    for (let i = 0; i < 25; i++) await people[i].askCode(`person${i}@example.org`);
    const st = [];
    for (let i = 0; i < 25; i++) st.push((await people[i].useCode(`person${i}@example.org`, people[i].lastCode(`person${i}@example.org`))).status);
    expect(st.every((s) => s === 200)).toBe(true);
  });

  it("L3. one email is still stopped after 5 codes in an hour, from one room or from many places", async () => {
    const w = makeWorld();
    const st = [];
    for (let i = 0; i < 8; i++) st.push((await inRoom(w).askCode("ada@example.org")).status);
    expect(st.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(st.slice(5)).toEqual([429, 429, 429]);
    const elsewhere = new Browser(w);
    elsewhere.ip = "198.51.100.77";
    const r = await elsewhere.askCode("ada@example.org");
    expect(r.status).toBe(429);
    // The page shows the server's own sentence for one email.
    expect(r.data.error).toBe("Too many codes were asked for this email. Please try again later.");
    expect(w.outbox.filter((m) => m.to === "ada@example.org").length).toBe(5);
  });

  it("L4. a code is still dead after 3 wrong tries, even the right one after them", async () => {
    const w = makeWorld();
    const b = inRoom(w);
    await b.askCode("ada@example.org");
    const code = b.lastCode("ada@example.org");
    const wrong = String((Number(code) + 1) % 1000000).padStart(6, "0");
    for (let i = 0; i < 3; i++) expect((await b.useCode("ada@example.org", wrong)).status).not.toBe(200);
    const right = await b.useCode("ada@example.org", code);
    expect(right.status).not.toBe(200);
    expect(right.status).not.toBe(429);
    expect((await b.fetch("/api/me")).status).toBe(401);
  });

  it("L5. the room has a limit still: the 31st code in 10 minutes is refused, in plain words on the page", async () => {
    const w = makeWorld();
    const st = [];
    let last = null;
    for (let i = 0; i < 31; i++) {
      last = await inRoom(w).askCode(`person${i}@example.org`);
      st.push(last.status);
    }
    expect(st.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(st[30]).toBe(429);
    // The limit by address carries no sentence of the counter for one email,
    // so the page says in its own words that the network asked too many.
    expect(last.data.error).toBeUndefined();
    expect(w.outbox.length).toBe(30);
    // Another network is not touched by it.
    const other = new Browser(w);
    other.ip = "198.51.100.200";
    expect((await other.askCode("someone@example.org")).status).toBe(200);
  });

  it("L6. the room may try 60 codes in 10 minutes, and the 61st try is refused", async () => {
    const w = makeWorld();
    const b = inRoom(w);
    const st = [];
    for (let i = 0; i < 61; i++) st.push((await b.useCode(`person${i}@example.org`, "123456")).status);
    expect(st.slice(0, 60).includes(429)).toBe(false);
    expect(st[60]).toBe(429);
  });

  it("L7. the 21st guest of the hour from one room is refused, the 20 before are not", async () => {
    const w = makeWorld();
    const st = [];
    for (let i = 0; i < 21; i++) st.push((await inRoom(w).guest()).status);
    expect(st.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(st[20]).toBe(429);
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM "user" WHERE isAnonymous = 1').first();
    expect(n).toBe(20);
  });

  it("L8. a busy room asking whether it is signed in is not sent back to the doors", async () => {
    const w = makeWorld();
    const ada = inRoom(w);
    await ada.signUp("ada@example.org");
    const st = [];
    for (let i = 0; i < 100; i++) st.push((await ada.json("/api/auth/get-session")).status);
    expect(st.every((s) => s === 200)).toBe(true);
    expect((await ada.json("/api/auth/get-session")).data.user.email).toBe("ada@example.org");
  });

  it("L9. 15 members of one room connect ORCID within a few minutes", async () => {
    const w = makeWorld();
    const st = [];
    for (let i = 0; i < 15; i++) {
      const b = inRoom(w);
      await b.signUp(`person${i}@example.org`);
      const r = await b.json("/api/auth/link-social", {
        method: "POST",
        body: { provider: "orcid", callbackURL: SITE + "/workspace/account.html?orcid=yes", errorCallbackURL: SITE + "/workspace/account.html?orcid=no" }
      });
      st.push(r.status);
    }
    expect(st.every((s) => s === 200)).toBe(true);
  });
});
