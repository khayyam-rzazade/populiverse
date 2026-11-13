// ATTACKS ON ANOTHER PERSON'S WORK. Every one of them must fail.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";
import { makeWorld, Browser, setOpen } from "./helpers.js";

async function twoPeople() {
  const w = makeWorld();
  const ada = new Browser(w);
  await ada.signUp("ada@example.org");
  const bob = new Browser(w);
  await bob.signUp("bob@example.org", { name: "Bob Other" });
  const secret = await ada.newPage("Ada's unpublished idea", "SECRET-ADA-7731 the argument of my next paper");
  return { w, ada, bob, id: secret.data.page.id };
}

describe("Attacks on another person's notes", () => {
  beforeEach(() => setOpen(true));

  it("10. reading another person's page by its address fails", async () => {
    const { bob, id } = await twoPeople();
    const r = await bob.json(`/api/pages/${id}`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.data)).not.toContain("SECRET-ADA");
  });

  it("11. changing another person's page fails, and the page stays as it was", async () => {
    const { ada, bob, id } = await twoPeople();
    const r = await bob.json(`/api/pages/${id}`, { method: "PATCH", body: { body: "overwritten by bob" } });
    expect(r.status).toBe(404);
    const mine = await ada.json(`/api/pages/${id}`);
    expect(mine.data.page.body).toContain("SECRET-ADA-7731");
  });

  it("12. deleting another person's page fails, and the page is still there", async () => {
    const { ada, bob, id } = await twoPeople();
    expect((await bob.json(`/api/pages/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await ada.json(`/api/pages/${id}`)).status).toBe(200);
  });

  it("13. listing and searching show only one's own pages", async () => {
    const { bob } = await twoPeople();
    await bob.newPage("Bob's page", "nothing here");
    for (const q of ["", "SECRET", "Ada", "%", "_", "' OR '1'='1", "%' OR 1=1 --"]) {
      const r = await bob.json(`/api/pages?q=${encodeURIComponent(q)}`);
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.data), q).not.toContain("SECRET-ADA");
      for (const p of r.data.pages) expect(p.title).toBe("Bob's page");
    }
  });

  it("14. 'Download Everything' holds only one's own pages", async () => {
    const { bob } = await twoPeople();
    await bob.newPage("Bob's page", "bob text");
    const res = await bob.fetch("/api/me/export");
    expect(res.status).toBe(200);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const all = Object.values(files).map(strFromU8).join("\n");
    expect(all).toContain("bob text");
    expect(all).not.toContain("SECRET-ADA");
    expect(all).not.toContain("ada@example.org");
  });

  it("15. a guest cannot reach an account's pages", async () => {
    const { w, id } = await twoPeople();
    const g = new Browser(w);
    expect((await g.guest()).status).toBe(200);
    expect((await g.json(`/api/pages/${id}`)).status).toBe(404);
    expect(JSON.stringify((await g.json("/api/pages")).data)).not.toContain("SECRET-ADA");
  });

  it("16. guessing page addresses finds nothing", async () => {
    const { bob } = await twoPeople();
    const { id } = await env.DB.prepare("SELECT id FROM notebook_page LIMIT 1").first();
    for (const guess of [id.toUpperCase(), id.slice(0, -1) + "0", "1", "%2e%2e", "' OR '1'='1"]) {
      const r = await bob.fetch(`/api/pages/${encodeURIComponent(guess)}`);
      expect(r.status, guess).toBe(404);
      expect(await r.text()).not.toContain("SECRET-ADA");
    }
  });

  it("17. a guest who signs up keeps every page, and takes no one else's", async () => {
    const w = makeWorld();
    const other = new Browser(w);
    await other.guest();
    await other.newPage("Other guest", "OTHER-GUEST-PAGE");
    const g = new Browser(w);
    await g.guest();
    await g.newPage("Guest note", "kept after sign-up");
    await g.signIn("carla@example.org");
    await g.finish({ name: "Carla" });
    const r = await g.json("/api/pages");
    expect(r.data.pages.map((p) => p.title)).toEqual(["Guest note"]);
    const o = await other.json("/api/pages");
    expect(o.data.pages.map((p) => p.title)).toEqual(["Other guest"]);
  });
});
