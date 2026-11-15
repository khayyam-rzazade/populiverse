// Attacks on the fixes of Fable's check of batches 2 and 3 (master plan,
// section 18, the rows of 2026-11-13 on the check and on the fixes). Fable's own
// file, review-fable-3.test.js, is not changed; these stand beside it.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";
import { Browser, makeWorld, setOpen, EDITOR } from "./helpers.js";
import { addToNewsletter } from "../src/outside.js";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FIG = { ref: "in-power#map", title: "Populists in Power", source: "Sources: X.", cite: "Cite line.", url: "https://populiverse.com/data/in-power.html", day: "13 November 2026", picture: PNG };
const work = (n, more = {}) => ({ kind: "work", ref: "W" + n, title: "Author " + n + " 2020. Title " + n, extra: "Author " + n + " 2020", year: "2020", cite: "Author " + n + ". 2020. Title " + n + ".", abstract: "An abstract of work " + n + " with some words in it.", ...more });

let world;
beforeEach(async () => {
  world = makeWorld();
  await setOpen(true);
  await env.DB.batch(["project_thing", "project", "draft", "figure"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});
async function member(email, fields) { const b = new Browser(world); await b.signUp(email, fields); return b; }
async function guest() { const b = new Browser(world); const r = await b.guest(); expect(r.status).toBe(200); return b; }
const post = (b, path, body) => b.json(path, { method: "POST", body });
const patch = (b, path, body) => b.json(path, { method: "PATCH", body });
const delta = (ops) => ({ ops });

// ------------------------------------------------------------ the name

describe("Fix 16. The name in three pieces", () => {
  it("N1. a sign-up with no surname, or no first name, is refused; a middle name is not needed", async () => {
    const b = new Browser(world);
    expect((await b.signIn("n1@example.org")).status).toBe(200);
    const tries = [
      { firstName: "Ada", surname: "" },
      { firstName: "Ada", surname: "   " },
      { firstName: "Ada", surname: "12345" },
      { firstName: "Ada", surname: undefined },
      { firstName: "", surname: "Lovelace" },
      { firstName: "Ada", surname: "x".repeat(121) },
      { firstName: "Ada", middleName: "y".repeat(121), surname: "Lovelace" }
    ];
    for (const t of tries) {
      const body = { rorId: "0107c5v14", ...t };
      const r = await b.json("/api/me", { method: "PATCH", body });
      expect(r.status, JSON.stringify(t)).toBe(400);
    }
    // the old form's one box alone is not enough any more
    expect((await b.json("/api/me", { method: "PATCH", body: { name: "Ada Lovelace", rorId: "0107c5v14" } })).status).toBe(400);
    expect((await b.json("/api/keep?kind=work")).status).toBe(403);
    const ok = await b.json("/api/me", { method: "PATCH", body: { firstName: "Ada", surname: "Lovelace", rorId: "0107c5v14" } });
    expect(ok.status).toBe(200);
    const me = (await b.json("/api/me")).data;
    expect(me).toMatchObject({ finished: true, needsName: false, name: "Ada Lovelace", firstName: "Ada", middleName: null, surname: "Lovelace" });
    expect((await b.json("/api/keep?kind=work")).status).toBe(200);
  });

  it("N2. an account from before is asked once for its surname, and loses nothing", async () => {
    const b = await member("n2@example.org", { name: "Ada Lovelace", position: "Professor" });
    const me0 = (await b.json("/api/me")).data;
    const id = (await b.json("/api/auth/get-session")).data.user.id;
    expect((await post(b, "/api/pages", { title: "Kept page", body: "my words", words: "" })).status).toBe(201);
    expect((await post(b, "/api/keep/note", { ...work(1), body: "kept note" })).status).toBe(200);
    // The account as it stood before the migration: one name line, no pieces.
    await env.DB.batch([
      env.DB.prepare('UPDATE "user" SET name = ? WHERE id = ?').bind("Ada King Lovelace", id),
      env.DB.prepare("UPDATE profile SET first_name = NULL, middle_name = NULL, surname = NULL WHERE user_id = ?").bind(id)
    ]);
    // The migration's own step that copies the name.
    const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith("0005"));
    expect(m).toBeTruthy();
    const steps = m.queries.filter((q) => /^\s*update/i.test(q));
    expect(steps.length).toBe(1);
    await env.DB.prepare(steps[0]).run();

    const asked = (await b.json("/api/me")).data;
    expect(asked).toMatchObject({ finished: false, needsName: true, firstName: "Ada King Lovelace", surname: null, name: "Ada King Lovelace" });
    expect(asked.institution).toBe(me0.institution);
    expect(asked.position).toBe("Professor");
    // Until the surname is given, the Workspace asks for it.
    expect((await b.json("/api/pages")).status).toBe(403);
    // Only the name is sent; nothing else of the account is asked again.
    const r = await b.json("/api/me", { method: "PATCH", body: { firstName: "Ada", middleName: "King", surname: "Lovelace" } });
    expect(r.status).toBe(200);
    const after = (await b.json("/api/me")).data;
    expect(after).toMatchObject({ finished: true, needsName: false, name: "Ada King Lovelace", firstName: "Ada", middleName: "King", surname: "Lovelace" });
    expect(after.institution).toBe(me0.institution);
    expect(after.position).toBe("Professor");
    expect(after.since).toBe(me0.since);
    const pages = (await b.json("/api/pages")).data.pages;
    expect(pages.map((p) => p.title)).toEqual(["Kept page"]);
    expect((await b.json("/api/keep?kind=work")).data.things[0].note.body).toBe("kept note");
    // A second sign-in asks nothing.
    const again = new Browser(world);
    await again.signIn("n2@example.org");
    expect((await again.json("/api/me")).data).toMatchObject({ finished: true, needsName: false });
  });

  it("N3. the desk's download has the three pieces, and the newsletter gets the first name as typed", async () => {
    await member("n3@example.org", { firstName: "María José", middleName: "de la", surname: "Cruz Díaz" });
    const ed = await member(EDITOR, { firstName: "Khayyam", surname: "RZAZADE" });
    const csv = await (await ed.fetch("/api/desk/accounts.csv")).text();
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0].startsWith("first_name,middle_name,surname,email,")).toBe(true);
    expect(csv).toContain("María José,de la,Cruz Díaz,n3@example.org");

    const sent = [];
    const was = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response("{}", { status: 200 });
    };
    try {
      const r = await addToNewsletter({ SENDER_API_KEY: "k", SENDER_GROUP_ID: "g" }, "n3@example.org", "María José", "Cruz Díaz");
      expect(r.ok).toBe(true);
    } finally {
      globalThis.fetch = was;
    }
    expect(sent[0].body).toMatchObject({ email: "n3@example.org", firstname: "María José", lastname: "Cruz Díaz" });
  });

  it("N4. Download Everything carries the three pieces", async () => {
    const b = await member("n4@example.org", { firstName: "Ada", middleName: "K.", surname: "Lovelace" });
    const zip = unzipSync(new Uint8Array(await (await b.fetch("/api/me/export")).arrayBuffer()));
    expect(JSON.parse(strFromU8(zip["account.json"]))).toMatchObject({ name: "Ada K. Lovelace", first_name: "Ada", middle_name: "K.", surname: "Lovelace" });
  });
});

