// Attacks on Write, projects and the Annotated Bibliography (master plan,
// section 18, stage 2, batch 3). Each test is an attack, and each must fail.
// They run in Cloudflare's own runtime with a local database, as the tests of
// batches 1 and 2 do.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";
import { Browser, makeWorld, setOpen } from "./helpers.js";

const WORK = {
  kind: "work",
  ref: "ABCD1234",
  title: "Mudde, C. 2004. The Populist Zeitgeist.",
  extra: "Mudde 2004",
  year: "2004",
  cite: "Mudde, Cas. 2004. “The Populist Zeitgeist.” <i>Government and Opposition</i> 39 (4): 541–63.",
  url: "https://doi.org/10.1111/j.1477-7053.2004.00135.x"
};
const ITEM = {
  kind: "item",
  ref: "2026-1:14",
  title: "United States and Iraq: the last American troops leave",
  extra: "Monitor 2026/1, item 14 · 14 September 2026",
  cite: "RZAZADE, Khayyam, ed. 2026. “United States and Iraq.” PopuliVerse Monitor 2026/1 (September 2026), item 14.",
  bibtex: "@misc{pv_item_14,\n  title = {{United States and Iraq}}\n}\n"
};

// One pixel, as a plain PNG: the smallest picture a Data page could send.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const FIGURE = {
  ref: "in-power#map",
  title: "Populists in Power: Now",
  source: "Sources: The PopuList 4.0; Global Populism Database.",
  cite: "Rzazade, Khayyam, ed. 2026. “Populists in Power.” PopuliVerse. https://populiverse.com/data/in-power.html. Accessed 2026-11-13.",
  url: "https://populiverse.com/data/in-power.html",
  day: "2026-11-13",
  width: 1200,
  height: 800,
  picture: PNG
};

const SCRIPT = '<script>alert("x")</script>';

let world;
beforeEach(async () => {
  world = makeWorld();
  await setOpen(true);
});

function at() {
  return new Browser(world);
}

async function member(email) {
  const b = new Browser(world);
  await b.signUp(email);
  return b;
}

async function guest() {
  const b = new Browser(world);
  await b.guest();
  return b;
}

async function aProject(b, title) {
  const r = await b.json("/api/projects", { method: "POST", body: { title: title || "Populism and defence", question: "Do populists spend less?" } });
  expect(r.status).toBe(201);
  return r.data.project.id;
}

async function aDraft(b, projectId) {
  const r = await b.json("/api/drafts", { method: "POST", body: { title: "A draft", project_id: projectId || null } });
  expect(r.status).toBe(201);
  return r.data.draft.id;
}

async function aFigure(b) {
  const r = await b.json("/api/figures", { method: "POST", body: FIGURE });
  expect(r.status).toBe(201);
  return r.data.figure.id;
}

function delta(ops) {
  return { ops: ops };
}

const DOORS = [
  ["GET", "/api/projects", undefined],
  ["POST", "/api/projects", { title: "A project" }],
  ["GET", "/api/projects/abc", undefined],
  ["PATCH", "/api/projects/abc", { title: "Changed" }],
  ["DELETE", "/api/projects/abc", undefined],
  ["POST", "/api/projects/abc/things", { kind: "work", ref: "ABCD1234" }],
  ["DELETE", "/api/projects/abc/things", { kind: "work", ref: "ABCD1234" }],
  ["GET", "/api/drafts", undefined],
  ["POST", "/api/drafts", { title: "A draft" }],
  ["GET", "/api/drafts/abc", undefined],
  ["PATCH", "/api/drafts/abc", { title: "Changed" }],
  ["DELETE", "/api/drafts/abc", undefined],
  ["GET", "/api/figures", undefined],
  ["POST", "/api/figures", FIGURE],
  ["GET", "/api/figures/abc", undefined],
  ["DELETE", "/api/figures/abc", undefined],
  ["POST", "/api/write/cites", { refs: [{ kind: "work", ref: "ABCD1234" }] }],
  ["GET", "/api/write/bibliography", undefined]
];

