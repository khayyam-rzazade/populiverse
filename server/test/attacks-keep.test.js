// Attacks on what a reader keeps: saved things, notes, tags, reading status and
// marked passages (master plan, section 18, stage 2, batch 2). Each test is an
// attack, and each must fail. They run in Cloudflare's own runtime with a local
// database, as the tests of batch 1 do.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";
import { Browser, makeWorld, setOpen, invite, EDITOR } from "./helpers.js";

const WORK = { kind: "work", ref: "ABCD1234", title: "Mudde, C. (2004). The Populist Zeitgeist.", extra: "Government and Opposition", year: "2004" };
const ITEM = { kind: "item", ref: "2026-1:14", title: "United States and Iraq: the last American troops leave", extra: "Monitor 2026/1, item 14" };

let world;
beforeEach(async () => {
  world = makeWorld();
  await setOpen(true);
});

function at(email) {
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

const DOORS = [
  ["GET", "/api/keep?kind=work", undefined],
  ["POST", "/api/keep/mine", { refs: [{ kind: "work", ref: "ABCD1234" }] }],
  ["POST", "/api/keep", WORK],
  ["DELETE", "/api/keep", { kind: "work", ref: "ABCD1234" }],
  ["POST", "/api/keep/note", { ...WORK, body: "mine" }],
  ["POST", "/api/keep/tag", { ...WORK, add: "theory" }],
  ["POST", "/api/keep/status", { ...WORK, status: "read" }],
  ["POST", "/api/keep/mark", { ...WORK, at: 0, text: "a passage" }],
  ["GET", "/api/notes", undefined]
];

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
      const r = await b.json(path, { method, body, origin: "https://populiverse.com.evil.test" });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  it("3. refuses every new door to an account that is not finished", async () => {
    const b = new Browser(world);
    await b.signIn("half@example.org");
    for (const [method, path, body] of DOORS) {
      const r = await b.json(path, { method, body });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  it("4. answers nothing for a door of the workspace that does not exist", async () => {
    const b = await member("ada@example.org");
    expect((await b.json("/api/keep/all", { method: "GET" })).status).toBe(404);
    expect((await b.json("/api/keep/mine", { method: "GET" })).status).toBe(404);
    expect((await b.json("/api/keep", { method: "PUT", body: WORK })).status).toBe(404);
    expect((await b.json("/api/keep/note", { method: "DELETE", body: WORK })).status).toBe(404);
  });
});

describe("Attacks: another person's things", () => {
  it("5. never shows, changes, deletes or lists another person's things", async () => {
    const ada = await member("ada@example.org");
    await ada.json("/api/keep", { method: "POST", body: WORK });
    await ada.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "Ada's note" } });
    await ada.json("/api/keep/tag", { method: "POST", body: { ...WORK, add: "ada-tag" } });
    await ada.json("/api/keep/mark", { method: "POST", body: { ...WORK, at: 4, text: "Ada's passage" } });

    const bob = await member("bob@example.org");
    // Nothing of Ada's is on Bob's shelf or in his notes.
    const shelf = await bob.json("/api/keep?kind=work");
    expect(shelf.status).toBe(200);
    expect(shelf.data.things).toHaveLength(0);
    expect(shelf.data.counts.work).toBe(0);
    expect((await bob.json("/api/keep/mine", { method: "POST", body: { refs: [{ kind: "work", ref: WORK.ref }] } })).data.things).toHaveLength(0);
    expect((await bob.json("/api/notes")).data.notes).toHaveLength(0);
    // Searching for her words finds nothing.
    expect((await bob.json("/api/keep?kind=work&q=Ada")).data.things).toHaveLength(0);
    expect((await bob.json("/api/notes?q=Ada")).data.notes).toHaveLength(0);
    // Removing hers: not his, so not found.
    expect((await bob.json("/api/keep", { method: "DELETE", body: { kind: "work", ref: WORK.ref } })).status).toBe(404);
    // Taking her tag off, by the same name: nothing of hers changes.
    await bob.json("/api/keep/tag", { method: "POST", body: { ...WORK, remove: "ada-tag" } });
    // Her marked passage, by its own id: not his.
    const mine = await ada.json("/api/keep?kind=work");
    const markId = mine.data.things[0].marks[0].id;
    expect((await bob.json("/api/keep/mark", { method: "POST", body: { remove: markId } })).status).toBe(404);

    // Everything of Ada's is untouched.
    const after = await ada.json("/api/keep?kind=work");
    const thing = after.data.things[0];
    expect(thing.note.body).toBe("Ada's note");
    expect(thing.tags).toEqual(["ada-tag"]);
    expect(thing.marks).toHaveLength(1);
  });

  it("6. writing a note on the same thing makes the writer's own, not the other's", async () => {
    const ada = await member("ada@example.org");
    await ada.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "Ada's note" } });
    const bob = await member("bob@example.org");
    await bob.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "Bob's note" } });
    expect((await ada.json("/api/keep?kind=work")).data.things[0].note.body).toBe("Ada's note");
    expect((await bob.json("/api/keep?kind=work")).data.things[0].note.body).toBe("Bob's note");
    const { results } = await env.DB.prepare("SELECT user_id FROM kept WHERE kind = 'work' AND ref = ?").bind(WORK.ref).all();
    expect(results).toHaveLength(2);
  });

  it("7. a person's own id in the request changes nothing: the thing is the sender's", async () => {
    const ada = await member("ada@example.org");
    const bob = await member("bob@example.org");
    const ids = await env.DB.prepare('SELECT id, email FROM "user" WHERE isAnonymous IS NULL OR isAnonymous = 0').all();
    const adaId = ids.results.find((u) => u.email === "ada@example.org").id;
    const r = await bob.json("/api/keep", {
      method: "POST",
      body: { ...WORK, user_id: adaId, userId: adaId, id: "chosen-by-hand", who: adaId }
    });
    expect(r.status).toBe(201);
    const { results } = await env.DB.prepare("SELECT user_id, id FROM kept WHERE ref = ?").bind(WORK.ref).all();
    expect(results).toHaveLength(1);
    expect(results[0].user_id).not.toBe(adaId);
    expect(results[0].id).not.toBe("chosen-by-hand");
    expect((await ada.json("/api/keep?kind=work")).data.things).toHaveLength(0);
  });
});

