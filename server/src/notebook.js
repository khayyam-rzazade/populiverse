// The Notebook: free pages a reader writes for themselves. Plain text for now;
// Write (batch 3) brings formatting. Every query names the owner: `user_id = ?`
// is bound to `who.userId`, the person the gate found, and to nobody else.

import { json, readBody, now } from "./util.js";
import { LIMITS } from "./lists.js";

function clean(text, max) {
  if (typeof text !== "string") return null;
  // Control characters other than line breaks and tabs are dropped.
  const t = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return t.length > max ? null : t;
}

export const notebook = {
  async list({ env, url, who }) {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
    let sql =
      "SELECT id, title, substr(body, 1, 240) AS snippet, length(body) AS chars, created_at, updated_at FROM notebook_page WHERE user_id = ?";
    const args = [who.userId];
    if (q) {
      const like = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
      sql += " AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')";
      args.push(like, like);
    }
    sql += " ORDER BY updated_at DESC LIMIT ?";
    args.push(LIMITS.pagesPerAccount);
    const { results } = await env.DB.prepare(sql).bind(...args).all();
    return json({ pages: results, limit: who.guest ? LIMITS.pagesPerGuest : LIMITS.pagesPerAccount });
  },

  async create({ env, request, who }) {
    const body = (await readBody(request)) || {};
    const title = clean(body.title ?? "", LIMITS.charsPerTitle);
    const text = clean(body.body ?? "", LIMITS.charsPerPage);
    if (title === null || text === null) return json({ error: "That page is too long." }, 413);
    const limit = who.guest ? LIMITS.pagesPerGuest : LIMITS.pagesPerAccount;
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM notebook_page WHERE user_id = ?").bind(who.userId).first();
    if (n >= limit) {
      return json(
        { error: who.guest ? `A guest can keep ${limit} pages. Sign up to keep more.` : `You have reached ${limit} pages.` },
        409
      );
    }
    const id = crypto.randomUUID();
    const t = now();
    await env.DB.prepare(
      "INSERT INTO notebook_page (id, user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(id, who.userId, title, text, t, t)
      .run();
    return json({ page: { id, title, body: text, created_at: t, updated_at: t } }, 201);
  },

  async get({ env, params, who }) {
    const page = await env.DB.prepare(
      "SELECT id, title, body, created_at, updated_at FROM notebook_page WHERE id = ? AND user_id = ?"
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
      const text = clean(body.body, LIMITS.charsPerPage);
      if (text === null) return json({ error: `A page can hold ${LIMITS.charsPerPage.toLocaleString("en")} characters.` }, 413);
      sets.push("body = ?");
      args.push(text);
    }
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
