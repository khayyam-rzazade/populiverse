// The sign-in. It is not written by us: it comes from Better Auth 1.7.22, an
// open library. This file holds only its settings (master plan, section 18,
// stage 2, point 8). No passwords exist.
//
// Three ways in:
//   - a code sent to the reader's email (sign in and sign up are the same step);
//   - ORCID, once a person has connected it inside the account;
//   - a guest, with no email; a guest who signs up keeps everything.

import { betterAuth } from "better-auth";
import { emailOTP, anonymous, genericOAuth } from "better-auth/plugins";
import { sendCode, sendNotInvited } from "./mail.js";
import { isOpen, isInvited, isEditorEmail } from "./settings.js";

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

// One instance of the sign-in for each running copy of the server.
let cached = null;
export function getAuth(env) {
  if (!cached || cached.env !== env) cached = { env, auth: createAuth(env) };
  return cached.auth;
}

export function createAuth(env) {
  const secure = env.BASE_URL.startsWith("https://");

  return betterAuth({
    appName: "PopuliVerse",
    baseURL: env.BASE_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [env.SITE_ORIGIN],

    emailAndPassword: { enabled: false },
    telemetry: { enabled: false }, // the library sends nothing to its makers

    session: {
      expiresIn: 30 * DAY, // a session ends 30 days after its last use
      updateAge: DAY, // and is renewed at most once a day
      freshAge: 15 * MINUTE, // deleting the account asks for a sign-in this recent
      cookieCache: { enabled: false } // every request is checked in the database
    },

    account: {
      // ORCID gives no email, so it is connected only by a person who is already
      // signed in, and never matched to an account by email (the address the
      // library is given for ORCID ends in .invalid and belongs to nobody).
      // Connecting it never changes the account's own name or email, and a
      // sign-in never connects anything by itself: only the person does, from
      // inside the account (Fable's review, fix b).
      accountLinking: {
        enabled: true,
        allowDifferentEmails: true,
        trustedProviders: ["orcid"],
        updateUserInfoOnLink: false,
        disableImplicitLinking: true
      }
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/email-otp/send-verification-otp": { window: 10 * MINUTE, max: 5 },
        "/sign-in/email-otp": { window: 10 * MINUTE, max: 10 },
        "/sign-in/anonymous": { window: 60 * MINUTE, max: 10 },
        "/sign-in/social": { window: 10 * MINUTE, max: 10 },
        "/link-social": { window: 10 * MINUTE, max: 10 }
      }
    },

    advanced: {
      cookiePrefix: "pv",
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] }
    },

    databaseHooks: {
      user: {
        create: {
          // While the workspace is closed, only invited emails (and the editor)
          // may open an account, and no guest may start. This is checked here,
          // where every new user passes, whatever the way in.
          before: async (user) => {
            if (await isOpen(env.DB)) return;
            if (user.isAnonymous) return false;
            if (isEditorEmail(env, user.email)) return;
            if (await isInvited(env.DB, user.email)) return;
            return false;
          }
        }
      }
    },

    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * MINUTE,
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendVerificationOnSignUp: false,
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") return; // no other kind of code is used
          const known = await env.DB.prepare('SELECT 1 FROM "user" WHERE email = ?').bind(email).first();
          const allowed =
            known || (await isOpen(env.DB)) || isEditorEmail(env, email) || (await isInvited(env.DB, email));
          // Either way one email goes out and the page answers the same, so
          // nobody can learn whether an address has an account or an invitation.
          await (allowed ? sendCode(env, email, otp) : sendNotInvited(env, email));
        }
      }),

      anonymous({
        emailDomainName: "guest.populiverse.invalid",
        generateName: () => "Guest",
        // A guest who signs in or signs up keeps everything; the empty guest is
        // then removed by the library (Fable's check of batches 2 and 3, point 3).
        async onLinkAccount({ anonymousUser, newUser }) {
          const from = anonymousUser?.user?.id;
          const to = newUser?.user?.id;
          if (!from || !to || from === to || newUser.user.isAnonymous) return;
          await env.DB.batch(moveGuest(env.DB, from, to));
        }
      }),

      genericOAuth({
        config: [
          {
            providerId: "orcid",
            clientId: env.ORCID_CLIENT_ID || "not-set",
            clientSecret: env.ORCID_CLIENT_SECRET || "not-set",
            // ORCID's own addresses, written out, so that nothing is looked up
            // at ORCID until a person actually uses it.
            authorizationUrl: "https://orcid.org/oauth/authorize",
            tokenUrl: "https://orcid.org/oauth/token",
            userInfoUrl: "https://orcid.org/oauth/userinfo",
            scopes: ["openid"],
            pkce: true,
            // An ORCID iD that no account has connected does not open a new
            // account, whatever the request asks: an account always begins
            // with an email code (Fable's review, fix b).
            disableImplicitSignUp: true,
            disableSignUp: true,
            // ORCID returns the iD and the name, never the email. The address
            // below can belong to nobody (.invalid), so it never matches a
            // real account; the iD is what finds the person.
            async getUserInfo(tokens) {
              const res = await fetch("https://orcid.org/oauth/userinfo", {
                headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" }
              });
              if (!res.ok) return null;
              const p = await res.json();
              if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(p.sub || "")) return null;
              const name = p.name || [p.given_name, p.family_name].filter(Boolean).join(" ");
              return {
                id: p.sub,
                sub: p.sub,
                name: name || p.sub,
                email: `${p.sub}@orcid.populiverse.invalid`,
                emailVerified: false
              };
            }
          }
        ]
      })
    ]
  });
}

