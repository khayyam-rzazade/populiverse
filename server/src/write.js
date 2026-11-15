// Write: drafts, the figures sent from the Data pages, the references of what a
// draft cites, and the Annotated Bibliography (master plan, section 18, stage 2,
// batch 3).
//
// A draft is never stored as HTML. Its text is the editor's own document, a
// plain list of pieces (a "delta"), and the server keeps only the pieces it
// knows: words, the five formats, a cite and a figure. Anything else a browser
// sends — a pasted colour, a style, a tag, an address that is not a web
// address — is dropped before the draft is stored, so no page can ever be
// handed something to run.

import { json, readBody, now, webAddress, inGroups } from "./util.js";
import { LIMITS } from "./lists.js";
import { ownProject } from "./projects.js";

const KINDS = new Set(["work", "item", "actor", "country", "chart"]);
const FORMATS = new Set(["bold", "italic", "header", "blockquote", "list"]);
const PAGE = 25;

function text(v, max) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return t.length > max ? null : t;
}

const cleanText = text;

function line(v, max) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? null : t;
}

// The five formats, and nothing else.
function formatsOf(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  const out = {};
  for (const k of Object.keys(a)) {
    if (!FORMATS.has(k)) continue;
    const v = a[k];
    if (k === "bold" || k === "italic" || k === "blockquote") {
      if (v === true) out[k] = true;
    } else if (k === "header") {
      if (v === 1 || v === 2 || v === 3) out[k] = v;
    } else if (k === "list") {
      if (v === "bullet" || v === "ordered") out[k] = v;
    }
  }
  return Object.keys(out).length ? out : null;
}

// A cite, or "empty" when it has no kind, no name and no words: that is what
// the editor once made of a pasted link, and it is simply left out. Anything
// else that is not a whole cite is refused.
function citeOf(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const blank = (x) => x === undefined || x === null || x === "";
  if (blank(v.kind) && blank(v.ref) && blank(v.text)) return "empty";
  const kind = typeof v.kind === "string" && KINDS.has(v.kind) ? v.kind : null;
  const ref = line(v.ref ?? "", LIMITS.charsPerRef);
  const words = line(v.text ?? "", 300);
  if (!kind || !ref || !words) return null;
  return { kind, ref, text: words, url: webAddress(v.url ?? "") };
}

// Rebuilds a draft, or a page of the Notebook, from what the browser sent,
// keeping only what is known (Fable's check, point 8: one cleaner for both).
// `figures` is the set of this person's own figure ids: a figure that is not
// theirs, or no longer there, is simply left out. A page of the Notebook holds
// no figures, so for a page `figures` is null and a figure is not known.
// Gives back { stored, words, text } or { error, status }: a refusal always
// says why.
const UNKNOWN = "This holds something the editor does not know, so it was not saved.";
export function cleanDelta(body, figures, maxChars = LIMITS.charsPerDraft) {
  const tooLong = { error: `This can hold ${maxChars.toLocaleString("en")} characters.`, status: 413 };
  const unknown = { error: UNKNOWN, status: 400 };
  if (!body || typeof body !== "object" || Array.isArray(body)) return unknown;
  if (!Array.isArray(body.ops)) return unknown;
  if (body.ops.length > 60000) return { error: "This is cut into too many pieces to keep.", status: 413 };
  const ops = [];
  let text = "";
  for (const op of body.ops) {
    if (!op || typeof op !== "object" || Array.isArray(op)) return unknown;
    const attributes = formatsOf(op.attributes);
    if (typeof op.insert === "string") {
      const t = cleanText(op.insert, maxChars);
      if (t === null) return tooLong;
      if (!t) continue;
      text += t;
      ops.push(attributes ? { insert: t, attributes } : { insert: t });
      continue;
    }
    if (op.insert && typeof op.insert === "object" && !Array.isArray(op.insert)) {
      const keys = Object.keys(op.insert);
      if (keys.length !== 1) return unknown;
      if (keys[0] === "pvcite") {
        const cite = citeOf(op.insert.pvcite);
        if (cite === "empty") continue;
        if (!cite) return unknown;
        text += cite.text;
        ops.push(attributes ? { insert: { pvcite: cite }, attributes } : { insert: { pvcite: cite } });
        continue;
      }
      if (keys[0] === "pvfigure" && figures) {
        const v = op.insert.pvfigure;
        const id = v && typeof v === "object" && typeof v.id === "string" ? v.id.slice(0, 64) : "";
        if (!id) return unknown;
        if (!figures.has(id)) continue;
        ops.push({ insert: { pvfigure: { id } } });
        text += "\n";
        continue;
      }
      return unknown;
    }
    return unknown;
  }
  const stored = JSON.stringify({ ops });
  if (stored.length > maxChars) return tooLong;
  const plain = text.replace(/\s+$/, "");
  const counted = plain.trim() ? plain.trim().split(/\s+/).length : 0;
  return { stored, words: Math.min(counted, 10000000), text: plain };
}

