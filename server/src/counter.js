// The counter in front of the door that sends a code (master plan, section 18,
// Fable's review of batch 1, fix a). The sign-in library counts per internet
// address; this counts per email address, whoever asks and whether or not the
// address has an account: at most 5 codes an hour and 10 a day. It is a
// counter, not sign-in code: the sign-in itself stays the library's.
//
// It keeps a fingerprint of the address, never the address. The fingerprint is
// made with the server's secret key, so it cannot be turned back into the
// address. The nightly job empties the counter after a day (cleanup.js).

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const CODES_AN_HOUR = 5;
export const CODES_A_DAY = 10;

async function fingerprint(env, email) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(env.BETTER_AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("code-for:" + email));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Takes one code from the address's allowance. Answers null when none is left.
// The check and the count are one step in the database, so two requests at the
// same moment cannot both slip past the limit.
export async function takeCode(env, email, at = Date.now()) {
  const fp = await fingerprint(env, String(email).trim().toLowerCase());
  const r = await env.DB.prepare(
    `INSERT INTO code_ask (fingerprint, asked_at)
     SELECT ?1, ?2
      WHERE (SELECT COUNT(*) FROM code_ask WHERE fingerprint = ?1 AND asked_at > ?3) < ?4
        AND (SELECT COUNT(*) FROM code_ask WHERE fingerprint = ?1 AND asked_at > ?5) < ?6`
  )
    .bind(fp, at, at - HOUR, CODES_AN_HOUR, at - DAY, CODES_A_DAY)
    .run();
  return r.meta.changes === 1 ? { fp, at } : null;
}

// A code the library did not send after all (a wrong address, its own limit)
// is given back, so that it does not count.
export async function giveBack(env, taken) {
  await env.DB.prepare(
    "DELETE FROM code_ask WHERE rowid = (SELECT rowid FROM code_ask WHERE fingerprint = ? AND asked_at = ? LIMIT 1)"
  )
    .bind(taken.fp, taken.at)
    .run();
}

// For the nightly job.
export async function emptyCounter(db, at = Date.now()) {
  await db.prepare("DELETE FROM code_ask WHERE asked_at < ?").bind(at - DAY).run();
}
