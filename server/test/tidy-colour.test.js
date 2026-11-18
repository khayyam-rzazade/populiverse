// The tidy-up and colour round of 17 November 2026 (claude/workspace-tidy-and-
// colour-plan.md). Part F: a colour for each project, one of six fixed names,
// with attacks. Part G: the page the email's stop link opens names the account
// page, where the switch now stands, and no longer the first page. Each test
// fails without its part.
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { unzipSync, strFromU8 } from "fflate";
import { Browser, makeWorld, invite } from "./helpers.js";

const SIX = ["moss", "plum", "slate", "sand", "rose", "stone"];

async function member(w, email) {
  const b = new Browser(w);
  await invite(email);
  await b.signUp(email);
  return b;
}
const colourIn = async (id) => (await env.DB.prepare("SELECT colour FROM project WHERE id = ?").bind(id).first())?.colour;

describe("Part F: a colour for each project", () => {
  it("F1. a project takes each of the six colours, when started and when changed, and can lose it again", async () => {
    const w = makeWorld();
    const a = await member(w, "colour-a@example.org");
    const made = await a.json("/api/projects", { method: "POST", body: { title: "One", question: "", colour: "plum" } });
    expect(made.status).toBe(201);
    expect(made.data.project.colour).toBe("plum");
    const id = made.data.project.id;
    expect(await colourIn(id)).toBe("plum");
    for (const c of SIX) {
      const r = await a.json(`/api/projects/${id}`, { method: "PATCH", body: { colour: c } });
      expect(r.status).toBe(200);
      expect(await colourIn(id)).toBe(c);
    }
    // No colour, by null or by an empty word.
    expect((await a.json(`/api/projects/${id}`, { method: "PATCH", body: { colour: null } })).status).toBe(200);
    expect(await colourIn(id)).toBe(null);
    await a.json(`/api/projects/${id}`, { method: "PATCH", body: { colour: "sand" } });
    expect((await a.json(`/api/projects/${id}`, { method: "PATCH", body: { colour: "" } })).status).toBe(200);
    expect(await colourIn(id)).toBe(null);
    // A project started without a colour has none, and a change of the title
    // alone leaves the colour as it was.
    const plain = await a.json("/api/projects", { method: "POST", body: { title: "Two" } });
    expect(plain.data.project.colour).toBe(null);
    await a.json(`/api/projects/${id}`, { method: "PATCH", body: { colour: "rose" } });
    await a.json(`/api/projects/${id}`, { method: "PATCH", body: { title: "One again" } });
    expect(await colourIn(id)).toBe("rose");
  });

  it("F2. the colour is shown wherever the project is: the list, the project, a thing's projects, the drafts", async () => {
    const w = makeWorld();
    const a = await member(w, "colour-b@example.org");
    const id = (await a.json("/api/projects", { method: "POST", body: { title: "Shown", colour: "slate" } })).data.project.id;
    await a.json("/api/keep", { method: "POST", body: { kind: "work", ref: "W1", title: "A work" } });
    await a.json(`/api/projects/${id}/things`, { method: "POST", body: { kind: "work", ref: "W1" } });
    const d = await a.json("/api/drafts", { method: "POST", body: { title: "Draft", project_id: id } });
    expect((await a.json("/api/projects")).data.projects[0].colour).toBe("slate");
    expect((await a.json(`/api/projects/${id}`)).data.project.colour).toBe("slate");
    const thing = (await a.json("/api/keep?kind=work&order=new&from=0")).data.things[0];
    expect(thing.projects).toEqual([{ id, title: "Shown", colour: "slate" }]);
    expect((await a.json("/api/drafts")).data.drafts[0].project_colour).toBe("slate");
    expect((await a.json(`/api/drafts/${d.data.draft.id}`)).data.project.colour).toBe("slate");
  });

  it("F3. a colour outside the six is refused, when started and when changed, and nothing is kept", async () => {
    const w = makeWorld();
    const a = await member(w, "colour-c@example.org");
    const bad = ["red", "Moss", " moss", "moss ", "#5A6B50", "rgb(0,0,0)", "moss; DROP TABLE project", "x".repeat(5000),
      "<script>alert(1)</script>", 1, true, ["moss"], { colour: "moss" }];
    for (const colour of bad) {
      const r = await a.json("/api/projects", { method: "POST", body: { title: "Bad", colour } });
      expect(r.status).toBe(400);
      expect(r.data.fields.colour).toBe("Please pick one of the six colours.");
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM project").first()).n).toBe(0);
    const id = (await a.json("/api/projects", { method: "POST", body: { title: "Good", colour: "moss" } })).data.project.id;
    for (const colour of bad) {
      const r = await a.json(`/api/projects/${id}`, { method: "PATCH", body: { colour, title: "Changed" } });
      expect(r.status).toBe(400);
    }
    // Nothing of a refused change is kept, not even the title sent with it.
    const row = await env.DB.prepare("SELECT title, colour FROM project WHERE id = ?").bind(id).first();
    expect(row).toEqual({ title: "Good", colour: "moss" });
  });

  it("F4. nobody can colour another person's project, a guest's or a member's", async () => {
    const w = makeWorld();
    const a = await member(w, "colour-d@example.org");
    const b = await member(w, "colour-e@example.org");
    const id = (await a.json("/api/projects", { method: "POST", body: { title: "Mine", colour: "moss" } })).data.project.id;
    const r = await b.json(`/api/projects/${id}`, { method: "PATCH", body: { colour: "rose" } });
    expect(r.status).toBe(404);
    expect(await colourIn(id)).toBe("moss");
    // A guest cannot either, and a guest's own project takes a colour.
    await env.DB.prepare("UPDATE setting SET value = 'yes' WHERE key = 'open'").run();
    const g = new Browser(w);
    expect((await g.guest()).status).toBe(200);
    expect((await g.json(`/api/projects/${id}`, { method: "PATCH", body: { colour: "rose" } })).status).toBe(404);
    expect(await colourIn(id)).toBe("moss");
    const gid = (await g.json("/api/projects", { method: "POST", body: { title: "Guest's", colour: "sand" } })).data.project.id;
    expect(await colourIn(gid)).toBe("sand");
    expect((await a.json(`/api/projects/${gid}`, { method: "PATCH", body: { colour: "plum" } })).status).toBe(404);
    expect(await colourIn(gid)).toBe("sand");
    // Nobody signed in, and another site, reach nothing.
    const nobody = new Browser(w);
    expect((await nobody.json(`/api/projects/${id}`, { method: "PATCH", body: { colour: "rose" } })).status).toBe(401);
    expect((await a.fetch(`/api/projects/${id}`, { method: "PATCH", body: { colour: "rose" }, origin: "https://evil.example" })).status).toBe(403);
    expect(await colourIn(id)).toBe("moss");
    // Another person's project does not show its colour on b's shelf either.
    expect((await b.json("/api/projects")).data.projects).toEqual([]);
  });

  it("F5. the database itself keeps only the six names", async () => {
    const w = makeWorld();
    const a = await member(w, "colour-f@example.org");
    const id = (await a.json("/api/projects", { method: "POST", body: { title: "Kept", colour: "stone" } })).data.project.id;
    await expect(env.DB.prepare("UPDATE project SET colour = 'red' WHERE id = ?").bind(id).run()).rejects.toThrow();
    expect(await colourIn(id)).toBe("stone");
  });

  it("F6. Download Everything carries each project's colour", async () => {
    const w = makeWorld();
    const a = await member(w, "colour-g@example.org");
    await a.json("/api/projects", { method: "POST", body: { title: "Coloured", colour: "rose" } });
    await a.json("/api/projects", { method: "POST", body: { title: "Plain" } });
    const zip = unzipSync(new Uint8Array(await (await a.fetch("/api/me/export")).arrayBuffer()));
    const projects = JSON.parse(strFromU8(zip["projects.json"]));
    expect(projects.map((p) => [p.title, p.colour])).toEqual([["Coloured", "rose"], ["Plain", null]]);
    expect(strFromU8(zip["README.txt"])).toContain("projects.json  your projects, each with its colour and what is in it");
  });
});

describe("Part G: the stop page names the account page", () => {
  it("G1. both stop pages say the switch is on the account page, and nothing of the first page", async () => {
    const w = makeWorld();
    const a = await member(w, "stop-g@example.org");
    await a.json("/api/me/email", { method: "PATCH", body: { on: true } });
    const { stop_token } = await env.DB.prepare("SELECT stop_token FROM digest").first();
    const stranger = new Browser(w);
    const asked = await (await stranger.fetch(`/api/stop/${stop_token}`, { origin: null })).text();
    const done = await (await stranger.fetch(`/api/stop/${stop_token}`, { method: "POST", origin: "https://api.populiverse.com" })).text();
    for (const page of [asked, done]) {
      expect(page).toContain("You can turn it on again on your account page in the Workspace.");
      expect(page).not.toContain("first page");
    }
    expect(done).toContain('<a href="https://populiverse.com/workspace/account.html">Go to your account page</a>');
  });
});
