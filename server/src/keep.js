// What a reader keeps: saved things, one note for each, their own tags, the
// reading status of a work and marked passages of an abstract (master plan,
// section 18, stage 2, batch 2).
//
// Every query names the owner: `user_id = ?` is bound to `who.userId`, the
// person the gate found (index.js), and to nobody else. Nothing a person types
// is stored as anything but plain text.

import { json, readBody, now, like, webAddress, inGroups } from "./util.js";
import { LIMITS } from "./lists.js";

const KINDS = ["work", "item", "actor", "country", "chart"];
const IS_KIND = new Set(KINDS);
const STATUSES = new Set(["to-read", "reading", "read"]);
const PAGE = 25;

// Plain text: control characters other than line breaks and tabs are dropped,
// and anything longer than the limit is refused.
function text(v, max) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return t.length > max ? null : t;
}

// One line: every run of spaces becomes one space.
function line(v, max) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? null : t;
}

// The card the shelf shows, and the reference the site itself gives for the
// thing. A field that is missing stays empty. The address is kept only if it is
// a plain web address, so that no row of the shelf can ever become a link that
// does something when it is clicked.
function card(body) {
  const title = line(body.title ?? "", LIMITS.charsPerCard);
  const extra = line(body.extra ?? "", LIMITS.charsPerExtra);
  const url = webAddress(body.url ?? "");
  const year = line(body.year ?? "", 20);
  const country = line(body.country ?? "", 80);
  const abstract = text(body.abstract ?? "", LIMITS.charsPerAbstract);
  const cite = line(body.cite ?? "", LIMITS.charsPerCite);
  const bibtex = text(body.bibtex ?? "", LIMITS.charsPerBibtex);
  if (title === null || extra === null || year === null || country === null) return null;
  if (abstract === null || cite === null || bibtex === null) return null;
  return { title, extra, url, year, country, abstract, cite, bibtex };
}

// The kind and the name of a thing, as they arrive from the page.
function which(body) {
  const kind = typeof body.kind === "string" && IS_KIND.has(body.kind) ? body.kind : null;
  const ref = line(body.ref ?? "", LIMITS.charsPerRef);
  if (!kind || !ref) return null;
  return { kind, ref };
}

function limitOf(who) {
  return who.guest ? LIMITS.keptPerGuest : LIMITS.keptPerAccount;
}

async function used(env, who) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM kept WHERE user_id = ?").bind(who.userId).first();
  return row.n;
}

async function find(env, who, kind, ref) {
  return env.DB.prepare("SELECT * FROM kept WHERE user_id = ? AND kind = ? AND ref = ?")
    .bind(who.userId, kind, ref)
    .first();
}

// Changes the card of a thing already saved. It writes no new row: a thing
// removed a moment ago is saved again only through putNew, which counts, so a
// save that races a removal cannot carry the shelf past its limit (Fable's
// second run, point b). Gives back { row, fresh } or null when the shelf is full.
async function put(env, who, kind, ref, c) {
  const t = now();
  const row = await env.DB.prepare(
    `UPDATE kept SET
       title = CASE WHEN ?1 <> '' THEN ?1 ELSE title END,
       extra = CASE WHEN ?2 <> '' THEN ?2 ELSE extra END,
       url = CASE WHEN ?3 <> '' THEN ?3 ELSE url END,
       year = CASE WHEN ?4 <> '' THEN ?4 ELSE year END,
       country = CASE WHEN ?5 <> '' THEN ?5 ELSE country END,
       abstract = CASE WHEN ?6 <> '' THEN ?6 ELSE abstract END,
       cite = CASE WHEN ?7 <> '' THEN ?7 ELSE cite END,
       bibtex = CASE WHEN ?8 <> '' THEN ?8 ELSE bibtex END,
       updated_at = ?9
     WHERE user_id = ?10 AND kind = ?11 AND ref = ?12
     RETURNING *`
  )
    .bind(c.title, c.extra, c.url, c.year, c.country, c.abstract, c.cite, c.bibtex, t, who.userId, kind, ref)
    .first();
  if (row) return { row, fresh: false };
  const made = await putNew(env, who, kind, ref, c, limitOf(who));
  if (made) return { row: made, fresh: true };
  // Saved by another request in the same moment, or the shelf is full.
  const again = await find(env, who, kind, ref);
  return again ? { row: again, fresh: false } : null;
}