describe("Attacks: too much and too long", () => {
  it("8. a guest cannot go past the guest's limit", async () => {
    const g = await guest();
    const limit = (await g.json("/api/keep/mine", { method: "POST", body: { refs: [] } })).data.limit;
    expect(limit).toBe(50);
    for (let i = 0; i < limit; i++) {
      const r = await g.json("/api/keep", { method: "POST", body: { ...WORK, ref: "w" + i } });
      expect(r.status).toBe(201);
    }
    const over = await g.json("/api/keep", { method: "POST", body: { ...WORK, ref: "one-too-many" } });
    expect(over.status).toBe(409);
    expect(over.data.error).toContain("50");
    // A note on a new thing is a save too, so it is refused in the same way.
    expect((await g.json("/api/keep/note", { method: "POST", body: { ...WORK, ref: "also-new", body: "x" } })).status).toBe(409);
    // Writing on something already kept still works.
    expect((await g.json("/api/keep/note", { method: "POST", body: { ...WORK, ref: "w0", body: "fine" } })).status).toBe(200);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM kept WHERE user_id = (SELECT id FROM \"user\" WHERE isAnonymous = 1)").first();
    expect(n).toBe(limit);
  });

  it("9. a note, a tag, a passage, a card or a name that is far too long is refused", async () => {
    const b = await member("ada@example.org");
    expect((await b.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "x".repeat(20001) } })).status).toBe(413);
    expect((await b.json("/api/keep/tag", { method: "POST", body: { ...WORK, add: "t".repeat(41) } })).status).toBe(413);
    expect((await b.json("/api/keep/mark", { method: "POST", body: { ...WORK, at: 0, text: "p".repeat(1001) } })).status).toBe(413);
    expect((await b.json("/api/keep", { method: "POST", body: { ...WORK, title: "T".repeat(601) } })).status).toBe(413);
    expect((await b.json("/api/keep", { method: "POST", body: { ...WORK, abstract: "a".repeat(6001) } })).status).toBe(413);
    expect((await b.json("/api/keep", { method: "POST", body: { ...WORK, ref: "r".repeat(201) } })).status).toBe(404);
    expect((await b.json("/api/keep", { method: "POST", body: "x".repeat(40001) })).status).toBe(413);
    expect((await b.json("/api/keep?kind=work")).data.things).toHaveLength(0);
  });

  it("10. one thing cannot carry more tags or marked passages than the limit", async () => {
    const b = await member("ada@example.org");
    for (let i = 0; i < 12; i++) {
      expect((await b.json("/api/keep/tag", { method: "POST", body: { ...WORK, add: "tag-" + i } })).status).toBe(200);
    }
    expect((await b.json("/api/keep/tag", { method: "POST", body: { ...WORK, add: "tag-13" } })).status).toBe(409);
    for (let i = 0; i < 50; i++) {
      expect((await b.json("/api/keep/mark", { method: "POST", body: { ...WORK, at: i, text: "p" + i } })).status).toBe(200);
    }
    expect((await b.json("/api/keep/mark", { method: "POST", body: { ...WORK, at: 99, text: "one too many" } })).status).toBe(409);
    const thing = (await b.json("/api/keep?kind=work")).data.things[0];
    expect(thing.tags).toHaveLength(12);
    expect(thing.marks).toHaveLength(50);
  });
});