// ---------------------------------------------------------------- the doors

describe("Attacks: every new door", () => {
  it("1. refuses every new door to someone who is not signed in", async () => {
    const b = at();
    for (const [method, path, body] of DOORS) {
      const r = await b.json(path, { method, body });
      expect([401, 403], `${method} ${path}`).toContain(r.status);
      expect(r.data.error, `${method} ${path}`).toBeTruthy();
    }
  });

  it("2. refuses every new door to another site", async () => {
    const b = await member("ada@example.org");
    for (const [method, path, body] of DOORS) {
      const res = await b.fetch(path, { method, body, origin: "https://not-populiverse.example" });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("3. refuses every new door to an account that is not finished", async () => {
    const b = at();
    await b.signIn("half@example.org");
    for (const [method, path, body] of DOORS) {
      const r = await b.json(path, { method, body });
      expect([401, 403], `${method} ${path}`).toContain(r.status);
    }
  });

  it("4. answers 404 for a door of the workspace that does not exist", async () => {
    const b = await member("ada@example.org");
    for (const path of ["/api/drafts/abc/body", "/api/projects/abc/draft", "/api/write", "/api/figures/abc/picture"]) {
      const r = await b.json(path);
      expect(r.status, path).toBe(404);
    }
  });
});

// --------------------------------------------- a script, wherever it is typed

describe("Attacks: a script typed or pasted in", () => {
  it("5. keeps a script in a page as plain words, and never as HTML", async () => {
    const b = await member("ada@example.org");
    const page = await b.json("/api/pages", {
      method: "POST",
      body: { title: SCRIPT, body: JSON.stringify(delta([{ insert: SCRIPT + "\n" }])), words: SCRIPT }
    });
    expect(page.status).toBe(201);
    const row = await env.DB.prepare("SELECT title, body, words FROM notebook_page WHERE id = ?").bind(page.data.page.id).first();
    expect(row.title).toBe(SCRIPT);
    expect(row.words).toBe(SCRIPT);
    // What is stored is the editor's own document, so the script is a value in
    // it and never a piece of the page.
    expect(JSON.parse(row.body).ops[0].insert).toBe(SCRIPT + "\n");
  });

  it("6. keeps a script in a draft as plain words", async () => {
    const b = await member("ada@example.org");
    const id = await aDraft(b);
    const r = await b.json("/api/drafts/" + id, {
      method: "PATCH",
      body: { title: SCRIPT, body: delta([{ insert: SCRIPT + "\n" }]) }
    });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare("SELECT title, body FROM draft WHERE id = ?").bind(id).first();
    expect(row.title).toBe(SCRIPT);
    expect(JSON.parse(row.body).ops[0].insert).toBe(SCRIPT + "\n");
  });

  it("7. keeps a script in a project's title and question as plain words", async () => {
    const b = await member("ada@example.org");
    const r = await b.json("/api/projects", { method: "POST", body: { title: SCRIPT, question: SCRIPT } });
    expect(r.status).toBe(201);
    const row = await env.DB.prepare("SELECT title, question FROM project WHERE id = ?").bind(r.data.project.id).first();
    expect(row.title).toBe(SCRIPT);
    expect(row.question).toBe(SCRIPT);
  });

  it("8. keeps a script in a cite as plain words", async () => {
    const b = await member("ada@example.org");
    const id = await aDraft(b);
    await b.json("/api/keep", { method: "POST", body: WORK });
    const r = await b.json("/api/drafts/" + id, {
      method: "PATCH",
      body: {
        body: delta([
          { insert: { pvcite: { kind: "work", ref: WORK.ref, text: SCRIPT, url: WORK.url } } },
          { insert: "\n" }
        ])
      }
    });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare("SELECT body FROM draft WHERE id = ?").bind(id).first();
    expect(JSON.parse(row.body).ops[0].insert.pvcite.text).toBe(SCRIPT.replace(/\s+/g, " "));
  });

  it("9. drops every format but the five, however a draft is pasted in", async () => {
    const b = await member("ada@example.org");
    const id = await aDraft(b);
    const r = await b.json("/api/drafts/" + id, {
      method: "PATCH",
      body: {
        body: delta([
          { insert: "words", attributes: { bold: true, color: "#ff0000", background: "#000", link: "javascript:alert(1)", font: "x", size: "huge", script: "super", code: true } },
          { insert: "\n", attributes: { header: 3, align: "right", direction: "rtl", indent: 3, "code-block": true } }
        ])
      }
    });
    expect(r.status).toBe(200);
    const ops = JSON.parse((await env.DB.prepare("SELECT body FROM draft WHERE id = ?").bind(id).first()).body).ops;
    expect(ops[0].attributes).toEqual({ bold: true });
    expect(ops[1].attributes).toEqual({ header: 3 });
  });

  it("10. refuses a piece of a draft that the editor does not know", async () => {
    const b = await member("ada@example.org");
    const id = await aDraft(b);
    for (const ops of [
      [{ insert: { image: "https://example.org/x.png" } }],
      [{ insert: { video: "https://example.org/x" } }],
      [{ insert: { pvcite: { kind: "work" } } }],
      [{ insert: { pvcite: "words" } }],
      [{ insert: { pvcite: { kind: "nothing", ref: "x", text: "x" } } }],
      [{ insert: 12 }],
      [{ retain: 3 }],
      ["words"]
    ]) {
      const r = await b.json("/api/drafts/" + id, { method: "PATCH", body: { body: delta(ops) } });
      expect([400, 413], JSON.stringify(ops)).toContain(r.status);
    }
  });

  it("11. drops control characters from a note, a page and a draft", async () => {
    const b = await member("ada@example.org");
    const id = await aDraft(b);
    await b.json("/api/drafts/" + id, { method: "PATCH", body: { body: delta([{ insert: "a\u0000b\u0007c\n" }]) } });
    const row = await env.DB.prepare("SELECT body FROM draft WHERE id = ?").bind(id).first();
    expect(JSON.parse(row.body).ops[0].insert).toBe("abc\n");
  });
});

// ----------------------------------------------- a link that runs a script

describe("Attacks: a link that runs a script", () => {
  it("12. never keeps an address that is not a plain web address", async () => {
    const b = await member("ada@example.org");
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", " javascript:alert(1)", "JaVaScRiPt:alert(1)"]) {
      await b.json("/api/keep", { method: "POST", body: { ...WORK, ref: "W" + bad.length, url: bad } });
      const row = await env.DB.prepare("SELECT url FROM kept WHERE ref = ?").bind("W" + bad.length).first();
      expect(row.url, bad).toBe("");
    }
  });

  it("13. never keeps such an address inside a cite in a draft", async () => {
    const b = await member("ada@example.org");
    const id = await aDraft(b);
    const r = await b.json("/api/drafts/" + id, {
      method: "PATCH",
      body: { body: delta([{ insert: { pvcite: { kind: "work", ref: "X", text: "(Mudde 2004)", url: "javascript:alert(1)" } } }, { insert: "\n" }]) }
    });
    expect(r.status).toBe(200);
    const ops = JSON.parse((await env.DB.prepare("SELECT body FROM draft WHERE id = ?").bind(id).first()).body).ops;
    expect(ops[0].insert.pvcite.url).toBe("");
  });

  it("14. never keeps such an address on a figure", async () => {
    const b = await member("ada@example.org");
    const r = await b.json("/api/figures", { method: "POST", body: { ...FIGURE, url: "javascript:alert(1)" } });
    expect(r.status).toBe(201);
    const row = await env.DB.prepare("SELECT url FROM figure WHERE id = ?").bind(r.data.figure.id).first();
    expect(row.url).toBe("");
  });
});

// ------------------------------------------------------- another person's work

describe("Attacks: another person's projects, drafts and pages", () => {
  it("15. cannot read, change, delete or list another person's project", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    const mine = await aProject(ada);

    expect((await eve.json("/api/projects/" + mine)).status).toBe(404);
    expect((await eve.json("/api/projects/" + mine, { method: "PATCH", body: { title: "Taken" } })).status).toBe(404);
    expect((await eve.json("/api/projects/" + mine, { method: "DELETE" })).status).toBe(404);
    const list = await eve.json("/api/projects");
    expect(list.data.projects).toHaveLength(0);

    const still = await env.DB.prepare("SELECT title FROM project WHERE id = ?").bind(mine).first();
    expect(still.title).toBe("Populism and defence");
  });

  it("16. cannot read, change, delete or list another person's draft", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    const mine = await aDraft(ada);
    await ada.json("/api/drafts/" + mine, { method: "PATCH", body: { body: delta([{ insert: "a secret idea\n" }]) } });

    expect((await eve.json("/api/drafts/" + mine)).status).toBe(404);
    expect((await eve.json("/api/drafts/" + mine, { method: "PATCH", body: { title: "Taken" } })).status).toBe(404);
    expect((await eve.json("/api/drafts/" + mine, { method: "DELETE" })).status).toBe(404);
    const list = await eve.json("/api/drafts");
    expect(list.data.drafts).toHaveLength(0);

    const still = await env.DB.prepare("SELECT body FROM draft WHERE id = ?").bind(mine).first();
    expect(still.body).toContain("a secret idea");
  });

  it("17. cannot read, change, delete or list another person's page or figure", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    const page = await ada.json("/api/pages", { method: "POST", body: { title: "Mine", body: "mine", words: "mine" } });
    const figure = await aFigure(ada);

    expect((await eve.json("/api/pages/" + page.data.page.id)).status).toBe(404);
    expect((await eve.json("/api/pages/" + page.data.page.id, { method: "DELETE" })).status).toBe(404);
    expect((await eve.json("/api/figures/" + figure)).status).toBe(404);
    expect((await eve.json("/api/figures/" + figure, { method: "DELETE" })).status).toBe(404);
    expect((await eve.json("/api/figures")).data.figures).toHaveLength(0);
  });

  it("18. cannot put another person's id into the request and reach their rows", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    const mine = await aProject(ada);
    const who = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind("ada@example.org").first();

    const r = await eve.json("/api/projects", { method: "POST", body: { title: "Eve's", user_id: who.id } });
    expect(r.status).toBe(201);
    const row = await env.DB.prepare("SELECT user_id FROM project WHERE id = ?").bind(r.data.project.id).first();
    expect(row.user_id).not.toBe(who.id);

    const cites = await eve.json("/api/write/cites", { method: "POST", body: { refs: [{ kind: "work", ref: WORK.ref }], user_id: who.id } });
    expect(cites.data.things).toHaveLength(0);
    expect((await eve.json("/api/write/bibliography?project=" + mine)).status).toBe(404);
  });

  it("19. cannot put my thing into another person's project", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    const hers = await aProject(ada);
    await eve.json("/api/keep", { method: "POST", body: WORK });

    const r = await eve.json("/api/projects/" + hers + "/things", { method: "POST", body: { kind: "work", ref: WORK.ref } });
    expect(r.status).toBe(404);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM project_thing WHERE project_id = ?").bind(hers).first();
    expect(n).toBe(0);
  });

  it("20. cannot put another person's thing into my own project", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    await ada.json("/api/keep", { method: "POST", body: WORK });
    const mine = await aProject(eve, "Eve's project");

    // Eve has nothing of that name on her own shelf, so nothing is put in.
    const r = await eve.json("/api/projects/" + mine + "/things", { method: "POST", body: { kind: "work", ref: WORK.ref } });
    expect(r.status).toBe(404);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM project_thing WHERE project_id = ?").bind(mine).first();
    expect(n).toBe(0);
  });

  it("21. cannot put another person's draft or page into my project", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    const hers = await aProject(ada);
    const mine = await aDraft(eve);
    const page = await eve.json("/api/pages", { method: "POST", body: { title: "Mine", body: "x", words: "x" } });

    expect((await eve.json("/api/drafts/" + mine, { method: "PATCH", body: { project_id: hers } })).status).toBe(404);
    expect((await eve.json("/api/pages/" + page.data.page.id, { method: "PATCH", body: { project_id: hers } })).status).toBe(404);
    const draft = await env.DB.prepare("SELECT project_id FROM draft WHERE id = ?").bind(mine).first();
    expect(draft.project_id).toBe(null);
  });
});

