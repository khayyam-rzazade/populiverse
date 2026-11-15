// Fable's second run on batches 2 and 3: attacks on the fixes themselves
// (master plan, section 18, the rows of 2026-11-13 on the check and on the fixes).
// Written without having seen the fixes made. Each test says what SHOULD hold.
// On the day they were written, 2 of the 27 failed: B5 (one statement still
// writes without a count) and C4 (the Notebook's search reads how a page is
// stored). All 27 must pass before the push.
// Five groups, as the editor asked: the guest who signs in to an account that
// keeps the same things; the count inside every INSERT; the cleaner shared by
// pages and drafts; the empty cite; the name in three pieces.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";
import { Browser, makeWorld, setOpen, EDITOR } from "./helpers.js";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FIG = { ref: "in-power#map", title: "Populists in Power", source: "Sources: X.", cite: "Cite line.", url: "https://populiverse.com/data/in-power.html", day: "13 November 2026", width: 10, height: 10, picture: PNG };
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
const del = (b, path, body) => b.json(path, { method: "DELETE", body });
const delta = (ops) => ({ ops });
const idOf = async (b) => (await b.json("/api/auth/get-session")).data.user.id;
async function count(table, userId) {
  const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(userId).first();
  return n;
}
const OURS = ["kept", "note", "tag", "mark", "project", "project_thing", "draft", "figure", "notebook_page"];
async function tally(userId) {
  const out = {};
  for (const t of OURS) out[t] = await count(t, userId);
  return out;
}

// ---------------------------------------------------------------- the guest

