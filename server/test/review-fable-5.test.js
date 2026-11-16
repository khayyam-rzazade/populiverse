// Fable's check of stage 2, batch 4 (master plan, section 18). The registration
// form grew, and an account from before must answer the new questions. These
// tests hold that no such account can be locked out of its own work: not one
// that still owes its surname, not the editor's, and not one that signs in by
// ORCID.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Browser, makeWorld, setOpen, EDITOR, SITE } from "./helpers.js";

let world;
beforeEach(async () => {
  world = makeWorld();
  await setOpen(true);
});
const patch = (b, path, body) => b.json(path, { method: "PATCH", body });
const idOf = async (b) => (await b.json("/api/auth/get-session")).data.user.id;

// The account as it stood before batch 4: no answer of the new form, and the
// position and the field as the old form left them.
async function asBefore(b, { position = null, field = null, surname = true } = {}) {
  const id = await idOf(b);
  await env.DB.prepare(
    `UPDATE profile SET commentary = NULL, commentary_at = NULL, interests = NULL,
            position_other = NULL, field_other = NULL, position = ?, field = ? WHERE user_id = ?`
  ).bind(position, field, id).run();
  // Before 13 November the name was one line and there was no surname.
  if (!surname) await env.DB.prepare("UPDATE profile SET first_name = NULL, middle_name = NULL, surname = NULL WHERE user_id = ?").bind(id).run();
  return id;
}

describe("Fable's check of batch 4. An account from before is never locked out", () => {
  it("C1. an account that still owes its surname, and had picked Other on the old form, can give its surname", async () => {
    for (const [n, old] of [[1, { position: "Other" }], [2, { field: "Other" }], [3, { position: "Other", field: "Other" }]]) {
      const b = new Browser(world);
      await b.signUp(`c1-${n}@example.org`);
      expect((await b.json("/api/pages", { method: "POST", body: { title: "Kept page", body: "my words" } })).status).toBe(201);
      await asBefore(b, { ...old, surname: false });

      const asked = (await b.json("/api/me")).data;
      expect(asked).toMatchObject({ finished: false, needsName: true });
      // The surname form sends the name alone. It must be taken.
      const r = await patch(b, "/api/me", { firstName: "Ada", middleName: "", surname: "Lovelace" });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
      const next = (await b.json("/api/me")).data;
      expect(next).toMatchObject({ finished: true, needsName: false, needsAnswers: true, surname: "Lovelace" });
      expect((await b.json("/api/pages")).data.pages.map((p) => p.title)).toEqual(["Kept page"]);

      // Then the new answers. Other still needs its box, and with it the account is in.
      const empty = await patch(b, "/api/me", {
        position: old.position || "Professor", positionOther: "", field: old.field || "History", fieldOther: "", interests: "", commentary: "No"
      });
      expect(empty.status).toBe(400);
      const full = await patch(b, "/api/me", {
        position: old.position || "Professor", positionOther: "Archivist", field: old.field || "History", fieldOther: "Area Studies",
        interests: "", commentary: "No"
      });
      expect(full.status, JSON.stringify(full.data)).toBe(200);
      const done = (await b.json("/api/me")).data;
      expect(done).toMatchObject({ finished: true, needsAnswers: false, commentary: "No" });
      expect(done.positionOther).toBe(old.position ? "Archivist" : null);
      expect(done.fieldOther).toBe(old.field ? "Area Studies" : null);
    }
  });

  it("C2. the editor's own account from before keeps its desk and its work while it is asked, and after", async () => {
    const ed = new Browser(world);
    await ed.signUp(EDITOR);
    expect((await ed.json("/api/pages", { method: "POST", body: { title: "Editor's page", body: "notes" } })).status).toBe(201);
    await asBefore(ed, { position: "Other" });
    const asked = (await ed.json("/api/me")).data;
    expect(asked).toMatchObject({ finished: true, editor: true, needsAnswers: true });
    expect((await ed.json("/api/desk/summary")).status).toBe(200);
    expect((await ed.json("/api/pages")).data.pages.length).toBe(1);
    const r = await patch(ed, "/api/me", {
      position: "Postdoctoral Researcher", positionOther: "", field: "International Relations", fieldOther: "", interests: "", commentary: "Yes"
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    const after = (await ed.json("/api/me")).data;
    expect(after).toMatchObject({ finished: true, editor: true, needsAnswers: false, positionOther: null });
    expect((await ed.json("/api/desk/summary")).status).toBe(200);
  });

  it("C3. an account from before that signs in by ORCID is asked the same, and loses nothing", async () => {
    const BACK = SITE + "/workspace/";
    const start = (b, door) => b.json(door, { method: "POST", body: { provider: "orcid", callbackURL: BACK, errorCallbackURL: BACK } });
    const back = (b, s) =>
      b.fetch(`/api/auth/callback/orcid?code=good-code&state=${encodeURIComponent(new URL(s.data.url).searchParams.get("state"))}`, { origin: null });

    const ada = new Browser(world);
    await ada.signUp("c3@example.org");
    await back(ada, await start(ada, "/api/auth/link-social"));
    expect((await ada.json("/api/pages", { method: "POST", body: { title: "Kept page", body: "my words" } })).status).toBe(201);
    await asBefore(ada, { field: "Other" });

    const later = new Browser(world);
    expect((await back(later, await start(later, "/api/auth/sign-in/social"))).headers.get("Location")).toBe(BACK);
    const asked = (await later.json("/api/me")).data;
    expect(asked).toMatchObject({ email: "c3@example.org", finished: true, needsAnswers: true });
    expect(asked.orcid).toBeTruthy();
    expect((await later.json("/api/pages")).data.pages.map((p) => p.title)).toEqual(["Kept page"]);
    const r = await patch(later, "/api/me", {
      position: "Prefer Not to Respond", positionOther: "", field: "Other", fieldOther: "Area Studies", interests: "", commentary: "Maybe Later"
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect((await later.json("/api/me")).data).toMatchObject({ needsAnswers: false, commentary: "Maybe Later", fieldOther: "Area Studies" });
    expect((await later.json("/api/pages")).data.pages.length).toBe(1);
  });
});