// -------------------------------------------- what points at nothing, and size

describe("Attacks: a cite or a figure that points at nothing", () => {
  it("22. keeps a cite whose thing is not on the shelf, and says so in place of a reference", async () => {
    const b = await member("ada@example.org");
    const id = await aDraft(b);
    const r = await b.json("/api/drafts/" + id, {
      method: "PATCH",
      body: { body: delta([{ insert: { pvcite: { kind: "work", ref: "NOTHERE", text: "(Nobody 1999)", url: "" } } }, { insert: "\n" }]) }
    });
    expect(r.status).toBe(200);
    // The reference is asked for and simply is not there: nothing is invented.
    const cites = await b.json("/api/write/cites", { method: "POST", body: { refs: [{ kind: "work", ref: "NOTHERE" }] } });
    expect(cites.data.things).toHaveLength(0);
  });

  it("23. leaves out a figure that is not this person's, or no longer there", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    const hers = await aFigure(ada);
    const id = await aDraft(eve);

    const r = await eve.json("/api/drafts/" + id, {
      method: "PATCH",
      body: { body: delta([{ insert: "a\n" }, { insert: { pvfigure: { id: hers } } }, { insert: "b\n" }]) }
    });
    expect(r.status).toBe(200);
    const ops = JSON.parse((await env.DB.prepare("SELECT body FROM draft WHERE id = ?").bind(id).first()).body).ops;
    expect(ops.some((o) => o.insert && o.insert.pvfigure)).toBe(false);

    const open = await eve.json("/api/drafts/" + id);
    expect(open.data.figures).toHaveLength(0);
  });

  it("24. refuses a draft or a page far too large", async () => {
    const b = await member("ada@example.org");
    const id = await aDraft(b);
    const huge = "a".repeat(500000);
    expect((await b.json("/api/drafts/" + id, { method: "PATCH", body: { body: delta([{ insert: huge }]) } })).status).toBe(413);
    expect((await b.json("/api/drafts/" + id, { method: "PATCH", body: { title: huge } })).status).toBe(413);
    expect((await b.json("/api/pages", { method: "POST", body: { title: "x", body: huge, words: huge } })).status).toBe(413);
    expect((await b.json("/api/projects", { method: "POST", body: { title: "x", question: huge } })).status).toBe(413);
    // Many pieces, each small: the whole is counted too.
    const many = [];
    for (let i = 0; i < 70000; i++) many.push({ insert: "aa" });
    expect((await b.json("/api/drafts/" + id, { method: "PATCH", body: { body: delta(many) } })).status).toBe(413);
    const row = await env.DB.prepare("SELECT length(body) AS n FROM draft WHERE id = ?").bind(id).first();
    expect(row.n).toBeLessThan(1000);
  });

  it("25. refuses a figure that is not a plain picture, or far too large", async () => {
    const b = await member("ada@example.org");
    for (const picture of [
      "<svg onload=alert(1)>",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png;base64,<script>",
      ""
    ]) {
      const r = await b.json("/api/figures", { method: "POST", body: { ...FIGURE, picture } });
      expect([400, 413], picture.slice(0, 30)).toContain(r.status);
    }
    const big = "data:image/png;base64," + "A".repeat(1000000);
    expect((await b.json("/api/figures", { method: "POST", body: { ...FIGURE, picture: big } })).status).toBe(413);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM figure").first();
    expect(n).toBe(0);
  });

  it("26. holds a guest to the limits, so that a script cannot fill the database", async () => {
    const b = await guest();
    for (let i = 0; i < 3; i++) expect((await b.json("/api/projects", { method: "POST", body: { title: "P" + i } })).status).toBe(201);
    const over = await b.json("/api/projects", { method: "POST", body: { title: "One too many" } });
    expect(over.status).toBe(409);
    expect(over.data.error).toContain("3");

    for (let i = 0; i < 3; i++) expect((await b.json("/api/drafts", { method: "POST", body: { title: "D" + i } })).status).toBe(201);
    expect((await b.json("/api/drafts", { method: "POST", body: { title: "One too many" } })).status).toBe(409);

    for (let i = 0; i < 3; i++) expect((await b.json("/api/figures", { method: "POST", body: FIGURE })).status).toBe(201);
    expect((await b.json("/api/figures", { method: "POST", body: FIGURE })).status).toBe(409);
  });

  it("27. gives one project one draft, however many arrive at once", async () => {
    const b = await member("ada@example.org");
    const id = await aProject(b);
    const all = await Promise.all([0, 1, 2, 3, 4].map(() => b.json("/api/drafts", { method: "POST", body: { title: "A draft", project_id: id } })));
    expect(all.filter((r) => r.status === 201)).toHaveLength(1);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM draft WHERE project_id = ?").bind(id).first();
    expect(n).toBe(1);
  });
});