describe("Attacks: bad input", () => {
  it("11. a kind the workspace does not know is refused", async () => {
    const b = await member("ada@example.org");
    for (const kind of ["page", "notebook", "user", "", null, 7, ["work"], { kind: "work" }, "WORK", "work ", "profile"]) {
      const r = await b.json("/api/keep", { method: "POST", body: { ...WORK, kind } });
      expect(r.status, String(kind)).toBe(404);
    }
    expect((await b.json("/api/keep?kind=page")).data.kind).toBe("work");
    expect((await b.json("/api/keep/mine", { method: "POST", body: { refs: [{ kind: "page", ref: "x" }, { kind: "profile", ref: "y" }] } })).data.things).toHaveLength(0);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM kept").first();
    expect(n).toBe(0);
  });

  it("12. a reading status only a work can have, and only from the list", async () => {
    const b = await member("ada@example.org");
    expect((await b.json("/api/keep/status", { method: "POST", body: { ...WORK, status: "finished" } })).status).toBe(400);
    expect((await b.json("/api/keep/status", { method: "POST", body: { ...ITEM, status: "read" } })).status).toBe(400);
    expect((await b.json("/api/keep/mark", { method: "POST", body: { ...ITEM, at: 0, text: "x" } })).status).toBe(400);
    expect((await b.json("/api/keep/status", { method: "POST", body: { ...WORK, status: "read" } })).status).toBe(200);
    expect((await b.json("/api/keep?kind=work")).data.things[0].status).toBe("read");
    const bad = await env.DB.prepare("SELECT COUNT(*) AS n FROM kept WHERE status NOT IN ('to-read','reading','read') AND status IS NOT NULL").first();
    expect(bad.n).toBe(0);
  });

  it("13. a passage cannot begin at a place that is not a place", async () => {
    const b = await member("ada@example.org");
    for (const at of [-1, 1.5, "0", null, undefined, 999999, NaN]) {
      const r = await b.json("/api/keep/mark", { method: "POST", body: { ...WORK, at, text: "a passage" } });
      expect(r.status, String(at)).toBe(400);
    }
  });
});

describe("Attacks: a script, in a note, a tag or a marked passage", () => {
  const SCRIPT = '<script>alert("x")</script><img src=x onerror=alert(1)>';
  const SQL = "'); DROP TABLE kept; --";

  it("14. keeps what was typed as plain text, and nothing of it runs or acts", async () => {
    const b = await member("ada@example.org");
    await b.json("/api/keep/note", { method: "POST", body: { ...WORK, title: SCRIPT, body: SCRIPT + SQL } });
    await b.json("/api/keep/tag", { method: "POST", body: { ...WORK, add: SCRIPT.slice(0, 40) } });
    await b.json("/api/keep/mark", { method: "POST", body: { ...WORK, at: 0, text: SCRIPT } });
    const thing = (await b.json("/api/keep?kind=work")).data.things[0];
    // Given back exactly as typed: not run, not turned into a tag, not escaped
    // into something else. The page sets it as text and never as HTML.
    expect(thing.note.body).toBe(SCRIPT + SQL);
    expect(thing.tags[0]).toBe(SCRIPT.slice(0, 40));
    expect(thing.marks[0].text).toBe(SCRIPT);
    expect(thing.title).toBe(SCRIPT);
    // The answer is JSON, never a page.
    const res = await b.fetch("/api/keep?kind=work");
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // The tables are still there.
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM kept").first();
    expect(n).toBe(1);
  });

  it("15. a database command in a search finds nothing and breaks nothing", async () => {
    const b = await member("ada@example.org");
    await b.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "a plain note" } });
    for (const q of ["%", "_", "' OR 1=1 --", "'; DELETE FROM note; --", "\\"]) {
      expect((await b.json("/api/keep?kind=work&q=" + encodeURIComponent(q))).status).toBe(200);
      expect((await b.json("/api/notes?q=" + encodeURIComponent(q))).status).toBe(200);
    }
    expect((await b.json("/api/keep?kind=work&q=%25")).data.things).toHaveLength(0);
    expect((await b.json("/api/notes")).data.notes).toHaveLength(1);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM note").first();
    expect(n).toBe(1);
  });

  it("16. control characters are dropped and a name is one line", async () => {
    const b = await member("ada@example.org");
    await b.json("/api/keep/note", { method: "POST", body: { ...WORK, title: "a\u0000b\tc\nd", body: "one\u0000two\nthree" } });
    const thing = (await b.json("/api/keep?kind=work")).data.things[0];
    expect(thing.title).toBe("a b c d");
    expect(thing.note.body).toBe("onetwo\nthree");
  });
});

