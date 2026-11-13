// A small stand-in for a browser: it keeps cookies, sends the site's Origin,
// and reads the sign-in codes from a captured outbox instead of a real inbox.

import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";

export const SITE = "https://populiverse.com";
export const API = "https://api.populiverse.com";
export const EDITOR = "editor@populiverse.com";

export function makeWorld() {
  const outbox = [];
  const world = {
    outbox,
    env: {
      ...env,
      EMAIL: {
        async send(m) {
          outbox.push(m);
          return { messageId: "<test@populiverse.com>" };
        }
      }
    }
  };
  return world;
}

export async function setOpen(open) {
  await env.DB.prepare("UPDATE setting SET value = ? WHERE key = 'open'").bind(open ? "yes" : "no").run();
}

export async function invite(email) {
  await env.DB.prepare("INSERT OR IGNORE INTO invite (email, invited_at) VALUES (?, ?)").bind(email, new Date().toISOString()).run();
}

let ipCounter = 1;

export class Browser {
  constructor(world) {
    this.world = world;
    this.jar = new Map();
    this.ip = `203.0.113.${ipCounter++ % 250}`;
  }

  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async fetch(path, { method = "GET", body, origin = SITE, headers = {}, cookie } = {}) {
    const h = new Headers(headers);
    if (origin) h.set("Origin", origin);
    h.set("cf-connecting-ip", this.ip);
    if (body !== undefined) h.set("Content-Type", "application/json");
    const c = cookie ?? this.cookieHeader();
    if (c) h.set("Cookie", c);
    const req = new Request(path.startsWith("http") ? path : API + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      redirect: "manual"
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, this.world.env, ctx);
    await waitOnExecutionContext(ctx);
    for (const sc of res.headers.getSetCookie()) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1);
      if (/max-age=0/i.test(sc) || v === "") this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }

  async json(path, opts) {
    const res = await this.fetch(path, opts);
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, data, res };
  }

  async askCode(email) {
    return this.json("/api/auth/email-otp/send-verification-otp", { method: "POST", body: { email, type: "sign-in" } });
  }

  lastCode(email) {
    const mail = [...this.world.outbox].reverse().find((m) => m.to === email.trim().toLowerCase());
    const m = mail && mail.subject.match(/(\d{6})/);
    return m ? m[1] : null;
  }

  async useCode(email, otp) {
    return this.json("/api/auth/sign-in/email-otp", { method: "POST", body: { email, otp } });
  }

  async signIn(email) {
    await this.askCode(email);
    const code = this.lastCode(email);
    if (!code) throw new Error("no code arrived for " + email);
    return this.useCode(email, code);
  }

  async finish(fields = {}) {
    return this.json("/api/me", {
      method: "PATCH",
      body: { name: "Test Person", rorId: "0107c5v14", position: "Professor", field: "Political Science", ...fields }
    });
  }

  async signUp(email, fields) {
    const r = await this.signIn(email);
    if (r.status !== 200) throw new Error("sign-in failed: " + JSON.stringify(r.data));
    const f = await this.finish(fields);
    if (f.status !== 200) throw new Error("finish failed: " + JSON.stringify(f.data));
    return f;
  }

  async guest() {
    return this.json("/api/auth/sign-in/anonymous", { method: "POST", body: {} });
  }

  async newPage(title, body) {
    return this.json("/api/pages", { method: "POST", body: { title, body } });
  }
}