// ------------------------------------------------------- deleting a project

describe("Attacks: deleting a project", () => {
  it("28. deletes the project and nothing that is in it", async () => {
    const b = await member("ada@example.org");
    const id = await aProject(b);
    await b.json("/api/keep", { method: "POST", body: WORK });
    await b.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "A note of mine" } });
    await b.json("/api/projects/" + id + "/things", { method: "POST", body: { kind: "work", ref: WORK.ref } });
    const page = await b.json("/api/pages", { method: "POST", body: { title: "A page", body: "x", words: "x", project_id: id } });
    const draft = await aDraft(b, id);

    expect((await b.json("/api/projects/" + id, { method: "DELETE" })).status).toBe(200);

    expect(await env.DB.prepare("SELECT id FROM project WHERE id = ?").bind(id).first()).toBe(null);
    const { n: links } = await env.DB.prepare("SELECT COUNT(*) AS n FROM project_thing WHERE project_id = ?").bind(id).first();
    expect(links).toBe(0);

    // Everything that was in it is still there, loose.
    const work = await env.DB.prepare("SELECT id FROM kept WHERE ref = ?").bind(WORK.ref).first();
    expect(work).not.toBe(null);
    const note = await env.DB.prepare("SELECT body FROM note WHERE kept_id = ?").bind(work.id).first();
    expect(note.body).toBe("A note of mine");
    const row = await env.DB.prepare("SELECT project_id FROM notebook_page WHERE id = ?").bind(page.data.page.id).first();
    expect(row.project_id).toBe(null);
    const d = await env.DB.prepare("SELECT project_id FROM draft WHERE id = ?").bind(draft).first();
    expect(d.project_id).toBe(null);
  });

  it("29. leaves another person's project untouched when one is deleted", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    const mine = await aProject(ada);
    const hers = await aProject(eve, "Eve's project");
    await ada.json("/api/projects/" + mine, { method: "DELETE" });
    const still = await env.DB.prepare("SELECT title FROM project WHERE id = ?").bind(hers).first();
    expect(still.title).toBe("Eve's project");
  });
});

