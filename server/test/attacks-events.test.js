// Attacks on the reader's own events, the one place the server grows in Part B
// of batch 4 (master plan, section 18, stage 2, batch 4, B2 and B4). An event a
// reader adds is private, is marked as the reader's own everywhere, is counted
// against a limit inside the statement that writes it, goes into Download
// Everything and is deleted with the account.

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";
import { Browser, makeWorld, setOpen, EDITOR } from "./helpers.js";
import { LIMITS } from "../src/lists.js";
import { nightly } from "../src/cleanup.js";

let world;
beforeEach(async () => {
  world = makeWorld();
  await setOpen(true);
});
const post = (b, path, body) => b.json(path, { method: "POST", body });
const del = (b, path) => b.json(path, { method: "DELETE" });
async function member(email, fields) {
  const b = new Browser(world);
  await b.signUp(email, fields);
  return b;
}
async function guest() {
  const b = new Browser(world);
  expect((await b.guest()).status).toBe(200);
  return b;
}
const idOf = async (b) => (await b.json("/api/auth/get-session")).data.user.id;
const EVENT = { aboutKind: "actor", aboutRef: "donald-trump", day: "2026-10-01", what: "A speech in Ohio", source: "The New York Times, 2 October 2026" };

describe("Batch 4, B2. The reader's own events", () => {
  it("E1. an event needs a date, what happened and a source, and nothing else is taken", async () => {
    const b = await member("e1@example.org");
    const refused = [
      { day: "" },
      { day: "yesterday" },
      { day: "2026-13-01" },
      { day: "2026-02-30" },
      { day: "2026-11-16T10:00:00Z" },
      { day: "0999" },
      { day: 2026 },
      { what: "" },
      { what: "   " },
      { what: "x".repeat(LIMITS.charsPerEvent + 1) },
      { what: 5 },
      { source: "" },
      { source: "  " },
      { source: "y".repeat(LIMITS.charsPerEventSource + 1) },
      { source: null }
    ];
    for (const t of refused) {
      const r = await post(b, "/api/events", { ...EVENT, ...t });
      expect(r.status, JSON.stringify(t)).toBe(400);
    }
    expect((await b.json("/api/events")).data.events).toEqual([]);

    // A thing an event cannot be about is not found at all.
    for (const t of [{ aboutKind: "work" }, { aboutKind: "" }, { aboutRef: "" }, { aboutRef: "../../etc" }, { aboutRef: "a".repeat(61) }]) {
      expect((await post(b, "/api/events", { ...EVENT, ...t })).status, JSON.stringify(t)).toBe(404);
    }

    // A year, a month and a full day are all taken.
    for (const day of ["2026", "2026-11", "2026-11-16", "1990-01-01", "2026-02-29"]) {
      const r = await post(b, "/api/events", { ...EVENT, day });
      expect(r.status, day).toBe(day === "2026-02-29" ? 400 : 201);
    }
    const list = (await b.json("/api/events")).data.events;
    expect(list.map((e) => e.day)).toEqual(["1990-01-01", "2026", "2026-11", "2026-11-16"]);
    for (const e of list) expect(e.mine).toBe(true);
  });

  it("E2. what a reader writes is kept as one clean line of text and never as anything that can run", async () => {
    const b = await member("e2@example.org");
    const r = await post(b, "/api/events", {
      ...EVENT,
      what: "  A speech\n\tin \u0000 Ohio  <script>alert(1)</script>  ",
      source: "  The Times,\r\n 2 October 2026  "
    });
    expect(r.status).toBe(201);
    const e = (await b.json("/api/events")).data.events[0];
    expect(e.what).toBe("A speech in Ohio <script>alert(1)</script>");
    expect(e.source).toBe("The Times, 2 October 2026");
    const row = await env.DB.prepare("SELECT what FROM own_event WHERE user_id = ?").bind(await idOf(b)).first();
    expect(row.what).toBe("A speech in Ohio <script>alert(1)</script>");
  });

  it("E3. one reader never sees, changes or deletes another's events, and the editor's desk never sees them", async () => {
    const ada = await member("a3@example.org");
    const bob = await member("b3@example.org");
    const mine = (await post(ada, "/api/events", { ...EVENT, what: "A SECRET EVENT", source: "A SECRET SOURCE" })).data.event;
    expect((await bob.json("/api/events")).data.events).toEqual([]);
    expect((await bob.json("/api/events?kind=actor&ref=donald-trump")).data.events).toEqual([]);
    expect((await del(bob, "/api/events/" + mine.id)).status).toBe(404);
    expect((await ada.json("/api/events")).data.events.length).toBe(1);

    const ed = await member(EDITOR);
    const desk = JSON.stringify((await ed.json("/api/desk/summary")).data);
    expect(desk).not.toContain("A SECRET EVENT");
    expect(desk).not.toContain("A SECRET SOURCE");
    const csv = await (await ed.fetch("/api/desk/accounts.csv")).text();
    expect(csv).not.toContain("A SECRET EVENT");
    expect(csv).not.toContain("A SECRET SOURCE");

    // The reader deletes her own, once.
    expect((await del(ada, "/api/events/" + mine.id)).status).toBe(200);
    expect((await del(ada, "/api/events/" + mine.id)).status).toBe(404);
    expect((await ada.json("/api/events")).data.events).toEqual([]);
  });

  it("E4. a guest keeps fewer, and the count stands inside the statement that writes the row", async () => {
    const g = await guest();
    const limit = LIMITS.eventsPerGuest;
    expect((await g.json("/api/events")).data.limit).toBe(limit);
    for (let i = 0; i < limit; i++) {
      expect((await post(g, "/api/events", { ...EVENT, what: "Event " + i })).status, "event " + i).toBe(201);
    }
    const over = await post(g, "/api/events", { ...EVENT, what: "One too many" });
    expect(over.status).toBe(409);
    expect((await g.json("/api/events")).data.used).toBe(limit);

    // Many requests arriving at once can never carry a reader past the limit.
    expect((await del(g, "/api/events/" + (await g.json("/api/events")).data.events[0].id)).status).toBe(200);
    const at_once = await Promise.all([1, 2, 3, 4, 5].map((n) => post(g, "/api/events", { ...EVENT, what: "At once " + n })));
    expect(at_once.filter((r) => r.status === 201).length).toBe(1);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM own_event WHERE user_id = ?").bind(await idOf(g)).first();
    expect(n).toBe(limit);

    // An account keeps more than a guest.
    const b = await member("e4@example.org");
    expect((await b.json("/api/events")).data.limit).toBe(LIMITS.eventsPerAccount);
    expect(LIMITS.eventsPerAccount).toBeGreaterThan(LIMITS.eventsPerGuest);
  });

  it("E5. the events are in Download Everything, marked as the reader's own", async () => {
    const b = await member("e5@example.org");
    await post(b, "/api/events", { ...EVENT, what: "A speech in Ohio", source: "The Times" });
    await post(b, "/api/events", { aboutKind: "country", aboutRef: "USA", day: "2026", what: "A law passed", source: "The register" });
    const zip = unzipSync(new Uint8Array(await (await b.fetch("/api/me/export")).arrayBuffer()));
    expect(Object.keys(zip)).toContain("events.json");
    const out = JSON.parse(strFromU8(zip["events.json"]));
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({ on: { kind: "actor", ref: "donald-trump" }, date: "2026-10-01", what: "A speech in Ohio", source: "The Times", added_by: "you" });
    expect(out[1]).toMatchObject({ on: { kind: "country", ref: "USA" }, date: "2026", what: "A law passed", added_by: "you" });
    // The file that says what is in the download names them too.
    expect(strFromU8(zip["README.txt"])).toContain("events.json");
  });

  it("E6. the events go with the account when it is deleted, and with a guest when the nightly job clears it", async () => {
    const b = await member("e6@example.org");
    await post(b, "/api/events", EVENT);
    const id = await idOf(b);
    expect((await b.json("/api/me", { method: "DELETE", body: { confirm: "delete" } })).status).toBe(200);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM own_event WHERE user_id = ?").bind(id).first();
    expect(n).toBe(0);

    const g = await guest();
    await post(g, "/api/events", EVENT);
    const gid = await idOf(g);
    await env.DB.prepare('UPDATE "user" SET createdAt = ? WHERE id = ?').bind("2020-01-01T00:00:00.000Z", gid).run();
    await env.DB.prepare("DELETE FROM session WHERE userId = ?").bind(gid).run();
    await nightly(world.env);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM own_event WHERE user_id = ?").bind(gid).first();
    expect(after.n).toBe(0);
  });

  it("E7. the events of one actor or country come back on their own, and nothing is shown for a thing that is not asked for", async () => {
    const b = await member("e7@example.org");
    await post(b, "/api/events", { ...EVENT, aboutRef: "donald-trump", what: "On Trump" });
    await post(b, "/api/events", { ...EVENT, aboutRef: "viktor-orban", what: "On Orban" });
    await post(b, "/api/events", { aboutKind: "country", aboutRef: "HUN", day: "2026", what: "On Hungary", source: "A source" });
    expect((await b.json("/api/events?kind=actor&ref=donald-trump")).data.events.map((e) => e.what)).toEqual(["On Trump"]);
    expect((await b.json("/api/events?kind=country&ref=HUN")).data.events.map((e) => e.what)).toEqual(["On Hungary"]);
    expect((await b.json("/api/events?kind=actor&ref=HUN")).data.events).toEqual([]);
    expect((await b.json("/api/events")).data.events.length).toBe(3);
  });

  it("E8. the migration only adds one table and its two indexes", async () => {
    const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith("0008"));
    expect(m).toBeTruthy();
    const steps = m.queries.map((q) => q.split("\n").filter((l) => !l.trim().startsWith("--")).join(" ").trim());
    expect(steps.length).toBe(3);
    expect(steps[0]).toMatch(/^create\s+table\s+"own_event"/i);
    expect(steps[1]).toMatch(/^create\s+index/i);
    expect(steps[2]).toMatch(/^create\s+index/i);
    // Nothing of what is already there is dropped, emptied or changed.
    for (const q of steps) expect(q).not.toMatch(/\b(drop\s+table|delete\s+from|alter\s+table)\b/i);
  });
});
