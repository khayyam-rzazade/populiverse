// The account page: what the account holds, finishing it, changing it,
// connecting ORCID, "Download Everything" and deleting it.

import { zipSync, strToU8 } from "fflate";
import { json, readBody, now } from "./util.js";
import { POSITIONS, FIELDS, COUNTRIES, LIMITS } from "./lists.js";
import { rorRecord, ROR_ID, addToNewsletter } from "./outside.js";
import { isOpen } from "./settings.js";
import { everything, forgetRows } from "./keep.js";
import { allProjects } from "./projects.js";
import { allDrafts, allFigures, draftWords } from "./write.js";

const FRESH_MINUTES = 15;

async function orcidOf(env, userId) {
  const row = await env.DB.prepare("SELECT accountId FROM account WHERE userId = ? AND providerId = 'orcid'")
    .bind(userId)
    .first();
  return row?.accountId || null;
}

// A plain file name made from a title.
function fileName(title) {
  return (
    String(title || "untitled")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60)
      .toLowerCase() || "untitled"
  );
}

// A picture kept as text becomes the picture's own bytes again, for the zip.
function pngBytes(dataUrl) {
  const comma = String(dataUrl || "").indexOf(",");
  if (comma < 0) return null;
  try {
    const raw = atob(dataUrl.slice(comma + 1));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function oneLine(v, max) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? null : t;
}

export const account = {
  async get({ env, who }) {
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM notebook_page WHERE user_id = ?").bind(who.userId).first();
    const kept = await env.DB.prepare("SELECT COUNT(*) AS n FROM kept WHERE user_id = ?").bind(who.userId).first();
    const notes = await env.DB.prepare("SELECT COUNT(*) AS n FROM note WHERE user_id = ?").bind(who.userId).first();
    const projectCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM project WHERE user_id = ?").bind(who.userId).first();
    const draftCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM draft WHERE user_id = ?").bind(who.userId).first();
    const p = who.profile || {};
    return json({
      guest: who.guest,
      finished: who.finished,
      editor: who.editor,
      open: await isOpen(env.DB),
      name: who.guest ? null : who.user.name,
      firstName: who.guest ? null : p.first_name || null,
      middleName: who.guest ? null : p.middle_name || null,
      surname: who.guest ? null : p.surname || null,
      // An account from before the surname was asked: it is asked for it once.
      needsName: !who.guest && !!p.completed_at && !p.surname,
      email: who.guest ? null : who.user.email,
      institution: p.institution || null,
      rorId: p.ror_id || null,
      country: p.country || null,
      position: p.position || null,
      field: p.field || null,
      newsletter: !!p.newsletter,
      newsletterAt: p.newsletter_at || null,
      since: who.user.createdAt,
      orcid: who.guest ? null : await orcidOf(env, who.userId),
      pages: n,
      kept: kept.n,
      notes: notes.n,
      projects: projectCount.n,
      drafts: draftCount.n,
      keptLimit: who.guest ? LIMITS.keptPerGuest : LIMITS.keptPerAccount,
      projectLimit: who.guest ? LIMITS.projectsPerGuest : LIMITS.projectsPerAccount,
      draftLimit: who.guest ? LIMITS.draftsPerGuest : LIMITS.draftsPerAccount,
      signedInAt: who.session.createdAt
    });
  },

  // Finishing the account and changing it later go through the same door.
  async update({ env, ctx, request, who }) {
    const body = await readBody(request, 5000);
    if (!body) return json({ error: "Please check the form." }, 400);
    const p = who.profile || {};
    const errors = {};

    // The name in three pieces (Fable's check, point 16): First Name and
    // Surname are needed, each with at least one letter; Middle Name is not.
    const piece = (key, have) => (body[key] === undefined ? have || "" : oneLine(body[key], LIMITS.charsPerName));
    const firstName = piece("firstName", p.first_name);
    const middleName = piece("middleName", p.middle_name);
    const surname = piece("surname", p.surname);
    const letter = /\p{L}/u;
    if (firstName === null) errors.firstName = `A first name can hold ${LIMITS.charsPerName} characters.`;
    else if (!letter.test(firstName)) errors.firstName = "Please give your first name.";
    if (middleName === null) errors.middleName = `A middle name can hold ${LIMITS.charsPerName} characters.`;
    if (surname === null) errors.surname = `A surname can hold ${LIMITS.charsPerName} characters.`;
    else if (!letter.test(surname)) errors.surname = "Please give your surname.";
    const name = [firstName, middleName, surname].filter(Boolean).join(" ");

    let institution = p.institution || null;
    let rorId = p.ror_id || null;
    let country = p.country || null;
    if (body.rorId !== undefined || body.institution !== undefined) {
      if (body.rorId) {
        const id = String(body.rorId).replace("https://ror.org/", "");
        const org = ROR_ID.test(id) ? await rorRecord(env, id) : null;
        if (!org) errors.institution = "That institution could not be found. Please pick it again, or type it by hand.";
        else {
          institution = org.name;
          rorId = org.id;
          country = org.country || null;
        }
      } else {
        institution = oneLine(body.institution, LIMITS.charsPerInstitution);
        rorId = null;
        country = typeof body.country === "string" ? body.country.toUpperCase() : "";
        if (!institution || institution.length < 2) errors.institution = "Please give your institution.";
        if (!COUNTRIES.has(country)) errors.country = "Please pick the country of your institution.";
      }
    }
    if (!institution) errors.institution = errors.institution || "Please give your institution.";

    const position = body.position === undefined ? p.position || null : body.position || null;
    if (position && !POSITIONS.includes(position)) errors.position = "Please pick a position from the list.";
    const field = body.field === undefined ? p.field || null : body.field || null;
    if (field && !FIELDS.includes(field)) errors.field = "Please pick a field from the list.";

    if (Object.keys(errors).length) return json({ error: "Please check the form.", fields: errors }, 400);

    const t = now();
    const wantsNewsletter = body.newsletter === true && !p.newsletter;
    await env.DB.batch([
      env.DB.prepare('UPDATE "user" SET name = ?, updatedAt = ? WHERE id = ?').bind(name, t, who.userId),
      env.DB.prepare(
        `INSERT INTO profile (user_id, first_name, middle_name, surname, institution, ror_id, country, position, field, completed_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET first_name = excluded.first_name, middle_name = excluded.middle_name,
           surname = excluded.surname, institution = excluded.institution, ror_id = excluded.ror_id,
           country = excluded.country, position = excluded.position, field = excluded.field,
           completed_at = COALESCE(profile.completed_at, excluded.completed_at)`
      ).bind(who.userId, firstName, middleName || null, surname, institution, rorId, country, position, field, t, t),
      ...(wantsNewsletter
        ? [env.DB.prepare("UPDATE profile SET newsletter = 1, newsletter_at = ? WHERE user_id = ?").bind(t, who.userId)]
        : [])
    ]);

    // The newsletter box: the address goes to Sender, after the answer is sent.
    if (wantsNewsletter) {
      const job = addToNewsletter(env, who.user.email, firstName, surname).then((r) =>
        env.DB.prepare("UPDATE profile SET newsletter_sent_at = ?, newsletter_error = ? WHERE user_id = ?")
          .bind(r.ok ? now() : null, r.ok ? null : r.error, who.userId)
          .run()
      );
      ctx?.waitUntil ? ctx.waitUntil(job) : await job;
    }
    return json({ saved: true });
  },

  // Deleting the account: asks for a sign-in in the last 15 minutes, and takes
  // every row of the person with it, in one step, the email on the invitation
  // list too (Fable's review, fix c).
  async remove({ env, request, who }) {
    const body = (await readBody(request, 1000)) || {};
    if (body.confirm !== "delete") return json({ error: "Please confirm." }, 400);
    const signedIn = new Date(who.session.createdAt).getTime();
    if (!(Date.now() - signedIn < FRESH_MINUTES * 60 * 1000)) {
      return json({ error: "For safety, please sign in again, then delete the account.", fresh: false }, 403);
    }
    const id = who.userId;
    await env.DB.batch([
      env.DB.prepare("DELETE FROM invite WHERE email = ?").bind(String(who.user.email).toLowerCase()),
      ...forgetRows(env.DB, id),
      env.DB.prepare("DELETE FROM notebook_page WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM profile WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(id),
      env.DB.prepare("DELETE FROM account WHERE userId = ?").bind(id),
      env.DB.prepare("DELETE FROM verification WHERE identifier = ?").bind(`sign-in-otp-${who.user.email}`),
      env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(id)
    ]);
    const res = json({ deleted: true });
    for (const name of ["pv.session_token", "__Secure-pv.session_token"]) {
      res.headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    }
    return res;
  },

  async unlinkOrcid({ env, who }) {
    await env.DB.prepare("DELETE FROM account WHERE userId = ? AND providerId = 'orcid'").bind(who.userId).run();
    return json({ orcid: null });
  },

  // "Download Everything": one zip with a plain-text file for every page and a
  // file with the account. Readable without PopuliVerse.
  async exportAll({ env, who }) {
    const { results: pages } = await env.DB.prepare(
      `SELECT p.id, p.title, p.body, p.words, p.project_id, p.created_at, p.updated_at, j.title AS project_title
         FROM notebook_page p LEFT JOIN project j ON j.id = p.project_id AND j.user_id = p.user_id
        WHERE p.user_id = ? ORDER BY p.created_at`
    )
      .bind(who.userId)
      .all();
    const p = who.profile || {};
    const accountData = who.guest
      ? { guest: true, since: who.user.createdAt }
      : {
          name: who.user.name,
          first_name: p.first_name || null,
          middle_name: p.middle_name || null,
          surname: p.surname || null,
          email: who.user.email,
          institution: p.institution || null,
          ror_id: p.ror_id || null,
          country: p.country || null,
          position: p.position || null,
          field: p.field || null,
          newsletter: !!p.newsletter,
          newsletter_ticked_at: p.newsletter_at || null,
          orcid: await orcidOf(env, who.userId),
          since: who.user.createdAt
        };
    const kept = await everything(env, who);
    const noted = kept.filter((k) => k.note);
    const projectList = await allProjects(env, who);
    const drafts = await allDrafts(env, who);
    const figures = await allFigures(env, who);
    const stamp = now().slice(0, 10);
    const files = {
      "README.txt": strToU8(
        `Everything you keep in the PopuliVerse Workspace, downloaded on ${stamp}.\n\n` +
          `account.json   your account\n` +
          `notebook/      one text file for each page of your Notebook\n` +
          `notebook.json  the same pages, with their dates, for use in other tools\n` +
          `shelf.json     everything on your shelf, with your tags, reading status,\n` +
          `               marked passages and the note on each thing\n` +
          `notes/         one text file for each of your notes\n` +
          `notes.json     the same notes, each with the thing it is on\n` +
          `projects.json  your projects, each with what is in it\n` +
          `drafts/        one text file for each of your drafts\n` +
          `drafts.json    the same drafts as the editor stored them\n` +
          `figures/       one picture for each chart or table you sent to Write\n` +
          `figures.json   the title, source and date of each of those pictures\n`
      ),
      "account.json": strToU8(JSON.stringify(accountData, null, 2)),
      "notebook.json": strToU8(JSON.stringify(pages, null, 2)),
      "shelf.json": strToU8(JSON.stringify(kept, null, 2)),
      "projects.json": strToU8(JSON.stringify(projectList, null, 2)),
      "drafts.json": strToU8(JSON.stringify(drafts, null, 2)),
      "figures.json": strToU8(
        JSON.stringify(
          figures.map((f) => ({
            id: f.id,
            title: f.title,
            source: f.source,
            cite: f.cite,
            url: f.url,
            data_as_of: f.day,
            sent: f.created_at
          })),
          null,
          2
        )
      ),
      "notes.json": strToU8(
        JSON.stringify(
          noted.map((k) => ({
            on: { kind: k.kind, ref: k.ref, title: k.title, extra: k.extra, url: k.url },
            note: k.note.body,
            written: k.note.at
          })),
          null,
          2
        )
      )
    };
    const used = new Set();
    pages.forEach((pg, i) => {
      const slug = fileName(pg.title);
      let name = `notebook/${String(i + 1).padStart(4, "0")}-${slug}.txt`;
      while (used.has(name)) name = name.replace(/\.txt$/, "-x.txt");
      used.add(name);
      const words = pg.words || (/^\s*\{\s*"ops"\s*:/.test(pg.body || "") ? "" : pg.body);
      files[name] = strToU8(
        `${pg.title || "Untitled"}\n\n${words}\n\n` +
          (pg.project_title ? `In the project: ${pg.project_title}\n` : "") +
          `Written ${pg.created_at}, last changed ${pg.updated_at}\n`
      );
    });
    drafts.forEach((d, i) => {
      const slug = fileName(d.title);
      let name = `drafts/${String(i + 1).padStart(4, "0")}-${slug}.txt`;
      while (used.has(name)) name = name.replace(/\.txt$/, "-x.txt");
      used.add(name);
      files[name] = strToU8(
        `${d.title || "Untitled"}\n\n${draftWords(d.body)}\n\n` +
          (d.project_title ? `In the project: ${d.project_title}\n` : "") +
          `${d.words} words. Written ${d.created_at}, last changed ${d.updated_at}\n`
      );
    });
    figures.forEach((f, i) => {
      const slug = fileName(f.title);
      let name = `figures/${String(i + 1).padStart(4, "0")}-${slug}.png`;
      while (used.has(name)) name = name.replace(/\.png$/, "-x.png");
      used.add(name);
      const bytes = pngBytes(f.picture);
      if (bytes) files[name] = bytes;
    });
    noted.forEach((k, i) => {
      const slug = fileName(k.title || k.ref || "note");
      let name = `notes/${String(i + 1).padStart(4, "0")}-${slug}.txt`;
      while (used.has(name)) name = name.replace(/\.txt$/, "-x.txt");
      used.add(name);
      const head = [k.title, k.extra, k.url].filter(Boolean).join("\n");
      files[name] = strToU8(
        `${head}\n\n${k.note.body}\n\n` +
          (k.tags.length ? `Your tags: ${k.tags.join(", ")}\n` : "") +
          (k.status ? `Reading: ${k.status}\n` : "") +
          (k.marks.length ? `\nPassages you marked:\n${k.marks.map((m) => `- ${m.text}`).join("\n")}\n` : "") +
          `\nWritten ${k.note.at}\n`
      );
    });
    const zip = zipSync(files, { level: 6 });
    return new Response(zip, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="populiverse-workspace-${stamp}.zip"`,
        "Cache-Control": "no-store"
      }
    });
  }
};
