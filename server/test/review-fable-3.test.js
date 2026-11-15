// Fable's own attacks on batches 2 and 3 together (the second pair of eyes;
// master plan, section 18, the row of 2026-11-13 on the check of batches 2 and 3).
// Written without having seen the build. Each test says what SHOULD hold.
// On the day they were written, 9 of the 20 failed: A1 (fix 3), B1 to B4 (fix 2),
// C1 and C2 (fix 8), F1 and F2 (fix 9). All 20 must pass before the push.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";
import { Browser, makeWorld, setOpen } from "./helpers.js";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FIG = { ref: "in-power#map", title: "Populists in Power", source: "Sources: X.", cite: "Cite line.", url: "https://populiverse.com/data/in-power.html", day: "2026-11-13", width: 10, height: 10, picture: PNG };
const work = (n, more = {}) => ({ kind: "work", ref: "W" + n, title: "Author " + n + " 2020. Title " + n, extra: "Author " + n + " 2020", year: "2020", cite: "Author " + n + ". 2020. Title " + n + ".", abstract: "An abstract of work " + n + " with some words in it.", ...more });

let world;
beforeEach(async () => {
  world = makeWorld();
  await setOpen(true);
  await env.DB.batch(["project_thing", "project", "draft", "figure"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});
async function member(email) { const b = new Browser(world); await b.signUp(email); return b; }
async function guest() { const b = new Browser(world); const r = await b.guest(); expect(r.status).toBe(200); return b; }
const post = (b, path, body) => b.json(path, { method: "POST", body });
const patch = (b, path, body) => b.json(path, { method: "PATCH", body });
const del = (b, path, body) => b.json(path, { method: "DELETE", body });
async function count(table, userId) {
  const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(userId).first();
  return n;
}

describe("F3-A. A guest who signs up keeps everything", () => {
  it("A1. shelf, note, tag, mark, project, draft, figure and page all move to the new account", async () => {
    const g = await guest();
    expect((await post(g, "/api/keep", work(1))).status).toBe(201);
    expect((await post(g, "/api/keep/note", { ...work(1), body: "my note" })).status).toBe(200);
    expect((await post(g, "/api/keep/tag", { kind: "work", ref: "W1", add: "core" })).status).toBe(200);
    expect((await post(g, "/api/keep/mark", { kind: "work", ref: "W1", at: 3, text: "abstract" })).status).toBe(200);
    const p = (await post(g, "/api/projects", { title: "P", question: "Q?" })).data.project.id;
    expect((await post(g, `/api/projects/${p}/things`, { kind: "work", ref: "W1" })).status).toBe(200);
    const d = (await post(g, "/api/drafts", { title: "D", project_id: p })).data.draft.id;
    const f = (await post(g, "/api/figures", FIG)).data.figure.id;
    expect((await patch(g, `/api/drafts/${d}`, { body: { ops: [{ insert: "text " }, { insert: { pvfigure: { id: f } } }, { insert: "\n" }] } })).status).toBe(200);
    expect((await post(g, "/api/pages", { title: "Pg", body: "x", words: "x", project_id: p })).status).toBe(201);

    // The guest signs up in the same browser.
    const s = await g.signIn("newperson@example.org");
    expect(s.status).toBe(200);
    expect((await g.finish()).status).toBe(200);

    const shelf = await g.json("/api/keep?kind=work");
    const projects = await g.json("/api/projects");
    const drafts = await g.json("/api/drafts");
    const figures = await g.json("/api/figures");
    const pages = await g.json("/api/pages");
    const got = {
      things: shelf.data.things.length,
      note: shelf.data.things[0]?.note?.body || null,
      tags: shelf.data.things[0]?.tags || [],
      marks: (shelf.data.things[0]?.marks || []).length,
      projects: projects.data.projects.length,
      inProject: projects.data.projects[0]?.counts?.works || 0,
      drafts: drafts.data.drafts.length,
      figures: figures.data.figures.length,
      pages: pages.data.pages.length,
      pageProject: pages.data.pages[0]?.project_title || null
    };
    expect(got).toEqual({ things: 1, note: "my note", tags: ["core"], marks: 1, projects: 1, inProject: 1, drafts: 1, figures: 1, pages: 1, pageProject: "P" });
  });

  it("A2. nothing of the old guest is left in any table", async () => {
    const g = await guest();
    const me0 = (await g.json("/api/auth/get-session")).data.user.id;
    await post(g, "/api/keep/note", { ...work(1), body: "n" });
    await post(g, "/api/projects", { title: "P" });
    await post(g, "/api/figures", FIG);
    await g.signIn("np2@example.org");
    await g.finish();
    const left = {};
    for (const t of ["kept", "note", "project", "figure", "draft", "notebook_page"]) left[t] = await count(t, me0);
    expect(left).toEqual({ kept: 0, note: 0, project: 0, figure: 0, draft: 0, notebook_page: 0 });
  });
});

describe("F3-B. Many things at once (the database's own limits)", () => {
  it("B1. a page that shows 60 things can ask which are saved", async () => {
    const a = await member("b1@example.org");
    for (let i = 0; i < 60; i++) expect((await post(a, "/api/keep", work(i))).status).toBe(201);
    const r = await post(a, "/api/keep/mine", { refs: Array.from({ length: 60 }, (_, i) => ({ kind: "work", ref: "W" + i })) });
    expect(r.status).toBe(200);
    expect(r.data.things.length).toBe(60);
  });
  it("B2. a page that shows 300 things, 150 of them saved", async () => {
    const a = await member("b2@example.org");
    for (let i = 0; i < 150; i++) await post(a, "/api/keep", work(i));
    const r = await post(a, "/api/keep/mine", { refs: Array.from({ length: 300 }, (_, i) => ({ kind: "work", ref: "W" + i })) });
    expect(r.status).toBe(200);
    expect(r.data.things.length).toBe(150);
  });
  it("B3. Download Everything with 150 things on the shelf", async () => {
    const a = await member("b3@example.org");
    for (let i = 0; i < 150; i++) await post(a, "/api/keep/note", { ...work(i), body: "note " + i });
    const res = await a.fetch("/api/me/export");
    expect(res.status).toBe(200);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(JSON.parse(strFromU8(zip["shelf.json"])).length).toBe(150);
    expect(JSON.parse(strFromU8(zip["notes.json"])).length).toBe(150);
  });
  it("B4. a draft that cites 120 works gets its references", async () => {
    const a = await member("b4@example.org");
    for (let i = 0; i < 120; i++) await post(a, "/api/keep", work(i));
    const r = await post(a, "/api/write/cites", { refs: Array.from({ length: 120 }, (_, i) => ({ kind: "work", ref: "W" + i })) });
    expect(r.status).toBe(200);
    expect(r.data.things.length).toBe(120);
  });
});

describe("F3-C. Nothing but the five formats is stored, in the Notebook too", () => {
  it("C1. a Notebook page sent straight to the door keeps no unknown format, no picture, no script address", async () => {
    const a = await member("c1@example.org");
    const evil = JSON.stringify({
      ops: [
        { insert: "red", attributes: { color: "red", link: "javascript:alert(1)", font: "x", bold: true } },
        { insert: { image: "https://evil.example/x.png" } },
        { insert: { pvcite: { kind: "work", ref: "W1", text: "(A 2020)", url: "javascript:alert(document.cookie)" } } },
        { insert: { video: "https://evil.example/v" } },
        { insert: "\n" }
      ]
    });
    const made = await post(a, "/api/pages", { title: "t", body: evil, words: "red" });
    const id = made.data?.page?.id;
    const back = id ? (await a.json("/api/pages/" + id)).data.page.body : "";
    const kept = { status: made.status, js: /javascript:/i.test(back), colour: /"color"/.test(back), image: /"image"/.test(back), video: /"video"/.test(back) };
    // Either refused, or stored clean.
    expect(kept.js || kept.colour || kept.image || kept.video).toBe(false);
  });
  it("C2. the same through PATCH", async () => {
    const a = await member("c2@example.org");
    const id = (await post(a, "/api/pages", { title: "t", body: "", words: "" })).data.page.id;
    const evil = JSON.stringify({ ops: [{ insert: { pvcite: { kind: "work", ref: "W1", text: "x", url: "javascript:alert(1)" } } }, { insert: "\n" }] });
    await patch(a, "/api/pages/" + id, { body: evil, words: "x" });
    const back = (await a.json("/api/pages/" + id)).data.page.body;
    expect(/javascript:/i.test(back)).toBe(false);
  });
  it("C3. a draft: odd keys, prototype names, retain/delete, a cite of an unknown kind, two keys in one piece", async () => {
    const a = await member("c3@example.org");
    const d = (await post(a, "/api/drafts", { title: "D" })).data.draft.id;
    const tries = [
      { ops: [{ retain: 5 }] },
      { ops: [{ delete: 5 }] },
      { ops: [{ insert: { pvcite: { kind: "work", ref: "W1", text: "x" }, image: "y" } }] },
      { ops: [{ insert: { pvcite: { kind: "person", ref: "W1", text: "x" } } }] },
      { ops: [{ insert: { __proto__: { pvcite: 1 } } }] },
      { ops: "x" },
      { ops: [[]] },
      { ops: [{ insert: 5 }] }
    ];
    for (const t of tries) {
      const r = await patch(a, "/api/drafts/" + d, { body: t });
      expect(r.status, JSON.stringify(t)).toBeGreaterThanOrEqual(400);
    }
    const ok = await patch(a, "/api/drafts/" + d, {
      body: JSON.parse('{"ops":[{"insert":"a","attributes":{"__proto__":{"bold":true},"constructor":1,"bold":"yes","header":7,"list":"check","italic":true,"script":"super","background":"#000","link":"javascript:x"}},{"insert":"\\n"}]}')
    });
    expect(ok.status).toBe(200);
    const body = (await a.json("/api/drafts/" + d)).data.draft.body;
    expect(JSON.parse(body)).toEqual({ ops: [{ insert: "a", attributes: { italic: true } }, { insert: "\n" }] });
  });
  it("C4. a title, a question, a tag, a figure's lines: no control characters, kept as words", async () => {
    const a = await member("c4@example.org");
    const s = '"><img src=x onerror=alert(1)>\u0000‮';
    const p = await post(a, "/api/projects", { title: s, question: s });
    expect(p.status).toBe(201);
    expect(p.data.project.title.includes("\u0000")).toBe(false);
    const f = await post(a, "/api/figures", { ...FIG, title: s, source: s, cite: s, day: s, ref: s });
    expect(f.status).toBe(201);
    const f2 = await post(a, "/api/figures", { ...FIG, picture: "data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+" });
    expect(f2.status).toBe(400);
    const f3 = await post(a, "/api/figures", { ...FIG, picture: "data:image/png;base64,AAAA\" onload=\"x" });
    expect(f3.status).toBe(400);
    const f4 = await post(a, "/api/figures", { ...FIG, url: "https://populiverse.com/x\" onclick=\"alert(1)" });
    expect(f4.status).toBe(201);
    expect(f4.data.figure.url).toBe("");
  });
});

describe("F3-D. Another person's things, through the side doors", () => {
  it("D1. filters by another person's project show nothing of theirs", async () => {
    const eve = await member("eve@example.org");
    const ada = await member("ada@example.org");
    const ep = (await post(eve, "/api/projects", { title: "Eve's" })).data.project.id;
    await post(eve, "/api/keep/note", { ...work(1), body: "eve's secret note" });
    await post(eve, `/api/projects/${ep}/things`, { kind: "work", ref: "W1" });
    await post(eve, "/api/pages", { title: "eve page", body: "secret", words: "secret", project_id: ep });
    await post(ada, "/api/keep", work(1));
    const shelf = await ada.json("/api/keep?kind=work&project=" + ep);
    const notes = await ada.json("/api/notes?project=" + ep);
    const pages = await ada.json("/api/pages?project=" + ep);
    const bib = await ada.json("/api/write/bibliography?project=" + ep);
    expect(shelf.data.things.length).toBe(0);
    expect(notes.data.notes.length).toBe(0);
    expect(pages.data.pages.length).toBe(0);
    expect(bib.status).toBe(404);
    expect(JSON.stringify([shelf.data, notes.data, pages.data, bib.data]).includes("secret")).toBe(false);
  });
  it("D2. the same work kept by two people: cites, bibliography and download give each only their own note", async () => {
    const eve = await member("eve2@example.org");
    const ada = await member("ada2@example.org");
    await post(eve, "/api/keep/note", { ...work(1), body: "EVE-ONLY" });
    await post(ada, "/api/keep/note", { ...work(1), body: "ADA-ONLY" });
    const c = await post(ada, "/api/write/cites", { refs: [{ kind: "work", ref: "W1" }] });
    const b = await ada.json("/api/write/bibliography");
    const res = await ada.fetch("/api/me/export");
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const all = JSON.stringify(c.data) + JSON.stringify(b.data) + Object.keys(zip).map((k) => (k.endsWith(".png") ? "" : strFromU8(zip[k]))).join("\n");
    expect(all.includes("ADA-ONLY")).toBe(true);
    expect(all.includes("EVE-ONLY")).toBe(false);
  });
  it("D3. another person's figure, draft, project and mark by their id: read, change, delete, attach", async () => {
    const eve = await member("eve3@example.org");
    const ada = await member("ada3@example.org");
    const ef = (await post(eve, "/api/figures", FIG)).data.figure.id;
    const ep = (await post(eve, "/api/projects", { title: "Eve's" })).data.project.id;
    const ed = (await post(eve, "/api/drafts", { title: "Eve's draft", project_id: ep })).data.draft.id;
    const em = (await post(eve, "/api/keep/mark", { ...work(1), at: 0, text: "An" })).data.thing.marks[0].id;
    const ad = (await post(ada, "/api/drafts", { title: "Ada's" })).data.draft.id;
    // attach Eve's figure and Eve's project to Ada's draft
    const r1 = await patch(ada, "/api/drafts/" + ad, { body: { ops: [{ insert: { pvfigure: { id: ef } } }, { insert: "\n" }] } });
    expect(r1.status).toBe(200);
    const got = await ada.json("/api/drafts/" + ad);
    expect(got.data.figures.length).toBe(0);
    expect(got.data.draft.body.includes(ef)).toBe(false);
    expect((await patch(ada, "/api/drafts/" + ad, { project_id: ep })).status).toBe(404);
    expect((await post(ada, "/api/drafts", { title: "x", project_id: ep })).status).toBe(404);
    expect((await post(ada, "/api/pages", { title: "x", body: "", words: "", project_id: ep })).status).toBe(404);
    expect((await post(ada, "/api/keep/mark", { remove: em })).status).toBe(404);
    for (const path of ["/api/figures/" + ef, "/api/drafts/" + ed, "/api/projects/" + ep]) {
      expect((await ada.json(path)).status, path).toBe(404);
      expect((await del(ada, path)).status, path).toBe(404);
    }
    // Eve still has all of it
    expect((await eve.json("/api/figures/" + ef)).status).toBe(200);
    expect((await eve.json("/api/drafts/" + ed)).status).toBe(200);
    expect((await eve.json("/api/projects/" + ep)).status).toBe(200);
    expect((await eve.json("/api/keep?kind=work")).data.things[0].marks.length).toBe(1);
  });
});

describe("F3-E. Removing things that other things point at", () => {
  it("E1. a saved work removed from the shelf leaves its project, and the project still opens", async () => {
    const a = await member("e1@example.org");
    const me = (await a.json("/api/auth/get-session")).data.user.id;
    const p = (await post(a, "/api/projects", { title: "P" })).data.project.id;
    await post(a, "/api/keep/note", { ...work(1), body: "n" });
    await post(a, `/api/projects/${p}/things`, { kind: "work", ref: "W1" });
    expect((await del(a, "/api/keep", { kind: "work", ref: "W1" })).status).toBe(200);
    expect(await count("project_thing", me)).toBe(0);
    const g = await a.json("/api/projects/" + p);
    expect(g.status).toBe(200);
    expect(g.data.things.length).toBe(0);
  });
  it("E2. a figure deleted while a draft uses it: the draft opens, and says nothing false", async () => {
    const a = await member("e2@example.org");
    const d = (await post(a, "/api/drafts", { title: "D" })).data.draft.id;
    const f = (await post(a, "/api/figures", FIG)).data.figure.id;
    await patch(a, "/api/drafts/" + d, { body: { ops: [{ insert: { pvfigure: { id: f } } }, { insert: "\n" }] } });
    expect((await del(a, "/api/figures/" + f)).status).toBe(200);
    const g = await a.json("/api/drafts/" + d);
    expect(g.status).toBe(200);
    expect(g.data.figures.length).toBe(0);
  });
  it("E3. a deleted project takes no work, note, page or draft with it, and frees its draft for another project", async () => {
    const a = await member("e3@example.org");
    const p = (await post(a, "/api/projects", { title: "P" })).data.project.id;
    const p2 = (await post(a, "/api/projects", { title: "P2" })).data.project.id;
    await post(a, "/api/keep/note", { ...work(1), body: "n" });
    await post(a, `/api/projects/${p}/things`, { kind: "work", ref: "W1" });
    const d = (await post(a, "/api/drafts", { title: "D", project_id: p })).data.draft.id;
    const pg = (await post(a, "/api/pages", { title: "Pg", body: "x", words: "x", project_id: p })).data.page.id;
    expect((await del(a, "/api/projects/" + p)).status).toBe(200);
    expect((await a.json("/api/keep?kind=work")).data.things[0].note.body).toBe("n");
    expect((await a.json("/api/keep?kind=work")).data.things[0].projects).toEqual([]);
    expect((await a.json("/api/pages/" + pg)).data.page.project_id).toBe(null);
    expect((await a.json("/api/drafts/" + d)).data.draft.project_id).toBe(null);
    expect((await patch(a, "/api/drafts/" + d, { project_id: p2 })).status).toBe(200);
  });
});

describe("F3-F. Limits under a race, and things far too large", () => {
  it("F1. a guest at 45 things who sends 20 saves at once does not end above 50", async () => {
    const g = await guest();
    for (let i = 0; i < 45; i++) await post(g, "/api/keep", work(i));
    await Promise.all(Array.from({ length: 20 }, (_, i) => post(g, "/api/keep", work(100 + i))));
    const used = (await g.json("/api/keep?kind=work")).data.used;
    expect(used).toBeLessThanOrEqual(50);
  });
  it("F2. a guest who sends 10 projects, 10 drafts and 10 figures at once does not end above 3 of each", async () => {
    const g = await guest();
    await Promise.all(Array.from({ length: 10 }, (_, i) => post(g, "/api/projects", { title: "P" + i })));
    await Promise.all(Array.from({ length: 10 }, (_, i) => post(g, "/api/drafts", { title: "D" + i })));
    await Promise.all(Array.from({ length: 10 }, () => post(g, "/api/figures", FIG)));
    const n = {
      projects: (await g.json("/api/projects")).data.projects.length,
      drafts: (await env.DB.prepare("SELECT COUNT(*) AS n FROM draft").first()).n,
      figures: (await g.json("/api/figures")).data.figures.length
    };
    expect(n).toEqual({ projects: 3, drafts: 3, figures: 3 });
  });
  it("F3. bodies far too large are refused at every writing door", async () => {
    const a = await member("f3@example.org");
    const big = "x".repeat(3000000);
    const d = (await post(a, "/api/drafts", { title: "D" })).data.draft.id;
    const p = (await post(a, "/api/projects", { title: "P" })).data.project.id;
    const tries = [
      ["POST", "/api/keep", { ...work(1), abstract: big }],
      ["POST", "/api/keep/note", { ...work(1), body: big }],
      ["POST", "/api/keep/tag", { kind: "work", ref: "W1", add: big }],
      ["POST", "/api/keep/mark", { kind: "work", ref: "W1", at: 0, text: big }],
      ["POST", "/api/projects", { title: big }],
      ["PATCH", "/api/projects/" + p, { question: big }],
      ["PATCH", "/api/drafts/" + d, { body: { ops: [{ insert: big }] } }],
      ["PATCH", "/api/drafts/" + d, { title: big }],
      ["POST", "/api/pages", { title: "t", body: big }],
      ["POST", "/api/figures", { ...FIG, picture: "data:image/png;base64," + "A".repeat(3000000) }],
      ["POST", "/api/figures", { ...FIG, source: big }]
    ];
    for (const [method, path, body] of tries) {
      const r = await a.json(path, { method, body });
      expect([400, 409, 413].includes(r.status), `${method} ${path} -> ${r.status}`).toBe(true);
    }
    // a draft made of 60,001 one-letter pieces, and one whose cites add up past the limit
    const many = await patch(a, "/api/drafts/" + d, { body: { ops: Array.from({ length: 60001 }, () => ({ insert: "a" })) } });
    expect(many.status).toBe(413);
  });
});

describe("F3-G. A cite and a mark that point at nothing", () => {
  it("G1. a cite of a thing that is nowhere gets no reference, and no error", async () => {
    const a = await member("g1@example.org");
    const r = await post(a, "/api/write/cites", { refs: [{ kind: "work", ref: "NOPE" }, { kind: "item", ref: "9999-9:99" }, { kind: "nonsense", ref: "x" }, null, 5, "x"] });
    expect(r.status).toBe(200);
    expect(r.data.things).toEqual([]);
  });
});
