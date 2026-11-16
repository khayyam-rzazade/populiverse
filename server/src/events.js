// The reader's own events, for the Chronology Maker (master plan, section 18,
// stage 2, batch 4, Part B, B2 and B4). This is the only place the server
// grows in Part B. The three case tools themselves run in the page, from the
// data files the site already publishes, so nothing of them is stored here.
//
// Every query names the owner: `user_id = ?` is bound to `who.userId`, the
// person the gate found (index.js), and to nobody else. An event of one
// reader is never shown to another, and never to the editor's desk.
//
// An event a reader adds is the reader's own. It is never mixed silently into
// the Monitor's own items: the page marks it as the reader's own on screen and
// in every export, and this file keeps it in a table of its own.

import { json, readBody, now } from "./util.js";
import { LIMITS } from "./lists.js";

// Plain one-line text: control characters become spaces, runs of space become
// one space, and anything longer than the limit is refused.
function line(v, max) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? null : t;
}

function limitOf(who) {
  return who.guest ? LIMITS.eventsPerGuest : LIMITS.eventsPerAccount;
}

// What an event can be about: an actor or a country of the site, named as the
// rest of the Workspace names them (an actor's name in its address, a
// country's three-letter code).
const ABOUT = new Set(["actor", "country"]);
const REF = /^[A-Za-z0-9][A-Za-z0-9-]{0,59}$/;

// A day, a month or a year, and a real one. "2026-11-16", "2026-11", "2026".
// Anything else is refused, so that a chronology can always be put in order.
export function readDay(v) {
  const t = typeof v === "string" ? v.trim() : "";
  const m = t.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1000 || year > 2999) return null;
  if (m[2] === undefined) return t;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (m[3] === undefined) return t;
  const day = Number(m[3]);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > days) return null;
  return t;
}

function cardOf(row) {
  return {
    id: row.id,
    aboutKind: row.about_kind,
    aboutRef: row.about_ref,
    day: row.day,
    what: row.what,
    source: row.source,
    mine: true,
    added: row.created_at
  };
}

export const events = {
  // The reader's own events, all of them or those on one actor or country.
  async list({ env, url, who }) {
    const kind = url.searchParams.get("kind") || "";
    const ref = url.searchParams.get("ref") || "";
    let rows;
    if (kind || ref) {
      if (!ABOUT.has(kind) || !REF.test(ref)) return json({ events: [], limit: limitOf(who), used: 0 });
      rows = await env.DB.prepare(
        `SELECT * FROM own_event WHERE user_id = ? AND about_kind = ? AND about_ref = ? ORDER BY day, created_at`
      )
        .bind(who.userId, kind, ref)
        .all();
    } else {
      rows = await env.DB.prepare("SELECT * FROM own_event WHERE user_id = ? ORDER BY day, created_at")
        .bind(who.userId)
        .all();
    }
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM own_event WHERE user_id = ?").bind(who.userId).first();
    return json({ events: rows.results.map(cardOf), limit: limitOf(who), used: n });
  },

  // One event. The count stands inside the statement that writes the row, so
  // that many requests at once can never carry a reader past the limit
  // (Fable's check of batches 2 and 3, point 2).
  async add({ env, request, who }) {
    const body = await readBody(request, 4000);
    if (!body) return json({ error: "Please check the form." }, 400);
    const errors = {};
    const aboutKind = typeof body.aboutKind === "string" ? body.aboutKind : "";
    const aboutRef = typeof body.aboutRef === "string" ? body.aboutRef : "";
    if (!ABOUT.has(aboutKind) || !REF.test(aboutRef)) return json({ error: "Not found." }, 404);

    const day = readDay(body.day);
    if (!day) errors.day = "Please give the date as 2026, 2026-11 or 2026-11-16.";
    const what = line(body.what ?? "", LIMITS.charsPerEvent);
    if (what === null) errors.what = `What happened can hold ${LIMITS.charsPerEvent} characters.`;
    else if (!what) errors.what = "Please say what happened.";
    const source = line(body.source ?? "", LIMITS.charsPerEventSource);
    if (source === null) errors.source = `A source can hold ${LIMITS.charsPerEventSource} characters.`;
    else if (!source) errors.source = "Please give the source. An event without one is of no use later.";
    if (Object.keys(errors).length) return json({ error: "Please check the form.", fields: errors }, 400);

    const t = now();
    const id = crypto.randomUUID();
    const made = await env.DB.prepare(
      `INSERT INTO own_event (id, user_id, about_kind, about_ref, day, what, source, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM own_event WHERE user_id = ?) < ?`
    )
      .bind(id, who.userId, aboutKind, aboutRef, day, what, source, t, t, who.userId, limitOf(who))
      .run();
    if (!made.meta.changes) {
      return json(
        {
          error: who.guest
            ? `As a guest you can add ${LIMITS.eventsPerGuest} events of your own. Sign up to keep more.`
            : `You can add ${LIMITS.eventsPerAccount} events of your own.`
        },
        409
      );
    }
    return json({ event: cardOf({ id, about_kind: aboutKind, about_ref: aboutRef, day, what, source, created_at: t }) }, 201);
  },

  async remove({ env, params, who }) {
    const id = params.id;
    const gone = await env.DB.prepare("DELETE FROM own_event WHERE id = ? AND user_id = ?").bind(id, who.userId).run();
    if (!gone.meta.changes) return json({ error: "Not found." }, 404);
    return json({ removed: true });
  }
};

// Every event of one person, for Download Everything.
export async function allEvents(env, who) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM own_event WHERE user_id = ? ORDER BY about_kind, about_ref, day, created_at"
  )
    .bind(who.userId)
    .all();
  return results.map(cardOf);
}
