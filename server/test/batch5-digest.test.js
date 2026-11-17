// Batch 5, Part D: the email of what is new (master plan, section 18, stage 2,
// batch 5). Each test fails without its part. The site's two files are stood
// in for here, so nothing reaches the internet.
import { describe, it, expect, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { Browser, makeWorld, setOpen, invite, EDITOR, API } from "./helpers.js";
import { sendDigests } from "../src/digest.js";

const ITEM = (folder, n, actors, iso, title) => ({ issue: folder.replace("-", "/"), folder, n, title, type: "Election", date: "2026-11-05", iso, actors, k: "full" });
let MON = null;
let LIB = null;
let libAsked = 0;
const was = globalThis.fetch;
function standIn() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://populiverse.com/data/monitor.json")) return MON ? new Response(JSON.stringify(MON)) : new Response("no", { status: 503 });
    if (u.startsWith("https://populiverse.com/library/library-list.json")) {
      libAsked++;
      return LIB ? new Response(JSON.stringify(LIB)) : new Response("no", { status: 503 });
    }
    return was(url, init);
  };
}
afterEach(() => {
  globalThis.fetch = was;
  MON = LIB = null;
  libAsked = 0;
});

function monitor(folder, items) {
  return { issue: folder.replace("-", "/"), folder, items, actors: [], places: { DEU: ["Germany", "276", "europe", 10, 51, 0, "germany"], HUN: ["Hungary", "348", "europe", 19, 47, 0, "hungary"] } };
}

