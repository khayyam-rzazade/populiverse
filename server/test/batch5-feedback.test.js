// Batch 5, Part A: the feedback card (master plan, section 18, stage 2, batch 5,
// and the plan of the card of 2026-11-16). Each test here fails without its
// part of the build.
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";
import { Browser, makeWorld, setOpen, invite, EDITOR } from "./helpers.js";

const GOOD = { score: 4, uses: ["The Library", "The Monitor"], missing: "A search across issues.", help: ["Cite It in My Work"] };

async function member(w, email, fields) {
  const b = new Browser(w);
  await invite(email);
  await b.signUp(email, fields);
  return b;
}

async function yesterday(table, userId, column) {
  const day = new Date(Date.now() - 86400000).toISOString();
  await env.DB.prepare(`UPDATE ${table} SET ${column} = ? WHERE user_id = ?`).bind(column === "last_day" ? day.slice(0, 10) : day, userId).run();
}

async function idOf(email) {
  return (await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first()).id;
}

// A guest is heard from the fifth day of use (Fable's check of batch 5, F3):
// this stands in for four more days of a guest's use.
async function fiveDays(g) {
  await g.json("/api/me");
  await env.DB.prepare('UPDATE feedback_card SET days = 5 WHERE user_id IN (SELECT id FROM "user" WHERE isAnonymous = 1)').run();
}

const editorMails = (w) => w.outbox.filter((m) => m.to === EDITOR && /^Feedback card/.test(m.subject));

describe("A. Days of use are counted, once a day, for guests and finished accounts", () => {
  it("counts one day however often the Workspace asks, and the next day again", async () => {
    const w = makeWorld();
    const a = await member(w, "days@example.org");
    for (let i = 0; i < 3; i++) await a.json("/api/me");
    expect((await a.json("/api/me")).data.daysUsed).toBe(1);
    await yesterday("feedback_card", await idOf("days@example.org"), "last_day");
    expect((await a.json("/api/me")).data.daysUsed).toBe(2);
  });

  it("counts a guest too, and never an account that is not finished", async () => {
    const w = makeWorld();
    await setOpen(true);
    const g = new Browser(w);
    await g.guest();
    expect((await g.json("/api/me")).data.daysUsed).toBe(1);
    const half = new Browser(w);
    await half.signIn("half@example.org");
    expect((await half.json("/api/me")).data.daysUsed).toBe(0);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_card WHERE user_id = ?").bind(await idOf("half@example.org")).first();
    expect(row.n).toBe(0);
  });
});

describe("A. An answer, and the one email it sends to the editor", () => {
  it("keeps the answer and sends exactly one plain email to the editor", async () => {
    const w = makeWorld();
    const a = await member(w, "ada@example.org", { firstName: "Ada", surname: "Lovelace", interests: "Populist radical right" });
    const r = await a.json("/api/feedback", { method: "POST", body: GOOD });
    expect(r.status).toBe(200);
    const mails = editorMails(w);
    expect(mails.length).toBe(1);
    expect(mails[0].subject).toBe("Feedback card: 4 of 5");
    expect(mails[0].html).toBeUndefined();
    expect(mails[0].text).toContain("Who: Ada Lovelace");
    expect(mails[0].text).toContain("Email: ada@example.org");
    expect(mails[0].text).toContain("Uses it for: The Library, The Monitor");
    expect(mails[0].text).toContain("Would like to help: Cite It in My Work");
    expect(mails[0].text).toContain("  A search across issues.");
    const own = await a.json("/api/feedback");
    expect(own.data.answer.score).toBe(4);
    expect(own.data.answer.uses).toEqual(["The Library", "The Monitor"]);
  });

  it("a guest's answer names nobody in the email", async () => {
    const w = makeWorld();
    await setOpen(true);
    const g = new Browser(w);
    await g.guest();
    await fiveDays(g);
    expect((await g.json("/api/feedback", { method: "POST", body: GOOD })).status).toBe(200);
    const m = editorMails(w)[0];
    expect(m.text).toContain("Who: a guest, with no name and no email.");
    expect(m.text).not.toMatch(/guest\.populiverse\.invalid/);
  });
});

