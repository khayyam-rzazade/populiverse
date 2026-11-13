// ATTACKS ON ROLES: the desk, guests, unfinished accounts. Every one must fail.
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { makeWorld, Browser, setOpen, EDITOR } from "./helpers.js";
import { ROUTES } from "../src/routes.js";

const deskRoutes = ROUTES.filter((r) => r.access === "editor");

describe("Attacks on the editor's desk and on roles", () => {
  beforeEach(() => setOpen(true));

  it("29. the desk refuses a reader, a guest, and the editor's address before the account is finished", async () => {
    const w = makeWorld();
    const reader = new Browser(w);
    await reader.signUp("ada@example.org");
    const guest = new Browser(w);
    await guest.guest();
    const halfEditor = new Browser(w);
    await halfEditor.signIn(EDITOR);
    for (const b of [reader, guest, halfEditor]) {
      for (const r of deskRoutes) {
        const res = await b.fetch(r.path, { method: r.method, body: r.method === "GET" ? undefined : { open: true, emails: "x@example.org", email: "x@example.org" } });
        expect(res.status, r.path).toBe(403);
      }
    }
    const { value } = await env.DB.prepare("SELECT value FROM setting WHERE key = 'open'").first();
    expect(value).toBe("yes");
  });

  it("30. a name that looks like the editor's address, in any case or with spaces, is not the editor", async () => {
    const w = makeWorld();
    for (const email of ["Editor@populiverse.com.evil.example", "editor@populiverse.co", "editor+x@populiverse.com"]) {
      const b = new Browser(w);
      await b.signUp(email);
      expect((await b.fetch("/api/desk/summary")).status, email).toBe(403);
    }
  });

  it("31. a guest cannot change an account, delete one, or touch ORCID", async () => {
    const g = new Browser(makeWorld());
    await g.guest();
    expect((await g.fetch("/api/me", { method: "PATCH", body: { name: "Guest Name" } })).status).toBe(403);
    expect((await g.fetch("/api/me", { method: "DELETE", body: { confirm: "delete" } })).status).toBe(403);
    expect((await g.fetch("/api/me/orcid", { method: "DELETE" })).status).toBe(403);
    expect((await g.fetch("/api/auth/link-social", { method: "POST", body: { provider: "orcid", callbackURL: "https://populiverse.com/workspace/" } })).status).toBe(403);
  });

  it("32. an account that has not finished sign-up cannot use the Notebook", async () => {
    const b = new Browser(makeWorld());
    await b.signIn("ada@example.org");
    expect((await b.fetch("/api/pages")).status).toBe(403);
    expect((await b.fetch("/api/pages", { method: "POST", body: { title: "x" } })).status).toBe(403);
  });

  it("33. a guest can keep 20 pages, no more", async () => {
    const g = new Browser(makeWorld());
    await g.guest();
    for (let i = 0; i < 20; i++) expect((await g.newPage(`p${i}`, "x")).status).toBe(201);
    const r = await g.newPage("one too many", "x");
    expect(r.status).toBe(409);
    expect(r.data.error).toContain("Sign up");
  });

  it("34. the desk never shows a word of what people write", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org");
    await ada.newPage("MARK-TITLE-5519", "MARK-BODY-8842 private thoughts");
    const g = new Browser(w);
    await g.guest();
    await g.newPage("MARK-GUEST-TITLE", "MARK-GUEST-BODY");
    const ed = new Browser(w);
    await ed.signUp(EDITOR, { name: "Khayyam RZAZADE" });
    let seen = "";
    for (const r of deskRoutes.filter((r) => r.method === "GET")) {
      const res = await ed.fetch(r.path);
      expect(res.status, r.path).toBe(200);
      seen += await res.text();
    }
    expect(seen).toContain("ada@example.org");
    expect(seen).not.toContain("MARK-");
    expect(seen).not.toContain("private thoughts");
  });

  it("35. a name written as a spreadsheet formula stays plain text in the download of accounts", async () => {
    const w = makeWorld();
    const ada = new Browser(w);
    await ada.signUp("ada@example.org", { name: '=HYPERLINK("https://evil.example","click")' });
    const ed = new Browser(w);
    await ed.signUp(EDITOR, { name: "Khayyam RZAZADE" });
    const csv = await (await ed.fetch("/api/desk/accounts.csv")).text();
    expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"",""click"")"`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

describe("Attacks with bad input", () => {
  beforeEach(() => setOpen(true));

  it("36. a page with a script, or with database commands, is stored as plain text and changes nothing", async () => {
    const b = new Browser(makeWorld());
    await b.signUp("ada@example.org");
    const evil = `<script>alert(1)</script><img src=x onerror=alert(2)>'); DROP TABLE notebook_page; --`;
    const r = await b.newPage(evil.slice(0, 200), evil);
    expect(r.status).toBe(201);
    const back = await b.fetch(`/api/pages/${r.data.page.id}`);
    expect(back.headers.get("Content-Type")).toContain("application/json");
    expect(back.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await back.json()).page.body).toBe(evil);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM notebook_page").first();
    expect(n).toBe(1);
  });

  it("37. a page beyond 200,000 characters, a title beyond 200, or a body of junk is refused", async () => {
    const b = new Browser(makeWorld());
    await b.signUp("ada@example.org");
    expect((await b.newPage("ok", "x".repeat(200001))).status).toBe(413);
    expect((await b.newPage("t".repeat(201), "x")).status).toBe(413);
    const p = await b.newPage("ok", "fine");
    expect((await b.fetch(`/api/pages/${p.data.page.id}`, { method: "PATCH", body: "not json{" })).status).toBe(413);
    expect((await b.fetch(`/api/pages/${p.data.page.id}`, { method: "PATCH", body: { body: "y".repeat(200001) } })).status).toBe(413);
  });

  it("38. the sign-up form accepts only the listed positions, fields and countries, and only real ROR records", async () => {
    const b = new Browser(makeWorld());
    await b.signIn("ada@example.org");
    expect((await b.finish({ position: "Nobel Laureate" })).status).toBe(400);
    expect((await b.finish({ field: "Astrology" })).status).toBe(400);
    expect((await b.finish({ rorId: "999999999" })).status).toBe(400);
    expect((await b.finish({ rorId: undefined, institution: "My Institute", country: "ZZ" })).status).toBe(400);
    expect((await b.finish({ name: "" })).status).toBe(400);
    expect((await b.finish({ name: "x".repeat(121) })).status).toBe(400);
    // the institution's name and country come from ROR, not from the browser
    expect((await b.finish({ rorId: "0107c5v14", institution: "Fake University", country: "US" })).status).toBe(200);
    const me = await b.json("/api/me");
    expect(me.data.institution).toBe("University of Genoa");
    expect(me.data.country).toBe("IT");
  });

  it("39. two windows on one page: the older window cannot overwrite the newer text", async () => {
    const b = new Browser(makeWorld());
    await b.signUp("ada@example.org");
    const p = (await b.newPage("draft", "first")).data.page;
    const one = await b.json(`/api/pages/${p.id}`, { method: "PATCH", body: { body: "from window one", base: p.updated_at } });
    expect(one.status).toBe(200);
    const two = await b.json(`/api/pages/${p.id}`, { method: "PATCH", body: { body: "from window two", base: p.updated_at } });
    expect(two.status).toBe(409);
    expect((await b.json(`/api/pages/${p.id}`)).data.page.body).toBe("from window one");
  });
});
