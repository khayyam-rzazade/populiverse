// The Notebook: free pages a reader writes for themselves, loose or inside a
// project. From batch 3 a page carries the five formats and cites, so its text
// is kept as the editor's own document (plain JSON, never HTML) in `body`, with
// the same page as plain words in `words`. A page written before this batch has
// plain words in `body` and opens unchanged.
//
// Every query names the owner: `user_id = ?` is bound to `who.userId`, the
// person the gate found, and to nobody else.

import { json, readBody, now, like } from "./util.js";
import { LIMITS } from "./lists.js";
import { ownProject } from "./projects.js";
import { cleanDelta } from "./write.js";

function clean(text, max) {
  if (typeof text !== "string") return null;
  // Control characters other than line breaks and tabs are dropped.
  const t = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return t.length > max ? null : t;
}

// A page's text, as it is kept (Fable's check, point 8). A page of the editor's
// own document goes through the same cleaner as a draft, with no figures, and
// its plain words are made here, from what is kept. A page of plain words, as
// every page was before batch 3, is kept as the words it is. One that looks
// like the editor's document but cannot be read is refused.
function pageText(body) {
  const raw = clean(body ?? "", LIMITS.charsPerPage);
  if (raw === null) return { error: `A page can hold ${LIMITS.charsPerPage.toLocaleString("en")} characters.`, status: 413 };
  if (!/^\s*\{\s*"ops"\s*:/.test(raw)) return { stored: raw, text: "" };
  let delta;
  try {
    delta = JSON.parse(raw);
  } catch {
    return { error: "This page could not be read, so it was not saved.", status: 400 };
  }
  const kept = cleanDelta(delta, null, LIMITS.charsPerPage);
  if (kept.error) return kept;
  return { stored: kept.stored, text: kept.text };
}

// The words of a page, for its line in the list and for the search: for a page
// of the editor's own document the plain words the server made, and for a page
// of plain words the page itself. How a page is stored is never searched
// (Fable's second run, point d).
const WORDS_OF_PAGE = `CASE WHEN p.words <> '' OR p.body LIKE '{"ops"%' THEN p.words ELSE p.body END`;

export const notebook = {
  async list({ env, url, who }) {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
    const project = (url.searchParams.get("project") || "").trim().slice(0, 64);
    const loose = url.searchParams.get("loose") === "1";
    let sql =
      `SELECT p.id, p.title, p.project_id,
              substr(${WORDS_OF_PAGE}, 1, 240) AS snippet,
              length(p.body) AS chars, p.created_at, p.updated_at, j.title AS project_title
         FROM notebook_page p LEFT JOIN project j ON j.id = p.project_id AND j.user_id = p.user_id
        WHERE p.user_id = ?`;
    const args = [who.userId];
    if (project) {
      sql += " AND p.project_id = ?";
      args.push(project);
    } else if (loose) {
      sql += " AND p.project_id IS NULL";
    }
    if (q) {
      const pattern = like(q);
      sql += ` AND (p.title LIKE ? ESCAPE '\\' OR ${WORDS_OF_PAGE} LIKE ? ESCAPE '\\')`;
      args.push(pattern, pattern);
    }
    sql += " ORDER BY p.updated_at DESC LIMIT ?";
    args.push(LIMITS.pagesPerAccount);
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    return json({ pages: results, limit: who.guest ? LIMITS.pagesPerGuest : LIMITS.pagesPerAccount });
  },

  async create({ env, request, who }) {
    // A body too large to read is a page too large, not an empty page.
    const body = await readBody(request);
    if (!body) return json({ error: "That page is too long." }, 413);
    const title = clean(body.title ?? "", LIMITS.charsPerTitle);
    if (title === null) return json({ error: "That page is too long." }, 413);
    // What the page sends as its words is not used: the server makes them.
    if (typeof body.words === "string" && body.words.length > LIMITS.charsPerPage) return json({ error: "That page is too long." }, 413);
    const page = pageText(body.body);
    if (page.error) return json({ error: page.error }, page.status);
    const owned = await ownProject(env, who, body.project_id ?? null);
    if (!owned.ok) return json({ error: "No such project." }, 404);
    const limit = who.guest ? LIMITS.pagesPerGuest : LIMITS.pagesPerAccount;
    const id = crypto.randomUUID();
    const t = now();
    // The count stands inside the statement that writes the row (Fable's check, point 9).
    const made = await env.DB.prepare(
      `INSERT INTO notebook_page (id, user_id, title, body, words, project_id, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM notebook_page WHERE user_id = ?) < ?`
    )
      .bind(id, who.userId, title, page.stored, page.text, owned.id, t, t, who.userId, limit)
      .run();
    if (!made.meta.changes) {
      return json(
        { error: who.guest ? `A guest can keep ${limit} pages. Sign up to keep more.` : `You have reached ${limit} pages.` },
        409
      );
    }
    return json(
      { page: { id, title, body: page.stored, words: page.text, project_id: owned.id, created_at: t, updated_at: t } },
      201
    );
  },

  async get({ env, params, who }) {
    const page = await env.DB.prepare(
      `SELECT p.id, p.title, p.body, p.words, p.project_id, p.created_at, p.updated_at, j.title AS project_title
         FROM notebook_page p LEFT JOIN project j ON j.id = p.project_id AND j.user_id = p.user_id
        WHERE p.id = ? AND p.user_id = ?`
    )
      .bind(params.id, who.userId)
      .first();
    return page ? json({ page }) : json({ error: "No such page." }, 404);
  },

  async update({ env, request, params, who }) {
    const body = await readBody(request);
    if (!body) return json({ error: "That page is too long." }, 413);
    const current = await env.DB.prepare("SELECT updated_at FROM notebook_page WHERE id = ? AND user_id = ?")
      .bind(params.id, who.userId)
      .first();
    if (!current) return json({ error: "No such page." }, 404);
    // Two windows on the same page: the older one is told, and nothing is lost.
    if (body.base && body.base !== current.updated_at) {
      return json({ error: "This page was changed in another window. Reload it to see the newest text." }, 409);
    }
    const sets = [];
    const args = [];
    if (body.title !== undefined) {
      const title = clean(body.title, LIMITS.charsPerTitle);
      if (title === null) return json({ error: "That title is too long." }, 413);
      sets.push("title = ?");
      args.push(title);
    }
    if (body.body !== undefined) {
      const page = pageText(body.body);
      if (page.error) return json({ error: page.error }, page.status);
      sets.push("body = ?", "words = ?");
      args.push(page.stored, page.text);
    }
    if (typeof body.words === "string" && body.words.length > LIMITS.charsPerPage) {
      return json({ error: `A page can hold ${LIMITS.charsPerPage.toLocaleString("en")} characters.` }, 413);
    }
    if (body.project_id !== undefined) {
      const owned = await ownProject(env, who, body.project_id);
      if (!owned.ok) return json({ error: "No such project." }, 404);
      sets.push("project_id = ?");
      args.push(owned.id);
    }
    if (!sets.length) return json({ error: "Nothing to change." }, 400);
    const t = now();
    sets.push("updated_at = ?");
    args.push(t, params.id, who.userId);
    await env.DB.prepare(`UPDATE notebook_page SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...args).run();
    return json({ updated_at: t });
  },

  async remove({ env, params, who }) {
    const r = await env.DB.prepare("DELETE FROM notebook_page WHERE id = ? AND user_id = ?").bind(params.id, who.userId).run();
    return r.meta.changes ? json({ deleted: true }) : json({ error: "No such page." }, 404);
  }
};
