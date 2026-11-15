// Before the tests: the database is made from the migrations, as at Cloudflare.
// Before each test: it is emptied, so that no test leans on another.
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  await env.DB.batch(
    ["mark", "tag", "note", "kept", "notebook_page", "profile", "session", "account", "verification", "rateLimit", "invite", "code_ask", '"user"'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`)
    )
  );
  await env.DB.prepare("UPDATE setting SET value = 'no' WHERE key = 'open'").run();
});
