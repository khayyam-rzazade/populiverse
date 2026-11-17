// The feedback card of the Workspace (master plan, section 18, stage 2, batch 5,
// Part A, and the plan of the card of 2026-11-16).
//
// A reader, a guest too, is asked four short questions once they have opened
// the Workspace on five different days. Each answer is kept, one row for each
// reader, and goes to the editor in one plain email. A reader may change the
// answer later from the account page, at most once a day, so that nobody can
// fill the editor's inbox. Every query names its owner: `user_id = ?` is bound
// to the person the gate found and to nobody else.

import { json, readBody, now } from "./util.js";
import { FEEDBACK_USES, FEEDBACK_HELP, HELP_NOT_NOW, LIMITS } from "./lists.js";
import { sendFeedback } from "./mail.js";

const today = () => now().slice(0, 10);

// The card comes on the fifth different day of use.
const CARD_DAYS = 5;

// Plain text: control characters other than line breaks and tabs are dropped,
// line endings are made one kind, and the ends are trimmed. `false` when it is
// not text or is too long.
function plain(v, max) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return false;
  const t = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return t.length > max ? false : t;
}

// Boxes ticked: only words of the list, each once, in the list's own order.
// `false` when anything else arrives.
function ticked(v, list) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > list.length * 2) return false;
  if (!v.every((x) => typeof x === "string" && list.includes(x))) return false;
  return list.filter((x) => v.includes(x));
}

const split = (s) => String(s || "").split("\n").filter(Boolean);

// One day of use is counted the first time a reader's Workspace asks who they
// are on that day (UTC), however often it asks. The count lives in the
// statement, so two pages opened at once still count one day.
export async function countDay(env, userId) {
  await env.DB.prepare(
    `INSERT INTO feedback_card (user_id, days, last_day) VALUES (?1, 1, ?2)
     ON CONFLICT (user_id) DO UPDATE SET days = feedback_card.days + 1, last_day = excluded.last_day
      WHERE feedback_card.last_day IS NOT excluded.last_day`
  )
    .bind(userId, today())
    .run();
}

// What the page needs to know to show the card, or not.
export async function cardState(env, userId) {
  const row = await env.DB.prepare(
    `SELECT c.days, c.later_at, f.created_at, f.updated_at
       FROM (SELECT ?1 AS id) me
       LEFT JOIN feedback_card c ON c.user_id = me.id
       LEFT JOIN feedback f ON f.user_id = me.id`
  )
    .bind(userId)
    .first();
  return {
    daysUsed: row?.days || 0,
    cardLater: !!row?.later_at,
    feedbackAt: row?.updated_at || null
  };
}

// The reader's own answer, for the account page and for Download Everything.
export async function ownAnswer(env, userId) {
  const f = await env.DB.prepare("SELECT * FROM feedback WHERE user_id = ?").bind(userId).first();
  if (!f) return null;
  return { score: f.score, uses: split(f.uses), missing: f.missing, help: split(f.help), answered: f.created_at, changed: f.updated_at };
}

export const feedback = {
  async get({ env, who }) {
    return json({ answer: await ownAnswer(env, who.userId) });
  },

  // "Not Now": the card does not come again by itself. It can still be opened
  // from the account page.
  async later({ env, who }) {
    await env.DB.prepare(
      `INSERT INTO feedback_card (user_id, days, later_at) VALUES (?1, 0, ?2)
       ON CONFLICT (user_id) DO UPDATE SET later_at = COALESCE(feedback_card.later_at, excluded.later_at)`
    )
      .bind(who.userId, now())
      .run();
    return json({ later: true });
  },

  async answer({ env, ctx, request, who }) {
    const body = await readBody(request, 20000);
    if (!body) return json({ error: "Please check the answers." }, 400);
    const errors = {};
    const score = body.score;
    if (!Number.isInteger(score) || score < 1 || score > 5) errors.score = "Please say how useful it is, from 1 to 5.";
    const uses = ticked(body.uses, FEEDBACK_USES);
    if (uses === false) errors.uses = "Please tick from the list.";
    const help = ticked(body.help, FEEDBACK_HELP);
    if (help === false) errors.help = "Please tick from the list.";
    else if (help.includes(HELP_NOT_NOW) && help.length > 1) errors.help = "Not Now goes on its own.";
    const missing = plain(body.missing, LIMITS.charsPerFeedback);
    if (missing === false) errors.missing = `Please keep it to ${LIMITS.charsPerFeedback} characters.`;
    if (Object.keys(errors).length) return json({ error: "Please check the answers.", fields: errors }, 400);

    // A guest is heard from the fifth day of use, when the card comes, and
    // not before: a guest has no name, and anyone can become one, so without
    // this anyone could write to the editor at will (Fable's check of batch
    // 5, F3). The days only ever grow, so this needs no place in the
    // statement below.
    if (who.guest) {
      const card = await env.DB.prepare("SELECT days FROM feedback_card WHERE user_id = ?").bind(who.userId).first();
      if ((card?.days || 0) < CARD_DAYS) {
        return json({ error: "The questions open once you have used the Workspace on five different days." }, 403);
      }
    }

    // One row for each reader. A second answer on the same day is refused in
    // the statement itself, so two sent at once cannot both pass.
    const t = now();
    const row = await env.DB.prepare(
      `INSERT INTO feedback (user_id, score, uses, missing, help, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT (user_id) DO UPDATE SET score = excluded.score, uses = excluded.uses, missing = excluded.missing,
         help = excluded.help, updated_at = excluded.updated_at
        WHERE substr(feedback.updated_at, 1, 10) < substr(excluded.updated_at, 1, 10)
       RETURNING created_at, updated_at`
    )
      .bind(who.userId, score, uses.join("\n"), missing, help.join("\n"), t)
      .first();
    if (!row) return json({ error: "You have already sent an answer today. You can change it again tomorrow." }, 429);

    // One email to the editor for each answer. If it fails, the answer is
    // still kept and stands on Your Desk.
    const changed = row.created_at !== row.updated_at;
    const job = sendFeedback(env, { who, answer: { score, uses, missing, help }, changed }).catch((e) =>
      console.error("feedback email failed", e?.message)
    );
    ctx?.waitUntil ? ctx.waitUntil(job) : await job;
    return json({ saved: true, changed, at: row.updated_at });
  }
};

