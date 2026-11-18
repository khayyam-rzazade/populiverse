// Projects: a question, the cases and works under it, the notes on them, the
// pages of the Notebook inside it and one draft (master plan, section 18,
// stage 2, batch 3).
//
// Every query names the owner: `user_id = ?` is bound to `who.userId`, the
// person the gate found (index.js), and to nobody else. Deleting a project
// deletes the project and the links to what was in it, and nothing else: the
// works, notes, pages and the draft stay, loose.

import { json, readBody, now } from "./util.js";
import { LIMITS, PROJECT_COLOURS } from "./lists.js";
import { fillSortNames } from "./keep.js";

// Plain one-line text: control characters become spaces, runs of space become
// one space, and anything longer than the limit is refused.
function line(v, max) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? null : t;
}

// A project's colour as it arrives: undefined when the page sends none, null
// for "no colour" (null or an empty string), one of the six names, or false
// for anything else, which is refused.
function colourOf(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return typeof v === "string" && PROJECT_COLOURS.includes(v) ? v : false;
}
const NO_SUCH_COLOUR = "Please pick one of the six colours.";

function limitOf(who) {
  return who.guest ? LIMITS.projectsPerGuest : LIMITS.projectsPerAccount;
}

async function mine(env, who, id) {
  if (typeof id !== "string" || !id || id.length > 64) return null;
  return env.DB.prepare("SELECT * FROM project WHERE id = ? AND user_id = ?").bind(id, who.userId).first();
}

// The numbers each project carries in the list.
async function numbers(env, who) {
  const [things, notes, pages, drafts] = await Promise.all([
    env.DB.prepare(
      `SELECT pt.project_id AS id, k.kind AS kind, COUNT(*) AS n FROM project_thing pt
         JOIN kept k ON k.id = pt.kept_id AND k.user_id = pt.user_id
        WHERE pt.user_id = ? GROUP BY pt.project_id, k.kind`
    )
      .bind(who.userId)
      .all(),
    env.DB.prepare(
      `SELECT pt.project_id AS id, COUNT(*) AS n FROM project_thing pt
         JOIN note nt ON nt.kept_id = pt.kept_id AND nt.user_id = pt.user_id
        WHERE pt.user_id = ? GROUP BY pt.project_id`
    )
      .bind(who.userId)
      .all(),
    env.DB.prepare(
      "SELECT project_id AS id, COUNT(*) AS n FROM notebook_page WHERE user_id = ? AND project_id IS NOT NULL GROUP BY project_id"
    )
      .bind(who.userId)
      .all(),
    env.DB.prepare(
      "SELECT project_id AS id, title, words, updated_at FROM draft WHERE user_id = ? AND project_id IS NOT NULL"
    )
      .bind(who.userId)
      .all()
  ]);
  const out = {};
  const slot = (id) => (out[id] = out[id] || { cases: 0, works: 0, items: 0, charts: 0, notes: 0, pages: 0, draft: null });
  (things.results || []).forEach((r) => {
    const s = slot(r.id);
    if (r.kind === "work") s.works += r.n;
    else if (r.kind === "item") s.items += r.n;
    else if (r.kind === "chart") s.charts += r.n;
    else s.cases += r.n;
  });
  (notes.results || []).forEach((r) => { slot(r.id).notes = r.n; });
  (pages.results || []).forEach((r) => { slot(r.id).pages = r.n; });
  (drafts.results || []).forEach((r) => {
    slot(r.id).draft = { title: r.title, words: r.words, updated_at: r.updated_at };
  });
  return out;
}

