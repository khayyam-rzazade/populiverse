// Attacks on the registration form of batch 4 (master plan, section 18, stage
// 2, batch 4, Part A). The form grew by three answers and one line of research
// interests, and position and field became required. The server takes nothing
// outside the lists, and an account from before is asked once and only once.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";
import { Browser, makeWorld, setOpen, EDITOR } from "./helpers.js";

let world;
beforeEach(async () => {
  world = makeWorld();
  await setOpen(true);
});
const post = (b, path, body) => b.json(path, { method: "POST", body });
const patch = (b, path, body) => b.json(path, { method: "PATCH", body });
async function member(email, fields) {
  const b = new Browser(world);
  await b.signUp(email, fields);
  return b;
}
const idOf = async (b) => (await b.json("/api/auth/get-session")).data.user.id;
const profileOf = async (b) =>
  env.DB.prepare("SELECT * FROM profile WHERE user_id = ?").bind(await idOf(b)).first();

// The institution is always the same one, so that each test asks about the
// answers of the form and nothing else.
const BASE = { firstName: "Ada", surname: "Lovelace", rorId: "0107c5v14" };

describe("Batch 4, A2. The question on writing for the Commentary", () => {
  it("F1. a sign-up with no answer is refused, and so is any answer outside the three", async () => {
    const b = new Browser(world);
    expect((await b.signIn("f1@example.org")).status).toBe(200);
    const form = { ...BASE, position: "Professor", field: "History" };
    const refused = [
      {},
      { commentary: "" },
      { commentary: "   " },
      { commentary: null },
      { commentary: "yes" },
      { commentary: "maybe later" },
      { commentary: "Perhaps" },
      { commentary: "Yes, please" },
      { commentary: 1 },
      { commentary: true },
      { commentary: ["Yes"] },
      { commentary: { answer: "Yes" } }
    ];
    for (const t of refused) {
      const r = await patch(b, "/api/me", { ...form, ...t });
      expect(r.status, JSON.stringify(t)).toBe(400);
      expect(r.data.fields.commentary, JSON.stringify(t)).toBeTruthy();
    }
    // Nothing of the form was kept while the question stood unanswered.
    const waiting = (await b.json("/api/me")).data;
    expect(waiting).toMatchObject({ finished: false, commentary: null, position: null, field: null });

    for (const answer of ["Yes", "Maybe Later", "No"]) {
      const ok = await patch(b, "/api/me", { ...form, commentary: answer });
      expect(ok.status, answer).toBe(200);
      expect((await b.json("/api/me")).data.commentary).toBe(answer);
    }
    expect((await b.json("/api/me")).data).toMatchObject({ finished: true, needsAnswers: false });
  });

  it("F2. an answer once given can never be emptied, and the day of the answer moves only when the answer changes", async () => {
    const b = await member("f2@example.org", { commentary: "Yes" });
    const first = (await profileOf(b)).commentary_at;
    expect(first).toBeTruthy();
    for (const t of [{ commentary: "" }, { commentary: null }, { commentary: "Soon" }]) {
      const r = await patch(b, "/api/me", t);
      expect(r.status, JSON.stringify(t)).toBe(400);
      expect(r.data.fields.commentary).toBeTruthy();
    }
    expect((await b.json("/api/me")).data.commentary).toBe("Yes");

    // The same answer again does not move the day.
    expect((await patch(b, "/api/me", { commentary: "Yes" })).status).toBe(200);
    expect((await profileOf(b)).commentary_at).toBe(first);
    // A different answer does.
    expect((await patch(b, "/api/me", { commentary: "No" })).status).toBe(200);
    const second = (await profileOf(b)).commentary_at;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});

describe("Batch 4, A3. Position and field, with Prefer Not to Respond and Other", () => {
  it("F3. both are required, and nothing outside the lists is ever taken", async () => {
    const b = new Browser(world);
    await b.signIn("f3@example.org");
    const form = { ...BASE, commentary: "No" };
    let r = await patch(b, "/api/me", form);
    expect(r.status).toBe(400);
    expect(Object.keys(r.data.fields).sort()).toEqual(["field", "position"]);
    r = await patch(b, "/api/me", { ...form, field: "History" });
    expect(r.status).toBe(400);
    expect(Object.keys(r.data.fields)).toEqual(["position"]);
    r = await patch(b, "/api/me", { ...form, position: "Professor" });
    expect(r.status).toBe(400);
    expect(Object.keys(r.data.fields)).toEqual(["field"]);
    const outside = [
      { position: "Nobel Laureate", field: "History" },
      { position: "Professor", field: "Astrology" },
      { position: "prefer not to respond", field: "History" },
      { position: "Professor", field: "prefer not to respond" },
      { position: "PREFER NOT TO RESPOND", field: "History" },
      { position: ["Professor"], field: "History" },
      { position: 3, field: "History" }
    ];
    for (const t of outside) {
      expect((await patch(b, "/api/me", { ...form, ...t })).status, JSON.stringify(t)).toBe(400);
    }
    // The last answer of each list is taken, and opens no box.
    const ok = await patch(b, "/api/me", { ...form, position: "Prefer Not to Respond", field: "Prefer Not to Respond" });
    expect(ok.status).toBe(200);
    expect((await b.json("/api/me")).data).toMatchObject({
      position: "Prefer Not to Respond",
      field: "Prefer Not to Respond",
      positionOther: null,
      fieldOther: null
    });
  });

  it("F4. Other with an empty box is refused, and a typed Other is one clean line beside the answer", async () => {
    const b = new Browser(world);
    await b.signIn("f4@example.org");
    const form = { ...BASE, commentary: "No", field: "History" };
    const refused = [
      { position: "Other" },
      { position: "Other", positionOther: "" },
      { position: "Other", positionOther: "   " },
      { position: "Other", positionOther: "\u0000\t\r" },
      { position: "Other", positionOther: "...." },
      { position: "Other", positionOther: "​​" },
      { position: "Other", positionOther: 5 },
      { position: "Other", positionOther: null },
      { position: "Other", positionOther: ["Engineer"] },
      { position: "Other", positionOther: "x".repeat(101) }
    ];
    for (const t of refused) {
      const r = await patch(b, "/api/me", { ...form, ...t });
      expect(r.status, JSON.stringify(t)).toBe(400);
      expect(r.data.fields.positionOther, JSON.stringify(t)).toBeTruthy();
    }
    expect((await b.json("/api/me")).data).toMatchObject({ finished: false, position: null, positionOther: null });

    // What is typed is made one clean line, and stands beside the answer.
    const ok = await patch(b, "/api/me", { ...form, position: "Other", positionOther: "  Research\n\tsoftware \u0000 engineer  " });
    expect(ok.status).toBe(200);
    expect((await b.json("/api/me")).data).toMatchObject({ position: "Other", positionOther: "Research software engineer" });
    expect((await profileOf(b)).position_other).toBe("Research software engineer");

    // A box of exactly the length allowed is taken.
    expect((await patch(b, "/api/me", { ...form, position: "Other", positionOther: "e".repeat(100) })).status).toBe(200);

    // An answer that is not Other empties the box, even when a box is sent.
    expect((await patch(b, "/api/me", { ...form, position: "Professor", positionOther: "still here" })).status).toBe(200);
    expect((await b.json("/api/me")).data).toMatchObject({ position: "Professor", positionOther: null });
    expect((await profileOf(b)).position_other).toBe(null);

    // The field has its own box, and it works the same way.
    expect((await patch(b, "/api/me", { ...form, position: "Professor", field: "Other" })).status).toBe(400);
    const okField = await patch(b, "/api/me", { ...form, position: "Professor", field: "Other", fieldOther: "Area  studies" });
    expect(okField.status).toBe(200);
    expect((await b.json("/api/me")).data).toMatchObject({ field: "Other", fieldOther: "Area studies" });
  });
});

describe("Batch 4, A1. Research interests", () => {
  it("F5. one line, not required, of at most 200 characters, and nothing but text", async () => {
    const b = await member("f5@example.org");
    expect((await b.json("/api/me")).data.interests).toBe(null);
    const form = { position: "Professor", field: "History", commentary: "No" };

    for (const bad of ["x".repeat(201), 5, ["a"], { a: 1 }, true]) {
      const r = await patch(b, "/api/me", { ...form, interests: bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.data.fields.interests).toBeTruthy();
    }
    expect((await b.json("/api/me")).data.interests).toBe(null);

    const ok = await patch(b, "/api/me", { ...form, interests: "  the radical\n\tright  in  Europe \u0000 " });
    expect(ok.status).toBe(200);
    expect((await b.json("/api/me")).data.interests).toBe("the radical right in Europe");

    expect((await patch(b, "/api/me", { ...form, interests: "y".repeat(200) })).status).toBe(200);
    expect((await b.json("/api/me")).data.interests).toBe("y".repeat(200));

    // It can be emptied again, since it was never required.
    expect((await patch(b, "/api/me", { ...form, interests: "   " })).status).toBe(200);
    expect((await b.json("/api/me")).data.interests).toBe(null);
  });
});

describe("Batch 4, A4. An account from before", () => {
  it("F6. the migration only adds columns and takes nothing away", async () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith("0007"));
    expect(m).toBeTruthy();
    expect(m.queries.length).toBe(5);
    // Every step of it adds one column to the profile and nothing else.
    const steps = m.queries.map((q) => q.split("\n").filter((l) => !l.trim().startsWith("--")).join(" ").trim());
    for (const q of steps) expect(q).toMatch(/^alter\s+table\s+"profile"\s+add\s+column\s+"\w+"\s+text$/i);
  });

  it("F7. an account from before is asked once and only once, loses nothing, and is asked for the new answers alone", async () => {
    const b = await member("f7@example.org", {
      firstName: "Ada", middleName: "King", surname: "Lovelace",
      position: "Professor", field: "History", commentary: "No", interests: "Populism in the Caucasus"
    });
    const before = (await b.json("/api/me")).data;
    const id = await idOf(b);
    expect((await post(b, "/api/pages", { title: "Kept page", body: "my words", words: "" })).status).toBe(201);

    // The account as it stood before batch 4: no answers of the new form.
    await env.DB.prepare(
      "UPDATE profile SET commentary = NULL, commentary_at = NULL, interests = NULL, position = NULL, field = NULL WHERE user_id = ?"
    ).bind(id).run();

    const asked = (await b.json("/api/me")).data;
    expect(asked).toMatchObject({ finished: true, needsAnswers: true, commentary: null, position: null, field: null });
    // It is asked, and meanwhile it loses nothing and is still a member.
    expect(asked.institution).toBe(before.institution);
    expect(asked.surname).toBe("Lovelace");
    expect((await b.json("/api/pages")).data.pages.map((p) => p.title)).toEqual(["Kept page"]);

    // Only the new answers are sent; nothing else of the account is asked again.
    const r = await patch(b, "/api/me", {
      position: "Student", field: "Sociology", commentary: "Yes", interests: "Populism in the Caucasus"
    });
    expect(r.status).toBe(200);
    const after = (await b.json("/api/me")).data;
    expect(after).toMatchObject({
      finished: true, needsAnswers: false, commentary: "Yes",
      position: "Student", field: "Sociology", interests: "Populism in the Caucasus",
      firstName: "Ada", middleName: "King", surname: "Lovelace", name: "Ada King Lovelace"
    });
    expect(after.institution).toBe(before.institution);
    expect(after.since).toBe(before.since);
    expect((await b.json("/api/pages")).data.pages.map((p) => p.title)).toEqual(["Kept page"]);

    // A second sign-in, in another browser, asks nothing.
    const again = new Browser(world);
    await again.signIn("f7@example.org");
    expect((await again.json("/api/me")).data).toMatchObject({ needsAnswers: false, commentary: "Yes" });
  });

  it("F8. a guest is never asked, and cannot answer", async () => {
    const g = new Browser(world);
    expect((await g.guest()).status).toBe(200);
    const me = (await g.json("/api/me")).data;
    expect(me).toMatchObject({ guest: true, needsAnswers: false, commentary: null, interests: null, position: null, field: null });
    expect((await patch(g, "/api/me", { commentary: "Yes", position: "Professor", field: "History" })).status).toBe(403);
    expect((await g.json("/api/me")).data.commentary).toBe(null);
  });
});

describe("Batch 4, A5. The editor's side", () => {
  it("F9. the desk counts the answers and lists everyone who said Yes or Maybe Later", async () => {
    await member("y1@example.org", {
      firstName: "Ada", surname: "Lovelace", commentary: "Yes",
      position: "Other", positionOther: "Research software engineer", field: "History",
      interests: "The radical right in Europe"
    });
    await member("m1@example.org", {
      firstName: "Bo", surname: "Nilsson", commentary: "Maybe Later",
      position: "Student", field: "Other", fieldOther: "Area studies"
    });
    await member("no1@example.org", { commentary: "No" });
    const ed = await member(EDITOR, { commentary: "No" });

    const s = (await ed.json("/api/desk/summary")).data;
    const counted = Object.fromEntries(s.commentary.map((r) => [r.value, r.n]));
    expect(counted).toMatchObject({ Yes: 1, "Maybe Later": 1, No: 2 });
    expect(s.commentaryUnanswered).toBe(0);
    expect(s.writers.map((x) => x.email).sort()).toEqual(["m1@example.org", "y1@example.org"]);
    expect(s.writers.find((x) => x.email === "y1@example.org")).toMatchObject({
      answer: "Yes", name: "Ada Lovelace", institution: "University of Genoa", country: "IT",
      position: "Other", positionOther: "Research software engineer",
      field: "History", fieldOther: null, interests: "The radical right in Europe"
    });
    expect(s.writers.find((x) => x.email === "m1@example.org")).toMatchObject({
      answer: "Maybe Later", field: "Other", fieldOther: "Area studies", interests: null
    });
    // Nobody who said No stands on the list.
    expect(JSON.stringify(s.writers)).not.toContain("no1@example.org");

    // An account from before is counted as unanswered, and nowhere else.
    const old = await member("old1@example.org", { commentary: "No" });
    await env.DB.prepare("UPDATE profile SET commentary = NULL WHERE user_id = ?").bind(await idOf(old)).run();
    const s2 = (await ed.json("/api/desk/summary")).data;
    expect(s2.commentaryUnanswered).toBe(1);
    expect(JSON.stringify(s2.writers)).not.toContain("old1@example.org");
  });

  it("F10. the download of accounts carries the new columns, and a typed Other stays plain text in a spreadsheet", async () => {
    await member("d1@example.org", {
      firstName: "Ada", surname: "Lovelace", commentary: "Yes",
      position: "Other", positionOther: "Research software engineer",
      field: "Other", fieldOther: "Area studies", interests: "The radical right in Europe"
    });
    await member("d2@example.org", {
      commentary: "Maybe Later", position: "Other", positionOther: '=HYPERLINK("http://evil.example","x")',
      field: "History", interests: "@SUM(A1:A9)"
    });
    const ed = await member(EDITOR, { commentary: "No" });
    const csv = (await (await ed.fetch("/api/desk/accounts.csv")).text()).replace(/^﻿/, "");
    const head = csv.split("\r\n")[0].split(",");
    // The first four columns stay where the earlier rounds put them.
    expect(head.slice(0, 5)).toEqual(["first_name", "middle_name", "surname", "email", "institution"]);
    for (const col of ["position", "position_other", "field", "field_other", "research_interests", "write_for_commentary", "commentary_answered"]) {
      expect(head, col).toContain(col);
    }
    expect(csv).toContain("Research software engineer");
    expect(csv).toContain("Area studies");
    expect(csv).toContain("The radical right in Europe");
    // A formula typed into a box, or into the research interests, is text.
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).not.toMatch(/(^|,)@SUM/m);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    // Every row has as many cells as the head.
    const cells = (row) => {
      const out = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (q) {
          if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; }
          else if (ch === '"') q = false;
          else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    };
    const rows = csv.trim().split("\r\n").map(cells);
    expect(rows.every((r) => r.length === head.length)).toBe(true);
  });

  it("F11. the desk still shows nothing anyone keeps or writes", async () => {
    const ada = await member("w1@example.org", { commentary: "Yes", interests: "The radical right in Europe" });
    await post(ada, "/api/pages", { title: "A SECRET PAGE", body: "SECRET WORDS", words: "SECRET WORDS" });
    await post(ada, "/api/keep/note", {
      kind: "work", ref: "SECRETREF", title: "A work", extra: "", year: "2020", body: "A SECRET NOTE"
    });
    const ed = await member(EDITOR, { commentary: "No" });
    const words = JSON.stringify((await ed.json("/api/desk/summary")).data);
    for (const secret of ["A SECRET PAGE", "SECRET WORDS", "A SECRET NOTE", "SECRETREF"]) {
      expect(words, secret).not.toContain(secret);
    }
    const csv = await (await ed.fetch("/api/desk/accounts.csv")).text();
    for (const secret of ["A SECRET PAGE", "SECRET WORDS", "A SECRET NOTE", "SECRETREF"]) {
      expect(csv, secret).not.toContain(secret);
    }
  });

  it("F12. Download Everything carries the new answers", async () => {
    const b = await member("dl@example.org", {
      firstName: "Ada", surname: "Lovelace", commentary: "Yes",
      position: "Other", positionOther: "Research software engineer",
      field: "History", interests: "The radical right in Europe"
    });
    const res = await b.fetch("/api/me/export");
    expect(res.status).toBe(200);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const account = JSON.parse(strFromU8(zip["account.json"]));
    expect(account).toMatchObject({
      position: "Other", position_other: "Research software engineer",
      field: "History", field_other: null,
      research_interests: "The radical right in Europe",
      write_for_commentary: "Yes"
    });
    expect(account.write_for_commentary_answered).toBeTruthy();

    // A guest has no answers to download, and the file is still made.
    const g = new Browser(world);
    await g.guest();
    const gz = unzipSync(new Uint8Array(await (await g.fetch("/api/me/export")).arrayBuffer()));
    expect(JSON.parse(strFromU8(gz["account.json"]))).toMatchObject({ guest: true });
  });

  it("F13. the account page can change every answer of the form, and keeps them", async () => {
    const b = await member("ap@example.org", { commentary: "No" });
    const ok = await patch(b, "/api/me", {
      firstName: "Ada", middleName: "King", surname: "Lovelace",
      institution: "Free University", country: "DE",
      position: "Other", positionOther: "Research software engineer",
      field: "Other", fieldOther: "Area studies",
      interests: "The radical right in Europe", commentary: "Maybe Later"
    });
    expect(ok.status).toBe(200);
    expect((await b.json("/api/me")).data).toMatchObject({
      name: "Ada King Lovelace", institution: "Free University", country: "DE",
      position: "Other", positionOther: "Research software engineer",
      field: "Other", fieldOther: "Area studies",
      interests: "The radical right in Europe", commentary: "Maybe Later", needsAnswers: false
    });
  });
});