// ------------------------------------------------------------ Your Desk

function person(r) {
  return {
    name: [r.first_name || r.name, r.middle_name, r.surname].filter(Boolean).join(" "),
    email: r.email,
    institution: r.institution || null,
    country: r.country || null,
    position: r.position || null,
    positionOther: r.position_other || null,
    field: r.field || null,
    fieldOther: r.field_other || null,
    interests: r.interests || null
  };
}

// Every answer in full, newest first, and for each way to help the people who
// ticked it. A guest has no name and no email, so a guest's answer is counted
// and shown, and stands in no list of people. Writing for the Commentary holds
// everyone who said so, at registration (Yes or Maybe Later) or on the card,
// once each. Nothing here reads a reader's shelf, pages, notes or drafts.
export async function deskFeedback(env) {
  const { results: rows } = await env.DB.prepare(
    `SELECT f.user_id, f.score, f.uses, f.missing, f.help, f.created_at, f.updated_at,
            COALESCE(u.isAnonymous, 0) AS guest, u.name, u.email,
            p.first_name, p.middle_name, p.surname, p.institution, p.country, p.position, p.position_other,
            p.field, p.field_other, p.interests, p.commentary, p.commentary_at
       FROM feedback f JOIN "user" u ON u.id = f.user_id LEFT JOIN profile p ON p.user_id = f.user_id
      ORDER BY f.updated_at DESC`
  ).all();
  const { results: registered } = await env.DB.prepare(
    `SELECT u.id AS user_id, u.name, u.email, p.first_name, p.middle_name, p.surname, p.institution, p.country,
            p.position, p.position_other, p.field, p.field_other, p.interests, p.commentary, p.commentary_at, p.completed_at
       FROM "user" u JOIN profile p ON p.user_id = u.id
      WHERE COALESCE(u.isAnonymous, 0) = 0 AND p.completed_at IS NOT NULL AND p.commentary IN ('Yes', 'Maybe Later')`
  ).all();
  const later = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_card WHERE later_at IS NOT NULL").first();

  const answers = (rows || []).map((r) => ({
    at: r.updated_at,
    changed: r.created_at !== r.updated_at,
    guest: !!r.guest,
    ...(r.guest ? {} : person(r)),
    score: r.score,
    uses: split(r.uses),
    missing: r.missing || "",
    help: split(r.help)
  }));

  const ways = FEEDBACK_HELP.filter((w) => w !== HELP_NOT_NOW).map((way) => {
    const people = new Map();
    for (const r of rows || []) {
      if (r.guest || !split(r.help).includes(way)) continue;
      people.set(r.user_id, { ...person(r), at: r.updated_at, said: ["On the card"] });
    }
    if (way === FEEDBACK_HELP[0]) {
      for (const r of registered || []) {
        const said = `At registration, ${r.commentary}`;
        const have = people.get(r.user_id);
        if (have) have.said.push(said);
        else people.set(r.user_id, { ...person(r), at: r.commentary_at || r.completed_at, said: [said] });
      }
    }
    return {
      way,
      people: [...people.values()].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    };
  });

  const tally = (list, key) =>
    list.map((value) => ({ value, n: answers.filter((a) => a[key].includes(value)).length }));
  return {
    total: answers.length,
    guests: answers.filter((a) => a.guest).length,
    later: later?.n || 0,
    scores: [1, 2, 3, 4, 5].map((s) => ({ value: String(s), n: answers.filter((a) => a.score === s).length })),
    uses: tally(FEEDBACK_USES, "uses"),
    help: tally(FEEDBACK_HELP, "help"),
    ways,
    answers
  };
}