// Everything a guest keeps moves to the account, in one step. Where the account
// already keeps the same thing, the account's row stays and takes from the
// guest's what it lacks: the note if it has none, the tags, the passages it
// does not have yet, and the reading status if it has none. A project of the
// guest that held the thing now holds the account's row. Then the rest moves as
// it is. Nothing is dropped for a limit in this move.
export function moveGuest(db, from, to) {
  // The guest's rows that the account keeps too, as pairs: guest's id, account's id.
  const both = `SELECT g.id AS gid, a.id AS aid FROM kept g
                  JOIN kept a ON a.user_id = ?2 AND a.kind = g.kind AND a.ref = g.ref
                 WHERE g.user_id = ?1`;
  const twin = (col) => `(SELECT a.id FROM kept g JOIN kept a ON a.user_id = ?2 AND a.kind = g.kind AND a.ref = g.ref
                            WHERE g.user_id = ?1 AND g.id = ${col})`;
  return [
    // The note, where the account has none.
    db.prepare(
      `INSERT INTO note (kept_id, user_id, body, created_at, updated_at)
       SELECT b.aid, ?2, n.body, n.created_at, n.updated_at FROM note n JOIN (${both}) b ON b.gid = n.kept_id
        WHERE n.user_id = ?1
       ON CONFLICT (kept_id) DO NOTHING`
    ).bind(from, to),
    // The tags.
    db.prepare(
      `INSERT INTO tag (kept_id, user_id, name, added_at)
       SELECT b.aid, ?2, t.name, t.added_at FROM tag t JOIN (${both}) b ON b.gid = t.kept_id
        WHERE t.user_id = ?1
       ON CONFLICT (kept_id, name) DO NOTHING`
    ).bind(from, to),
    // The passages the account does not have yet.
    db.prepare(
      `UPDATE mark SET user_id = ?2, kept_id = ${twin("mark.kept_id")}
        WHERE user_id = ?1 AND kept_id IN (SELECT gid FROM (${both}))
          AND NOT EXISTS (SELECT 1 FROM mark m2 WHERE m2.user_id = ?2 AND m2.kept_id = ${twin("mark.kept_id")}
                            AND m2.at = mark.at AND m2.text = mark.text)`
    ).bind(from, to),
    // The reading status, where the account has none.
    db.prepare(
      `UPDATE kept SET status = (SELECT g.status FROM kept g WHERE g.user_id = ?1 AND g.kind = kept.kind AND g.ref = kept.ref)
        WHERE user_id = ?2 AND status IS NULL
          AND EXISTS (SELECT 1 FROM kept g WHERE g.user_id = ?1 AND g.kind = kept.kind AND g.ref = kept.ref AND g.status IS NOT NULL)`
    ).bind(from, to),
    // A guest's project that held the thing now holds the account's row.
    db.prepare(
      `UPDATE project_thing SET kept_id = ${twin("project_thing.kept_id")}
        WHERE user_id = ?1 AND kept_id IN (SELECT gid FROM (${both}))`
    ).bind(from, to),
    // What is left of those twin rows of the guest goes.
    db.prepare(`DELETE FROM mark WHERE user_id = ?1 AND kept_id IN (SELECT gid FROM (${both}))`).bind(from, to),
    db.prepare(`DELETE FROM tag WHERE user_id = ?1 AND kept_id IN (SELECT gid FROM (${both}))`).bind(from, to),
    db.prepare(`DELETE FROM note WHERE user_id = ?1 AND kept_id IN (SELECT gid FROM (${both}))`).bind(from, to),
    db.prepare(`DELETE FROM kept WHERE user_id = ?1 AND id IN (SELECT gid FROM (${both}))`).bind(from, to),
    // Everything else moves as it is.
    ...["kept", "note", "tag", "mark", "project", "project_thing", "draft", "figure", "notebook_page"].map((t) =>
      db.prepare(`UPDATE ${t} SET user_id = ?2 WHERE user_id = ?1`).bind(from, to)
    )
  ];
}
