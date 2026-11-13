// The attack tests run inside a local copy of Cloudflare's own runtime (workerd),
// with a local copy of the database. Nothing here reaches the internet: ORCID,
// ROR and Sender are answered by stand-ins in test/outside.js.
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fakeOutside } from "./test/outside.js";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-0123456789abcdef",
            ORCID_CLIENT_ID: "APP-TEST",
            ORCID_CLIENT_SECRET: "orcid-test-secret",
            SENDER_API_KEY: "sender-test-key",
            SENDER_GROUP_ID: "grp1",
            ROR_CLIENT_ID: "ror-test"
          },
          outboundService: fakeOutside
        }
      })
    ],
    test: { setupFiles: ["./test/setup.js"], include: ["test/**/*.test.js"] }
  };
});
