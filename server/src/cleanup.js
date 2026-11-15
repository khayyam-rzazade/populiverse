// The nightly job (03:17 UTC), so that nothing is kept longer than promised on
// the Privacy page (master plan, section 18, the row on batch 1, point e).
//   - A guest's work: deleted 30 days after the guest's last visit.
//   - An account: kept as long as it is used. After two years without a visit,
//     one email warns; 30 days later, if still unused, the account and
//     everything in it are deleted. The editor's own account is never touched.
//   - Spent sign-in codes, old counts of the rate limit, and the counter of
//     codes asked for an address, after a day.
// Deleting an account also takes its email off the invitation list (Fable's
// review, fix c).

import { sendDeletionWarning } from "./mail.js";
import { isEditorEmail } from "./settings.js";
import { emptyCounter } from "./counter.js";
import { forgetRows } from "./keep.js";

const DAY = 86400000;

async function deleteUser(db, id) {
  await db.batch([
    db.prepare('DELETE FROM invite WHERE email = (SELECT lower(email) FROM "user" WHERE id = ?)').bind(id),
    ...forgetRows(db, id),
    db.prepare("DELETE FROM notebook_page WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM profile WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM session WHERE userId = ?").bind(id),
    db.prepare("DELETE FROM account WHERE userId = ?").bind(id),
    db.prepare('DELETE FROM "user" WHERE id = ?').bind(id)
  ]);
}

export async function nightly(env, at = Date.now()) {
  const db = env.DB;
  const iso = (ms) => new Date(ms).toISOString();
  const report = { guests: 0, warned: 0, deleted: 0 };

  // Guests: no session left alive (a session lives 30 days after its last use).
  const { results: guests } = await db
    .prepare(
      `SELECT u.id FROM "user" u
        WHERE u.isAnonymous = 1 AND u.createdAt < ?
          AND NOT EXISTS (SELECT 1 FROM session s WHERE s.userId = u.id AND s.expiresAt > ?)`
    )
    .bind(iso(at - DAY), iso(at))
    .all();
  for (const g of guests) {
    await deleteUser(db, g.id);
    report.guests++;
  }

  // Accounts unused for two years.
  const { results: idle } = await db
    .prepare(
      `SELECT u.id, u.email, p.warned_at, COALESCE(p.last_seen_at, u.createdAt) AS seen
         FROM "user" u LEFT JOIN profile p ON p.user_id = u.id
        WHERE COALESCE(u.isAnonymous, 0) = 0 AND COALESCE(p.last_seen_at, u.createdAt) < ?`
    )
    .bind(iso(at - 730 * DAY))
    .all();
  for (const a of idle) {
    if (isEditorEmail(env, a.email)) continue;
    if (!a.warned_at) {
      const date = new Date(at + 30 * DAY).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      // The account counts as warned only when the email went out; if the
      // mail fails, the job tries again the next night (Fable's review, fix d).
      const sent = await sendDeletionWarning(env, a.email, date).then(
        () => true,
        () => false
      );
      if (!sent) continue;
      await db
        .prepare(
          `INSERT INTO profile (user_id, warned_at) VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET warned_at = excluded.warned_at`
        )
        .bind(a.id, iso(at))
        .run();
      report.warned++;
    } else if (a.warned_at < iso(at - 30 * DAY)) {
      await deleteUser(db, a.id);
      report.deleted++;
    }
  }

  await db.prepare("DELETE FROM verification WHERE expiresAt < ?").bind(iso(at)).run();
  await db.prepare("DELETE FROM session WHERE expiresAt < ?").bind(iso(at - 7 * DAY)).run();
  await db.prepare("DELETE FROM rateLimit WHERE lastRequest < ?").bind(at - DAY).run().catch(() => null);
  await emptyCounter(db, at);
  return report;
}