function full(who, limit) {
  return json(
    {
      error: who.guest
        ? `A guest can keep ${limit} things. Sign up to keep more.`
        : `You have reached ${limit} things on your shelf.`,
      limit
    },
    409
  );
}

// Saves a thing that is not on the shelf yet, if the shelf has room. The count
// stands inside the statement that writes the row, so requests sent at the same
// moment cannot pass the limit together (Fable's check, point 9). Gives back
// the row, or null when the shelf is full.
async function putNew(env, who, kind, ref, c, limit) {
  const t = now();
  return env.DB.prepare(
    `INSERT INTO kept (id, user_id, kind, ref, title, extra, url, year, country, abstract, cite, bibtex, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM kept WHERE user_id = ?) < ?
     ON CONFLICT (user_id, kind, ref) DO NOTHING
     RETURNING *`
  )
    .bind(crypto.randomUUID(), who.userId, kind, ref, c.title, c.extra, c.url, c.year, c.country, c.abstract, c.cite, c.bibtex, t, t, who.userId, limit)
    .first();
}

// Saves the thing if it is not saved yet, within the limit. Gives back the row,
// or an answer to send straight back to the page.
async function reach(env, who, body) {
  const w = which(body);
  if (!w) return { error: json({ error: "Not found." }, 404) };
  const have = await find(env, who, w.kind, w.ref);
  if (have) return { row: have, kind: w.kind, ref: w.ref };
  const c = card(body);
  if (!c) return { error: json({ error: "That is too long to keep." }, 413) };
  const limit = limitOf(who);
  const row = await putNew(env, who, w.kind, w.ref, c, limit);
  if (row) return { row, kind: w.kind, ref: w.ref, fresh: true };
  // Not written: either the same thing arrived a moment ago, or the shelf is full.
  const again = await find(env, who, w.kind, w.ref);
  if (again) return { row: again, kind: w.kind, ref: w.ref };
  return { error: full(who, limit) };
}

// Everything on one thing, for the shelf and for the page it came from. The
// rows are asked about in groups of 40 (Fable's check, point 2).
async function dress(env, who, rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const ask = (sql) =>
    inGroups(ids, async (part) => {
      const { results } = await env.DB.prepare(sql.replace("(?)", "(" + part.map(() => "?").join(", ") + ")"))
        .bind(who.userId, ...part)
        .all();
      return results || [];
    });
  const [notes, tags, marks, links] = await Promise.all([
    ask("SELECT kept_id, body, updated_at FROM note WHERE user_id = ? AND kept_id IN (?)"),
    ask("SELECT kept_id, name FROM tag WHERE user_id = ? AND kept_id IN (?) ORDER BY name"),
    ask("SELECT id, kept_id, at, text FROM mark WHERE user_id = ? AND kept_id IN (?) ORDER BY at"),
    ask(
      `SELECT pt.kept_id AS kept_id, p.id AS id, p.title AS title FROM project_thing pt
         JOIN project p ON p.id = pt.project_id AND p.user_id = pt.user_id
        WHERE pt.user_id = ? AND pt.kept_id IN (?) ORDER BY p.title COLLATE NOCASE`
    )
  ]);
  const noteOf = {};
  notes.forEach((n) => { noteOf[n.kept_id] = { body: n.body, at: n.updated_at }; });
  const tagsOf = {};
  tags.forEach((t) => { (tagsOf[t.kept_id] = tagsOf[t.kept_id] || []).push(t.name); });
  Object.keys(tagsOf).forEach((k) => tagsOf[k].sort());
  const marksOf = {};
  marks.forEach((m) => {
    (marksOf[m.kept_id] = marksOf[m.kept_id] || []).push({ id: m.id, at: m.at, text: m.text });
  });
  Object.keys(marksOf).forEach((k) => marksOf[k].sort((a, b) => a.at - b.at));
  const inProject = {};
  links.forEach((l) => {
    (inProject[l.kept_id] = inProject[l.kept_id] || []).push({ id: l.id, title: l.title });
  });
  return rows.map((r) => ({
    kind: r.kind,
    ref: r.ref,
    title: r.title,
    extra: r.extra,
    url: r.url,
    year: r.year,
    country: r.country,
    cite: r.cite || "",
    bibtex: r.bibtex || "",
    projects: inProject[r.id] || [],
    status: r.status || null,
    abstract: r.kind === "work" ? r.abstract : "",
    note: noteOf[r.id] || null,
    tags: tagsOf[r.id] || [],
    marks: marksOf[r.id] || [],
    saved_at: r.created_at,
    changed_at: r.updated_at
  }));
}

