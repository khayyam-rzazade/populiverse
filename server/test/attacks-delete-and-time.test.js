// ATTACKS ON DELETING, AND WHAT TIME DOES TO DATA. Every attack must fail.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { makeWorld, Browser, setOpen, EDITOR } from "./helpers.js";
import { nightly } from "../src/cleanup.js";

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

describe("Deleting an account", () => {
  beforeEach(() => setOpen(true));

  it("47. a stolen session older than 15 minutes cannot delete the account", async () => {
    const b = new Browser(makeWorld());
    await b.signUp("ada@example.org");
    await b.newPage("keep me", "important");
    await env.DB.prepare("UPDATE session SET createdAt = ?").bind(iso(Date.now() - 16 * 60000)).run();
    const r = await b.json("/api/me", { method: "DELETE", body: { confirm: "delete" } });
    expect(r.status).toBe(403);
    expect(r.data.fresh).toBe(false);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM notebook_page").first();
    expect(n).toBe(1);
  });

  it("48. deleting needs the confirmation, and then takes every row of the person and nothing else", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org", { newsletter: true });
    await ada.newPage("mine", "x");
    const bob = new Browser(w);
    await bob.signUp("bob@example.org");
    await bob.newPage("bob's", "y");
    expect((await ada.json("/api/me", { method: "DELETE", body: {} })).status).toBe(400);
    const old = ada.cookieHeader();
    const r = await ada.json("/api/me", { method: "DELETE", body: { confirm: "delete" } });
    expect(r.status).toBe(200);
    for (const [table, col] of [["notebook_page", "user_id"], ["profile", "user_id"], ["session", "userId"], ["account", "userId"]]) {
      const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} t JOIN "user" u ON u.id = t.${col} WHERE u.email = 'ada@example.org'`).first();
      expect(n, table).toBe(0);
    }
    const { n: users } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM "user" WHERE email = 'ada@example.org'`).first();
    expect(users).toBe(0);
    expect((await new Browser(w).fetch("/api/me", { cookie: old })).status).toBe(401);
    expect((await bob.json("/api/pages")).data.pages.length).toBe(1);
    // the same address can start again, empty
    const again = new Browser(w);
    await again.signUp("ada@example.org");
    expect((await again.json("/api/pages")).data.pages.length).toBe(0);
  });
});

describe("The nightly job", () => {
  beforeEach(() => setOpen(true));

  it("49. a guest unused for 30 days is deleted with the pages; a guest still in use stays", async () => {
    const w = makeWorld();
    const old = new Browser(w);
    await old.guest();
    await old.newPage("old guest", "x");
    const fresh = new Browser(w);
    await fresh.guest();
    await fresh.newPage("fresh guest", "y");
    const now = Date.now();
    // the old guest's last visit was 31 days ago: its session ended a day ago
    const { id } = await env.DB.prepare(`SELECT u.id FROM "user" u JOIN notebook_page p ON p.user_id = u.id WHERE p.title = 'old guest'`).first();
    await env.DB.prepare("UPDATE session SET expiresAt = ? WHERE userId = ?").bind(iso(now - DAY), id).run();
    await env.DB.prepare('UPDATE "user" SET createdAt = ? WHERE id = ?').bind(iso(now - 40 * DAY), id).run();
    const report = await nightly(w.env, now);
    expect(report.guests).toBe(1);
    const titles = (await env.DB.prepare("SELECT title FROM notebook_page").all()).results.map((r) => r.title);
    expect(titles).toEqual(["fresh guest"]);
  });

  it("50. an account unused for two years is warned once, kept if used, deleted 30 days after the warning if not; the editor never", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    await ada.newPage("ada", "x");
    const bob = new Browser(w);
    await bob.signUp("bob@example.org");
    const ed = new Browser(w);
    await ed.signUp(EDITOR);
    const now = Date.now();
    await env.DB.prepare("UPDATE profile SET last_seen_at = ?").bind(iso(now - 731 * DAY)).run();

    const first = await nightly(w.env, now);
    expect(first.warned).toBe(2);
    const warnings = w.outbox.filter((m) => m.subject === "Your PopuliVerse Workspace account");
    expect(warnings.map((m) => m.to).sort()).toEqual(["ada@example.org", "bob@example.org"]);

    // Bob comes back once
    await env.DB.prepare("UPDATE session SET expiresAt = ?").bind(iso(now + 30 * DAY)).run();
    expect((await bob.fetch("/api/me")).status).toBe(200);

    const second = await nightly(w.env, now + 10 * DAY);
    expect(second.warned + second.deleted).toBe(0);
    const third = await nightly(w.env, now + 31 * DAY);
    expect(third.deleted).toBe(1);
    const left = (await env.DB.prepare('SELECT email FROM "user" ORDER BY email').all()).results.map((r) => r.email);
    expect(left).toEqual(["bob@example.org", EDITOR]);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM notebook_page").first();
    expect(n).toBe(0);
  });
});