describe("Attacks: two at the same moment", () => {
  it("17. ten notes on one thing at once make one thing and one note", async () => {
    const b = await member("ada@example.org");
    const all = await Promise.all(
      Array.from({ length: 10 }, (_, i) => b.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "note " + i } }))
    );
    expect(all.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const kept = await env.DB.prepare("SELECT COUNT(*) AS n FROM kept WHERE ref = ?").bind(WORK.ref).first();
    const notes = await env.DB.prepare("SELECT COUNT(*) AS n FROM note").first();
    expect(kept.n).toBe(1);
    expect(notes.n).toBe(1);
    const thing = (await b.json("/api/keep?kind=work")).data.things[0];
    expect(thing.note.body).toMatch(/^note \d$/);
  });

  it("18. twenty saves of one thing at once make one row", async () => {
    const b = await member("ada@example.org");
    await Promise.all(Array.from({ length: 20 }, () => b.json("/api/keep", { method: "POST", body: WORK })));
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM kept WHERE ref = ?").bind(WORK.ref).first();
    expect(n).toBe(1);
    expect((await b.json("/api/keep?kind=work")).data.things).toHaveLength(1);
  });

  it("19. tagging one thing twenty times at once keeps one tag of that name", async () => {
    const b = await member("ada@example.org");
    await Promise.all(Array.from({ length: 20 }, () => b.json("/api/keep/tag", { method: "POST", body: { ...WORK, add: "theory" } })));
    const thing = (await b.json("/api/keep?kind=work")).data.things[0];
    expect(thing.tags).toEqual(["theory"]);
  });
});

