// Small helpers shared by the routes.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

// Reads a JSON body of at most `max` characters, or returns null.
export async function readBody(request, max = 400000) {
  const text = await request.text();
  if (text.length > max) return null;
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export function now() {
  return new Date().toISOString();
}

// What a reader searches for, made into a LIKE pattern. Cloudflare's database
// takes a pattern of at most 50 bytes and answers an error above that, so the
// words are cut to fit, counted in bytes and never in the middle of a letter.
export function like(words) {
  const text = String(words || "").trim();
  const room = LIKE_BYTES;
  let out = "";
  let bytes = 0;
  for (const letter of text) {
    // A backslash, a per cent sign and an underscore are escaped, so they
    // count twice, and the pattern itself adds the two per cent signs.
    const piece = /[\\%_]/.test(letter) ? "\\" + letter : letter;
    const size = new TextEncoder().encode(piece).length;
    if (bytes + size > room) break;
    out += piece;
    bytes += size;
  }
  return "%" + out + "%";
}

const LIKE_BYTES = 44;

// A plain web address, or nothing. Anything else — a "javascript:" address,
// say — is never kept and never becomes a link on a page.
export function webAddress(url) {
  if (typeof url !== "string") return "";
  const clean = url.trim();
  return /^https?:\/\/[^\s]+$/i.test(clean) && clean.length <= 500 ? clean : "";
}

// Cloudflare's database takes at most 100 values in one question (Fable's check
// of batches 2 and 3, point 2). A long list is asked in groups of 40, one after
// the other, and the answers are put together.
export const GROUP = 40;
export async function inGroups(list, ask) {
  const out = [];
  for (let i = 0; i < list.length; i += GROUP) {
    const rows = await ask(list.slice(i, i + GROUP));
    for (const r of rows || []) out.push(r);
  }
  return out;
}