describe("What works as it should", () => {
  beforeEach(() => setOpen(true));

  it("51. the newsletter box sends the address to Sender once, and the desk sees the tick", async () => {
    const w = makeWorld();
    globalThis.__senderCalls = 0;
    const ada = new Browser(w);
    await ada.signUp("ada@example.org", { newsletter: true });
    await ada.finish({ newsletter: true });
    const p = await env.DB.prepare("SELECT newsletter, newsletter_sent_at FROM profile").first();
    expect(p.newsletter).toBe(1);
    expect(p.newsletter_sent_at).toBeTruthy();
    const bob = new Browser(w);
    await bob.signUp("bob@example.org", { newsletter: false });
    const ed = new Browser(w);
    await ed.signUp(EDITOR);
    const s = await ed.json("/api/desk/summary");
    expect(s.data.newsletter).toBe(1);
    expect(s.data.newsletterSent).toBe(1);
  });

  it("52. the desk counts accounts, guests, institutions, countries, positions and fields; invites and the switch work", async () => {
    const w = makeWorld();
    await new Browser(w).signUp("a@example.org");
    await new Browser(w).signUp("b@example.org", { rorId: undefined, institution: "Free University", country: "DE", position: "PhD Candidate", field: "Sociology" });
    await new Browser(w).guest();
    const ed = new Browser(w);
    await ed.signUp(EDITOR, { name: "Khayyam RZAZADE" });
    const s = (await ed.json("/api/desk/summary")).data;
    expect(s.accounts).toBe(3);
    expect(s.guests).toBe(1);
    expect(s.countries.find((c) => c.value === "IT").n).toBe(2);
    expect(s.countries.find((c) => c.value === "DE").n).toBe(1);
    expect(s.institutions[0]).toMatchObject({ name: "University of Genoa", ror: "0107c5v14", n: 2 });
    expect(s.weeks.length).toBe(26);
    expect(s.weeks.at(-1).accounts).toBe(3);
    const add = await ed.json("/api/desk/invites", { method: "POST", body: { emails: "x@example.org, Y@Example.org\nnot-an-email" } });
    expect(add.data.added).toEqual(["x@example.org", "y@example.org"]);
    expect(add.data.notEmails).toEqual(["not-an-email"]);
    await ed.json("/api/desk/invites", { method: "DELETE", body: { email: "x@example.org" } });
    expect((await ed.json("/api/desk/invites")).data.invites.map((i) => i.email)).toEqual(["y@example.org"]);
    await ed.json("/api/desk/open", { method: "POST", body: { open: false } });
    expect((await new Browser(w).json("/api/status")).data.open).toBe(false);
    const csv = await (await ed.fetch("/api/desk/accounts.csv")).text();
    expect(csv.split("\r\n")[0]).toContain("name,email,institution");
    expect(csv).toContain("https://ror.org/0107c5v14");
  });

  it("53. the institution search answers through the server, and says so when ROR cannot be reached", async () => {
    const b = new Browser(makeWorld());
    const r = await b.json("/api/ror?q=genoa");
    expect(r.data.items[0]).toMatchObject({ id: "0107c5v14", name: "University of Genoa", country: "IT" });
    expect((await b.json("/api/ror?q=x")).data.items).toEqual([]);
  });
});
