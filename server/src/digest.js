// The email of what is new (master plan, section 18, stage 2, batch 5, Part D).
//
// Only for a reader who asks, never a guest. One email for each new issue of
// the Monitor, sent by the nightly job when the site's own Monitor file names
// an issue the reader has not been sent. It holds what Home holds: the items
// about what that reader follows, each with its reference and its address,
// and the count of new works on a followed country. Plain text, no picture,
// no tracking, no sentence about an item that the Monitor did not write.
// Never empty, never twice. It ends with why it came and a link that stops it
// (the link opens a page with one button, and the button stops it).
// The editor holds the main switch on Your Desk, off until he turns it on, and
// he can turn it on only after he has sent one to himself.

import { json, readBody, now } from "./util.js";
import { ISSUE, issueOrder, followed } from "./home.js";
import { sendDigest } from "./mail.js";

// The most readers one night's job writes to; the rest go the next night.
const PER_NIGHT = 200;

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function setting(db, key) {
  const row = await db.prepare("SELECT value FROM setting WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}
async function setSetting(db, key, value) {
  await db
    .prepare("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}
export async function digestLive(db) {
  return (await setting(db, "digest")) === "on";
}

// A file the site publishes, read fresh.
async function siteFile(env, path) {
  try {
    const res = await fetch(`${env.SITE_ORIGIN}${path}?v=${Date.now()}`, { headers: { Accept: "application/json" } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function heading(it) {
  return it.k === "entry" && it.s ? `${it.title}. ${it.s}` : it.title;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function day(it) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(it.date || "");
  return m ? `${m[3] ? Number(m[3]) + " " : ""}${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

// What is new for one reader: the items of the issues after `after` up to the
// newest, about what the reader follows, and the works added since `since` on
// a followed country. `library` is asked for only when a country is followed.
// Gives back null when there is nothing, and throws when the Library's list is
// needed and cannot be read, so that the email waits for the next night
// rather than leave the works out without a word.
export async function whatIsNew(env, userId, mon, after, since, library) {
  const follows = await followed(env, userId);
  if (!follows.length) return null;
  const name = {};
  for (const f of follows) name[`${f.kind}:${f.ref}`] = f.title || f.ref;
  const items = (mon.items || [])
    .filter(
      (it) =>
        ISSUE.test(it.folder || "") &&
        (after ? issueOrder(it.folder, after) > 0 : it.folder === mon.folder) &&
        issueOrder(it.folder, mon.folder) <= 0 &&
        ((it.actors || []).some((a) => name[`actor:${a}`]) || (it.iso || []).some((c) => name[`country:${c}`]))
    )
    .sort((a, b) => issueOrder(a.folder, b.folder) || a.n - b.n)
    .map((it) => {
      const about = [...(it.actors || []).map((a) => name[`actor:${a}`]), ...(it.iso || []).map((c) => name[`country:${c}`])]
        .filter(Boolean)
        .filter((x, i, all) => all.indexOf(x) === i);
      return {
        heading: heading(it),
        ref: `PopuliVerse Monitor ${it.issue}, item ${it.n}`,
        day: day(it),
        about,
        url: `https://populiverse.com/monitor/${it.folder}/#item-${it.n}`
      };
    });
  const places = mon.places || {};
  const countries = follows.filter((f) => f.kind === "country" && places[f.ref] && places[f.ref][6]);
  const works = [];
  if (countries.length) {
    const lib = await library();
    if (!lib || !Array.isArray(lib.entries)) throw new Error("the Library's list could not be read");
    const from = since ? Date.parse(since) : 0;
    for (const f of countries) {
      const tag = places[f.ref][6];
      const n = lib.entries.filter(
        (e) => e.added && Date.parse(e.added) > from && (e.country || []).includes(`country:${tag}`)
      ).length;
      if (n) works.push({ n, name: f.title || places[f.ref][0], url: `https://populiverse.com/library/?country=${encodeURIComponent(tag)}&sort=added` });
    }
  }
  if (!items.length && !works.length) return null;
  return { issue: mon.issue, items, works };
}

const stopUrl = (env, t) => `${env.BASE_URL}/api/stop/${t}`;

// The nightly job's part. Each reader is claimed in one statement before the
// email goes, so a job that runs twice, or two at once, sends nothing twice;
// an email that fails gives the claim back for the next night and does not
// stop the others.
export async function sendDigests(env, at = Date.now()) {
  const report = { live: false, issue: null, waiting: 0, started: 0, sent: 0, nothing: 0, failed: 0 };
  if (!(await digestLive(env.DB))) return report;
  report.live = true;
  const mon = await siteFile(env, "/data/monitor.json");
  if (!mon || !ISSUE.test(mon.folder || "") || !Array.isArray(mon.items)) return report;
  const current = mon.folder;
  report.issue = current;
  const t = new Date(at).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT d.user_id, d.sent_issue, d.sent_at, d.stop_token, u.email, p.first_name
       FROM digest d JOIN "user" u ON u.id = d.user_id JOIN profile p ON p.user_id = d.user_id
      WHERE d.wanted = 1 AND COALESCE(u.isAnonymous, 0) = 0 AND u.emailVerified = 1
        AND u.email NOT LIKE '%.invalid'
        AND p.completed_at IS NOT NULL AND COALESCE(p.surname, '') <> ''
        AND (d.sent_issue IS NULL OR d.sent_issue <> ?)
      ORDER BY d.wanted_at
      LIMIT ?`
  )
    .bind(current, PER_NIGHT)
    .all();
  let lib = null;
  const library = () => (lib = lib || siteFile(env, "/library/library-list.json"));
  for (const r of results || []) {
    // The first night after a reader asked: what is newest now is where the
    // emails start, so the first email is of an issue that comes after.
    if (!r.sent_issue) {
      await env.DB.prepare("UPDATE digest SET sent_issue = ?, sent_at = ? WHERE user_id = ? AND wanted = 1 AND sent_issue IS NULL")
        .bind(current, t, r.user_id)
        .run();
      report.started++;
      continue;
    }
    if (!ISSUE.test(r.sent_issue) || issueOrder(current, r.sent_issue) <= 0) {
      report.waiting++;
      continue;
    }
    const claimed = await env.DB.prepare(
      "UPDATE digest SET sent_issue = ?, sent_at = ? WHERE user_id = ? AND wanted = 1 AND sent_issue = ? RETURNING user_id"
    )
      .bind(current, t, r.user_id, r.sent_issue)
      .first();
    if (!claimed) continue;
    try {
      const news = await whatIsNew(env, r.user_id, mon, r.sent_issue, r.sent_at, library);
      if (!news) {
        report.nothing++;
        continue;
      }
      await sendDigest(env, r.email, r.first_name, news, stopUrl(env, r.stop_token), false);
      report.sent++;
    } catch (e) {
      console.error("email of what is new failed", e?.message);
      report.failed++;
      await env.DB.prepare("UPDATE digest SET sent_issue = ?, sent_at = ? WHERE user_id = ? AND sent_issue = ?")
        .bind(r.sent_issue, r.sent_at, r.user_id, current)
        .run();
    }
  }
  if (report.sent) {
    await setSetting(env.DB, "digest_last", JSON.stringify({ issue: mon.issue, at: t, sent: report.sent }));
  }
  return report;
}

async function ensureToken(env, userId) {
  await env.DB.prepare("INSERT INTO digest (user_id, wanted, stop_token) VALUES (?, 0, ?) ON CONFLICT (user_id) DO NOTHING")
    .bind(userId, token())
    .run();
  const row = await env.DB.prepare("SELECT stop_token FROM digest WHERE user_id = ?").bind(userId).first();
  return row.stop_token;
}

export const digest = {
  // The reader's own switch, on the account page. Only the
  // reader's own row is ever touched. Turning it on again starts afresh, so
  // that no issue that came while it was off arrives late.
  async set({ env, request, who }) {
    const body = await readBody(request, 1000);
    if (!body || typeof body.on !== "boolean") return json({ error: "On or off?" }, 400);
    if (body.on) {
      await env.DB.prepare(
        `INSERT INTO digest (user_id, wanted, wanted_at, stop_token) VALUES (?1, 1, ?2, ?3)
         ON CONFLICT (user_id) DO UPDATE SET wanted = 1, wanted_at = excluded.wanted_at, sent_issue = NULL, sent_at = NULL
          WHERE digest.wanted = 0`
      )
        .bind(who.userId, now(), token())
        .run();
    } else {
      await env.DB.prepare("UPDATE digest SET wanted = 0 WHERE user_id = ?").bind(who.userId).run();
    }
    return json({ emailOn: body.on });
  },

  // ---------------------------------------------------------- Your Desk

  async status(env) {
    const readers = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM digest d JOIN profile p ON p.user_id = d.user_id
        WHERE d.wanted = 1 AND p.completed_at IS NOT NULL`
    ).first();
    let last = null;
    try {
      last = JSON.parse((await setting(env.DB, "digest_last")) || "null");
    } catch {
      last = null;
    }
    return {
      digestOn: await digestLive(env.DB),
      digestTested: await setting(env.DB, "digest_tested"),
      digestReaders: readers?.n || 0,
      digestLast: last
    };
  },

  async setLive({ env, request }) {
    const body = await readBody(request, 1000);
    if (!body || typeof body.on !== "boolean") return json({ error: "On or off?" }, 400);
    if (body.on && !(await setting(env.DB, "digest_tested"))) {
      return json({ error: "Please send it to yourself first." }, 409);
    }
    await setSetting(env.DB, "digest", body.on ? "on" : "off");
    return json(await digest.status(env));
  },

  // The email as a reader would get it for the newest issue, built for the
  // editor's own actors and countries and sent to the editor alone.
  async test({ env, who }) {
    const mon = await siteFile(env, "/data/monitor.json");
    if (!mon || !ISSUE.test(mon.folder || "")) return json({ error: "The Monitor's file could not be read. Please try again." }, 502);
    let news;
    try {
      news = await whatIsNew(env, who.userId, mon, null, new Date(Date.now() - 31 * 86400000).toISOString(), () =>
        siteFile(env, "/library/library-list.json")
      );
    } catch {
      return json({ error: "The Library's list could not be read. Please try again." }, 502);
    }
    if (!news) {
      return json(
        { error: "The newest issue has nothing on the actors and countries you follow, so this email would not be sent. Save one it speaks of, then try again." },
        409
      );
    }
    try {
      await sendDigest(env, who.user.email, who.profile?.first_name, news, stopUrl(env, await ensureToken(env, who.userId)), true);
    } catch {
      return json({ error: "The email could not be sent. Please try again." }, 502);
    }
    await setSetting(env.DB, "digest_tested", now());
    return json({ sent: true, to: who.user.email, ...(await digest.status(env)) });
  }
};

// The page the link in an email opens. Opening it changes nothing: mail
// systems open every link in an email to scan it, and that must not turn the
// email off for a reader who asked for it (Fable's check of batch 5, F2). The
// page holds one button, and the button stops the email and does nothing
// else. Both pages say the same whether or not the key was a real one, so
// they tell nobody anything about anybody. Since the tidy-up of 17 November
// 2026 (Part A) the switch is on the account page only, so the page names
// that page alone.
export async function stopPage(env, key, pressed) {
  if (pressed) await env.DB.prepare("UPDATE digest SET wanted = 0 WHERE stop_token = ?").bind(key).run();
  const site = env.SITE_ORIGIN;
  const body = pressed
    ? `<p>The email of what is new will not come again. Nothing else has changed.</p>
<p>You can turn it on again on your account page in the Workspace.</p>
<p><a href="${site}/workspace/account.html">Go to your account page</a></p>`
    : `<p>Stop the email of what is new?</p>
<form method="post"><button type="submit">Stop the Email</button></form>
<p>Nothing else changes. You can turn it on again on your account page in the Workspace.</p>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>PopuliVerse</title>
<style>body{font-family:"Libre Baskerville",Georgia,serif;max-width:36rem;margin:4rem auto;padding:0 1.25rem;color:#111;background:#FCFCFB;line-height:1.7}a{color:#111}button{font:inherit;color:#FCFCFB;background:#111;border:1px solid #111;padding:.7rem 1.4rem;cursor:pointer}</style>
</head>
<body>
<p><strong>PopuliVerse</strong></p>
${body}
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store"
    }
  });
}
