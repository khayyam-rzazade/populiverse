// The account page: what the account holds, finishing it, changing it,
// connecting ORCID, "Download Everything" and deleting it.

import { zipSync, strToU8 } from "fflate";
import { json, readBody, now } from "./util.js";
import { POSITIONS, FIELDS, COUNTRIES, LIMITS } from "./lists.js";
import { rorRecord, ROR_ID, addToNewsletter } from "./outside.js";
import { isOpen } from "./settings.js";

const FRESH_MINUTES = 15;

async function orcidOf(env, userId) {
  const row = await env.DB.prepare("SELECT accountId FROM account WHERE userId = ? AND providerId = 'orcid'")
    .bind(userId)
    .first();
  return row?.accountId || null;
}

function oneLine(v, max) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? null : t;
}

export const account = {
  async get({ env, who }) {
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM notebook_page WHERE user_id = ?").bind(who.userId).first();
    const p = who.profile || {};
    return json({
      guest: who.guest,
      finished: who.finished,
      editor: who.editor,
      open: await isOpen(env.DB),
      name: who.guest ? null : who.user.name,
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
      signedInAt: who.session.createdAt
    });
  },

  // Finishing the account and changing it later go through the same door.
  async update({ env, ctx, request, who }) {
    const body = await readBody(request, 5000);
    if (!body) return json({ error: "Please check the form." }, 400);
    const p = who.profile || {};
    const errors = {};

    const name = body.name === undefined ? who.user.name : oneLine(body.name, LIMITS.charsPerName);
    if (!name || name.length < 2) errors.name = "Please give your name.";

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
        `INSERT INTO profile (user_id, institution, ror_id, country, position, field, completed_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET institution = excluded.institution, ror_id = excluded.ror_id,
           country = excluded.country, position = excluded.position, field = excluded.field,
           completed_at = COALESCE(profile.completed_at, excluded.completed_at)`
      ).bind(who.userId, institution, rorId, country, position, field, t, t),
      ...(wantsNewsletter
        ? [env.DB.prepare("UPDATE profile SET newsletter = 1, newsletter_at = ? WHERE user_id = ?").bind(t, who.userId)]
        : [])
    ]);

    // The newsletter box: the address goes to Sender, after the answer is sent.
    if (wantsNewsletter) {
      const job = addToNewsletter(env, who.user.email, name).then((r) =>
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
      "SELECT id, title, body, created_at, updated_at FROM notebook_page WHERE user_id = ? ORDER BY created_at"
    )
      .bind(who.userId)
      .all();
    const p = who.profile || {};
    const accountData = who.guest
      ? { guest: true, since: who.user.createdAt }
      : {
          name: who.user.name,
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
    const stamp = now().slice(0, 10);
    const files = {
      "README.txt": strToU8(
        `Everything you keep in the PopuliVerse Workspace, downloaded on ${stamp}.\n\n` +
          `account.json   your account\n` +
          `notebook/      one text file for each page of your Notebook\n` +
          `notebook.json  the same pages, with their dates, for use in other tools\n`
      ),
      "account.json": strToU8(JSON.stringify(accountData, null, 2)),
      "notebook.json": strToU8(JSON.stringify(pages, null, 2))
    };
    const used = new Set();
    pages.forEach((pg, i) => {
      const slug =
        (pg.title || "untitled")
          .normalize("NFKD")
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/\s+/g, "-")
          .slice(0, 60)
          .toLowerCase() || "untitled";
      let name = `notebook/${String(i + 1).padStart(4, "0")}-${slug}.txt`;
      while (used.has(name)) name = name.replace(/\.txt$/, "-x.txt");
      used.add(name);
      files[name] = strToU8(`${pg.title || "Untitled"}\n\n${pg.body}\n\nWritten ${pg.created_at}, last changed ${pg.updated_at}\n`);
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