async function member(w, email, fields) {
  const b = new Browser(w);
  await invite(email);
  await b.signUp(email, fields);
  return b;
}
const idOf = async (email) => (await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first()).id;
const live = (on = true) => env.DB.prepare("INSERT INTO setting (key, value) VALUES ('digest', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(on ? "on" : "off").run();
const digests = (w) => w.outbox.filter((m) => /on what you follow$/.test(m.subject));
const follow = (b, kind, ref, title) => b.json("/api/keep", { method: "POST", body: { kind, ref, title } });

// A reader who asked, with the first night behind them (issue 2026-2 newest then).
async function reader(w, email, fields) {
  const b = await member(w, email, fields);
  await b.json("/api/me/email", { method: "PATCH", body: { on: true } });
  await env.DB.prepare("UPDATE digest SET sent_issue = '2026-2', sent_at = '2026-10-01T00:00:00.000Z' WHERE user_id = ?").bind(await idOf(email)).run();
  return b;
}

describe("D. One email for each new issue, to those who asked, with what they follow", () => {
  it("sends the items and the new works, plain, with why it came and the link that stops it", async () => {
    const w = makeWorld();
    standIn();
    const a = await reader(w, "ada@example.org", { firstName: "Ada", surname: "Lovelace" });
    await follow(a, "actor", "viktor-orban", "Viktor Orbán");
    await follow(a, "country", "DEU", "Germany");
    MON = monitor("2026-3", [
      ITEM("2026-2", 1, ["viktor-orban"], ["HUN"], "An item already sent"),
      ITEM("2026-3", 1, ["viktor-orban"], ["HUN"], "Orbán calls an election"),
      ITEM("2026-3", 2, [], ["FRA"], "Not followed"),
      { ...ITEM("2026-3", 3, [], ["DEU"], "Germany"), k: "entry", s: "The AfD leads a poll." }
    ]);
    LIB = { entries: [
      { added: "2026-11-01T00:00:00Z", country: ["country:germany"] },
      { added: "2026-11-02T00:00:00Z", country: ["country:germany", "country:hungary"] },
      { added: "2026-09-01T00:00:00Z", country: ["country:germany"] }
    ] };
    await live();
    const r = await sendDigests(w.env);
    expect(r.sent).toBe(1);
    const m = digests(w);
    expect(m.length).toBe(1);
    expect(m[0].to).toBe("ada@example.org");
    expect(m[0].subject).toBe("PopuliVerse Monitor 2026/3 on what you follow");
    expect(m[0].html).toBeUndefined();
    const t = m[0].text;
    expect(t).toContain("Hello Ada,");
    expect(t).toContain("Orbán calls an election\nPopuliVerse Monitor 2026/3, item 1 · 5 November 2026 · Viktor Orbán\nhttps://populiverse.com/monitor/2026-3/#item-1");
    expect(t).toContain("Germany. The AfD leads a poll.\nPopuliVerse Monitor 2026/3, item 3");
    expect(t).not.toContain("Not followed");
    expect(t).not.toContain("An item already sent");
    expect(t).toContain("2 new works on Germany in the Library\nhttps://populiverse.com/library/?country=germany&sort=added");
    expect(t).toMatch(/You get this email because you asked for it in your PopuliVerse Workspace\. To stop it, open this link and press Stop the Email\. You do not need to sign in\.\nhttps:\/\/api\.populiverse\.com\/api\/stop\/[A-Za-z0-9_-]{43}\n/);
  });

  it("a second run sends nothing, and two runs at once send one", async () => {
    const w = makeWorld();
    standIn();
    const a = await reader(w, "twice@example.org");
    await follow(a, "actor", "viktor-orban", "Viktor Orbán");
    MON = monitor("2026-3", [ITEM("2026-3", 1, ["viktor-orban"], ["HUN"], "Item")]);
    await live();
    await Promise.all([sendDigests(w.env), sendDigests(w.env)]);
    await sendDigests(w.env);
    expect(digests(w).length).toBe(1);
  });

  it("never empty: a reader with nothing new gets no email, and is not asked again for that issue", async () => {
    const w = makeWorld();
    standIn();
    const a = await reader(w, "empty@example.org");
    await follow(a, "actor", "giorgia-meloni", "Giorgia Meloni");
    MON = monitor("2026-3", [ITEM("2026-3", 1, ["viktor-orban"], ["HUN"], "Item")]);
    await live();
    const r = await sendDigests(w.env);
    expect(r.nothing).toBe(1);
    expect(digests(w).length).toBe(0);
    const row = await env.DB.prepare("SELECT sent_issue FROM digest WHERE user_id = ?").bind(await idOf("empty@example.org")).first();
    expect(row.sent_issue).toBe("2026-3");
  });

  it("the first night after asking only marks where the emails start", async () => {
    const w = makeWorld();
    standIn();
    const a = await member(w, "fresh@example.org");
    await follow(a, "actor", "viktor-orban", "Viktor Orbán");
    await a.json("/api/me/email", { method: "PATCH", body: { on: true } });
    MON = monitor("2026-3", [ITEM("2026-3", 1, ["viktor-orban"], ["HUN"], "Item")]);
    await live();
    expect((await sendDigests(w.env)).started).toBe(1);
    expect(digests(w).length).toBe(0);
    MON = monitor("2026-4", [ITEM("2026-4", 1, ["viktor-orban"], ["HUN"], "Next")]);
    await sendDigests(w.env);
    expect(digests(w).length).toBe(1);
    expect(digests(w)[0].text).toContain("Next");
  });

  it("nothing leaves while the editor's main switch is off, and nothing is sent to anyone who did not ask", async () => {
    const w = makeWorld();
    standIn();
    const a = await reader(w, "off@example.org");
    await follow(a, "actor", "viktor-orban", "Viktor Orbán");
    const b = await member(w, "notasked@example.org");
    await follow(b, "actor", "viktor-orban", "Viktor Orbán");
    MON = monitor("2026-3", [ITEM("2026-3", 1, ["viktor-orban"], ["HUN"], "Item")]);
    expect((await sendDigests(w.env)).live).toBe(false);
    await live(false);
    await sendDigests(w.env);
    expect(digests(w).length).toBe(0);
    await live();
    await sendDigests(w.env);
    expect(digests(w).map((m) => m.to)).toEqual(["off@example.org"]);
  });

  it("one email that fails does not stop the others, and it is tried again the next night", async () => {
    const w = makeWorld();
    standIn();
    for (const e of ["f1@example.org", "f2@example.org", "f3@example.org"]) {
      const b = await reader(w, e);
      await follow(b, "actor", "viktor-orban", "Viktor Orbán");
    }
    MON = monitor("2026-3", [ITEM("2026-3", 1, ["viktor-orban"], ["HUN"], "Item")]);
    await live();
    const send = w.env.EMAIL.send;
    w.env.EMAIL.send = async (m) => {
      if (m.to === "f2@example.org" && /what you follow/.test(m.subject)) throw new Error("down");
      return send(m);
    };
    const r = await sendDigests(w.env);
    expect(r.sent).toBe(2);
    expect(r.failed).toBe(1);
    w.env.EMAIL.send = send;
    await sendDigests(w.env);
    expect(digests(w).map((m) => m.to).sort()).toEqual(["f1@example.org", "f2@example.org", "f3@example.org"]);
  });

  it("waits a night rather than leave out the works when the Library's list cannot be read", async () => {
    const w = makeWorld();
    standIn();
    const a = await reader(w, "lib@example.org");
    await follow(a, "country", "DEU", "Germany");
    MON = monitor("2026-3", [ITEM("2026-3", 1, [], ["DEU"], "Item")]);
    LIB = null;
    await live();
    expect((await sendDigests(w.env)).failed).toBe(1);
    expect(digests(w).length).toBe(0);
    LIB = { entries: [] };
    await sendDigests(w.env);
    expect(digests(w).length).toBe(1);
  });
});

describe("D. Attacks on the email of what is new", () => {
  it("a guest, a deleted account and an unfinished account are never sent anything", async () => {
    const w = makeWorld();
    standIn();
    await setOpen(true);
    const g = new Browser(w);
    await g.guest();
    expect((await g.json("/api/me/email", { method: "PATCH", body: { on: true } })).status).toBe(403);
    const half = new Browser(w);
    await half.signIn("half@example.org");
    await half.json("/api/me");
    expect((await half.json("/api/me/email", { method: "PATCH", body: { on: true } })).status).toBe(403);
    // Rows put in by hand, as if a door had been found: the job still sends
    // nothing. The guest is even given a finished profile, so that only its
    // being a guest keeps it out.
    const gid = (await env.DB.prepare('SELECT id FROM "user" WHERE isAnonymous = 1').first()).id;
    await env.DB.prepare("INSERT INTO profile (user_id, surname, completed_at) VALUES (?, 'Guest', ?)").bind(gid, new Date().toISOString()).run();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM profile WHERE user_id = ?").bind(await idOf("half@example.org")).first()).n).toBe(1);
    for (const id of [gid, await idOf("half@example.org")]) {
      await env.DB.prepare("INSERT INTO digest (user_id, wanted, stop_token, sent_issue) VALUES (?, 1, ?, '2026-2')").bind(id, crypto.randomUUID()).run();
      await env.DB.prepare("INSERT INTO kept (id, user_id, kind, ref, created_at, updated_at) VALUES (?, ?, 'actor', 'viktor-orban', '', '')").bind(crypto.randomUUID(), id).run();
    }
    const gone = await reader(w, "gone@example.org");
    await follow(gone, "actor", "viktor-orban", "Viktor Orbán");
    const goneId = await idOf("gone@example.org");
    await gone.json("/api/me", { method: "DELETE", body: { confirm: "delete" } });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM digest WHERE user_id = ?").bind(goneId).first()).n).toBe(0);
    MON = monitor("2026-3", [ITEM("2026-3", 1, ["viktor-orban"], ["HUN"], "Item")]);
    await live();
    await sendDigests(w.env);
    expect(digests(w).length).toBe(0);
  });

  it("nobody turns the email on or off for another reader", async () => {
    const w = makeWorld();
    const a = await member(w, "a@example.org");
    const b = await member(w, "b@example.org");
    const bId = await idOf("b@example.org");
    await a.json("/api/me/email", { method: "PATCH", body: { on: true, user_id: bId, userId: bId } });
    expect((await b.json("/api/me")).data.emailOn).toBe(false);
    await b.json("/api/me/email", { method: "PATCH", body: { on: true } });
    await a.json("/api/me/email", { method: "PATCH", body: { on: false, user_id: bId } });
    expect((await b.json("/api/me")).data.emailOn).toBe(true);
    expect((await a.fetch("/api/me/email", { method: "PATCH", body: { on: true }, origin: "https://evil.example" })).status).toBe(403);
    expect((await new Browser(w).json("/api/me/email", { method: "PATCH", body: { on: true } })).status).toBe(401);
  });

  it("the link that stops it cannot be guessed, needs no sign-in, and only stops", async () => {
    const w = makeWorld();
    const a = await member(w, "stop@example.org");
    await a.json("/api/me/email", { method: "PATCH", body: { on: true } });
    const b = await member(w, "keep@example.org");
    await b.json("/api/me/email", { method: "PATCH", body: { on: true } });
    const row = await env.DB.prepare("SELECT stop_token FROM digest WHERE user_id = ?").bind(await idOf("stop@example.org")).first();
    expect(row.stop_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const tokens = await env.DB.prepare("SELECT stop_token FROM digest").all();
    expect(new Set(tokens.results.map((x) => x.stop_token)).size).toBe(2);
    const stranger = new Browser(w);
    // A wrong key, a short one and a key with other letters change nothing and look the same.
    const wrong = await stranger.fetch(`/api/stop/${"A".repeat(43)}`, { origin: null });
    expect(wrong.status).toBe(200);
    const wrongPage = await wrong.text();
    expect((await stranger.fetch("/api/stop/abc", { origin: null })).status).toBe(403);
    expect((await stranger.fetch(`/api/stop/${"%27".repeat(15)}`, { origin: null })).status).toBe(403);
    expect((await a.json("/api/me")).data.emailOn).toBe(true);
    // Opening the link shows a page with one button and changes nothing, since
    // mail systems open every link to scan it (Fable's check of batch 5, F2).
    const res = await stranger.fetch(`/api/stop/${row.stop_token}`, { origin: null });
    expect(res.status).toBe(200);
    const asked = await res.text();
    expect(asked).toBe(wrongPage);
    expect(asked).toContain('<form method="post">');
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.getSetCookie().length).toBe(0);
    expect((await a.json("/api/me")).data.emailOn).toBe(true);
    // The button of a wrong key changes nothing and looks the same as a right one.
    const wrongPress = await stranger.fetch(`/api/stop/${"A".repeat(43)}`, { method: "POST", origin: null });
    expect(wrongPress.status).toBe(200);
    const wrongDone = await wrongPress.text();
    expect((await a.json("/api/me")).data.emailOn).toBe(true);
    // The button stops that email, sets no cookie, and does nothing else.
    const press = await stranger.fetch(`/api/stop/${row.stop_token}`, { method: "POST", origin: "https://api.populiverse.com" });
    expect(press.status).toBe(200);
    expect(await press.text()).toBe(wrongDone);
    expect(press.headers.getSetCookie().length).toBe(0);
    expect((await a.json("/api/me")).data.emailOn).toBe(false);
    expect((await b.json("/api/me")).data.emailOn).toBe(true);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM "user"').first();
    expect(after.n).toBe(2);
    // No other way in: a HEAD, a PUT or a DELETE is not a door.
    for (const method of ["HEAD", "PUT", "DELETE"]) {
      expect((await stranger.fetch(`/api/stop/${row.stop_token}`, { method, origin: null })).status).toBe(403);
    }
  });

  it("turning it on again starts afresh, so an issue that came while it was off never arrives late", async () => {
    const w = makeWorld();
    standIn();
    const a = await reader(w, "again@example.org");
    await follow(a, "actor", "viktor-orban", "Viktor Orbán");
    await a.json("/api/me/email", { method: "PATCH", body: { on: false } });
    await a.json("/api/me/email", { method: "PATCH", body: { on: true } });
    MON = monitor("2026-3", [ITEM("2026-3", 1, ["viktor-orban"], ["HUN"], "Item")]);
    await live();
    await sendDigests(w.env);
    expect(digests(w).length).toBe(0);
  });
});

describe("D. The editor's main switch, and the test he sends himself first", () => {
  it("cannot be turned on before a test was sent; the test goes to the editor alone", async () => {
    const w = makeWorld();
    standIn();
    const r1 = await reader(w, "r1@example.org");
    await follow(r1, "actor", "viktor-orban", "Viktor Orbán");
    const ed = await member(w, EDITOR, { name: "Khayyam", surname: "RZAZADE" });
    expect((await r1.json("/api/desk/digest/test", { method: "POST", body: {} })).status).toBe(403);
    expect((await r1.json("/api/desk/digest", { method: "POST", body: { on: true } })).status).toBe(403);
    expect((await ed.json("/api/desk/digest", { method: "POST", body: { on: true } })).status).toBe(409);
    MON = monitor("2026-3", [ITEM("2026-3", 1, ["viktor-orban"], ["HUN"], "Orbán item")]);
    LIB = { entries: [] };
    expect((await ed.json("/api/desk/digest/test", { method: "POST", body: {} })).status).toBe(409);
    await follow(ed, "actor", "viktor-orban", "Viktor Orbán");
    const t = await ed.json("/api/desk/digest/test", { method: "POST", body: {} });
    expect(t.status).toBe(200);
    expect(digests(w).map((m) => m.to)).toEqual([EDITOR]);
    expect(digests(w)[0].subject).toBe("Test. PopuliVerse Monitor 2026/3 on what you follow");
    expect(t.data.digestReaders).toBe(1);
    expect(t.data.digestOn).toBe(false);
    expect((await ed.json("/api/me")).data.emailOn).toBe(false);
    const on = await ed.json("/api/desk/digest", { method: "POST", body: { on: true } });
    expect(on.data.digestOn).toBe(true);
    await sendDigests(w.env);
    expect(digests(w).map((m) => m.to)).toEqual([EDITOR, "r1@example.org"]);
    expect((await ed.json("/api/desk/digest")).data.digestLast).toMatchObject({ issue: "2026/3", sent: 1 });
  });
});