export const projects = {
  async list({ env, who }) {
    const { results } = await env.DB.prepare(
      "SELECT id, title, question, colour, created_at, updated_at FROM project WHERE user_id = ? ORDER BY updated_at DESC"
    )
      .bind(who.userId)
      .all();
    const counts = await numbers(env, who);
    return json({
      projects: (results || []).map((p) => ({
        ...p,
        counts: counts[p.id] || { cases: 0, works: 0, items: 0, charts: 0, notes: 0, pages: 0, draft: null }
      })),
      limit: limitOf(who),
      guest: who.guest
    });
  },

  async create({ env, request, who }) {
    const body = await readBody(request, 20000);
    if (!body) return json({ error: "That is too long." }, 413);
    const title = line(body.title ?? "", LIMITS.charsPerTitle);
    const question = line(body.question ?? "", LIMITS.charsPerQuestion);
    if (title === null || question === null) return json({ error: "That is too long." }, 413);
    if (!title) return json({ error: "Please give the project a title.", fields: { title: "Please give the project a title." } }, 400);
    const colour = colourOf(body.colour);
    if (colour === false) return json({ error: NO_SUCH_COLOUR, fields: { colour: NO_SUCH_COLOUR } }, 400);
    const limit = limitOf(who);
    const id = crypto.randomUUID();
    const t = now();
    // The count stands inside the statement that writes the row (Fable's check, point 9).
    const made = await env.DB.prepare(
      `INSERT INTO project (id, user_id, title, question, colour, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM project WHERE user_id = ?) < ?`
    )
      .bind(id, who.userId, title, question, colour || null, t, t, who.userId, limit)
      .run();
    if (!made.meta.changes) {
      return json(
        { error: who.guest ? `A guest can keep ${limit} projects. Sign up to keep more.` : `You have reached ${limit} projects.`, limit },
        409
      );
    }
    return json({ project: { id, title, question, colour: colour || null, created_at: t, updated_at: t } }, 201);
  },

  // One project as one view. Everything comes from this person's own rows; the
  // counts of the cases and the events of the Monitor are drawn by the page
  // from the site's own data, so they are never out of date.
  async get({ env, params, who }) {
    const p = await mine(env, who, params.id);
    if (!p) return json({ error: "No such project." }, 404);
    await fillSortNames(env, who);
    const [things, pages, draft] = await Promise.all([
      env.DB.prepare(
        `SELECT k.kind, k.ref, k.title, k.extra, k.url, k.year, k.country, k.status, k.cite,
                n.body AS note, n.updated_at AS note_changed
           FROM project_thing pt
           JOIN kept k ON k.id = pt.kept_id AND k.user_id = pt.user_id
           LEFT JOIN note n ON n.kept_id = k.id AND n.user_id = k.user_id
          WHERE pt.user_id = ? AND pt.project_id = ?
          ORDER BY k.kind, k.sort_name, k.title COLLATE NOCASE
          LIMIT ?`
      )
        .bind(who.userId, p.id, LIMITS.thingsPerProject)
        .all(),
      env.DB.prepare(
        `SELECT id, title, substr(body, 1, 240) AS snippet, created_at, updated_at
           FROM notebook_page WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 200`
      )
        .bind(who.userId, p.id)
        .all(),
      env.DB.prepare(
        "SELECT id, title, words, created_at, updated_at FROM draft WHERE user_id = ? AND project_id = ?"
      )
        .bind(who.userId, p.id)
        .first()
    ]);
    const rows = things.results || [];
    const reading = { "to-read": 0, reading: 0, read: 0 };
    rows.forEach((r) => {
      if (r.kind !== "work") return;
      const s = r.status || "to-read";
      if (reading[s] !== undefined) reading[s]++;
    });
    return json({
      project: { id: p.id, title: p.title, question: p.question, colour: p.colour || null, created_at: p.created_at, updated_at: p.updated_at },
      things: rows,
      reading,
      pages: pages.results || [],
      draft: draft || null,
      guest: who.guest
    });
  },

  async update({ env, request, params, who }) {
    const p = await mine(env, who, params.id);
    if (!p) return json({ error: "No such project." }, 404);
    const body = await readBody(request, 20000);
    if (!body) return json({ error: "That is too long." }, 413);
    const sets = [];
    const args = [];
    if (body.title !== undefined) {
      const title = line(body.title, LIMITS.charsPerTitle);
      if (title === null) return json({ error: "That title is too long." }, 413);
      if (!title) return json({ error: "Please give the project a title." }, 400);
      sets.push("title = ?");
      args.push(title);
    }
    if (body.question !== undefined) {
      const question = line(body.question, LIMITS.charsPerQuestion);
      if (question === null) return json({ error: "That question is too long." }, 413);
      sets.push("question = ?");
      args.push(question);
    }
    if (body.colour !== undefined) {
      const colour = colourOf(body.colour);
      if (colour === false) return json({ error: NO_SUCH_COLOUR, fields: { colour: NO_SUCH_COLOUR } }, 400);
      sets.push("colour = ?");
      args.push(colour);
    }
    if (!sets.length) return json({ error: "Nothing to change." }, 400);
    const t = now();
    sets.push("updated_at = ?");
    args.push(t, p.id, who.userId);
    await env.DB.prepare(`UPDATE project SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...args).run();
    return json({ saved: true, updated_at: t });
  },

  // Deleting a project deletes nothing that is in it. Its works stay on the
  // shelf with their notes, its pages and its draft become loose.
  async remove({ env, params, who }) {
    const p = await mine(env, who, params.id);
    if (!p) return json({ error: "No such project." }, 404);
    await env.DB.batch([
      env.DB.prepare("UPDATE notebook_page SET project_id = NULL WHERE user_id = ? AND project_id = ?").bind(who.userId, p.id),
      env.DB.prepare("UPDATE draft SET project_id = NULL WHERE user_id = ? AND project_id = ?").bind(who.userId, p.id),
      env.DB.prepare("DELETE FROM project_thing WHERE user_id = ? AND project_id = ?").bind(who.userId, p.id),
      env.DB.prepare("DELETE FROM project WHERE id = ? AND user_id = ?").bind(p.id, who.userId)
    ]);
    return json({ deleted: true });
  },

  // A thing of this person's shelf goes into a project of this person. Both
  // halves are read with `user_id = ?`, so neither can belong to anybody else.
  async addThing({ env, request, params, who }) {
    const p = await mine(env, who, params.id);
    if (!p) return json({ error: "No such project." }, 404);
    const body = (await readBody(request, 4000)) || {};
    const kind = typeof body.kind === "string" ? body.kind : "";
    const ref = line(body.ref ?? "", LIMITS.charsPerRef);
    if (!kind || !ref) return json({ error: "Not found." }, 404);
    const row = await env.DB.prepare("SELECT id FROM kept WHERE user_id = ? AND kind = ? AND ref = ?")
      .bind(who.userId, kind, ref)
      .first();
    if (!row) return json({ error: "That is not on your shelf." }, 404);
    const here = await env.DB.prepare("SELECT 1 FROM project_thing WHERE project_id = ? AND kept_id = ?")
      .bind(p.id, row.id)
      .first();
    if (here) return json({ added: true });
    const t = now();
    const [made] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO project_thing (project_id, kept_id, user_id, added_at)
         SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM project_thing WHERE user_id = ? AND project_id = ?) < ?
         ON CONFLICT (project_id, kept_id) DO NOTHING`
      ).bind(p.id, row.id, who.userId, t, who.userId, p.id, LIMITS.thingsPerProject),
      env.DB.prepare("UPDATE project SET updated_at = ? WHERE id = ? AND user_id = ?").bind(t, p.id, who.userId)
    ]);
    if (!made.meta.changes) {
      const again = await env.DB.prepare("SELECT 1 FROM project_thing WHERE project_id = ? AND kept_id = ?").bind(p.id, row.id).first();
      if (!again) return json({ error: `One project can hold ${LIMITS.thingsPerProject} things.` }, 409);
    }
    return json({ added: true });
  },

  async removeThing({ env, request, params, who }) {
    const p = await mine(env, who, params.id);
    if (!p) return json({ error: "No such project." }, 404);
    const body = (await readBody(request, 4000)) || {};
    const kind = typeof body.kind === "string" ? body.kind : "";
    const ref = line(body.ref ?? "", LIMITS.charsPerRef);
    if (!kind || !ref) return json({ error: "Not found." }, 404);
    const row = await env.DB.prepare("SELECT id FROM kept WHERE user_id = ? AND kind = ? AND ref = ?")
      .bind(who.userId, kind, ref)
      .first();
    if (!row) return json({ error: "That is not on your shelf." }, 404);
    await env.DB.prepare("DELETE FROM project_thing WHERE project_id = ? AND kept_id = ? AND user_id = ?")
      .bind(p.id, row.id, who.userId)
      .run();
    return json({ removed: true });
  }
};

// Everything of this person's projects, for "Download Everything" (account.js).
export async function allProjects(env, who) {
  const { results: list } = await env.DB.prepare(
    "SELECT id, title, question, colour, created_at, updated_at FROM project WHERE user_id = ? ORDER BY created_at"
  )
    .bind(who.userId)
    .all();
  if (!(list || []).length) return [];
  const { results: links } = await env.DB.prepare(
    `SELECT pt.project_id AS project_id, k.kind AS kind, k.ref AS ref, k.title AS title
       FROM project_thing pt JOIN kept k ON k.id = pt.kept_id AND k.user_id = pt.user_id
      WHERE pt.user_id = ?`
  )
    .bind(who.userId)
    .all();
  const by = {};
  (links || []).forEach((l) => {
    (by[l.project_id] = by[l.project_id] || []).push({ kind: l.kind, ref: l.ref, title: l.title });
  });
  return list.map((p) => ({ ...p, things: by[p.id] || [] }));
}

// Used by the Notebook and by Write to check a project before it is named.
export async function ownProject(env, who, id) {
  if (id === null || id === undefined || id === "") return { ok: true, id: null };
  const p = await mine(env, who, id);
  return p ? { ok: true, id: p.id } : { ok: false };
}