// ------------------------------------------------------------ a pasted link

describe("Fix 4. A pasted link and a draft that is refused", () => {
  it("N5. an empty cite, as a pasted link made, is left out and the draft is kept", async () => {
    const a = await member("n5@example.org");
    const d = (await post(a, "/api/drafts", { title: "D" })).data.draft.id;
    const r = await patch(a, "/api/drafts/" + d, {
      body: delta([
        { insert: "See " },
        { insert: { pvcite: { kind: "", ref: "", text: "", url: "https://example.org/a" } } },
        { insert: { pvcite: {} } },
        { insert: "the report.\n" }
      ])
    });
    expect(r.status).toBe(200);
    const body = JSON.parse((await a.json("/api/drafts/" + d)).data.draft.body);
    expect(body).toEqual({ ops: [{ insert: "See " }, { insert: "the report.\n" }] });
  });

  it("N6. a draft that is refused says why, in words", async () => {
    const a = await member("n6@example.org");
    const d = (await post(a, "/api/drafts", { title: "D" })).data.draft.id;
    const unknown = await patch(a, "/api/drafts/" + d, { body: delta([{ insert: { image: "https://example.org/x.png" } }]) });
    expect(unknown.status).toBe(400);
    expect(unknown.data.error).toMatch(/does not know/);
    const many = await patch(a, "/api/drafts/" + d, { body: delta(Array.from({ length: 60001 }, () => ({ insert: "a" }))) });
    expect(many.status).toBe(413);
    expect(many.data.error).toMatch(/too long/);
  });

  it("N7. a Notebook page drops an empty cite in the same way", async () => {
    const a = await member("n7@example.org");
    const page = JSON.stringify(delta([{ insert: "x " }, { insert: { pvcite: { url: "https://example.org" } } }, { insert: "y\n" }]));
    const r = await post(a, "/api/pages", { title: "t", body: page, words: "" });
    expect(r.status).toBe(201);
    expect(JSON.parse(r.data.page.body)).toEqual({ ops: [{ insert: "x " }, { insert: "y\n" }] });
  });
});

