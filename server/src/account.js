// The account page: what the account holds, finishing it, changing it,
// connecting ORCID, "Download Everything" and deleting it.

import { zipSync, strToU8 } from "fflate";
import { json, readBody, now } from "./util.js";
import { POSITIONS, FIELDS, COUNTRIES, LIMITS, OTHER, COMMENTARY } from "./lists.js";
import { rorRecord, ROR_ID, addToNewsletter } from "./outside.js";
import { isOpen } from "./settings.js";
import { everything, forgetRows } from "./keep.js";
import { allProjects } from "./projects.js";
import { allDrafts, allFigures, draftWords } from "./write.js";
import { allEvents } from "./events.js";
import { countDay, cardState, ownAnswer } from "./feedback.js";
import { digestLive } from "./digest.js";

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

// A line a person types, made one clean line: control characters and runs of
// space become one space, and the ends are trimmed. `false` means it is no
// line at all, because it is not text or it is too long; an empty string means
// nothing was typed. The two are never mistaken for each other (master plan,
// section 18, stage 2, batch 4, A7).
function line(v, max) {
  if (typeof v !== "string") return false;
  const t = v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? false : t;
}

export const account = {
  async get({ env, who }) {
    // A day of use, for the feedback card (batch 5, Part A). Only a guest or a
    // finished account uses the Workspace, so only they are counted.
    if (who.finished) await countDay(env, who.userId);
    const card = await cardState(env, who.userId);
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
      positionOther: p.position_other || null,
      field: p.field || null,
      fieldOther: p.field_other || null,
      interests: p.interests || null,
      commentary: p.commentary || null,
      // An account from before the form grew: it is asked once, at this visit,
      // for the answers of the new form only (batch 4, A4). A guest is not
      // asked, and an account that has answered is never asked again.
      needsAnswers: !who.guest && !!p.completed_at && !p.commentary,
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
      signedInAt: who.session.createdAt,
      // The email of what is new (batch 5, Part D): whether this reader asked
      // for it, and whether the editor has started it.
      emailOn: who.guest ? false : !!(await env.DB.prepare("SELECT wanted FROM digest WHERE user_id = ?").bind(who.userId).first())?.wanted,
      emailLive: await digestLive(env.DB),
      daysUsed: card.daysUsed,
      cardLater: card.cardLater,
      feedbackAt: card.feedbackAt
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

    // Position, field and the question on the Commentary (batch 4, A2 and A3).
    // All three are asked of a request that speaks of any of them, which is
    // every sending of the form, and of an account that has answered before,
    // so that an answer once given can never be emptied. A request that speaks
    // of none of them leaves all three as they stand: that is how an account
    // from before is asked for its name alone, and then for these answers (A4).
    const asks = body.position !== undefined || body.field !== undefined || body.commentary !== undefined || !!p.commentary;
    const fromList = (value, list, what) =>
      value ? (list.includes(value) ? null : `Please pick a ${what} from the list.`) : asks ? `Please pick a ${what} from the list.` : null;

    const position = body.position === undefined ? p.position || null : body.position || null;
    const positionBad = fromList(position, POSITIONS, "position");
    if (positionBad) errors.position = positionBad;
    const field = body.field === undefined ? p.field || null : body.field || null;
    const fieldBad = fromList(field, FIELDS, "field");
    if (fieldBad) errors.field = fieldBad;

    // "Other" opens a box, and what is typed is kept beside the answer, never
    // in place of it. A list answer that is not "Other" clears its box.
    function typedOther(key, answer, stored, what) {
      if (answer !== OTHER) return null;
      // A request that speaks of none of the answers leaves the box as it
      // stands too. An account from before batch 4 may hold "Other" with no
      // box, because the old form had none, and it must still be able to give
      // its surname before it is asked for these answers (Fable's check of
      // batch 4, point 1).
      if (!asks && body[key] === undefined) return stored || null;
      const given = body[key] === undefined ? stored || "" : line(body[key], LIMITS.charsPerOther);
      if (given === false) {
        errors[key] = `Please say what it is in one line of ${LIMITS.charsPerOther} characters or fewer.`;
        return null;
      }
      if (!given || !letter.test(given)) {
        errors[key] = `Please say what your ${what} is.`;
        return null;
      }
      return given;
    }
    const positionOther = positionBad ? p.position_other || null : typedOther("positionOther", position, p.position_other, "position");
    const fieldOther = fieldBad ? p.field_other || null : typedOther("fieldOther", field, p.field_other, "field");

    const commentary = body.commentary === undefined ? p.commentary || null : body.commentary || null;
    if (commentary ? !COMMENTARY.includes(commentary) : asks) {
      errors.commentary = "Please answer the question on writing for the Commentary.";
    }

    // Research interests: one line, and not required (A1).
    let interests = p.interests || null;
    if (body.interests !== undefined) {
      const given = line(body.interests, LIMITS.charsPerInterests);
      if (given === false) errors.interests = `Please write your research interests in one line of ${LIMITS.charsPerInterests} characters or fewer.`;
      else interests = given || null;
    }

    if (Object.keys(errors).length) return json({ error: "Please check the form.", fields: errors }, 400);

    const t = now();
    // The day the answer on the Commentary was given, so that the editor can
    // see who answered and when (A5).
    const commentaryAt = commentary && commentary !== (p.commentary || null) ? t : p.commentary_at || null;
    const wantsNewsletter = body.newsletter === true && !p.newsletter;
    await env.DB.batch([
      env.DB.prepare('UPDATE "user" SET name = ?, updatedAt = ? WHERE id = ?').bind(name, t, who.userId),
      env.DB.prepare(
        `INSERT INTO profile (user_id, first_name, middle_name, surname, institution, ror_id, country,
                              position, position_other, field, field_other, interests, commentary, commentary_at,
                              completed_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET first_name = excluded.first_name, middle_name = excluded.middle_name,
           surname = excluded.surname, institution = excluded.institution, ror_id = excluded.ror_id,
           country = excluded.country, position = excluded.position, position_other = excluded.position_other,
           field = excluded.field, field_other = excluded.field_other, interests = excluded.interests,
           commentary = excluded.commentary, commentary_at = excluded.commentary_at,
           completed_at = COALESCE(profile.completed_at, excluded.completed_at)`
      ).bind(who.userId, firstName, middleName || null, surname, institution, rorId, country,
             position, positionOther, field, fieldOther, interests, commentary, commentaryAt, t, t),
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

  // The newsletter button (batch 5, Part C): the account's own address goes
  // to Sender the way the box at registration sends it, so that Sender's own
  // email follows. The box is set in the statement itself, so a second press,
  // or two at once, never sends the address twice.
  async joinNewsletter({ env, ctx, who }) {
    const t = now();
    const row = await env.DB.prepare(
      "UPDATE profile SET newsletter = 1, newsletter_at = ? WHERE user_id = ? AND newsletter = 0 RETURNING user_id"
    )
      .bind(t, who.userId)
      .first();
    if (!row) return json({ newsletter: true, already: true });
    const p = who.profile || {};
    const job = addToNewsletter(env, who.user.email, p.first_name, p.surname).then((r) =>
      env.DB.prepare("UPDATE profile SET newsletter_sent_at = ?, newsletter_error = ? WHERE user_id = ?")
        .bind(r.ok ? now() : null, r.ok ? null : r.error, who.userId)
        .run()
    );
    ctx?.waitUntil ? ctx.waitUntil(job) : await job;
    return json({ newsletter: true, at: t });
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
          position_other: p.position_other || null,
          field: p.field || null,
          field_other: p.field_other || null,
          research_interests: p.interests || null,
          write_for_commentary: p.commentary || null,
          write_for_commentary_answered: p.commentary_at || null,
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
    const ownEvents = await allEvents(env, who);
    const card = await cardState(env, who.userId);
    const answer = await ownAnswer(env, who.userId);
    // Home's day of the last visit and the email of what is new (batch 5,
    // Parts B and D): what the Workspace keeps on them, without the key of
    // the link that stops the email.
    const mark = await env.DB.prepare("SELECT home_at, home_issue FROM home_mark WHERE user_id = ?").bind(who.userId).first();
    const mail = await env.DB.prepare("SELECT wanted, wanted_at, sent_issue, sent_at FROM digest WHERE user_id = ?").bind(who.userId).first();
    accountData.home_last_visit = mark ? { at: mark.home_at, newest_monitor_issue_then: mark.home_issue || null } : null;
    if (!who.guest) {
      accountData.email_of_what_is_new = mail
        ? { on: !!mail.wanted, asked: mail.wanted_at || null, last_issue_sent: mail.sent_issue || null, last_sent: mail.sent_at || null }
        : { on: false };
    }
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
          `projects.json  your projects, each with its colour and what is in it\n` +
          `drafts/        one text file for each of your drafts\n` +
          `drafts.json    the same drafts as the editor stored them\n` +
          `figures/       one picture for each chart or table you sent to Write\n` +
          `figures.json   the title, source and date of each of those pictures\n` +
          `events.json    the events you added yourself to a chronology, each with\n` +
          `               its source and the actor or country it is on\n` +
          `feedback.json  your answer to the feedback card, if you gave one, and the\n` +
          `               number of days you opened the Workspace\n`
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
      "events.json": strToU8(
        JSON.stringify(
          ownEvents.map((e) => ({
            on: { kind: e.aboutKind, ref: e.aboutRef },
            date: e.day,
            what: e.what,
            source: e.source,
            added_by: "you",
            added: e.added
          })),
          null,
          2
        )
      ),
      "feedback.json": strToU8(
        JSON.stringify(
          {
            answer: answer
              ? {
                  how_useful: answer.score,
                  uses_it_for: answer.uses,
                  missing_or_awkward: answer.missing,
                  would_like_to_help: answer.help,
                  answered: answer.answered,
                  last_changed: answer.changed
                }
              : null,
            days_you_opened_the_workspace: card.daysUsed,
            not_now_pressed: card.cardLater
          },
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
