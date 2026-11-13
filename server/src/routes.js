// Every route of the workspace, with the access it asks of the gate (index.js).
// Each one reads and writes only the rows of `who.userId`, the person the gate
// found. No route reads what a person writes for anyone else, the editor's desk
// included.

import { json } from "./util.js";
import { notebook } from "./notebook.js";
import { account } from "./account.js";
import { desk } from "./desk.js";
import { isOpen } from "./settings.js";
import { rorSearch } from "./outside.js";

export const ROUTES = [
  { method: "GET", path: "/api/status", access: "public", handler: status },
  { method: "GET", path: "/api/ror", access: "public", handler: ror },

  { method: "GET", path: "/api/me", access: "anyone-in", handler: account.get },
  { method: "PATCH", path: "/api/me", access: "account-any", handler: account.update },
  { method: "DELETE", path: "/api/me", access: "account-any", handler: account.remove },
  { method: "GET", path: "/api/me/export", access: "anyone-in", handler: account.exportAll },
  { method: "DELETE", path: "/api/me/orcid", access: "account", handler: account.unlinkOrcid },

  { method: "GET", path: "/api/pages", access: "member", handler: notebook.list },
  { method: "POST", path: "/api/pages", access: "member", handler: notebook.create },
  { method: "GET", path: "/api/pages/:id", access: "member", handler: notebook.get },
  { method: "PATCH", path: "/api/pages/:id", access: "member", handler: notebook.update },
  { method: "DELETE", path: "/api/pages/:id", access: "member", handler: notebook.remove },

  { method: "GET", path: "/api/desk/summary", access: "editor", handler: desk.summary },
  { method: "GET", path: "/api/desk/accounts.csv", access: "editor", handler: desk.accountsCsv },
  { method: "GET", path: "/api/desk/invites", access: "editor", handler: desk.invites },
  { method: "POST", path: "/api/desk/invites", access: "editor", handler: desk.addInvites },
  { method: "DELETE", path: "/api/desk/invites", access: "editor", handler: desk.removeInvite },
  { method: "POST", path: "/api/desk/open", access: "editor", handler: desk.setOpen }
];

async function status({ env }) {
  return json({ open: await isOpen(env.DB) });
}

async function ror({ env, url }) {
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2 || q.length > 100) return json({ items: [] });
  try {
    return json({ items: await rorSearch(env, q) });
  } catch {
    // The form then lets the person type the institution by hand.
    return json({ items: [], unavailable: true });
  }
}
