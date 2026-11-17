// Home: the first thing a reader sees in the Workspace answers one question,
// what is new for what I follow (master plan, section 18, stage 2, batch 5,
// Part B). The server keeps when the reader last came and gives back what the
// reader follows; the page reads what is new from the files the site already
// publishes (data/monitor.json and the Library's own list), so nothing here
// can say what the Monitor or the Library does not.

import { json, readBody, now } from "./util.js";

// A Monitor issue's folder, "2026-3". Anything else is kept as nothing.
export const ISSUE = /^\d{4}-\d{1,2}$/;

// Folders in the order of their issues: "2026-10" after "2026-9".
export function issueOrder(a, b) {
  const [ya, na] = String(a).split("-").map(Number);
  const [yb, nb] = String(b).split("-").map(Number);
  return ya - yb || na - nb;
}

// The actors and countries a reader follows: those on the shelf.
export async function followed(env, userId) {
  const { results } = await env.DB.prepare(
    "SELECT kind, ref, title FROM kept WHERE user_id = ? AND kind IN ('actor', 'country') ORDER BY sort_name, title"
  )
    .bind(userId)
    .all();
  return results || [];
}

export const home = {
  async visit({ env, request, who }) {
    const body = (await readBody(request, 1000)) || {};
    const issue = typeof body.issue === "string" && ISSUE.test(body.issue) ? body.issue : "";
    const t = now();
    // One statement: on the first visit of a day the latest visit becomes the
    // one before, so two pages opened at once still agree.
    const mark = await env.DB.prepare(
      `INSERT INTO home_mark (user_id, home_day, home_issue, home_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id) DO UPDATE SET
         before_issue = CASE WHEN home_mark.home_day <> excluded.home_day THEN home_mark.home_issue ELSE home_mark.before_issue END,
         before_at = CASE WHEN home_mark.home_day <> excluded.home_day THEN home_mark.home_at ELSE home_mark.before_at END,
         home_issue = CASE WHEN excluded.home_issue <> '' THEN excluded.home_issue ELSE home_mark.home_issue END,
         home_day = excluded.home_day,
         home_at = excluded.home_at
       RETURNING before_issue, before_at`
    )
      .bind(who.userId, t.slice(0, 10), issue, t)
      .first();
    const [follows, draft, page] = await Promise.all([
      followed(env, who.userId),
      env.DB.prepare(
        `SELECT id, title, updated_at FROM draft
          WHERE user_id = ? AND NOT (title = '' AND words = 0 AND instr(body, 'pvfigure') = 0)
          ORDER BY updated_at DESC LIMIT 1`
      )
        .bind(who.userId)
        .first(),
      env.DB.prepare(
        `SELECT id, title, updated_at FROM notebook_page
          WHERE user_id = ? AND (title <> '' OR body <> '') ORDER BY updated_at DESC LIMIT 1`
      )
        .bind(who.userId)
        .first()
    ]);
    return json({
      // No visit before today: the page shows the newest issue, and the works
      // added since the reader joined.
      since: mark?.before_at ? { issue: mark.before_issue || "", at: mark.before_at } : null,
      joined: who.user.createdAt,
      follows,
      lastDraft: draft || null,
      lastPage: page || null
    });
  }
};