describe("R4-A. A guest who signs in to an account that keeps the same things", () => {
  it("A1. the guest's draft, project and page that lean on a twin thing still hold together", async () => {
    const acc = await member("a1@example.org");
    await post(acc, "/api/keep/note", { ...work(1), body: "ACCOUNT NOTE" });
    const ap = (await post(acc, "/api/projects", { title: "Account project" })).data.project.id;
    await post(acc, `/api/projects/${ap}/things`, { kind: "work", ref: "W1" });
    const ad = (await post(acc, "/api/drafts", { title: "Account draft", project_id: ap })).data.draft.id;

    const g = await guest();
    await post(g, "/api/keep/note", { ...work(1), body: "GUEST NOTE" });
    await post(g, "/api/keep", work(2));
    const gp = (await post(g, "/api/projects", { title: "Guest project", question: "Why?" })).data.project.id;
    await post(g, `/api/projects/${gp}/things`, { kind: "work", ref: "W1" });
    await post(g, `/api/projects/${gp}/things`, { kind: "work", ref: "W2" });
    const gd = (await post(g, "/api/drafts", { title: "Guest draft", project_id: gp })).data.draft.id;
    const gf = (await post(g, "/api/figures", FIG)).data.figure.id;
    const body = delta([
      { insert: "As " },
      { insert: { pvcite: { kind: "work", ref: "W1", text: "(Author 1 2020)", url: "" } } },
      { insert: " and " },
      { insert: { pvcite: { kind: "work", ref: "W2", text: "(Author 2 2020)", url: "" } } },
      { insert: " say.\n" },
      { insert: { pvfigure: { id: gf } } },
      { insert: "\n" }
    ]);
    expect((await patch(g, "/api/drafts/" + gd, { body })).status).toBe(200);
    const gpage = (await post(g, "/api/pages", { title: "Guest page", body: "words", project_id: gp })).data.page.id;

    expect((await g.signIn("a1@example.org")).status).toBe(200);

    // Two projects, two drafts, each draft still in its own project.
    const projects = (await g.json("/api/projects")).data.projects;
    expect(projects.map((p) => p.title).sort()).toEqual(["Account project", "Guest project"]);
    const drafts = (await g.json("/api/drafts")).data.drafts;
    expect(drafts.map((d) => [d.title, d.project_title]).sort()).toEqual([["Account draft", "Account project"], ["Guest draft", "Guest project"]]);
    // The guest's project holds the account's row of the twin, and the other work.
    const view = (await g.json("/api/projects/" + gp)).data;
    expect(view.things.map((t) => t.ref).sort()).toEqual(["W1", "W2"]);
    expect(view.things.find((t) => t.ref === "W1").note).toBe("ACCOUNT NOTE");
    expect(view.pages.map((p) => p.id)).toEqual([gpage]);
    expect(view.draft.id).toBe(gd);
    // The draft opens with its figure, and both cites still find their reference.
    const opened = (await g.json("/api/drafts/" + gd)).data;
    expect(JSON.parse(opened.draft.body)).toEqual(body);
    expect(opened.figures.map((f) => f.id)).toEqual([gf]);
    const cites = (await post(g, "/api/write/cites", { refs: [{ kind: "work", ref: "W1" }, { kind: "work", ref: "W2" }] })).data.things;
    expect(cites.map((c) => c.ref).sort()).toEqual(["W1", "W2"]);
    // One row for the twin, in two projects.
    const shelf = (await g.json("/api/keep?kind=work")).data;
    expect(shelf.things.length).toBe(2);
    expect(shelf.things.find((t) => t.ref === "W1").projects.map((p) => p.title).sort()).toEqual(["Account project", "Guest project"]);
    expect(ad).toBeTruthy();
  });

  it("A2. where the account has nothing on the twin, it takes the guest's note, tags, passages and status", async () => {
    const acc = await member("a2@example.org");
    await post(acc, "/api/keep", work(1));
    const g = await guest();
    await post(g, "/api/keep/note", { ...work(1), body: "ONLY THE GUEST WROTE ONE" });
    await post(g, "/api/keep/tag", { kind: "work", ref: "W1", add: "core" });
    await post(g, "/api/keep/status", { kind: "work", ref: "W1", status: "reading" });
    await post(g, "/api/keep/mark", { kind: "work", ref: "W1", at: 3, text: "abstract" });
    await post(g, "/api/keep/mark", { kind: "work", ref: "W1", at: 3, text: "abstract" }); // the same passage twice
    expect((await g.signIn("a2@example.org")).status).toBe(200);
    const t = (await g.json("/api/keep?kind=work")).data.things;
    expect(t.length).toBe(1);
    expect(t[0].note.body).toBe("ONLY THE GUEST WROTE ONE");
    expect(t[0].tags).toEqual(["core"]);
    expect(t[0].status).toBe("reading");
    expect(t[0].marks.map((m) => [m.at, m.text])).toEqual([[3, "abstract"], [3, "abstract"]]);
  });

  it("A3. the account's own status, card and abstract are not overwritten by the guest's", async () => {
    const acc = await member("a3@example.org");
    await post(acc, "/api/keep", work(1, { title: "ACCOUNT TITLE", abstract: "ACCOUNT ABSTRACT" }));
    await post(acc, "/api/keep/status", { kind: "work", ref: "W1", status: "read" });
    const g = await guest();
    await post(g, "/api/keep", work(1, { title: "GUEST TITLE", abstract: "GUEST ABSTRACT" }));
    await post(g, "/api/keep/status", { kind: "work", ref: "W1", status: "to-read" });
    expect((await g.signIn("a3@example.org")).status).toBe(200);
    const t = (await g.json("/api/keep?kind=work")).data.things[0];
    expect([t.title, t.abstract, t.status]).toEqual(["ACCOUNT TITLE", "ACCOUNT ABSTRACT", "read"]);
  });

  it("A4. the same name under another kind is not the same thing, and a third person's shelf is not touched", async () => {
    const other = await member("a4-other@example.org");
    await post(other, "/api/keep/note", { ...work(1), body: "THIRD PERSON" });
    await post(other, "/api/keep/tag", { kind: "work", ref: "W1", add: "theirs" });
    const otherId = await idOf(other);
    const before = await tally(otherId);

    const acc = await member("a4@example.org");
    await post(acc, "/api/keep/note", { kind: "item", ref: "W1", title: "An item named W1", body: "ITEM NOTE" });
    const g = await guest();
    await post(g, "/api/keep/note", { ...work(1), body: "GUEST WORK NOTE" });
    expect((await g.signIn("a4@example.org")).status).toBe(200);
    const works = (await g.json("/api/keep?kind=work")).data.things;
    const items = (await g.json("/api/keep?kind=item")).data.things;
    expect(works.map((t) => t.note.body)).toEqual(["GUEST WORK NOTE"]);
    expect(items.map((t) => t.note.body)).toEqual(["ITEM NOTE"]);
    expect(await tally(otherId)).toEqual(before);
    const theirs = (await other.json("/api/keep?kind=work")).data.things[0];
    expect([theirs.note.body, theirs.tags]).toEqual(["THIRD PERSON", ["theirs"]]);
  });

  it("A5. nothing is dropped for a limit: a full guest signs in to an account, twelve tags meet twelve tags", async () => {
    const acc = await member("a5@example.org");
    await post(acc, "/api/keep", work(0));
    for (let i = 0; i < 12; i++) await post(acc, "/api/keep/tag", { kind: "work", ref: "W0", add: "acc" + i });
    const g = await guest();
    for (let i = 0; i < 50; i++) expect((await post(g, "/api/keep", work(i))).status).toBe(201);
    for (let i = 0; i < 12; i++) await post(g, "/api/keep/tag", { kind: "work", ref: "W0", add: "guest" + i });
    for (let i = 0; i < 3; i++) await post(g, "/api/projects", { title: "P" + i });
    for (let i = 0; i < 3; i++) await post(g, "/api/drafts", { title: "D" + i });
    for (let i = 0; i < 3; i++) await post(g, "/api/figures", FIG);
    for (let i = 0; i < 20; i++) await post(g, "/api/pages", { title: "Pg" + i, body: "x" });
    expect((await g.signIn("a5@example.org")).status).toBe(200);
    const id = await idOf(g);
    expect(await tally(id)).toMatchObject({ kept: 50, project: 3, draft: 3, figure: 3, notebook_page: 20, tag: 24 });
  });

  it("A6. a guest who signs in to an account from before the surname loses nothing while it is asked", async () => {
    const acc = await member("a6@example.org", { firstName: "Old Name" });
    const accId = await idOf(acc);
    await env.DB.prepare("UPDATE profile SET surname = NULL WHERE user_id = ?").bind(accId).run();
    const g = await guest();
    await post(g, "/api/keep/note", { ...work(1), body: "GUEST NOTE" });
    const p = (await post(g, "/api/projects", { title: "Guest project" })).data.project.id;
    await post(g, "/api/drafts", { title: "Guest draft", project_id: p });
    await post(g, "/api/pages", { title: "Guest page", body: "words" });
    expect((await g.signIn("a6@example.org")).status).toBe(200);
    const me = (await g.json("/api/me")).data;
    expect(me).toMatchObject({ needsName: true, finished: false });
    expect((await g.json("/api/keep?kind=work")).status).toBe(403);
    expect(await tally(accId)).toMatchObject({ kept: 1, note: 1, project: 1, draft: 1, notebook_page: 1 });
    expect((await patch(g, "/api/me", { firstName: "Old", surname: "Name" })).status).toBe(200);
    expect((await g.json("/api/keep?kind=work")).data.things[0].note.body).toBe("GUEST NOTE");
    expect((await g.json("/api/pages")).data.pages.map((x) => x.title)).toEqual(["Guest page"]);
  });

  it("A7. if the move fails half way, the guest's work is not lost", async () => {
    const acc = await member("a7@example.org");
    await post(acc, "/api/keep", work(1));
    const g = await guest();
    const gid = await idOf(g);
    await post(g, "/api/keep/note", { ...work(1), body: "GUEST NOTE" });
    await post(g, "/api/keep/note", { ...work(2), body: "GUEST NOTE 2" });
    await post(g, "/api/pages", { title: "Guest page", body: "words" });
    const accId = await idOf(acc);
    // The database refuses one step of the move, as it would on a bad night.
    await env.DB.prepare("CREATE TRIGGER r4_boom BEFORE UPDATE ON notebook_page BEGIN SELECT RAISE(ABORT, 'boom'); END").run();
    let res;
    try {
      res = await g.signIn("a7@example.org");
    } finally {
      await env.DB.prepare("DROP TRIGGER r4_boom").run();
    }
    const withGuest = await tally(gid);
    const withAccount = await tally(accId);
    // The sign-in answers an error, and the person is still the guest.
    expect(res.status).toBe(500);
    expect(await idOf(g)).toBe(gid);
    // Wherever the rows are now, the two notes, the two things and the page exist.
    expect(withGuest.note + withAccount.note, "notes after a failed move (sign-in answered " + res.status + ")").toBe(2);
    expect(withGuest.notebook_page + withAccount.notebook_page).toBe(1);
    expect(withGuest.kept + withAccount.kept).toBe(3);
  });

  it("A8. a guest who signs up fresh and never finishes the form still holds the work", async () => {
    const g = await guest();
    await post(g, "/api/keep/note", { ...work(1), body: "GUEST NOTE" });
    expect((await g.signIn("a8@example.org")).status).toBe(200);
    const id = await idOf(g);
    expect(await tally(id)).toMatchObject({ kept: 1, note: 1 });
    // the form refuses a missing surname, and the work waits
    expect((await patch(g, "/api/me", { firstName: "Ada", rorId: "0107c5v14" })).status).toBe(400);
    expect(await tally(id)).toMatchObject({ kept: 1, note: 1 });
    expect((await g.finish()).status).toBe(200);
    expect((await g.json("/api/keep?kind=work")).data.things[0].note.body).toBe("GUEST NOTE");
  });
});