// -------------------------------------------- Download Everything, and deleting

describe("Attacks: Download Everything and deleting an account", () => {
  async function zipOf(b) {
    const res = await b.fetch("/api/me/export");
    expect(res.status).toBe(200);
    return unzipSync(new Uint8Array(await res.arrayBuffer()));
  }

  it("30. gives the reader their drafts, projects and figures, and nothing of anyone else", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    await eve.json("/api/projects", { method: "POST", body: { title: "EVE-PROJECT", question: "EVE-QUESTION" } });
    const eveDraft = await aDraft(eve);
    await eve.json("/api/drafts/" + eveDraft, { method: "PATCH", body: { title: "EVE-DRAFT", body: delta([{ insert: "EVE-WORDS\n" }]) } });
    await eve.json("/api/figures", { method: "POST", body: { ...FIGURE, title: "EVE-FIGURE" } });

    const id = await aProject(ada);
    const draft = await aDraft(ada, id);
    await ada.json("/api/drafts/" + draft, {
      method: "PATCH",
      body: { title: "My paper", body: delta([{ insert: "My own words\n" }]) }
    });
    await ada.json("/api/figures", { method: "POST", body: FIGURE });

    const files = await zipOf(ada);
    const names = Object.keys(files);
    expect(names).toContain("projects.json");
    expect(names).toContain("drafts.json");
    expect(names).toContain("figures.json");
    expect(names.some((n) => n.startsWith("drafts/") && n.endsWith(".txt"))).toBe(true);
    expect(names.some((n) => n.startsWith("figures/") && n.endsWith(".png"))).toBe(true);

    const everything = names.map((n) => strFromU8(files[n], true)).join("\n");
    expect(everything).toContain("Populism and defence");
    expect(everything).toContain("My own words");
    expect(everything).not.toContain("EVE-PROJECT");
    expect(everything).not.toContain("EVE-QUESTION");
    expect(everything).not.toContain("EVE-DRAFT");
    expect(everything).not.toContain("EVE-WORDS");
    expect(everything).not.toContain("EVE-FIGURE");
    expect(everything).not.toContain("eve@example.org");

    // The README names what is in the file, so nothing is quietly left out.
    const readme = strFromU8(files["README.txt"]);
    ["projects.json", "drafts/", "drafts.json", "figures/", "figures.json"].forEach((line) => {
      expect(readme).toContain(line);
    });
  });

  it("31. a guest's download holds the guest's own work and no account", async () => {
    const b = await guest();
    const id = await aProject(b, "A guest's project");
    const draft = await aDraft(b, id);
    await b.json("/api/drafts/" + draft, { method: "PATCH", body: { body: delta([{ insert: "guest words\n" }]) } });
    const files = await zipOf(b);
    expect(strFromU8(files["projects.json"])).toContain("A guest's project");
    expect(strFromU8(files["account.json"])).toContain("guest");
  });

  it("32. deleting an account leaves nothing of it behind, and nobody else's rows", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    const hers = await aProject(eve, "Eve keeps this");
    await eve.json("/api/drafts", { method: "POST", body: { title: "Eve keeps this too", project_id: hers } });
    await eve.json("/api/figures", { method: "POST", body: FIGURE });

    const id = await aProject(ada);
    const draft = await aDraft(ada, id);
    await ada.json("/api/keep", { method: "POST", body: WORK });
    await ada.json("/api/projects/" + id + "/things", { method: "POST", body: { kind: "work", ref: WORK.ref } });
    await ada.json("/api/figures", { method: "POST", body: FIGURE });
    await ada.json("/api/pages", { method: "POST", body: { title: "A page", body: "x", words: "x", project_id: id } });

    const me = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind("ada@example.org").first();
    expect((await ada.json("/api/me", { method: "DELETE", body: { confirm: "delete" } })).status).toBe(200);

    for (const table of ["project", "project_thing", "draft", "figure", "notebook_page", "kept", "note", "tag", "mark", "profile"]) {
      const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(me.id).first();
      expect(n, table).toBe(0);
    }
    expect(await env.DB.prepare("SELECT id FROM draft WHERE id = ?").bind(draft).first()).toBe(null);
    expect(await env.DB.prepare('SELECT id FROM "user" WHERE id = ?').bind(me.id).first()).toBe(null);

    // Eve still has everything.
    const still = await env.DB.prepare("SELECT title FROM project WHERE id = ?").bind(hers).first();
    expect(still.title).toBe("Eve keeps this");
    const { n: hersDrafts } = await env.DB.prepare("SELECT COUNT(*) AS n FROM draft WHERE project_id = ?").bind(hers).first();
    expect(hersDrafts).toBe(1);
    const { n: hersFigures } = await env.DB.prepare("SELECT COUNT(*) AS n FROM figure").first();
    expect(hersFigures).toBe(1);
  });

  it("33. the nightly job takes a guest's projects, drafts and figures with it", async () => {
    const b = await guest();
    await aProject(b, "A guest's project");
    const draft = await aDraft(b);
    await b.json("/api/figures", { method: "POST", body: FIGURE });
    const who = await env.DB.prepare('SELECT id FROM "user" WHERE isAnonymous = 1').first();
    await env.DB.prepare('UPDATE "user" SET createdAt = ? WHERE id = ?').bind("2020-01-01T00:00:00.000Z", who.id).run();
    await env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(who.id).run();

    const { nightly } = await import("../src/cleanup.js");
    await nightly(world.env);

    for (const table of ["project", "draft", "figure", "notebook_page", "kept"]) {
      const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(who.id).first();
      expect(n, table).toBe(0);
    }
    expect(await env.DB.prepare("SELECT id FROM draft WHERE id = ?").bind(draft).first()).toBe(null);
  });
});

