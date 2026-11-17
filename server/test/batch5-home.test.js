// Batch 5, Parts B and C: Home with what is new, and the newsletter button
// (master plan, section 18, stage 2, batch 5). Each test fails without its part.
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { Browser, makeWorld, setOpen, invite } from "./helpers.js";

async function member(w, email, fields) {
  const b = new Browser(w);
  await invite(email);
  await b.signUp(email, fields);
  return b;
}
const idOf = async (email) => (await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first()).id;
const visit = (b, issue = "2026-2") => b.json("/api/home", { method: "POST", body: { issue } });

describe("B. Home keeps the reader's last visit", () => {
  it("the first visit has none; the same day keeps it; the next day counts from the visit before", async () => {
    const w = makeWorld();
    const a = await member(w, "home@example.org");
    expect((await visit(a)).data.since).toBeNull();
    expect((await visit(a)).data.since).toBeNull();
    const id = await idOf("home@example.org");
    const before = "2026-11-01T09:00:00.000Z";
    await env.DB.prepare("UPDATE home_mark SET home_day = '2026-11-01', home_at = ? WHERE user_id = ?").bind(before, id).run();
    const next = (await visit(a, "2026-3")).data.since;
    expect(next).toEqual({ issue: "2026-2", at: before });
    // Opened again the same day, it says the same, even though a new issue came.
    expect((await visit(a, "2026-4")).data.since).toEqual({ issue: "2026-2", at: before });
    const row = await env.DB.prepare("SELECT home_issue FROM home_mark WHERE user_id = ?").bind(id).first();
    expect(row.home_issue).toBe("2026-4");
  });

  it("an issue that is not an issue's folder is kept as nothing", async () => {
    const w = makeWorld();
    const a = await member(w, "badissue@example.org");
    await visit(a, "../../etc");
    await visit(a, "<script>");
    const row = await env.DB.prepare("SELECT home_issue FROM home_mark WHERE user_id = ?").bind(await idOf("badissue@example.org")).first();
    expect(row.home_issue).toBe("");
  });

  it("gives back only the reader's own actors and countries, and the last draft and page that hold anything", async () => {
    const w = makeWorld();
    const a = await member(w, "follow@example.org");
    const b = await member(w, "other@example.org");
    await a.json("/api/keep", { method: "POST", body: { kind: "actor", ref: "donald-trump", title: "Donald Trump" } });
    await a.json("/api/keep", { method: "POST", body: { kind: "country", ref: "DEU", title: "Germany" } });
    await a.json("/api/keep", { method: "POST", body: { kind: "work", ref: "W1", title: "A work" } });
    await b.json("/api/keep", { method: "POST", body: { kind: "actor", ref: "viktor-orban", title: "Viktor Orbán" } });
    await a.json("/api/drafts", { method: "POST", body: { title: "My draft" } });
    await a.json("/api/drafts", { method: "POST", body: {} });
    await a.newPage("My page", "words");
    const d = (await visit(a)).data;
    expect(d.follows.map((f) => f.kind + ":" + f.ref).sort()).toEqual(["actor:donald-trump", "country:DEU"]);
    expect(d.lastDraft.title).toBe("My draft");
    expect(d.lastPage.title).toBe("My page");
    expect(JSON.stringify(d)).not.toContain("viktor-orban");
  });

  it("a guest has Home too; nobody else does", async () => {
    const w = makeWorld();
    await setOpen(true);
    const g = new Browser(w);
    await g.guest();
    expect((await visit(g)).status).toBe(200);
    expect((await visit(new Browser(w))).status).toBe(401);
    const half = new Browser(w);
    await half.signIn("halfhome@example.org");
    expect((await visit(half)).status).toBe(403);
    const a = await member(w, "site2@example.org");
    expect((await a.fetch("/api/home", { method: "POST", body: { issue: "2026-2" }, origin: "https://evil.example" })).status).toBe(403);
  });

  it("goes with the account", async () => {
    const w = makeWorld();
    const a = await member(w, "gonehome@example.org");
    await visit(a);
    const id = await idOf("gonehome@example.org");
    await a.json("/api/me", { method: "DELETE", body: { confirm: "delete" } });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM home_mark WHERE user_id = ?").bind(id).first()).n).toBe(0);
  });
});

describe("C. The newsletter button", () => {
  async function counting(fn) {
    const sent = [];
    const was = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("api.sender.net")) {
        sent.push(JSON.parse(init.body));
        return new Response("{}", { status: 200 });
      }
      return was(url, init);
    };
    try {
      await fn();
    } finally {
      globalThis.fetch = was;
    }
    return sent;
  }

  it("hands the account's own address to Sender once, however often it is pressed", async () => {
    const w = makeWorld();
    const a = await member(w, "news@example.org", { firstName: "Ada", surname: "Lovelace" });
    const sent = await counting(async () => {
      const r = await Promise.all([1, 2, 3].map(() => a.json("/api/me/newsletter", { method: "POST", body: { email: "someone@else.org" } })));
      expect(r.every((x) => x.status === 200)).toBe(true);
    });
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ email: "news@example.org", firstname: "Ada", lastname: "Lovelace" });
    const me = (await a.json("/api/me")).data;
    expect(me.newsletter).toBe(true);
    const p = await env.DB.prepare("SELECT newsletter_sent_at FROM profile WHERE user_id = ?").bind(await idOf("news@example.org")).first();
    expect(p.newsletter_sent_at).toBeTruthy();
  });

  it("a guest and an unfinished account cannot use it, and another reader is never touched", async () => {
    const w = makeWorld();
    await setOpen(true);
    const other = await member(w, "untouched@example.org");
    const g = new Browser(w);
    await g.guest();
    const half = new Browser(w);
    await half.signIn("halfnews@example.org");
    const sent = await counting(async () => {
      expect((await g.json("/api/me/newsletter", { method: "POST", body: {} })).status).toBe(403);
      expect((await half.json("/api/me/newsletter", { method: "POST", body: {} })).status).toBe(403);
    });
    expect(sent.length).toBe(0);
    expect((await other.json("/api/me")).data.newsletter).toBe(false);
  });
});