// ------------------------------------------------------------ the Notebook's cleaner

describe("Fix 8. One cleaner for the Notebook and Write", () => {
  it("N8. a plain page of before stays as it is; a page's words are made by the server", async () => {
    const a = await member("n8@example.org");
    const plain = await post(a, "/api/pages", { title: "old", body: "Plain words\nof before.", words: "anything" });
    expect(plain.status).toBe(201);
    const back = (await a.json("/api/pages/" + plain.data.page.id)).data.page;
    expect(back.body).toBe("Plain words\nof before.");
    const fresh = await post(a, "/api/pages", {
      title: "new",
      body: JSON.stringify(delta([
        { insert: "Real " },
        { insert: { pvcite: { kind: "work", ref: "W1", text: "(Mudde 2004)", url: "" } } },
        { insert: " words", attributes: { bold: true } },
        { insert: "\n" }
      ])),
      words: "FORGED WORDS"
    });
    expect(fresh.status).toBe(201);
    const row = await env.DB.prepare("SELECT words FROM notebook_page WHERE id = ?").bind(fresh.data.page.id).first();
    expect(row.words).toBe("Real (Mudde 2004) words");
    // changing only the words sent does nothing to them
    await patch(a, "/api/pages/" + fresh.data.page.id, { words: "FORGED AGAIN" });
    const row2 = await env.DB.prepare("SELECT words FROM notebook_page WHERE id = ?").bind(fresh.data.page.id).first();
    expect(row2.words).toBe("Real (Mudde 2004) words");
  });

  it("N9. a page that looks like the editor's document but cannot be read, or holds a figure, is refused", async () => {
    const a = await member("n9@example.org");
    expect((await post(a, "/api/pages", { title: "t", body: '{"ops": [ broken', words: "" })).status).toBe(400);
    const fig = (await post(a, "/api/figures", FIG)).data.figure.id;
    const r = await post(a, "/api/pages", { title: "t", body: JSON.stringify(delta([{ insert: { pvfigure: { id: fig } } }, { insert: "\n" }])), words: "" });
    expect(r.status).toBe(400);
  });
});

// ------------------------------------------------------------ the guest who signs in

describe("Fix 3. A guest who signs in to an account that keeps the same thing", () => {
  it("N10. the account's row stays, and takes what it lacks from the guest's", async () => {
    const acc = await member("n10@example.org");
    await post(acc, "/api/keep/note", { ...work(1), body: "ACCOUNT NOTE" });
    await post(acc, "/api/keep/tag", { kind: "work", ref: "W1", add: "mine" });
    await post(acc, "/api/keep/mark", { kind: "work", ref: "W1", at: 3, text: "abstract" });
    await post(acc, "/api/keep", work(2));

    const g = await guest();
    const gid = (await g.json("/api/auth/get-session")).data.user.id;
    await post(g, "/api/keep/note", { ...work(1), body: "GUEST NOTE" });
    await post(g, "/api/keep/tag", { kind: "work", ref: "W1", add: "guest-tag" });
    await post(g, "/api/keep/tag", { kind: "work", ref: "W1", add: "mine" });
    await post(g, "/api/keep/mark", { kind: "work", ref: "W1", at: 3, text: "abstract" });
    await post(g, "/api/keep/mark", { kind: "work", ref: "W1", at: 12, text: "work" });
    await post(g, "/api/keep/note", { ...work(2), body: "GUEST NOTE ON TWO" });
    await post(g, "/api/keep/status", { kind: "work", ref: "W2", status: "read" });
    await post(g, "/api/keep", work(3));
    const p = (await post(g, "/api/projects", { title: "Guest project" })).data.project.id;
    await post(g, `/api/projects/${p}/things`, { kind: "work", ref: "W1" });

    expect((await g.signIn("n10@example.org")).status).toBe(200);
    const shelf = (await g.json("/api/keep?kind=work&order=author")).data.things;
    const by = Object.fromEntries(shelf.map((t) => [t.ref, t]));
    expect(Object.keys(by).sort()).toEqual(["W1", "W2", "W3"]);
    expect(by.W1.note.body).toBe("ACCOUNT NOTE");
    expect(by.W1.tags).toEqual(["guest-tag", "mine"]);
    expect(by.W1.marks.map((m) => m.text)).toEqual(["abstract", "work"]);
    expect(by.W1.projects.map((x) => x.title)).toEqual(["Guest project"]);
    expect(by.W2.note.body).toBe("GUEST NOTE ON TWO");
    expect(by.W2.status).toBe("read");
    const projects = (await g.json("/api/projects")).data.projects;
    expect(projects.map((x) => [x.title, x.counts.works])).toEqual([["Guest project", 1]]);
    for (const t of ["kept", "note", "tag", "mark", "project", "project_thing"]) {
      const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).bind(gid).first();
      expect(n, t).toBe(0);
    }
    // and nothing appeared on the shelf of anybody else
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM kept").first();
    expect(n).toBe(3);
  });
});