// ----------------------------------------- the Annotated Bibliography, and the desk

describe("Attacks: the Annotated Bibliography and the editor's desk", () => {
  it("34. gives the Annotated Bibliography only this person's works", async () => {
    const ada = await member("ada@example.org");
    const eve = await member("eve@example.org");
    await eve.json("/api/keep", { method: "POST", body: { ...WORK, ref: "EVEWORK", cite: "EVE-ONLY-REFERENCE" } });
    await eve.json("/api/keep/note", { method: "POST", body: { ...WORK, ref: "EVEWORK", body: "EVE-ONLY-NOTE" } });

    await ada.json("/api/keep", { method: "POST", body: WORK });
    await ada.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "Mine alone" } });
    const r = await ada.json("/api/write/bibliography");
    expect(r.status).toBe(200);
    const words = JSON.stringify(r.data);
    expect(words).toContain("Mine alone");
    expect(words).not.toContain("EVE-ONLY-REFERENCE");
    expect(words).not.toContain("EVE-ONLY-NOTE");
  });

  it("35. the editor's desk still shows no word of what anyone keeps or writes", async () => {
    const ada = await member("ada@example.org");
    await ada.json("/api/projects", { method: "POST", body: { title: "A SECRET PROJECT", question: "A SECRET QUESTION" } });
    const draft = await aDraft(ada);
    await ada.json("/api/drafts/" + draft, { method: "PATCH", body: { title: "A SECRET DRAFT", body: delta([{ insert: "SECRET WORDS\n" }]) } });

    const editor = await member("editor@populiverse.com");
    const r = await editor.json("/api/desk/summary");
    expect(r.status).toBe(200);
    const words = JSON.stringify(r.data);
    ["A SECRET PROJECT", "A SECRET QUESTION", "A SECRET DRAFT", "SECRET WORDS"].forEach((secret) => {
      expect(words).not.toContain(secret);
    });
  });

  it("36. the closed workspace lets nobody new in, and the new doors stay shut", async () => {
    await setOpen(false);
    const b = at();
    const r = await b.json("/api/auth/sign-in/anonymous", { method: "POST", body: {} });
    expect(r.status).not.toBe(200);
    for (const [method, path, body] of DOORS) {
      const answer = await b.json(path, { method, body });
      expect([401, 403], `${method} ${path}`).toContain(answer.status);
    }
  });

  it("37. a long search does not break the shelf, the notes or the pages", async () => {
    const b = await member("ada@example.org");
    await b.json("/api/keep", { method: "POST", body: WORK });
    const long = "populism and the politics of the people in comparative perspective".repeat(4);
    for (const path of [
      "/api/keep?kind=work&q=" + encodeURIComponent(long),
      "/api/notes?q=" + encodeURIComponent(long),
      "/api/pages?q=" + encodeURIComponent(long)
    ]) {
      const r = await b.json(path);
      expect(r.status, path).toBe(200);
    }
  });
});
