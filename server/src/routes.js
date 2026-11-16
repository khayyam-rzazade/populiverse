// Every route of the workspace, with the access it asks of the gate (index.js).
// Each one reads and writes only the rows of `who.userId`, the person the gate
// found. No route reads what a person writes for anyone else, the editor's desk
// included.

import { json } from "./util.js";
import { notebook } from "./notebook.js";
import { keep } from "./keep.js";
import { projects } from "./projects.js";
import { write } from "./write.js";
import { events } from "./events.js";
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

  // What a reader keeps: saved things, notes, tags, reading status, marks.
  { method: "GET", path: "/api/keep", access: "member", handler: keep.list },
  { method: "POST", path: "/api/keep/mine", access: "member", handler: keep.mine },
  { method: "POST", path: "/api/keep", access: "member", handler: keep.save },
  { method: "DELETE", path: "/api/keep", access: "member", handler: keep.remove },
  { method: "POST", path: "/api/keep/note", access: "member", handler: keep.note },
  { method: "POST", path: "/api/keep/tag", access: "member", handler: keep.tag },
  { method: "POST", path: "/api/keep/status", access: "member", handler: keep.status },
  { method: "POST", path: "/api/keep/mark", access: "member", handler: keep.mark },
  { method: "GET", path: "/api/notes", access: "member", handler: keep.notes },

  // Projects: the list, one project as one view, and what is in it.
  { method: "GET", path: "/api/projects", access: "member", handler: projects.list },
  { method: "POST", path: "/api/projects", access: "member", handler: projects.create },
  { method: "GET", path: "/api/projects/:id", access: "member", handler: projects.get },
  { method: "PATCH", path: "/api/projects/:id", access: "member", handler: projects.update },
  { method: "DELETE", path: "/api/projects/:id", access: "member", handler: projects.remove },
  { method: "POST", path: "/api/projects/:id/things", access: "member", handler: projects.addThing },
  { method: "DELETE", path: "/api/projects/:id/things", access: "member", handler: projects.removeThing },

  // Write: drafts, the figures sent from the Data pages, and the references.
  { method: "GET", path: "/api/drafts", access: "member", handler: write.list },
  { method: "POST", path: "/api/drafts", access: "member", handler: write.create },
  { method: "GET", path: "/api/drafts/:id", access: "member", handler: write.get },
  { method: "PATCH", path: "/api/drafts/:id", access: "member", handler: write.update },
  { method: "DELETE", path: "/api/drafts/:id", access: "member", handler: write.remove },
  { method: "GET", path: "/api/figures", access: "member", handler: write.figures },
  { method: "POST", path: "/api/figures", access: "member", handler: write.addFigure },
  { method: "GET", path: "/api/figures/:id", access: "member", handler: write.figure },
  { method: "DELETE", path: "/api/figures/:id", access: "member", handler: write.removeFigure },
  { method: "POST", path: "/api/write/cites", access: "member", handler: write.cites },
  { method: "GET", path: "/api/write/bibliography", access: "member", handler: write.bibliography },

  // The reader's own events in a chronology (batch 4, Part B). Private to the
  // person who wrote them; no other route reads this table.
  { method: "GET", path: "/api/events", access: "member", handler: events.list },
  { method: "POST", path: "/api/events", access: "member", handler: events.add },
  { method: "DELETE", path: "/api/events/:id", access: "member", handler: events.remove },

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
