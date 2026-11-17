// Fable's check of stage 2, batch 5 (2026-11-17), before the push. Three pins,
// one for each thing the check found in the server. Each failed on the build
// as it was handed over and passes with its mend. The fourth finding (an
// answer given as a guest goes with the account at sign-up) was mended in
// words, on the card and on the Privacy page, as the editor chose; that the
// answer goes with the account is tested in batch5-feedback.test.js.
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { Browser, makeWorld, setOpen } from "./helpers.js";

const idOf = async (email) => (await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first()).id;

describe("Fable 6. What the check of batch 5 found", () => {
  it("1. a guest's own chronology events come along when the guest signs up", async () => {
    const w = makeWorld();
    await setOpen(true);
    const g = new Browser(w);
    await g.guest();
    const add = await g.json("/api/events", { method: "POST", body: { aboutKind: "actor", aboutRef: "afd", day: "2026-11-01", what: "The guest's own event", source: "A source" } });
    expect(add.status).toBeLessThan(300);
    await g.signUp("gina@example.org", { firstName: "Gina", surname: "Guest" });
    const after = await g.json("/api/events");
    expect(after.data.events.map((e) => e.what)).toEqual(["The guest's own event"]);
  });

  it("2. a guest cannot write to the editor through the card before the fifth day of use", async () => {
    const w = makeWorld();
    await setOpen(true);
    const g = new Browser(w);
    await g.guest();
    await g.json("/api/me");
    const r = await g.json("/api/feedback", { method: "POST", body: { score: 1, missing: "written on the first day" } });
    expect(r.status).toBe(403);
    expect(w.outbox.filter((m) => /^Feedback card/.test(m.subject)).length).toBe(0);
    // On the fifth day the same guest is heard.
    await env.DB.prepare("UPDATE feedback_card SET days = 5 WHERE user_id = (SELECT id FROM \"user\" WHERE isAnonymous = 1)").run();
    const ok = await g.json("/api/feedback", { method: "POST", body: { score: 4 } });
    expect(ok.status).toBe(200);
  });

  it("3. opening the stop link does not stop the email by itself (a mail scanner opens every link); the button on its page does", async () => {
    const w = makeWorld();
    await setOpen(true);
    const a = new Browser(w);
    await a.signUp("ada@example.org", { firstName: "Ada", surname: "Lovelace" });
    await a.json("/api/me/email", { method: "PATCH", body: { on: true } });
    const id = await idOf("ada@example.org");
    const { stop_token } = await env.DB.prepare("SELECT stop_token FROM digest WHERE user_id = ?").bind(id).first();
    const scanner = new Browser(w);
    const page = await scanner.fetch(`/api/stop/${stop_token}`, { origin: null });
    expect(page.status).toBe(200);
    expect((await env.DB.prepare("SELECT wanted FROM digest WHERE user_id = ?").bind(id).first()).wanted).toBe(1);
    expect(await page.text()).toContain("Stop the Email");
    const press = await scanner.fetch(`/api/stop/${stop_token}`, { method: "POST", origin: null });
    expect(press.status).toBe(200);
    expect((await env.DB.prepare("SELECT wanted FROM digest WHERE user_id = ?").bind(id).first()).wanted).toBe(0);
  });
});