async function figureIds(env, who) {
  const { results } = await env.DB.prepare("SELECT id FROM figure WHERE user_id = ?").bind(who.userId).all();
  return new Set((results || []).map((r) => r.id));
}

function draftsLimit(who) {
  return who.guest ? LIMITS.draftsPerGuest : LIMITS.draftsPerAccount;
}

async function myDraft(env, who, id) {
  if (typeof id !== "string" || !id || id.length > 64) return null;
  return env.DB.prepare("SELECT * FROM draft WHERE id = ? AND user_id = ?").bind(id, who.userId).first();
}

// The figures a draft uses, with their pictures, so that it opens in one go.
async function figuresIn(env, who, stored) {
  const want = [];
  try {
    const d = JSON.parse(stored || '{"ops":[]}');
    (d.ops || []).forEach((op) => {
      if (op && op.insert && op.insert.pvfigure && want.indexOf(op.insert.pvfigure.id) < 0) {
        want.push(op.insert.pvfigure.id);
      }
    });
  } catch {
    return [];
  }
  if (!want.length) return [];
  return inGroups(want.slice(0, 2000), async (part) => {
    const { results } = await env.DB.prepare(
      `SELECT id, ref, title, source, cite, url, day, width, height, picture
         FROM figure WHERE user_id = ? AND id IN (${part.map(() => "?").join(", ")})`
    )
      .bind(who.userId, ...part)
      .all();
    return results || [];
  });
}

