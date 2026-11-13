// Two settings the editor changes at his desk: whether the workspace is open to
// all, and the list of invited emails. Until he opens it, it is closed.

export async function isOpen(db) {
  const row = await db.prepare("SELECT value FROM setting WHERE key = 'open'").first();
  return row?.value === "yes";
}

export async function setOpen(db, open) {
  await db
    .prepare("INSERT INTO setting (key, value) VALUES ('open', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(open ? "yes" : "no")
    .run();
}

export async function isInvited(db, email) {
  const row = await db.prepare("SELECT 1 FROM invite WHERE email = ?").bind(String(email).toLowerCase()).first();
  return !!row;
}

export function isEditorEmail(env, email) {
  return String(email || "").toLowerCase() === String(env.EDITOR_EMAIL).toLowerCase();
}
