// The editor's desk: counts of accounts and use, and the accounts themselves.
// It never reads what people write: no query in this file names the columns
// `title` or `body` of the Notebook, and a test checks that no answer of the
// desk ever holds a word of a page.

import { json, readBody, now } from "./util.js";
import { setOpen as saveOpen, isOpen } from "./settings.js";
import { LIMITS } from "./lists.js";

const DAY = 86400000;

// Monday of the week a date falls in, as YYYY-MM-DD.
function weekOf(iso) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

function tally(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // A cell that starts like a formula is kept as text in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function accountRows(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, p.first_name, p.middle_name, p.surname, u.email, u.createdAt AS created, p.institution, p.ror_id, p.country, p.position, p.field,
            p.newsletter, p.newsletter_at, p.newsletter_sent_at, p.newsletter_error, p.completed_at, p.last_seen_at,
            (SELECT a.accountId FROM account a WHERE a.userId = u.id AND a.providerId = 'orcid') AS orcid
       FROM "user" u LEFT JOIN profile p ON p.user_id = u.id
      WHERE COALESCE(u.isAnonymous, 0) = 0
      ORDER BY COALESCE(p.completed_at, u.createdAt) DESC`
  ).all();
  return results;
}

export const desk = {
  async summary({ env }) {
    const accounts = await accountRows(env);
    const finished = accounts.filter((a) => a.completed_at);
    const { results: guests } = await env.DB.prepare(
      `SELECT u.createdAt AS created,
              EXISTS (SELECT 1 FROM session s WHERE s.userId = u.id AND s.expiresAt > ?) AS active
         FROM "user" u WHERE u.isAnonymous = 1`
    )
      .bind(now())
      .all();
    const { n: pages } = await env.DB.prepare("SELECT COUNT(*) AS n FROM notebook_page").first();
    const { n: invites } = await env.DB.prepare("SELECT COUNT(*) AS n FROM invite").first();

    // Sign-ups by week, the last 26 weeks, oldest first.
    const weeks = [];
    const thisWeek = weekOf(now());
    for (let i = 25; i >= 0; i--) weeks.push(weekOf(new Date(Date.parse(thisWeek) - i * 7 * DAY).toISOString()));
    const byWeek = new Map(weeks.map((w) => [w, { week: w, accounts: 0, guests: 0 }]));
    for (const a of finished) byWeek.get(weekOf(a.completed_at)) && byWeek.get(weekOf(a.completed_at)).accounts++;
    for (const g of guests) byWeek.get(weekOf(g.created)) && byWeek.get(weekOf(g.created)).guests++;

    const institutions = new Map();
    for (const a of finished) {
      const key = a.ror_id || `typed:${(a.institution || "").toLowerCase()}`;
      const cur = institutions.get(key) || { name: a.institution, ror: a.ror_id, country: a.country, n: 0 };
      cur.n++;
      institutions.set(key, cur);
    }

    const cutoff = new Date(Date.now() - 30 * DAY).toISOString();
    return json({
      open: await isOpen(env.DB),
      invites,
      accounts: finished.length,
      unfinished: accounts.length - finished.length,
      activeAccounts30: finished.filter((a) => (a.last_seen_at || "") >= cutoff).length,
      guests: guests.length,
      activeGuests: guests.filter((g) => g.active).length,
      orcid: finished.filter((a) => a.orcid).length,
      newsletter: finished.filter((a) => a.newsletter).length,
      newsletterSent: finished.filter((a) => a.newsletter_sent_at).length,
      newsletterFailed: finished.filter((a) => a.newsletter && !a.newsletter_sent_at && a.newsletter_error).length,
      pages,
      weeks: [...byWeek.values()],
      countries: tally(finished, "country"),
      institutions: [...institutions.values()].sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name))),
      positions: tally(finished, "position"),
      fields: tally(finished, "field")
    });
  },

  async accountsCsv({ env }) {
    const rows = await accountRows(env);
    const head = [
      "first_name", "middle_name", "surname", "email", "institution", "ror_id", "country", "position", "field", "orcid",
      "newsletter", "newsletter_ticked", "newsletter_sent", "signed_up", "finished", "last_seen"
    ];
    const lines = [head.join(",")];
    for (const r of rows) {
      lines.push(
        [
          // An account that has not yet been asked for its surname keeps its
          // one name line in first_name until it is.
          r.first_name || r.name, r.middle_name, r.surname, r.email, r.institution, r.ror_id ? `https://ror.org/${r.ror_id}` : "", r.country, r.position, r.field,
          r.orcid ? `https://orcid.org/${r.orcid}` : "", r.newsletter ? "yes" : "no", r.newsletter_at, r.newsletter_sent_at,
          r.created, r.completed_at, r.last_seen_at
        ]
          .map(csvCell)
          .join(",")
      );
    }
    return new Response("﻿" + lines.join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="populiverse-accounts-${now().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  },

  async invites({ env }) {
    const { results } = await env.DB.prepare(
      `SELECT i.email, i.invited_at, EXISTS (SELECT 1 FROM "user" u WHERE u.email = i.email) AS joined
         FROM invite i ORDER BY i.invited_at DESC`
    ).all();
    return json({ invites: results, open: await isOpen(env.DB) });
  },

  async addInvites({ env, request }) {
    const body = await readBody(request, 50000);
    if (!body || typeof body.emails !== "string") return json({ error: "Please give one or more emails." }, 400);
    const emails = [...new Set(body.emails.toLowerCase().split(/[\s,;]+/).filter(Boolean))];
    const good = emails.filter((e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/.test(e));
    const bad = emails.filter((e) => !good.includes(e));
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM invite").first();
    if (n + good.length > LIMITS.invites) return json({ error: `The list can hold ${LIMITS.invites} emails.` }, 409);
    const t = now();
    if (good.length) {
      await env.DB.batch(
        good.map((e) => env.DB.prepare("INSERT OR IGNORE INTO invite (email, invited_at) VALUES (?, ?)").bind(e, t))
      );
    }
    return json({ added: good, notEmails: bad });
  },

  async removeInvite({ env, request }) {
    const body = await readBody(request, 1000);
    if (!body || typeof body.email !== "string") return json({ error: "Which email?" }, 400);
    await env.DB.prepare("DELETE FROM invite WHERE email = ?").bind(body.email.toLowerCase()).run();
    return json({ removed: true });
  },

  async setOpen({ env, request }) {
    const body = await readBody(request, 1000);
    if (!body || typeof body.open !== "boolean") return json({ error: "Open or closed?" }, 400);
    await saveOpen(env.DB, body.open);
    return json({ open: body.open });
  }
};