// ------------------------------------------------------------ limits and sizes

describe("Fixes 2, 7 and 9. Many things, picture sizes, limits under a race", () => {
  it("N11. a figure whose size is not a whole number is rounded, not set to 0", async () => {
    const a = await member("n11@example.org");
    const r = await post(a, "/api/figures", { ...FIG, width: 1200, height: 1289.4 });
    expect(r.status).toBe(201);
    expect(r.data.figure).toMatchObject({ width: 1200, height: 1289 });
    const r2 = await post(a, "/api/figures", { ...FIG, width: "1200", height: -5 });
    expect(r2.data.figure).toMatchObject({ width: 0, height: 0 });
  });

  it("N12. a guest at 15 pages who sends 10 at once ends at 20", async () => {
    const g = await guest();
    for (let i = 0; i < 15; i++) await post(g, "/api/pages", { title: "p" + i, body: "", words: "" });
    await Promise.all(Array.from({ length: 10 }, (_, i) => post(g, "/api/pages", { title: "q" + i, body: "", words: "" })));
    expect((await g.json("/api/pages")).data.pages.length).toBe(20);
  });

  it("N13. tags and passages sent all at once stay within their limits", async () => {
    const a = await member("n13@example.org");
    await post(a, "/api/keep", work(1));
    await Promise.all(Array.from({ length: 20 }, (_, i) => post(a, "/api/keep/tag", { kind: "work", ref: "W1", add: "t" + i })));
    await Promise.all(Array.from({ length: 60 }, (_, i) => post(a, "/api/keep/mark", { kind: "work", ref: "W1", at: i % 20, text: "abstract" })));
    const t = (await a.json("/api/keep?kind=work")).data.things[0];
    expect(t.tags.length).toBe(12);
    expect(t.marks.length).toBe(50);
  });

  it("N14. a page that shows 300 things, all saved, and a draft that cites 300", async () => {
    const a = await member("n14@example.org");
    await env.DB.batch(
      Array.from({ length: 300 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO kept (id, user_id, kind, ref, title, cite, created_at, updated_at) SELECT ?, id, 'work', ?, ?, ?, ?, ? FROM \"user\" WHERE email = ?"
        ).bind("k" + i, "W" + i, "Title " + i, "Cite " + i, "2026-11-13", "2026-11-13", "n14@example.org")
      )
    );
    const refs = Array.from({ length: 300 }, (_, i) => ({ kind: "work", ref: "W" + i }));
    const mine = await post(a, "/api/keep/mine", { refs });
    expect(mine.status).toBe(200);
    expect(mine.data.things.length).toBe(300);
    const cites = await post(a, "/api/write/cites", { refs });
    expect(cites.data.things.length).toBe(300);
    const zip = unzipSync(new Uint8Array(await (await a.fetch("/api/me/export")).arrayBuffer()));
    expect(JSON.parse(strFromU8(zip["shelf.json"])).length).toBe(300);
  });
});
