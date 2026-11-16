// The fixes after the live check before the trial (master plan, section 18,
// claude/workspace-trial-fixes-plan.md). C1: names with accents stand where a
// reader looks for them, through migration 0006 and its backfill. A3: the list
// of drafts says which draft nobody has written in yet. Each test says what
// SHOULD hold.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Browser, makeWorld, setOpen } from "./helpers.js";
import { sortKey } from "../src/keep.js";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let world;
beforeEach(async () => {
  world = makeWorld();
  await setOpen(true);
  await env.DB.batch(["project_thing", "project", "draft", "figure"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});
async function member(email) { const b = new Browser(world); await b.signUp(email); return b; }
const post = (b, path, body) => b.json(path, { method: "POST", body });
const patch = (b, path, body) => b.json(path, { method: "PATCH", body });
const idOf = async (b) => (await b.json("/api/auth/get-session")).data.user.id;

// Four works whose authors start with A, Á, Bö and Br, saved in a mixed order.
const NAMES = ["Bruno, Giordano. 2020. One.", "Mudde, Cas. 2004. Two.", "Böller, Anna. 2019. Three.", "Ábel, Zoltán. 2018. Four.", "Abbott, Ann. 2017. Five."];
const RIGHT = ["Abbott", "Ábel", "Böller", "Bruno", "Mudde"];
const work = (i) => ({ kind: "work", ref: "W" + i, title: NAMES[i], cite: NAMES[i], year: "20" + (10 + i), extra: NAMES[i].split(",")[0] });
const first = (list) => list.map((t) => (t.title || t.cite).split(",")[0]);

async function shelfOf(b) {
  for (let i = 0; i < NAMES.length; i++) await post(b, "/api/keep", work(i));
}
// The state of a shelf saved before migration 0006: no folded names.
async function asBefore(userId) {
  await env.DB.prepare("UPDATE kept SET sort_name = NULL WHERE user_id = ?").bind(userId).run();
}
async function emptyNames(userId) {
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM kept WHERE user_id = ? AND sort_name IS NULL").bind(userId).first();
  return n;
}

describe("C1. Names with accents in order (migration 0006 and its backfill)", () => {
  it("C1.1 the fold takes off accents, marks and a quote in front, and keeps the rest", () => {
    expect(sortKey("Böller, Anna")).toBe("boller, anna");
    expect(sortKey("Ábel, Zoltán")).toBe("abel, zoltan");
    expect(sortKey("Łukasz, Wróbel")).toBe("lukasz, wrobel");
    expect(sortKey("“Quoted” title")).toBe("quoted” title");
    expect(sortKey("Mudde, Cas. <i>Government and Opposition</i> &amp; more")).toBe("mudde, cas. government and opposition more");
    expect(sortKey("")).toBe("");
    expect(sortKey(null)).toBe("");
  });

  it("C1.2 a new save carries its folded name", async () => {
    const a = await member("c12@example.org");
    await post(a, "/api/keep", work(2));
    const row = await env.DB.prepare("SELECT sort_name FROM kept WHERE user_id = ?").bind(await idOf(a)).first();
    expect(row.sort_name).toBe("boller, anna. 2019. three.");
  });

  it("C1.3 a shelf saved before the migration is filled the first time it is read in order, and Böller stands before Bruno", async () => {
    const a = await member("c13@example.org");
    await shelfOf(a);
    const me = await idOf(a);
    await asBefore(me);
    expect(await emptyNames(me)).toBe(NAMES.length);
    // The newest-first list needs no folded names and leaves them as they are.
    const newest = await a.json("/api/keep?kind=work&order=new");
    expect(newest.status).toBe(200);
    expect(await emptyNames(me)).toBe(NAMES.length);
    const r = await a.json("/api/keep?kind=work&order=author");
    expect(r.status).toBe(200);
    expect(first(r.data.things)).toEqual(RIGHT);
    expect(await emptyNames(me)).toBe(0);
  });

  it("C1.4 the fill touches only the reader's own rows", async () => {
    const a = await member("c14a@example.org");
    const b = await member("c14b@example.org");
    await shelfOf(a);
    await shelfOf(b);
    await asBefore(await idOf(a));
    await asBefore(await idOf(b));
    await a.json("/api/keep?kind=work&order=author");
    expect(await emptyNames(await idOf(a))).toBe(0);
    expect(await emptyNames(await idOf(b))).toBe(NAMES.length);
  });

  it("C1.5 the Annotated Bibliography, the shelf's own list for the \"@\" and a project are in the same order", async () => {
    const a = await member("c15@example.org");
    await shelfOf(a);
    const p = (await post(a, "/api/projects", { title: "Order" })).data.project.id;
    for (let i = 0; i < NAMES.length; i++) await post(a, `/api/projects/${p}/things`, { kind: "work", ref: "W" + i });
    await asBefore(await idOf(a));
    const bib = await a.json("/api/write/bibliography");
    expect(first(bib.data.works)).toEqual(RIGHT);
    await asBefore(await idOf(a));
    const fromProject = await a.json("/api/write/bibliography?project=" + p);
    expect(first(fromProject.data.works)).toEqual(RIGHT);
    await asBefore(await idOf(a));
    const proj = await a.json("/api/projects/" + p);
    expect(first(proj.data.things.filter((t) => t.kind === "work"))).toEqual(RIGHT);
  });

  it("C1.6 the notes, ordered by what they are on, follow the same order", async () => {
    const a = await member("c16@example.org");
    for (let i = 0; i < NAMES.length; i++) await post(a, "/api/keep/note", { ...work(i), body: "Note " + i });
    await asBefore(await idOf(a));
    const r = await a.json("/api/notes?order=kind");
    expect(r.status).toBe(200);
    expect(first(r.data.notes)).toEqual(RIGHT);
  });

  it("C1.7 a shelf of more than a hundred things is filled whole, in rounds", async () => {
    const a = await member("c17@example.org");
    const me = await idOf(a);
    const t = new Date().toISOString();
    const rows = [];
    for (let i = 0; i < 250; i++) {
      rows.push(
        env.DB.prepare(
          "INSERT INTO kept (id, user_id, kind, ref, title, created_at, updated_at) VALUES (?, ?, 'item', ?, ?, ?, ?)"
        ).bind("x" + i, me, "2026-1:" + i, (i % 2 ? "Ö" : "O") + "rban " + String(i).padStart(3, "0"), t, t)
      );
    }
    await env.DB.batch(rows);
    expect(await emptyNames(me)).toBe(250);
    const r = await a.json("/api/keep?kind=item&order=author");
    expect(r.status).toBe(200);
    expect(await emptyNames(me)).toBe(0);
    // "Orban 000", "Örban 001", "Orban 002"…: the accent no longer splits them.
    expect(r.data.things.slice(0, 3).map((x) => x.title)).toEqual(["Orban 000", "Örban 001", "Orban 002"]);
  });

  it("C1.8 saving a thing again with a new name gives it the new folded name", async () => {
    const a = await member("c18@example.org");
    await post(a, "/api/keep", work(0));
    await post(a, "/api/keep", { ...work(0), title: "Élise, Anne. 2021." });
    const row = await env.DB.prepare("SELECT title, sort_name FROM kept WHERE user_id = ?").bind(await idOf(a)).first();
    expect(row.title).toBe("Élise, Anne. 2021.");
    expect(row.sort_name).toBe("elise, anne. 2021.");
  });
});

describe("A3. The list of drafts says which draft nobody has written in yet", () => {
  it("A3.1 a new draft is blank; a title, words or a figure each make it not blank", async () => {
    const a = await member("a31@example.org");
    const d1 = (await post(a, "/api/drafts", { title: "" })).data.draft;
    const d2 = (await post(a, "/api/drafts", { title: "" })).data.draft;
    const d3 = (await post(a, "/api/drafts", { title: "" })).data.draft;
    const d4 = (await post(a, "/api/drafts", { title: "" })).data.draft;
    let list = (await a.json("/api/drafts")).data.drafts;
    expect(list.every((d) => d.blank === 1)).toBe(true);

    await patch(a, "/api/drafts/" + d1.id, { title: "A title", base: d1.updated_at });
    await patch(a, "/api/drafts/" + d2.id, { body: { ops: [{ insert: "Some words\n" }] }, base: d2.updated_at });
    const fig = (await post(a, "/api/figures", { ref: "in-power#map", title: "A chart", source: "S.", cite: "C.", url: "https://populiverse.com/data/in-power.html", day: "15 November 2026", width: 1, height: 1, picture: PNG })).data.figure;
    await patch(a, "/api/drafts/" + d3.id, { body: { ops: [{ insert: { pvfigure: { id: fig.id } } }, { insert: "\n" }] }, base: d3.updated_at });

    list = (await a.json("/api/drafts")).data.drafts;
    const blank = Object.fromEntries(list.map((d) => [d.id, d.blank]));
    expect(blank[d1.id]).toBe(0);
    expect(blank[d2.id]).toBe(0);
    expect(blank[d3.id]).toBe(0);
    expect(blank[d4.id]).toBe(1);
  });

  it("A3.2 another person's drafts are never in the list", async () => {
    const a = await member("a32a@example.org");
    const b = await member("a32b@example.org");
    await post(b, "/api/drafts", { title: "" });
    const list = (await a.json("/api/drafts")).data.drafts;
    expect(list.length).toBe(0);
  });
});
