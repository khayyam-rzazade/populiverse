// The two outside services the server talks to: ROR (the open registry of
// institutions) and Sender (the newsletter). Nothing a person writes is ever
// sent to either.

// ---------------------------------------------------------------- ROR

const ROR = "https://api.ror.org/v2/organizations";

function rorHeaders(env) {
  const h = { Accept: "application/json" };
  if (env.ROR_CLIENT_ID) h["Client-Id"] = env.ROR_CLIENT_ID;
  return h;
}

function rorItem(org) {
  const display = (org.names || []).find((n) => (n.types || []).includes("ror_display")) || (org.names || [])[0];
  const loc = (org.locations || [])[0]?.geonames_details || {};
  return {
    id: String(org.id || "").replace("https://ror.org/", ""),
    name: display?.value || "",
    country: loc.country_code || "",
    countryName: loc.country_name || "",
    city: loc.name || ""
  };
}

// A ROR ID is nine characters: a zero and eight letters or digits.
export const ROR_ID = /^0[a-hj-km-np-tv-z0-9]{6}[0-9]{2}$/;

export async function rorSearch(env, q) {
  const url = `${ROR}?query=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: rorHeaders(env), cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!res.ok) throw new Error(`ROR answered ${res.status}`);
  const data = await res.json();
  return (data.items || []).slice(0, 8).map(rorItem).filter((o) => o.id && o.name);
}

export async function rorRecord(env, id) {
  if (!ROR_ID.test(id)) return null;
  const res = await fetch(`${ROR}/${id}`, { headers: rorHeaders(env), cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!res.ok) return null;
  const o = rorItem(await res.json());
  return o.id === id ? o : null;
}

// ---------------------------------------------------------------- Sender

// Adds a person who ticked the box to the newsletter group. Their email was
// proved by the sign-in code, and the tick is their consent.
export async function addToNewsletter(env, email, name) {
  if (!env.SENDER_API_KEY || !env.SENDER_GROUP_ID) return { ok: false, error: "Sender is not set up" };
  const parts = String(name || "").trim().split(/\s+/);
  const res = await fetch("https://api.sender.net/v2/subscribers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SENDER_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      email,
      firstname: parts[0] || "",
      lastname: parts.slice(1).join(" "),
      groups: [env.SENDER_GROUP_ID],
      trigger_automation: false
    })
  });
  if (res.ok) return { ok: true };
  // Someone already on Sender's list is only added to the group.
  const again = await fetch(`https://api.sender.net/v2/subscribers/groups/${encodeURIComponent(env.SENDER_GROUP_ID)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SENDER_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ subscribers: [email], trigger_automation: false })
  });
  return again.ok ? { ok: true } : { ok: false, error: `Sender answered ${res.status} and ${again.status}` };
}