// ---------------------------------------------------------------- the count

describe("R4-B. The count inside every INSERT", () => {
  it("B1. a guest one short of the limit, thirty new things at once through every door that saves", async () => {
    const doors = [
      (g, i) => post(g, "/api/keep", work(100 + i)),
      (g, i) => post(g, "/api/keep/note", { ...work(100 + i), body: "n" }),
      (g, i) => post(g, "/api/keep/tag", { ...work(100 + i), add: "t" }),
      (g, i) => post(g, "/api/keep/status", { ...work(100 + i), status: "read" }),
      (g, i) => post(g, "/api/keep/mark", { ...work(100 + i), at: 1, text: "abstract" })
    ];
    for (const door of doors) {
      const g = await guest();
      const gid = await idOf(g);
      for (let i = 0; i < 49; i++) await post(g, "/api/keep", work(i));
      const answers = await Promise.all(Array.from({ length: 30 }, (_, i) => door(g, i)));
      expect(await count("kept", gid)).toBe(50);
      expect(answers.filter((a) => a.status === 409).length).toBe(29);
      // and nothing hangs on a thing that was refused
      expect(await count("note", gid)).toBeLessThanOrEqual(1);
      expect(await count("tag", gid)).toBeLessThanOrEqual(1);
      expect(await count("mark", gid)).toBeLessThanOrEqual(1);
    }
  });

  it("B2. projects, drafts, figures and pages of a guest, twelve at once from nothing", async () => {
    const g = await guest();
    const gid = await idOf(g);
    await Promise.all([
      ...Array.from({ length: 12 }, (_, i) => post(g, "/api/projects", { title: "P" + i })),
      ...Array.from({ length: 12 }, (_, i) => post(g, "/api/drafts", { title: "D" + i })),
      ...Array.from({ length: 12 }, () => post(g, "/api/figures", FIG)),
      ...Array.from({ length: 30 }, (_, i) => post(g, "/api/pages", { title: "Pg" + i, body: "" }))
    ]);
    expect(await tally(gid)).toMatchObject({ project: 3, draft: 3, figure: 3, notebook_page: 20 });
  });

  it("B3. one project, twelve drafts asked for it at once: one draft", async () => {
    const a = await member("b3@example.org");
    const p = (await post(a, "/api/projects", { title: "P" })).data.project.id;
    const answers = await Promise.all(Array.from({ length: 12 }, () => post(a, "/api/drafts", { title: "D", project_id: p })));
    expect(answers.filter((r) => r.status === 201).length).toBe(1);
    expect(answers.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect((await a.json("/api/drafts")).data.drafts.length).toBe(1);
  });

  it("B4. a project one short of 2,000 things, ten more at once: 2,000", async () => {
    const a = await member("b4@example.org");
    const id = await idOf(a);
    const p = (await post(a, "/api/projects", { title: "P" })).data.project.id;
    await env.DB.prepare(
      `WITH RECURSIVE c(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM c WHERE i < 1999)
       INSERT INTO kept (id, user_id, kind, ref, title, created_at, updated_at)
       SELECT 'k' || i, ?, 'work', 'W' || i, 'T' || i, '2026-11-13', '2026-11-13' FROM c`
    ).bind(id).run();
    await env.DB.prepare(
      `INSERT INTO project_thing (project_id, kept_id, user_id, added_at)
       SELECT ?, id, user_id, '2026-11-13' FROM kept WHERE user_id = ? AND id NOT IN ('k1990','k1991','k1992','k1993','k1994','k1995','k1996','k1997','k1998','k1999') AND id <> 'k0'`
    ).bind(p, id).run();
    expect(await count("project_thing", id)).toBe(1989);
    for (let i = 0; i < 10; i++) await env.DB.prepare("INSERT INTO project_thing (project_id, kept_id, user_id, added_at) VALUES (?, ?, ?, 'x')").bind(p, "k" + (1990 + i), id).run();
    expect(await count("project_thing", id)).toBe(1999);
    // one free place; the shelf itself is full at 2,000, so add what is there: k0 and nine that are in already
    const answers = await Promise.all([
      post(a, `/api/projects/${p}/things`, { kind: "work", ref: "W0" }),
      ...Array.from({ length: 9 }, (_, i) => post(a, `/api/projects/${p}/things`, { kind: "work", ref: "W" + (i + 1) }))
    ]);
    expect(answers.every((r) => r.status === 200)).toBe(true);
    expect(await count("project_thing", id)).toBe(2000);
    // and the shelf takes no 2,001st thing, by any door
    const more = await Promise.all(Array.from({ length: 8 }, (_, i) => post(a, "/api/keep/note", { ...work(5000 + i), body: "n" })));
    expect(more.every((r) => r.status === 409)).toBe(true);
    expect(await count("kept", id)).toBe(2000);
  });

  it("B5. saving again a thing that is being removed does not carry a guest past the limit", async () => {
    const g = await guest();
    const gid = await idOf(g);
    for (let i = 0; i < 50; i++) await post(g, "/api/keep", work(i));
    // Round after round: the thing is removed, a new one takes its place, and
    // the old one is saved "again" by a request that saw it a moment before.
    for (let round = 0; round < 6; round++) {
      await Promise.all([
        del(g, "/api/keep", { kind: "work", ref: "W0" }),
        post(g, "/api/keep", work(200 + round)),
        post(g, "/api/keep", work(0)),
        post(g, "/api/keep", work(0)),
        post(g, "/api/keep", work(0))
      ]);
    }
    expect(await count("kept", gid)).toBeLessThanOrEqual(50);
  });

  it("B6. Download Everything and the shelf with a full account: 2,000 things, each with a note", async () => {
    const a = await member("b6@example.org");
    const id = await idOf(a);
    await env.DB.prepare(
      `WITH RECURSIVE c(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM c WHERE i < 1999)
       INSERT INTO kept (id, user_id, kind, ref, title, created_at, updated_at)
       SELECT 'k' || i, ?, 'work', 'W' || i, 'T' || i, '2026-11-13', '2026-11-13' FROM c`
    ).bind(id).run();
    await env.DB.prepare("INSERT INTO note (kept_id, user_id, body, created_at, updated_at) SELECT id, user_id, 'note on ' || ref, 'x', 'x' FROM kept WHERE user_id = ?").bind(id).run();
    const res = await a.fetch("/api/me/export");
    expect(res.status).toBe(200);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(JSON.parse(strFromU8(zip["shelf.json"])).length).toBe(2000);
    expect(JSON.parse(strFromU8(zip["notes.json"])).length).toBe(2000);
    const bib = await a.json("/api/write/bibliography");
    expect(bib.data.works.length).toBe(2000);
  });
});

// ---------------------------------------------------------------- the cleaner

describe("R4-C. One cleaner for pages and drafts", () => {
  const dirty = () => delta([
    { insert: "Plain ", attributes: { color: "red", background: "#000", font: "x", size: "huge", link: "javascript:alert(1)", script: "super", code: true, align: "center", underline: true, strike: true } },
    { insert: "bold", attributes: { bold: true, italic: "yes", onclick: "alert(1)" } },
    { insert: { pvcite: { kind: "work", ref: "W1", text: "(Mudde 2004)", url: "javascript:alert(1)", onclick: "x", extra: "<img src=x onerror=alert(1)>" } }, attributes: { link: "javascript:alert(1)", bold: true } },
    { insert: "\n", attributes: { header: 7, list: "checked", blockquote: "true", indent: 9, direction: "rtl", "code-block": true } },
    { insert: "Head\n", attributes: { header: 2 } },
    { insert: "one" },
    { insert: "\n", attributes: { list: "ordered" } }
  ]);
  const cleaned = delta([
    { insert: "Plain " },
    { insert: "bold", attributes: { bold: true } },
    { insert: { pvcite: { kind: "work", ref: "W1", text: "(Mudde 2004)", url: "" } }, attributes: { bold: true } },
    { insert: "\n" },
    { insert: "Head\n", attributes: { header: 2 } },
    { insert: "one" },
    { insert: "\n", attributes: { list: "ordered" } }
  ]);

  it("C1. the same dirty document comes out the same, clean, from a draft, a new page and a changed page", async () => {
    const a = await member("c1@example.org");
    const d = (await post(a, "/api/drafts", { title: "D" })).data.draft.id;
    expect((await patch(a, "/api/drafts/" + d, { body: dirty() })).status).toBe(200);
    const fromDraft = JSON.parse((await a.json("/api/drafts/" + d)).data.draft.body);
    const made = await post(a, "/api/pages", { title: "P", body: JSON.stringify(dirty()) });
    expect(made.status).toBe(201);
    const fromNew = JSON.parse((await a.json("/api/pages/" + made.data.page.id)).data.page.body);
    const plain = await post(a, "/api/pages", { title: "P2", body: "plain" });
    expect((await patch(a, "/api/pages/" + plain.data.page.id, { body: JSON.stringify(dirty()) })).status).toBe(200);
    const fromChanged = JSON.parse((await a.json("/api/pages/" + plain.data.page.id)).data.page.body);
    expect(fromDraft).toEqual(cleaned);
    expect(fromNew).toEqual(cleaned);
    expect(fromChanged).toEqual(cleaned);
    for (const stored of [fromDraft, fromNew, fromChanged]) {
      expect(JSON.stringify(stored)).not.toMatch(/javascript|onclick|onerror|color|<img/);
    }
  });

  it("C2. a page with a piece the editor does not know is refused through both doors, with words, and stays as it was", async () => {
    const a = await member("c2@example.org");
    const bad = [
      { insert: { image: "https://example.org/x.png" } },
      { insert: { video: "https://example.org/x" } },
      { insert: { formula: "x" } },
      { insert: { pvcite: { kind: "work", ref: "W1", text: "x" }, pvfigure: { id: "f" } } },
      { insert: { pvcite: { kind: "virus", ref: "W1", text: "x" } } },
      { insert: { pvcite: { kind: "work", ref: "", text: "x" } } },
      { insert: 5 },
      { retain: 3 },
      { delete: 3 },
      "a string",
      null
    ];
    const page = (await post(a, "/api/pages", { title: "P", body: JSON.stringify(delta([{ insert: "kept\n" }])) })).data.page.id;
    for (const op of bad) {
      const doc = JSON.stringify(delta([{ insert: "x " }, op, { insert: "\n" }]));
      const made = await post(a, "/api/pages", { title: "T", body: doc });
      expect(made.status, JSON.stringify(op)).toBe(400);
      expect(String(made.data.error)).toMatch(/not saved/);
      const changed = await patch(a, "/api/pages/" + page, { body: doc });
      expect(changed.status, JSON.stringify(op)).toBe(400);
    }
    expect(JSON.parse((await a.json("/api/pages/" + page)).data.page.body)).toEqual(delta([{ insert: "kept\n" }]));
    expect((await a.json("/api/pages")).data.pages.length).toBe(1);
  });

  it("C3. the page's two halves agree on what the editor's document is: no spelling slips past the server and opens as one", async () => {
    const a = await member("c3@example.org");
    // What the page script itself uses to tell a document from plain words (editor.js, isDelta).
    const opensAsDocument = (stored) => typeof stored === "string" && /^\s*\{\s*"ops"\s*:/.test(stored);
    const evil = '[{"insert":{"image":"x"}},{"insert":"t","attributes":{"link":"javascript:alert(1)"}}]';
    const spellings = [
      '{"\\u006fps":' + evil + "}",
      '{"x":1,"ops":' + evil + "}",
      '{ "ops" :' + evil + "}",
      '\n\t {"ops":' + evil + "}",
      '﻿{"ops":' + evil + "}",
      '{"ops":[],"ops":' + evil + "}",
      '{"OPS":' + evil + "}",
      "{'ops':" + evil + "}"
    ];
    for (const s of spellings) {
      const r = await post(a, "/api/pages", { title: "T", body: s });
      if (r.status !== 201) { expect(r.status, s).toBe(400); continue; }
      const stored = (await a.json("/api/pages/" + r.data.page.id)).data.page.body;
      if (opensAsDocument(stored)) {
        // then it went through the cleaner, and nothing unknown is left in it
        expect(stored, s).not.toMatch(/image|javascript|link/);
      } else {
        // then it is plain words, to the letter, and will be shown as words
        expect(stored, s).toBe(s.replace(/﻿/g, "﻿"));
      }
    }
  });

  it("C4. a search in the Notebook looks through the words of a page, not through how the page is stored", async () => {
    const a = await member("c4@example.org");
    await post(a, "/api/pages", { title: "One", body: JSON.stringify(delta([{ insert: "Alpha " }, { insert: "beta", attributes: { bold: true } }, { insert: { pvcite: { kind: "work", ref: "W1", text: "(Mudde 2004)", url: "https://doi.org/10.1/x" } } }, { insert: "\n" }])) });
    const found = async (q) => (await a.json("/api/pages?q=" + encodeURIComponent(q))).data.pages.length;
    expect(await found("alpha")).toBe(1);
    expect(await found("Mudde")).toBe(1);
    for (const q of ["insert", "attributes", "pvcite", "ops", "bold", "doi.org"]) {
      expect(await found(q), "searching for " + q).toBe(0);
    }
  });

  it("C5. the words of a page follow the page at every change, and a page too long is refused with its limit", async () => {
    const a = await member("c5@example.org");
    const page = (await post(a, "/api/pages", { title: "P", body: JSON.stringify(delta([{ insert: "first words\n" }])), words: "FORGED" })).data.page.id;
    const wordsOf = async () => (await env.DB.prepare("SELECT words FROM notebook_page WHERE id = ?").bind(page).first()).words;
    expect(await wordsOf()).toBe("first words");
    await patch(a, "/api/pages/" + page, { body: JSON.stringify(delta([{ insert: "second words\n" }])), words: "FORGED" });
    expect(await wordsOf()).toBe("second words");
    await patch(a, "/api/pages/" + page, { body: "plain again" });
    expect(await wordsOf()).toBe("");
    expect((await a.json("/api/pages?q=FORGED")).data.pages.length).toBe(0);
    expect((await a.json("/api/pages?q=plain")).data.pages.length).toBe(1);
    const long = await patch(a, "/api/pages/" + page, { body: JSON.stringify(delta([{ insert: "x".repeat(200001) }])) });
    expect(long.status).toBe(413);
    expect(String(long.data.error)).toMatch(/200,000/);
  });
});

// ---------------------------------------------------------------- the empty cite

describe("R4-D. The empty cite", () => {
  it("D1. every shape of an empty cite is left out, and all the words around it are kept", async () => {
    const a = await member("d1@example.org");
    const d = (await post(a, "/api/drafts", { title: "D" })).data.draft.id;
    const empties = [
      {},
      { kind: "", ref: "", text: "" },
      { kind: null, ref: null, text: null, url: null },
      { url: "https://example.org/pasted" },
      { url: "javascript:alert(1)" },
      { kind: "", ref: "", text: "", url: "https://example.org", onclick: "x" }
    ];
    const ops = [{ insert: "Start " }];
    empties.forEach((e, i) => { ops.push({ insert: { pvcite: e }, attributes: { bold: true } }); ops.push({ insert: "w" + i + " " }); });
    ops.push({ insert: "end.\n" });
    const r = await patch(a, "/api/drafts/" + d, { body: delta(ops) });
    expect(r.status).toBe(200);
    const stored = (await a.json("/api/drafts/" + d)).data.draft.body;
    expect(stored).not.toMatch(/pvcite|javascript|example\.org/);
    const words = JSON.parse(stored).ops.map((o) => o.insert).join("");
    expect(words).toBe("Start w0 w1 w2 w3 w4 w5 end.\n");
    expect(r.data.words).toBe(8);
  });

  it("D2. a cite that is half there, or not a cite at all, is refused with words, and the draft stays as it was", async () => {
    const a = await member("d2@example.org");
    const d = (await post(a, "/api/drafts", { title: "D" })).data.draft.id;
    const good = delta([{ insert: "kept words\n" }]);
    expect((await patch(a, "/api/drafts/" + d, { body: good })).status).toBe(200);
    const halves = [
      { kind: "work", ref: "", text: "" },
      { kind: "", ref: "W1", text: "(A 2020)" },
      { kind: "work", ref: "W1", text: "" },
      { kind: "", ref: "", text: "(A 2020)" },
      { kind: "", ref: "", text: "   " },
      { kind: "work", ref: "W1", text: "x".repeat(301) },
      null, "", [], 0, "text", true
    ];
    for (const h of halves) {
      const r = await patch(a, "/api/drafts/" + d, { body: delta([{ insert: "x " }, { insert: { pvcite: h } }, { insert: "\n" }]) });
      expect(r.status, JSON.stringify(h)).toBe(400);
      expect(String(r.data.error), JSON.stringify(h)).toMatch(/does not know|not saved/);
    }
    expect(JSON.parse((await a.json("/api/drafts/" + d)).data.draft.body)).toEqual(good);
  });

  it("D3. a cite's address that is not a web address is dropped, and its words can hold no line break", async () => {
    const a = await member("d3@example.org");
    const d = (await post(a, "/api/drafts", { title: "D" })).data.draft.id;
    const urls = ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", " JaVaScRiPt:alert(1)", "//evil.example", "vbscript:x", "https://ok.example/a b", "file:///etc/passwd"];
    const r = await patch(a, "/api/drafts/" + d, {
      body: delta(urls.map((u) => ({ insert: { pvcite: { kind: "work", ref: "W1", text: "(A\n2020)\u0000<b>", url: u } } })).concat([{ insert: "\n" }]))
    });
    expect(r.status).toBe(200);
    const ops = JSON.parse((await a.json("/api/drafts/" + d)).data.draft.body).ops;
    const cites = ops.filter((o) => o.insert.pvcite).map((o) => o.insert.pvcite);
    expect(cites.length).toBe(urls.length);
    for (const c of cites) {
      expect(c.url).toBe("");
      expect(c.text).toBe("(A 2020) <b>");
      expect(Object.keys(c).sort()).toEqual(["kind", "ref", "text", "url"]);
    }
  });
});

// ---------------------------------------------------------------- the name

describe("R4-E. The name in three pieces", () => {
  it("E1. a piece that is not plain words is refused, and a piece is always one clean line", async () => {
    const b = new Browser(world);
    await b.signIn("e1@example.org");
    const base = { rorId: "0107c5v14" };
    const refused = [
      { firstName: 5, surname: "Lovelace" },
      { firstName: ["Ada"], surname: "Lovelace" },
      { firstName: { a: 1 }, surname: "Lovelace" },
      { firstName: "Ada", surname: null },
      { firstName: "Ada", surname: true },
      { firstName: "Ada", middleName: 7, surname: "Lovelace" },
      { firstName: "🙂", surname: "Lovelace" },
      { firstName: "Ada", surname: "​​" },
      { firstName: "Ada", surname: "...." }
    ];
    for (const t of refused) {
      const r = await patch(b, "/api/me", { ...base, ...t });
      expect(r.status, JSON.stringify(t)).toBe(400);
    }
    expect((await b.json("/api/me")).data.finished).toBe(false);
    const ok = await patch(b, "/api/me", { ...base, firstName: "  Ada\n\tMaría ", middleName: "  ", surname: " O'Neill-\u0000Smith  " });
    expect(ok.status).toBe(200);
    const me = (await b.json("/api/me")).data;
    expect(me).toMatchObject({ firstName: "Ada María", middleName: null, surname: "O'Neill- Smith", name: "Ada María O'Neill- Smith" });
  });

  it("E2. a name written as a formula or with commas and quotes stays one cell of text in the desk's download, in all three columns", async () => {
    await member("e2@example.org", { firstName: "=HYPERLINK(\"http://evil.example\",\"x\")", middleName: "+1+1", surname: "@SUM(A1:A9)" });
    await member("e2b@example.org", { firstName: "-Ada", middleName: "=cmd|' /C calc'!A0", surname: "Smith, \"Jr\"" });
    await member("e2c@example.org", { firstName: "\tAda", surname: "\rLovelace" });
    const ed = await member(EDITOR, { firstName: "Khayyam", surname: "Rzazade" });
    const csv = (await (await ed.fetch("/api/desk/accounts.csv")).text()).replace(/^﻿/, "");
    const cells = (line) => {
      const out = []; let cur = "", q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
      }
      out.push(cur); return out;
    };
    const rows = csv.trim().split("\r\n").map(cells);
    expect(rows.every((r) => r.length === rows[0].length)).toBe(true);
    const by = Object.fromEntries(rows.slice(1).map((r) => [r[3], r.slice(0, 3)]));
    for (const email of ["e2@example.org", "e2b@example.org", "e2c@example.org"]) {
      for (const cell of by[email]) expect(cell, email + ": " + JSON.stringify(cell)).not.toMatch(/^[=+\-@\t\r]/);
    }
    expect(by["e2b@example.org"][2]).toBe('Smith, "Jr"');
  });

  it("E3. a guest has no name to give, and an account from before cannot change anything else until it gives its surname", async () => {
    const g = await guest();
    expect((await patch(g, "/api/me", { firstName: "Ada", surname: "Lovelace", rorId: "0107c5v14" })).status).toBe(403);
    const b = await member("e3@example.org", { firstName: "Ada Lovelace", position: "Professor" });
    const id = await idOf(b);
    await env.DB.prepare("UPDATE profile SET surname = NULL WHERE user_id = ?").bind(id).run();
    const r = await patch(b, "/api/me", { position: "Student", field: "History", institution: "Elsewhere", country: "DE", newsletter: true });
    expect(r.status).toBe(400);
    expect(Object.keys(r.data.fields)).toEqual(["surname"]);
    const row = await env.DB.prepare("SELECT position, field, institution, newsletter FROM profile WHERE user_id = ?").bind(id).first();
    expect(row).toMatchObject({ position: "Professor", newsletter: 0 });
    expect(row.institution).not.toBe("Elsewhere");
  });

  it("E4. an account from before is never the editor, and never a member, by any door, until the surname is given", async () => {
    const ed = await member(EDITOR, { firstName: "Khayyam Rzazade" });
    const id = await idOf(ed);
    await post(ed, "/api/keep", work(1));
    const p = (await post(ed, "/api/projects", { title: "P" })).data.project.id;
    const d = (await post(ed, "/api/drafts", { title: "D" })).data.draft.id;
    await env.DB.prepare("UPDATE profile SET surname = NULL WHERE user_id = ?").bind(id).run();
    const doors = [
      ["GET", "/api/desk/summary"], ["GET", "/api/desk/accounts.csv"], ["GET", "/api/desk/invites"],
      ["POST", "/api/desk/open", { open: true }], ["POST", "/api/desk/invites", { emails: "x@example.org" }],
      ["GET", "/api/pages"], ["POST", "/api/pages", { title: "t", body: "b" }],
      ["GET", "/api/keep?kind=work"], ["POST", "/api/keep", work(2)], ["POST", "/api/keep/mine", { refs: [] }],
      ["GET", "/api/notes"], ["GET", "/api/projects"], ["GET", "/api/projects/" + p], ["GET", "/api/drafts"], ["GET", "/api/drafts/" + d],
      ["GET", "/api/figures"], ["POST", "/api/write/cites", { refs: [] }], ["GET", "/api/write/bibliography"],
      ["DELETE", "/api/me/orcid"], ["POST", "/api/auth/link-social", { provider: "orcid", callbackURL: "https://populiverse.com/workspace/account.html" }]
    ];
    for (const [method, path, body] of doors) {
      const r = await ed.json(path, { method, body });
      expect(r.status, method + " " + path).toBe(403);
    }
    // what stays open: seeing the account, downloading everything, giving the name
    expect((await ed.json("/api/me")).data).toMatchObject({ needsName: true, editor: false, finished: false });
    expect((await ed.fetch("/api/me/export")).status).toBe(200);
    expect((await patch(ed, "/api/me", { firstName: "Khayyam", surname: "Rzazade" })).status).toBe(200);
    expect((await ed.json("/api/desk/summary")).status).toBe(200);
    expect((await ed.json("/api/keep?kind=work")).data.things.length).toBe(1);
  });

  it("E5. the newsletter gets the address once, however often the name is changed afterwards", async () => {
    const b = new Browser(world);
    await b.signIn("e5@example.org");
    expect((await patch(b, "/api/me", { firstName: "María José", middleName: "de la", surname: "Cruz", rorId: "0107c5v14", newsletter: true })).status).toBe(200);
    const read = () => env.DB.prepare("SELECT newsletter, newsletter_at, newsletter_sent_at, newsletter_error FROM profile p JOIN \"user\" u ON u.id = p.user_id WHERE u.email = ?").bind("e5@example.org").first();
    const first = await read();
    expect(first.newsletter).toBe(1);
    expect(first.newsletter_sent_at).toBeTruthy();
    expect(first.newsletter_error).toBeNull();
    // changing the name later, with the box sent as ticked again, sends nothing again
    expect((await patch(b, "/api/me", { firstName: "María", surname: "Cruz Díaz", newsletter: true })).status).toBe(200);
    expect(await read()).toEqual(first);
  });
});
