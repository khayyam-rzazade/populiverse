// The Researcher's Workspace server: api.populiverse.com.
//
// How a request travels:
//   1. Only requests from the site itself (https://populiverse.com) are taken.
//   2. A request for the sign-in goes to the library (auth.js), and only to the
//      few doors of it that the workspace uses; every other door stays shut.
//   3. Every other request passes the one gate below. The gate finds who is
//      asking and whether they may use that route. A route reads and writes only
//      the rows of the person the gate found.

import { getAuth } from "./auth.js";
import { ROUTES } from "./routes.js";
import { nightly } from "./cleanup.js";
import { isEditorEmail } from "./settings.js";
import { takeCode, giveBack } from "./counter.js";
import { json } from "./util.js";

// The doors of the library the workspace uses. Nothing else of it is reachable.
const AUTH_DOORS = new Set([
  "POST /api/auth/email-otp/send-verification-otp",
  "POST /api/auth/sign-in/email-otp",
  "POST /api/auth/sign-in/anonymous",
  "GET /api/auth/get-session",
  "POST /api/auth/sign-out",
  "POST /api/auth/sign-in/social",
  "POST /api/auth/link-social",
  "GET /api/auth/callback/orcid",
  "POST /api/auth/revoke-sessions"
]);

// The ORCID callback is the one door a browser reaches by leaving ORCID's own
// page, so it carries no Origin of ours; the library checks it with its own
// state, which only our sign-in could have made.
const NO_ORIGIN_DOORS = new Set(["GET /api/auth/callback/orcid"]);

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      console.error("workspace error", err?.message);
      const res = json({ error: "Something went wrong on our side. Please try again." }, 500);
      return withCors(res, env, request.headers.get("Origin"));
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(nightly(env));
  }
};

async function handle(request, env, ctx) {
  // Without its secret key the server does not start, rather than run unsafely.
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    return new Response("The workspace is not set up yet.", { status: 503 });
  }
  const url = new URL(request.url);
  const key = `${request.method} ${url.pathname}`;
  const origin = request.headers.get("Origin");

  // The browser asks first whether the site may call the server.
  if (request.method === "OPTIONS") {
    if (origin !== env.SITE_ORIGIN) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors(env) });
  }

  // 1. Only the site itself.
  if (!NO_ORIGIN_DOORS.has(key) && origin !== env.SITE_ORIGIN) {
    return new Response("Not here.", { status: 403 });
  }

  // 2. The sign-in.
  if (url.pathname.startsWith("/api/auth/")) {
    if (!AUTH_DOORS.has(key)) return withCors(json({ error: "Not found." }, 404), env, origin);
    // The door that sends a code: our counter per email address stands in
    // front of it (Fable's review, fix a). Beyond the limit no code is made.
    let taken = null;
    if (key === "POST /api/auth/email-otp/send-verification-otp") {
      const body = await request.clone().json().catch(() => null);
      if (!body || body.type !== "sign-in") return withCors(json({ error: "Not found." }, 404), env, origin);
      if (typeof body.email !== "string") return withCors(json({ error: "Please give a full email address." }, 400), env, origin);
      taken = await takeCode(env, body.email);
      if (!taken) return withCors(json({ error: "Too many codes were asked for this address. Please try again later." }, 429), env, origin);
    }
    // The sign-in door takes the email and the code only, and refuses a
    // request with anything else (Fable's review, fix e).
    if (key === "POST /api/auth/sign-in/email-otp") {
      const body = await request.clone().json().catch(() => null);
      const plain =
        body && typeof body === "object" && !Array.isArray(body) &&
        Object.keys(body).every((k) => k === "email" || k === "otp") &&
        typeof body.email === "string" && typeof body.otp === "string";
      if (!plain) return withCors(json({ error: "Please give your email and the code only." }, 400), env, origin);
    }
    if (key === "POST /api/auth/sign-in/social" || key === "POST /api/auth/link-social") {
      const body = await request.clone().json().catch(() => null);
      if (!body || body.provider !== "orcid") return withCors(json({ error: "Not found." }, 404), env, origin);
    }
    const auth = getAuth(env);
    // ORCID is connected only inside a finished account, never by a guest.
    if (key === "POST /api/auth/link-social") {
      const who = await gate(request, env, auth, "account");
      if (who instanceof Response) return withCors(who, env, origin);
    }
    const res = await auth.handler(request);
    if (taken && !res.ok) await giveBack(env, taken);
    return withCors(res, env, origin);
  }

  // 3. Everything else, through the gate.
  const match = findRoute(request.method, url.pathname);
  if (!match) return withCors(json({ error: "Not found." }, 404), env, origin);
  const auth = getAuth(env);
  const who = await gate(request, env, auth, match.route.access);
  if (who instanceof Response) return withCors(who, env, origin);
  const res = await match.route.handler({ request, env, ctx, url, params: match.params, who, auth });
  return withCors(res, env, origin);
}

// ------------------------------------------------------------------ The gate

// The kinds of access a route can ask for:
//   public       anyone on the site
//   anyone-in    a guest or an account, finished or not
//   account-any  an account (not a guest), finished or not
//   member       a guest or a finished account: may use the Notebook
//   account      a finished account
//   editor       the editor's finished account
export async function gate(request, env, auth, access) {
  if (access === "public") return null;
  const found = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!found?.user || !found?.session) return deny(401, "Please sign in.");

  const user = found.user;
  const guest = !!user.isAnonymous;
  let profile = null;
  if (!guest) {
    profile = await env.DB.prepare("SELECT * FROM profile WHERE user_id = ?").bind(user.id).first();
  }
  const finished = guest || !!profile?.completed_at;
  const editor = !guest && finished && user.emailVerified && isEditorEmail(env, user.email);

  const who = { userId: user.id, guest, finished, editor, user, session: found.session, profile };

  const ok = {
    "anyone-in": true,
    "account-any": !guest,
    member: finished,
    account: !guest && finished,
    editor
  }[access];
  if (!ok) {
    if (guest && access !== "editor") return deny(403, "Sign up to use this.");
    if (!finished && (access === "member" || access === "account")) return deny(403, "Please finish your account first.");
    return deny(403, "Not for this account.");
  }

  // An account's last visit, kept once a day, so that an account unused for two
  // years can be found (master plan, section 18, the row on batch 1).
  if (!guest) {
    const today = new Date().toISOString().slice(0, 10);
    if (!profile || String(profile.last_seen_at || "").slice(0, 10) !== today) {
      await env.DB.prepare(
        `INSERT INTO profile (user_id, last_seen_at) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, warned_at = NULL`
      )
        .bind(user.id, new Date().toISOString())
        .run();
    }
  }
  return who;
}

function deny(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

// ------------------------------------------------------------------ Routing

function findRoute(method, path) {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const names = [];
    const pattern = new RegExp(
      "^" + route.path.replace(/:([a-z]+)/g, (_, n) => (names.push(n), "([A-Za-z0-9_-]{1,64})")) + "$"
    );
    const m = path.match(pattern);
    if (m) return { route, params: Object.fromEntries(names.map((n, i) => [n, m[i + 1]])) };
  }
  return null;
}

// ------------------------------------------------------------------ Answers

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.SITE_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": "Content-Disposition",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}

function withCors(res, env, origin) {
  const out = new Response(res.body, res);
  if (origin === env.SITE_ORIGIN) for (const [k, v] of Object.entries(cors(env))) out.headers.set(k, v);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "no-referrer");
  if (!out.headers.has("Cache-Control")) out.headers.set("Cache-Control", "no-store");
  return out;
}