export const write = {
  // ----------------------------------------------------------------- drafts

  async list({ env, who }) {
    const { results } = await env.DB.prepare(
      `SELECT d.id, d.title, d.words, d.project_id, d.created_at, d.updated_at, p.title AS project_title
         FROM draft d LEFT JOIN project p ON p.id = d.project_id AND p.user_id = d.user_id
        WHERE d.user_id = ? ORDER BY d.updated_at DESC LIMIT ?`
    )
      .bind(who.userId, draftsLimit(who))
      .all();
    return json({ drafts: results || [], limit: draftsLimit(who), guest: who.guest });
  },

  async create({ env, request, who }) {
    const body = await readBody(request, 20000);
    if (!body) return json({ error: "That title is too long." }, 413);
    const title = line(body.title ?? "", LIMITS.charsPerTitle);
    if (title === null) return json({ error: "That title is too long." }, 413);
    const limit = draftsLimit(who);
    const full = () =>
      json(
        { error: who.guest ? `A guest can keep ${limit} drafts. Sign up to keep more.` : `You have reached ${limit} drafts.`, limit },
        409
      );
    const owned = await ownProject(env, who, body.project_id ?? null);
    if (!owned.ok) return json({ error: "No such project." }, 404);
    if (owned.id) {
      const taken = await env.DB.prepare("SELECT id FROM draft WHERE user_id = ? AND project_id = ?")
        .bind(who.userId, owned.id)
        .first();
      if (taken) return json({ error: "That project already has a draft.", draft: taken.id }, 409);
    }
    const id = crypto.randomUUID();
    const t = now();
    // The count stands inside the statement that writes the row, so requests
    // sent at the same moment cannot pass the limit together (Fable's check,
    // point 9).
    let made;
    try {
      made = await env.DB.prepare(
        `INSERT INTO draft (id, user_id, project_id, title, body, words, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, 0, ?, ? WHERE (SELECT COUNT(*) FROM draft WHERE user_id = ?) < ?`
      )
        .bind(id, who.userId, owned.id, title, '{"ops":[]}', t, t, who.userId, limit)
        .run();
    } catch (err) {
      // Two drafts asked for one project at the same moment: one project holds one draft.
      if (/UNIQUE/i.test(String(err && err.message))) return json({ error: "That project already has a draft." }, 409);
      throw err;
    }
    if (!made.meta.changes) return full();
    return json({ draft: { id, title, project_id: owned.id, body: '{"ops":[]}', words: 0, created_at: t, updated_at: t }, figures: [] }, 201);
  },

  async get({ env, params, who }) {
    const d = await myDraft(env, who, params.id);
    if (!d) return json({ error: "No such draft." }, 404);
    const project = d.project_id
      ? await env.DB.prepare("SELECT id, title, question FROM project WHERE id = ? AND user_id = ?")
          .bind(d.project_id, who.userId)
          .first()
      : null;
    return json({
      draft: {
        id: d.id,
        title: d.title,
        body: d.body,
        words: d.words,
        project_id: d.project_id,
        created_at: d.created_at,
        updated_at: d.updated_at
      },
      project: project || null,
      figures: await figuresIn(env, who, d.body)
    });
  },

  async update({ env, request, params, who }) {
    const current = await myDraft(env, who, params.id);
    if (!current) return json({ error: "No such draft." }, 404);
    const body = await readBody(request, LIMITS.charsPerDraft + 60000);
    if (!body) return json({ error: "That draft is too long." }, 413);
    // Two windows on the same draft: the older one is told, and nothing is lost.
    if (body.base && body.base !== current.updated_at) {
      return json({ error: "This draft was changed in another window. Reload it to see the newest text." }, 409);
    }
    const sets = [];
    const args = [];
    if (body.title !== undefined) {
      const title = line(body.title, LIMITS.charsPerTitle);
      if (title === null) return json({ error: "That title is too long." }, 413);
      sets.push("title = ?");
      args.push(title);
    }
    if (body.body !== undefined) {
      const clean = cleanDelta(body.body, await figureIds(env, who));
      if (clean.error) return json({ error: clean.error }, clean.status);
      sets.push("body = ?", "words = ?");
      args.push(clean.stored, clean.words);
    }
    if (body.project_id !== undefined) {
      const owned = await ownProject(env, who, body.project_id);
      if (!owned.ok) return json({ error: "No such project." }, 404);
      if (owned.id) {
        const taken = await env.DB.prepare("SELECT id FROM draft WHERE user_id = ? AND project_id = ? AND id <> ?")
          .bind(who.userId, owned.id, current.id)
          .first();
        if (taken) return json({ error: "That project already has a draft." }, 409);
      }
      sets.push("project_id = ?");
      args.push(owned.id);
    }
    if (!sets.length) return json({ error: "Nothing to change." }, 400);
    const t = now();
    sets.push("updated_at = ?");
    args.push(t, current.id, who.userId);
    await env.DB.prepare(`UPDATE draft SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...args).run();
    const after = await myDraft(env, who, current.id);
    return json({ updated_at: t, words: after ? after.words : 0 });
  },

  async remove({ env, params, who }) {
    const r = await env.DB.prepare("DELETE FROM draft WHERE id = ? AND user_id = ?").bind(params.id, who.userId).run();
    return r.meta.changes ? json({ deleted: true }) : json({ error: "No such draft." }, 404);
  },

  // ---------------------------------------------------------------- figures

  // The figures this person has sent from the Data pages. The pictures are left
  // out of the list, so that the picker stays light.
  async figures({ env, who }) {
    const { results } = await env.DB.prepare(
      `SELECT id, ref, title, source, cite, url, day, width, height, length(picture) AS bytes
         FROM figure WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`
    )
      .bind(who.userId)
      .all();
    return json({
      figures: results || [],
      limit: who.guest ? LIMITS.figuresPerGuest : LIMITS.figuresPerAccount,
      guest: who.guest
    });
  },

  async figure({ env, params, who }) {
    const row = await env.DB.prepare(
      "SELECT id, ref, title, source, cite, url, day, width, height, picture FROM figure WHERE id = ? AND user_id = ?"
    )
      .bind(params.id, who.userId)
      .first();
    return row ? json({ figure: row }) : json({ error: "No such figure." }, 404);
  },

  // A Data page sends a chart or a table as it drew it that day, with the
  // page's own source and "How to cite" lines. Nothing here is drawn by us.
  async addFigure({ env, request, who }) {
    const body = await readBody(request, LIMITS.charsPerFigure + 40000);
    if (!body) return json({ error: "That picture is too large." }, 413);
    const title = line(body.title ?? "", LIMITS.charsPerCard);
    const ref = line(body.ref ?? "", LIMITS.charsPerRef);
    const source = text(body.source ?? "", LIMITS.charsPerSource);
    const cite = line(body.cite ?? "", LIMITS.charsPerCite);
    const day = line(body.day ?? "", 40);
    const url = webAddress(body.url ?? "");
    const picture = typeof body.picture === "string" ? body.picture : "";
    if (title === null || ref === null || source === null || cite === null || day === null) {
      return json({ error: "That is too long to keep." }, 413);
    }
    if (!title) return json({ error: "A figure needs a title." }, 400);
    // The picture is a plain PNG, and nothing else.
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(picture)) {
      return json({ error: "That is not a picture of a chart." }, 400);
    }
    if (picture.length > LIMITS.charsPerFigure) return json({ error: "That picture is too large." }, 413);
    // A size that is not a whole number is rounded, never turned into 0
    // (Fable's check, point 7).
    const size = (v) => {
      const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
      return n > 0 && n <= 20000 ? n : 0;
    };
    const width = size(body.width);
    const height = size(body.height);
    const limit = who.guest ? LIMITS.figuresPerGuest : LIMITS.figuresPerAccount;
    const id = crypto.randomUUID();
    const made = await env.DB.prepare(
      `INSERT INTO figure (id, user_id, ref, title, source, cite, url, day, width, height, picture, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM figure WHERE user_id = ?) < ?`
    )
      .bind(id, who.userId, ref, title, source, cite, url, day, width, height, picture, now(), who.userId, limit)
      .run();
    if (!made.meta.changes) {
      return json(
        {
          error: who.guest
            ? `A guest can keep ${limit} figures. Sign up to keep more.`
            : `You have reached ${limit} figures. Remove one in Write first.`,
          limit
        },
        409
      );
    }
    return json({ figure: { id, ref, title, source, cite, url, day, width, height } }, 201);
  },

  async removeFigure({ env, params, who }) {
    const r = await env.DB.prepare("DELETE FROM figure WHERE id = ? AND user_id = ?").bind(params.id, who.userId).run();
    return r.meta.changes ? json({ deleted: true }) : json({ error: "No such figure." }, 404);
  },

  // ------------------------------------------------- the Annotated Bibliography

  // The works of the shelf, or of one project, each with the reference the
  // Library holds and the reader's own note under it.
  async bibliography({ env, url, who }) {
    const project = (url.searchParams.get("project") || "").trim().slice(0, 64);
    let title = "Your Shelf";
    if (project) {
      const p = await env.DB.prepare("SELECT title FROM project WHERE id = ? AND user_id = ?")
        .bind(project, who.userId)
        .first();
      if (!p) return json({ error: "No such project." }, 404);
      title = p.title;
    }
    const { results } = await env.DB.prepare(
      `SELECT k.ref, k.title, k.extra, k.url, k.year, k.cite, k.status, n.body AS note
         FROM kept k LEFT JOIN note n ON n.kept_id = k.id AND n.user_id = k.user_id
        WHERE k.user_id = ? AND k.kind = 'work'` +
        (project
          ? " AND EXISTS (SELECT 1 FROM project_thing pt WHERE pt.kept_id = k.id AND pt.user_id = k.user_id AND pt.project_id = ?)"
          : "") +
        " ORDER BY COALESCE(NULLIF(k.cite, ''), k.title) COLLATE NOCASE LIMIT 2000"
    )
      .bind(who.userId, ...(project ? [project] : []))
      .all();
    return json({ from: title, project: project || null, works: results || [] });
  },

  // ------------------------------------------------------- what a draft cites

  // The references the site holds for what a draft cites, and the reader's note
  // on each. Only this person's own rows are read.
  async cites({ env, request, who }) {
    const body = (await readBody(request, 120000)) || {};
    const asked = Array.isArray(body.refs) ? body.refs.slice(0, 300) : [];
    const want = [];
    for (const a of asked) {
      if (!a || typeof a !== "object") continue;
      const kind = typeof a.kind === "string" && KINDS.has(a.kind) ? a.kind : null;
      const ref = line(a.ref ?? "", LIMITS.charsPerRef);
      if (kind && ref) want.push({ kind, ref });
    }
    if (!want.length) return json({ things: [] });
    const things = await inGroups(want, async (part) => {
      const args = [];
      part.forEach((w) => args.push(w.kind, w.ref));
      const { results } = await env.DB.prepare(
        `SELECT k.kind, k.ref, k.title, k.extra, k.url, k.year, k.cite, k.bibtex, n.body AS note
           FROM kept k LEFT JOIN note n ON n.kept_id = k.id AND n.user_id = k.user_id
          WHERE k.user_id = ? AND (${part.map(() => "(k.kind = ? AND k.ref = ?)").join(" OR ")})`
      )
        .bind(who.userId, ...args)
        .all();
      return results || [];
    });
    return json({ things });
  }
};

// Everything of this person's drafts and figures, for "Download Everything".
export async function allDrafts(env, who) {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.title, d.body, d.words, d.project_id, d.created_at, d.updated_at, p.title AS project_title
       FROM draft d LEFT JOIN project p ON p.id = d.project_id AND p.user_id = d.user_id
      WHERE d.user_id = ? ORDER BY d.created_at`
  )
    .bind(who.userId)
    .all();
  return results || [];
}

export async function allFigures(env, who) {
  const { results } = await env.DB.prepare(
    "SELECT id, ref, title, source, cite, url, day, width, height, picture, created_at FROM figure WHERE user_id = ? ORDER BY created_at"
  )
    .bind(who.userId)
    .all();
  return results || [];
}

// The plain words of a draft, for the text file in "Download Everything".
export function draftWords(stored) {
  let out = "";
  try {
    const d = JSON.parse(stored || '{"ops":[]}');
    (d.ops || []).forEach((op) => {
      if (typeof op.insert === "string") out += op.insert;
      else if (op.insert && op.insert.pvcite) out += op.insert.pvcite.text;
      else if (op.insert && op.insert.pvfigure) out += "\n[a figure]\n";
    });
  } catch {
    return "";
  }
  return out;
}