export const keep = {
  // The shelf, one kind at a time.
  async list({ env, url, who }) {
    const kind = IS_KIND.has(url.searchParams.get("kind")) ? url.searchParams.get("kind") : "work";
    const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
    const status = STATUSES.has(url.searchParams.get("status")) ? url.searchParams.get("status") : null;
    const tag = (url.searchParams.get("tag") || "").trim().slice(0, LIMITS.charsPerTag);
    const order = url.searchParams.get("order") || "new";
    const from = Math.max(0, Math.min(100000, parseInt(url.searchParams.get("from"), 10) || 0));
    const project = (url.searchParams.get("project") || "").trim().slice(0, 64);

    let sql = "SELECT k.* FROM kept k WHERE k.user_id = ? AND k.kind = ?";
    const args = [who.userId, kind];
    if (project) {
      sql += " AND EXISTS (SELECT 1 FROM project_thing pt WHERE pt.kept_id = k.id AND pt.user_id = k.user_id AND pt.project_id = ?)";
      args.push(project);
    }
    if (status) {
      sql += " AND k.status = ?";
      args.push(status);
    }
    if (tag) {
      sql += " AND EXISTS (SELECT 1 FROM tag t WHERE t.kept_id = k.id AND t.user_id = k.user_id AND t.name = ?)";
      args.push(tag);
    }
    if (q) {
      const pattern = like(q);
      sql +=
        " AND (k.title LIKE ? ESCAPE '\\' OR k.extra LIKE ? ESCAPE '\\'" +
        " OR EXISTS (SELECT 1 FROM note n WHERE n.kept_id = k.id AND n.user_id = k.user_id AND n.body LIKE ? ESCAPE '\\')" +
        " OR EXISTS (SELECT 1 FROM tag t2 WHERE t2.kept_id = k.id AND t2.user_id = k.user_id AND t2.name LIKE ? ESCAPE '\\'))";
      args.push(pattern, pattern, pattern, pattern);
    }
    sql +=
      order === "author"
        ? " ORDER BY k.title COLLATE NOCASE"
        : order === "year"
          ? " ORDER BY k.year DESC, k.title COLLATE NOCASE"
          : " ORDER BY k.created_at DESC";
    sql += " LIMIT ? OFFSET ?";
    args.push(PAGE + 1, from);

    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const rows = results || [];
    const more = rows.length > PAGE;
    const things = await dress(env, who, rows.slice(0, PAGE));

    // The counts of the kinds and of the reading bar follow the Project filter,
    // so that the strip above the list always counts what the list can show.
    const inside = project
      ? " AND EXISTS (SELECT 1 FROM project_thing pt WHERE pt.kept_id = kept.id AND pt.user_id = kept.user_id AND pt.project_id = ?)"
      : "";
    const inArgs = project ? [project] : [];

    const counts = {};
    KINDS.forEach((k) => { counts[k] = 0; });
    const { results: byKind } = await env.DB.prepare(
      "SELECT kind, COUNT(*) AS n FROM kept WHERE user_id = ?" + inside + " GROUP BY kind"
    )
      .bind(who.userId, ...inArgs)
      .all();
    (byKind || []).forEach((r) => { if (IS_KIND.has(r.kind)) counts[r.kind] = r.n; });

    const { results: reading } = await env.DB.prepare(
      "SELECT COALESCE(status, 'to-read') AS s, COUNT(*) AS n FROM kept WHERE user_id = ? AND kind = 'work'" + inside + " GROUP BY s"
    )
      .bind(who.userId, ...inArgs)
      .all();
    const bar = { "to-read": 0, reading: 0, read: 0 };
    (reading || []).forEach((r) => { if (bar[r.s] !== undefined) bar[r.s] = r.n; });

    const { results: tagRows } = await env.DB.prepare(
      `SELECT t.name AS name, COUNT(*) AS n FROM tag t JOIN kept k ON k.id = t.kept_id
        WHERE t.user_id = ? AND k.kind = ? GROUP BY t.name ORDER BY t.name`
    )
      .bind(who.userId, kind)
      .all();

    return json({
      kind,
      things,
      more,
      from,
      project,
      counts,
      reading: bar,
      tags: tagRows || [],
      guest: who.guest,
      limit: limitOf(who),
      used: Object.keys(counts).reduce((n, k) => n + counts[k], 0)
    });
  },

  // What of the page being read is already kept. The page sends the names of
  // the things it shows, at most 300, and gets back only those of them that
  // this person keeps, so no page ever carries a whole shelf with it.
  async mine({ env, request, who }) {
    const body = (await readBody(request, 120000)) || {};
    const asked = Array.isArray(body.refs) ? body.refs.slice(0, 300) : [];
    const want = [];
    for (const a of asked) {
      const w = a && typeof a === "object" ? which(a) : null;
      if (w) want.push(w);
    }
    // Asked in groups of 40, two values a thing (Fable's check, point 2).
    const rows = await inGroups(want, async (part) => {
      const args = [];
      part.forEach((w) => args.push(w.kind, w.ref));
      const got = await env.DB.prepare(
        `SELECT * FROM kept WHERE user_id = ? AND (${part.map(() => "(kind = ? AND ref = ?)").join(" OR ")})`
      )
        .bind(who.userId, ...args)
        .all();
      return got.results || [];
    });
    return json({
      signedIn: true,
      guest: who.guest,
      limit: limitOf(who),
      used: await used(env, who),
      things: await dress(env, who, rows)
    });
  },

  // Save, or change the card of something already saved.
  async save({ env, request, who }) {
    const body = await readBody(request, 40000);
    if (!body) return json({ error: "That is too long to keep." }, 413);
    const got = await reach(env, who, body);
    if (got.error) return got.error;
    if (!got.fresh) {
      const c = card(body);
      if (!c) return json({ error: "That is too long to keep." }, 413);
      const changed = await put(env, who, got.kind, got.ref, c);
      if (!changed) return full(who, limitOf(who));
      got.row = changed.row;
      got.fresh = changed.fresh;
    }
    const [thing] = await dress(env, who, [got.row]);
    return json({ thing, used: await used(env, who), limit: limitOf(who) }, got.fresh ? 201 : 200);
  },

  // Remove a thing, and with it its note, its tags and its marked passages.
  async remove({ env, request, who }) {
    const body = (await readBody(request, 2000)) || {};
    const w = which(body);
    if (!w) return json({ error: "Not found." }, 404);
    const row = await find(env, who, w.kind, w.ref);
    if (!row) return json({ error: "That is not on your shelf." }, 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM mark WHERE kept_id = ? AND user_id = ?").bind(row.id, who.userId),
      env.DB.prepare("DELETE FROM tag WHERE kept_id = ? AND user_id = ?").bind(row.id, who.userId),
      env.DB.prepare("DELETE FROM note WHERE kept_id = ? AND user_id = ?").bind(row.id, who.userId),
      env.DB.prepare("DELETE FROM kept WHERE id = ? AND user_id = ?").bind(row.id, who.userId)
    ]);
    return json({ removed: true, used: await used(env, who) });
  },

  // The one note on a thing. Writing a note saves the thing. An empty note
  // takes the note away and leaves the thing.
  async note({ env, request, who }) {
    const body = await readBody(request, 60000);
    if (!body) return json({ error: "That note is too long." }, 413);
    const words = text(body.body ?? "", LIMITS.charsPerNote);
    if (words === null) {
      return json({ error: `A note can hold ${LIMITS.charsPerNote.toLocaleString("en")} characters.` }, 413);
    }
    const got = await reach(env, who, body);
    if (got.error) return got.error;
    const t = now();
    if (!words.trim()) {
      await env.DB.prepare("DELETE FROM note WHERE kept_id = ? AND user_id = ?").bind(got.row.id, who.userId).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO note (kept_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (kept_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`
      )
        .bind(got.row.id, who.userId, words, t, t)
        .run();
    }
    const [thing] = await dress(env, who, [got.row]);
    return json({ thing, used: await used(env, who), limit: limitOf(who) });
  },

  // One of the reader's own tags, added or taken away.
  async tag({ env, request, who }) {
    const body = await readBody(request, 40000);
    if (!body) return json({ error: "That tag is too long." }, 413);
    const add = body.add === undefined ? null : line(body.add, LIMITS.charsPerTag);
    const off = body.remove === undefined ? null : line(body.remove, LIMITS.charsPerTag);
    if (body.add !== undefined && (add === null || !add)) {
      return json({ error: `A tag can hold ${LIMITS.charsPerTag} characters.` }, 413);
    }
    if (add === null && !off) return json({ error: "Please give a tag." }, 400);
    const got = await reach(env, who, body);
    if (got.error) return got.error;
    if (add) {
      const made = await env.DB.prepare(
        `INSERT INTO tag (kept_id, user_id, name, added_at)
         SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM tag WHERE kept_id = ? AND user_id = ?) < ?
         ON CONFLICT (kept_id, name) DO NOTHING`
      )
        .bind(got.row.id, who.userId, add, now(), got.row.id, who.userId, LIMITS.tagsPerThing)
        .run();
      if (!made.meta.changes) {
        const here = await env.DB.prepare("SELECT 1 FROM tag WHERE kept_id = ? AND user_id = ? AND name = ?")
          .bind(got.row.id, who.userId, add)
          .first();
        if (!here) return json({ error: `One thing can carry ${LIMITS.tagsPerThing} tags.` }, 409);
      }
    } else {
      await env.DB.prepare("DELETE FROM tag WHERE kept_id = ? AND user_id = ? AND name = ?")
        .bind(got.row.id, who.userId, off)
        .run();
    }
    const [thing] = await dress(env, who, [got.row]);
    return json({ thing });
  },

  // The reading status of a work: to read, reading, read.
  async status({ env, request, who }) {
    const body = await readBody(request, 40000);
    if (!body) return json({ error: "Please check the form." }, 400);
    const want = typeof body.status === "string" && STATUSES.has(body.status) ? body.status : null;
    if (!want) return json({ error: "Not a reading status." }, 400);
    if (body.kind !== "work") return json({ error: "Only a work has a reading status." }, 400);
    const got = await reach(env, who, body);
    if (got.error) return got.error;
    await env.DB.prepare("UPDATE kept SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(want, now(), got.row.id, who.userId)
      .run();
    got.row.status = want;
    const [thing] = await dress(env, who, [got.row]);
    return json({ thing });
  },

  // A marked passage of an abstract: its own words and where it begins.
  async mark({ env, request, who }) {
    const body = await readBody(request, 40000);
    if (!body) return json({ error: "That passage is too long." }, 413);
    const off = body.remove === undefined ? null : line(body.remove, 64);
    if (off) {
      const r = await env.DB.prepare("DELETE FROM mark WHERE id = ? AND user_id = ?").bind(off, who.userId).run();
      return r.meta.changes ? json({ removed: true }) : json({ error: "No such passage." }, 404);
    }
    const words = text(body.text ?? "", LIMITS.charsPerMark);
    const at = Number.isInteger(body.at) && body.at >= 0 && body.at <= LIMITS.charsPerAbstract ? body.at : null;
    if (words === null) return json({ error: `A passage can hold ${LIMITS.charsPerMark} characters.` }, 413);
    if (!words.trim() || at === null) return json({ error: "Please mark a passage of the abstract." }, 400);
    if (body.kind !== "work") return json({ error: "Only a work has an abstract to mark." }, 400);
    const got = await reach(env, who, body);
    if (got.error) return got.error;
    const made = await env.DB.prepare(
      `INSERT INTO mark (id, kept_id, user_id, at, text, added_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM mark WHERE kept_id = ? AND user_id = ?) < ?`
    )
      .bind(crypto.randomUUID(), got.row.id, who.userId, at, words, now(), got.row.id, who.userId, LIMITS.marksPerWork)
      .run();
    if (!made.meta.changes) return json({ error: `One work can carry ${LIMITS.marksPerWork} marked passages.` }, 409);
    const [thing] = await dress(env, who, [got.row]);
    return json({ thing });
  },

  // The notes, with search, order and filter.
  async notes({ env, url, who }) {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
    const on = (url.searchParams.get("on") || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => IS_KIND.has(s));
    const order = url.searchParams.get("order") || "new";
    const from = Math.max(0, Math.min(100000, parseInt(url.searchParams.get("from"), 10) || 0));
    const project = (url.searchParams.get("project") || "").trim().slice(0, 64);

    let sql =
      `SELECT n.body AS body, n.created_at AS note_at, n.updated_at AS note_changed,
              k.kind AS kind, k.ref AS ref, k.title AS title, k.extra AS extra, k.url AS url,
              k.year AS year, k.country AS country, k.cite AS cite
         FROM note n JOIN kept k ON k.id = n.kept_id
        WHERE n.user_id = ?`;
    const args = [who.userId];
    if (project) {
      sql += " AND EXISTS (SELECT 1 FROM project_thing pt WHERE pt.kept_id = k.id AND pt.user_id = k.user_id AND pt.project_id = ?)";
      args.push(project);
    }
    if (on.length) {
      sql += ` AND k.kind IN (${on.map(() => "?").join(", ")})`;
      args.push(...on);
    }
    if (q) {
      const pattern = like(q);
      sql += " AND (n.body LIKE ? ESCAPE '\\' OR k.title LIKE ? ESCAPE '\\' OR k.extra LIKE ? ESCAPE '\\')";
      args.push(pattern, pattern, pattern);
    }
    sql +=
      order === "old"
        ? " ORDER BY n.updated_at"
        : order === "kind"
          ? " ORDER BY k.kind, k.title COLLATE NOCASE"
          : " ORDER BY n.updated_at DESC";
    sql += " LIMIT ? OFFSET ?";
    args.push(PAGE + 1, from);

    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const rows = results || [];
    const { results: byKind } = await env.DB.prepare(
      `SELECT k.kind AS kind, COUNT(*) AS n FROM note n JOIN kept k ON k.id = n.kept_id
        WHERE n.user_id = ?` +
        (project
          ? " AND EXISTS (SELECT 1 FROM project_thing pt WHERE pt.kept_id = k.id AND pt.user_id = k.user_id AND pt.project_id = ?)"
          : "") +
        " GROUP BY k.kind"
    )
      .bind(who.userId, ...(project ? [project] : []))
      .all();
    const counts = {};
    KINDS.forEach((k) => { counts[k] = 0; });
    (byKind || []).forEach((r) => { if (IS_KIND.has(r.kind)) counts[r.kind] = r.n; });
    return json({
      notes: rows.slice(0, PAGE),
      more: rows.length > PAGE,
      from,
      project,
      counts,
      total: Object.keys(counts).reduce((n, k) => n + counts[k], 0),
      guest: who.guest
    });
  }
};

// Everything one person keeps, for "Download Everything" (account.js).
export async function everything(env, who) {
  const { results } = await env.DB.prepare("SELECT * FROM kept WHERE user_id = ? ORDER BY kind, created_at")
    .bind(who.userId)
    .all();
  return dress(env, who, results || []);
}

// The references the site holds for a list of things, for the reference list of
// a draft. Only this person's rows are read.
export async function citesOf(env, who, want) {
  const list = [];
  for (const a of Array.isArray(want) ? want.slice(0, 300) : []) {
    const w = a && typeof a === "object" ? which(a) : null;
    if (w) list.push(w);
  }
  return inGroups(list, async (part) => {
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
}

// The rows to delete with a person, in the order they are deleted (account.js
// and cleanup.js). Nothing of theirs is left behind.
export function forgetRows(db, id) {
  return [
    db.prepare("DELETE FROM mark WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM tag WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM note WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM project_thing WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM project WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM draft WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM figure WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM kept WHERE user_id = ?").bind(id)
  ];
}