describe("A. Attacks on the card", () => {
  it("nobody answers for another reader: an id in the body is ignored, and nobody reads another's answer", async () => {
    const w = makeWorld();
    const a = await member(w, "a1@example.org");
    const b = await member(w, "b1@example.org");
    const bId = await idOf("b1@example.org");
    const r = await a.json("/api/feedback", { method: "POST", body: { ...GOOD, user_id: bId, userId: bId } });
    expect(r.status).toBe(200);
    expect((await b.json("/api/feedback")).data.answer).toBeNull();
    const rows = await env.DB.prepare("SELECT user_id FROM feedback").all();
    expect(rows.results.map((x) => x.user_id)).toEqual([await idOf("a1@example.org")]);
  });

  it("nobody answers twice past the rule: a second answer the same day is refused, even sent at once", async () => {
    const w = makeWorld();
    const a = await member(w, "twice@example.org");
    const sent = await Promise.all([1, 2, 3, 4].map((s) => a.json("/api/feedback", { method: "POST", body: { ...GOOD, score: s } })));
    expect(sent.filter((r) => r.status === 200).length).toBe(1);
    expect(sent.filter((r) => r.status === 429).length).toBe(3);
    expect(editorMails(w).length).toBe(1);
    const again = await a.json("/api/feedback", { method: "POST", body: { ...GOOD, score: 5 } });
    expect(again.status).toBe(429);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback").first()).n).toBe(1);
  });

  it("an answer can be changed on a later day, in the same row, and the editor is told it changed", async () => {
    const w = makeWorld();
    const a = await member(w, "later@example.org");
    await a.json("/api/feedback", { method: "POST", body: GOOD });
    await yesterday("feedback", await idOf("later@example.org"), "updated_at");
    const r = await a.json("/api/feedback", { method: "POST", body: { ...GOOD, score: 2 } });
    expect(r.status).toBe(200);
    expect(r.data.changed).toBe(true);
    expect(editorMails(w).map((m) => m.subject)).toEqual(["Feedback card: 4 of 5", "Feedback card: 2 of 5, changed"]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback").first()).n).toBe(1);
  });

  it("refuses what is not on the lists, and keeps nothing", async () => {
    const w = makeWorld();
    const a = await member(w, "bad@example.org");
    const bad = [
      { ...GOOD, score: 0 }, { ...GOOD, score: 6 }, { ...GOOD, score: "5" }, { ...GOOD, score: 4.5 },
      { ...GOOD, uses: ["The Library", "Money"] }, { ...GOOD, uses: "The Library" },
      { ...GOOD, help: ["Donate"] }, { ...GOOD, help: ["Not Now", "Cite It in My Work"] },
      { ...GOOD, missing: "x".repeat(2001) }, { ...GOOD, missing: { a: 1 } }
    ];
    for (const body of bad) expect((await a.json("/api/feedback", { method: "POST", body })).status).toBe(400);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback").first()).n).toBe(0);
    expect(editorMails(w).length).toBe(0);
  });

  it("not signed in, an unfinished account, and another site are refused", async () => {
    const w = makeWorld();
    const nobody = new Browser(w);
    expect((await nobody.json("/api/feedback", { method: "POST", body: GOOD })).status).toBe(401);
    const half = new Browser(w);
    await invite("half2@example.org");
    await half.signIn("half2@example.org");
    expect((await half.json("/api/feedback", { method: "POST", body: GOOD })).status).toBe(403);
    expect((await half.json("/api/feedback/later", { method: "POST", body: {} })).status).toBe(403);
    const a = await member(w, "site@example.org");
    expect((await a.fetch("/api/feedback", { method: "POST", body: GOOD, origin: "https://evil.example" })).status).toBe(403);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback").first()).n).toBe(0);
  });

  it("text typed into the card stays text in the editor's email, on the desk and in the download", async () => {
    const w = makeWorld();
    const typed = '<script>alert(1)</script>\n=HYPERLINK("http://x")\nWho: The Editor';
    const a = await member(w, "text@example.org");
    await a.json("/api/feedback", { method: "POST", body: { ...GOOD, missing: typed } });
    const m = editorMails(w)[0];
    expect(m.html).toBeUndefined();
    expect(m.text).toContain("  <script>alert(1)</script>\n  =HYPERLINK(\"http://x\")\n  Who: The Editor");
    expect(m.subject).not.toContain("script");
    const ed = await member(w, EDITOR, { name: "Khayyam", surname: "RZAZADE" });
    const desk = await ed.json("/api/desk/feedback");
    expect(desk.data.answers[0].missing).toBe(typed);
    expect(desk.res.headers.get("Content-Type")).toMatch(/application\/json/);
    const zip = unzipSync(new Uint8Array(await (await a.fetch("/api/me/export")).arrayBuffer()));
    expect(JSON.parse(strFromU8(zip["feedback.json"])).answer.missing_or_awkward).toBe(typed);
  });
});

describe("A. Not Now, and what the page is told", () => {
  it("Not Now is kept, and the answer's day is given back", async () => {
    const w = makeWorld();
    const a = await member(w, "notnow@example.org");
    expect((await a.json("/api/me")).data.cardLater).toBe(false);
    await a.json("/api/feedback/later", { method: "POST", body: {} });
    const me = (await a.json("/api/me")).data;
    expect(me.cardLater).toBe(true);
    expect(me.feedbackAt).toBeNull();
    await a.json("/api/feedback", { method: "POST", body: GOOD });
    expect((await a.json("/api/me")).data.feedbackAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("A. Who Wants to Help, on Your Desk", () => {
  it("lists each way with its people, the Commentary from registration and the card in one list, a guest in no list", async () => {
    const w = makeWorld();
    await setOpen(true);
    const reg = await member(w, "reg@example.org", { firstName: "Reg", surname: "Yes", commentary: "Yes" });
    const maybe = await member(w, "maybe@example.org", { firstName: "May", surname: "Be", commentary: "Maybe Later" });
    await member(w, "no@example.org", { firstName: "No", surname: "Body", commentary: "No" });
    const card = await member(w, "card@example.org", { firstName: "Card", surname: "Writer", commentary: "No" });
    await card.json("/api/feedback", { method: "POST", body: { ...GOOD, help: ["Write for the Commentary", "Use It in My Teaching"] } });
    await reg.json("/api/feedback", { method: "POST", body: { ...GOOD, help: ["Write for the Commentary"] } });
    const g = new Browser(w);
    await g.guest();
    await fiveDays(g);
    await g.json("/api/feedback", { method: "POST", body: { ...GOOD, help: ["Write for the Commentary"] } });

    const ed = await member(w, EDITOR, { name: "Khayyam", surname: "RZAZADE" });
    const d = (await ed.json("/api/desk/feedback")).data;
    expect(d.total).toBe(3);
    expect(d.guests).toBe(1);
    const commentary = d.ways.find((x) => x.way === "Write for the Commentary").people;
    expect(commentary.map((p) => p.email).sort()).toEqual(["card@example.org", "maybe@example.org", "reg@example.org"]);
    expect(commentary.find((p) => p.email === "reg@example.org").said).toEqual(["On the card", "At registration, Yes"]);
    expect(commentary.find((p) => p.email === "maybe@example.org").said).toEqual(["At registration, Maybe Later"]);
    expect(d.ways.find((x) => x.way === "Use It in My Teaching").people.map((p) => p.email)).toEqual(["card@example.org"]);
    expect(d.answers.filter((a) => a.guest)[0].email).toBeUndefined();
    expect(d.help.find((x) => x.value === "Write for the Commentary").n).toBe(3);
    expect(JSON.stringify(d)).not.toMatch(/guest\.populiverse\.invalid/);
    expect(maybe).toBeTruthy();
  });

  it("is the editor's only, and never holds a reader's shelf, pages or notes", async () => {
    const w = makeWorld();
    const a = await member(w, "private@example.org");
    await a.newPage("SECRET PAGE TITLE", "SECRET PAGE WORDS");
    await a.json("/api/keep/note", { method: "POST", body: { kind: "actor", ref: "donald-trump", title: "Donald Trump", body: "SECRET NOTE" } });
    await a.json("/api/feedback", { method: "POST", body: GOOD });
    expect((await a.json("/api/desk/feedback")).status).toBe(403);
    const ed = await member(w, EDITOR, { name: "Khayyam", surname: "RZAZADE" });
    const text = JSON.stringify((await ed.json("/api/desk/feedback")).data);
    expect(text).not.toMatch(/SECRET/);
  });
});

describe("A. The answer goes with the account, and comes with a guest who signs up", () => {
  it("deleting the account deletes the answer and the count", async () => {
    const w = makeWorld();
    const a = await member(w, "gone@example.org");
    await a.json("/api/feedback", { method: "POST", body: GOOD });
    const id = await idOf("gone@example.org");
    expect((await a.json("/api/me", { method: "DELETE", body: { confirm: "delete" } })).status).toBe(200);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE user_id = ?").bind(id).first()).n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_card WHERE user_id = ?").bind(id).first()).n).toBe(0);
  });

  it("a guest who signs up keeps the answer", async () => {
    const w = makeWorld();
    await setOpen(true);
    const g = new Browser(w);
    await g.guest();
    await fiveDays(g);
    await g.json("/api/feedback", { method: "POST", body: GOOD });
    await g.signUp("joined@example.org");
    expect((await g.json("/api/feedback")).data.answer.score).toBe(4);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback").first()).n).toBe(1);
  });
});