describe("Attacks: deleting and downloading", () => {
  it("20. deleting an account leaves nothing of it behind", async () => {
    const b = await member("ada@example.org");
    await b.json("/api/keep", { method: "POST", body: WORK });
    await b.json("/api/keep/note", { method: "POST", body: { ...ITEM, body: "on the item" } });
    await b.json("/api/keep/tag", { method: "POST", body: { ...WORK, add: "theory" } });
    await b.json("/api/keep/mark", { method: "POST", body: { ...WORK, at: 2, text: "a passage" } });
    await b.json("/api/keep/status", { method: "POST", body: { ...WORK, status: "reading" } });
    await b.newPage("a page", "some words");
    const other = await member("bob@example.org");
    await other.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "Bob keeps his" } });

    expect((await b.json("/api/me", { method: "DELETE", body: { confirm: "delete" } })).status).toBe(200);
    for (const table of ["kept", "note", "tag", "mark", "notebook_page", "profile", "session", "account"]) {
      const { n } = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "session" || table === "account" ? "userId" : "user_id"} = ` +
          `(SELECT id FROM "user" WHERE email = 'ada@example.org')`
      ).first();
      expect(n, table).toBe(0);
    }
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM "user" WHERE email = ?').bind("ada@example.org").first();
    expect(n).toBe(0);
    // Bob's own things are untouched.
    expect((await other.json("/api/keep?kind=work")).data.things[0].note.body).toBe("Bob keeps his");
    // And no row is left with an owner who is gone.
    for (const table of ["kept", "note", "tag", "mark"]) {
      const { n: orphans } = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE user_id NOT IN (SELECT id FROM "user")`
      ).first();
      expect(orphans, table).toBe(0);
    }
  });

  it("21. the nightly job's deletion leaves nothing of a guest or an old account behind", async () => {
    const g = await guest();
    await g.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "a guest's note" } });
    await g.json("/api/keep/tag", { method: "POST", body: { ...WORK, add: "theory" } });
    const { nightly } = await import("../src/cleanup.js");
    // Every session of the guest is over, and the guest arrived long ago.
    await env.DB.prepare('UPDATE "user" SET createdAt = ? WHERE isAnonymous = 1').bind("2024-01-01T00:00:00.000Z").run();
    await env.DB.prepare("DELETE FROM session").run();
    const report = await nightly(world.env);
    expect(report.guests).toBe(1);
    for (const table of ["kept", "note", "tag", "mark"]) {
      const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
      expect(n, table).toBe(0);
    }
  });

  it("22. Download Everything carries the new data, and only the asker's own", async () => {
    const b = await member("ada@example.org");
    await b.json("/api/keep", { method: "POST", body: { ...WORK, abstract: "The populist Zeitgeist is a thin ideology." } });
    await b.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "The note I wrote on this work." } });
    await b.json("/api/keep/tag", { method: "POST", body: { ...WORK, add: "theory" } });
    await b.json("/api/keep/status", { method: "POST", body: { ...WORK, status: "read" } });
    await b.json("/api/keep/mark", { method: "POST", body: { ...WORK, at: 4, text: "populist Zeitgeist" } });
    await b.json("/api/keep/note", { method: "POST", body: { ...ITEM, body: "The note on the Monitor item." } });
    const other = await member("bob@example.org");
    await other.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "Bob's own note" } });

    const res = await b.fetch("/api/me/export");
    expect(res.status).toBe(200);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(zip);
    expect(names).toContain("shelf.json");
    expect(names).toContain("notes.json");
    expect(names.some((n) => n.startsWith("notes/") && n.endsWith(".txt"))).toBe(true);
    expect(strFromU8(zip["README.txt"])).toContain("shelf.json");

    const shelf = JSON.parse(strFromU8(zip["shelf.json"]));
    expect(shelf).toHaveLength(2);
    const work = shelf.find((t) => t.kind === "work");
    expect(work.note.body).toBe("The note I wrote on this work.");
    expect(work.tags).toEqual(["theory"]);
    expect(work.status).toBe("read");
    expect(work.marks[0].text).toBe("populist Zeitgeist");
    expect(work.abstract).toContain("thin ideology");
    const notes = JSON.parse(strFromU8(zip["notes.json"]));
    expect(notes).toHaveLength(2);
    const text = names.filter((n) => n.startsWith("notes/")).map((n) => strFromU8(zip[n])).join("\n");
    expect(text).toContain("The note on the Monitor item.");
    expect(text).toContain("theory");
    // Nothing of Bob's is in Ada's file.
    expect(JSON.stringify(shelf) + text).not.toContain("Bob's own note");
  });

  it("23. a guest's download carries the guest's own shelf and no email", async () => {
    const g = await guest();
    await g.json("/api/keep/note", { method: "POST", body: { ...ITEM, body: "a guest's note" } });
    const res = await g.fetch("/api/me/export");
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const account = JSON.parse(strFromU8(zip["account.json"]));
    expect(account.guest).toBe(true);
    expect(JSON.stringify(account)).not.toContain("@");
    expect(JSON.parse(strFromU8(zip["shelf.json"]))[0].note.body).toBe("a guest's note");
  });
});

describe("Attacks: the closed workspace and the desk", () => {
  it("24. while the workspace is closed, nobody new reaches the new doors", async () => {
    await setOpen(false);
    const b = new Browser(world);
    const r = await b.askCode("stranger@example.org");
    expect(b.lastCode("stranger@example.org")).toBe(null);
    for (const [method, path, body] of DOORS) {
      expect((await b.json(path, { method, body })).status, path).toBe(401);
    }
    // An invited person signs up and keeps things as usual.
    await invite("asked@example.org");
    const ok = new Browser(world);
    await ok.signUp("asked@example.org");
    expect((await ok.json("/api/keep", { method: "POST", body: WORK })).status).toBe(201);
  });

  it("25. the editor's desk never shows a word of what people keep", async () => {
    const ada = await member("ada@example.org");
    await ada.json("/api/keep/note", { method: "POST", body: { ...WORK, body: "a private thought" } });
    await invite(EDITOR);
    const ed = new Browser(world);
    await ed.signUp(EDITOR);
    const summary = await ed.json("/api/desk/summary");
    expect(summary.status).toBe(200);
    const asText = JSON.stringify(summary.data);
    expect(asText).not.toContain("private thought");
    expect(asText).not.toContain(WORK.ref);
    const csv = await (await ed.fetch("/api/desk/accounts.csv")).text();
    expect(csv).not.toContain("private thought");
    expect(csv).not.toContain(WORK.ref);
  });
});
