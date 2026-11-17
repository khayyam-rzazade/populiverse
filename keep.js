/* "Save" and "Note" on the things of the site: works in the Library, items of
 * the Monitor, actors, countries, charts of the Data pages and rows of a
 * dataset (master plan, section 18, stage 2, batch 2).
 *
 * This script does nothing at all unless the browser carries the mark the
 * Workspace leaves when a person signs in. A reader who has never signed in
 * makes no request to the server, and every page is exactly as it was before.
 * Nothing a person types is ever written into the page as HTML: every piece of
 * text is set as text.
 *
 * A thing is any element on the page carrying data-keep-kind and data-keep-ref.
 * The buttons go into the element marked data-keep-tools inside it, or into the
 * element itself when that is what it is. The pages that draw their own lists
 * (the Library, the Data pages) put those marks on their rows; this script
 * looks again whenever a page redraws.
 */
(function () {
  "use strict";

  var MARK = "pv-workspace";          // "in" while a person is signed in
  var OPEN_MARK = "pv-workspace-open"; // "yes" once the Workspace is open to all
  var KINDS = { work: 1, item: 1, actor: 1, country: 1, chart: 1 };

  function recall(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function forget(key) {
    try { window.localStorage.removeItem(key); } catch (e) {}
  }

  var signedIn = recall(MARK) === "in";
  var workspaceOpen = recall(OPEN_MARK) === "yes";
  if (!signedIn && !workspaceOpen) return;

  var API = location.hostname === "populiverse.com"
    ? "https://api.populiverse.com"
    : /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://localhost:8787" : null;
  if (!API) return;

  // The folder of the Workspace, from any page of the site. An address that
  // ends in a slash names a folder, and the folder counts as one level.
  var WS = (function () {
    var depth = location.pathname.replace(/^\//, "").split("/").length - 1;
    return (depth ? new Array(depth + 1).join("../") : "") + "workspace/";
  })();

  // ------------------------------------------------------------ small tools

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "text") el.textContent = v;
        else if (k === "class") el.className = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function firstLine(text) {
    var one = String(text || "").replace(/\s+/g, " ").trim();
    return one.length > 120 ? one.slice(0, 119) + "…" : one;
  }

  // The filters standing in the address, in one fixed order, so that the same
  // view of a chart is always the same thing. A chart can name the parts of
  // the address that change what it shows (`only`, a list joined by commas):
  // then only those count, so one same view, in another order or at another
  // year it does not show, is never a second row on the shelf (Fable's check
  // of 16 November, point 8). A chart that names none counts them all, as
  // before. A row saved before keeps its own reference and address, and opens
  // as it always did.
  function viewQuery(only) {
    var out = [];
    var counts = only ? only.split(",") : null;
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (v !== "" && (!counts || counts.indexOf(k) >= 0)) out.push([k, v]);
    });
    out.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    return out.map(function (p) { return p[0] + "=" + p[1]; }).join("&").slice(0, 160);
  }

  function ask(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "include", headers: {} };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API + path, init).then(function (res) {
      return res.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        return { status: res.status, ok: res.ok, data: data || {} };
      });
    }, function () {
      return { status: 0, ok: false, data: {} };
    });
  }

  // ------------------------------------------------------------ what is kept

  var kept = {};                       // kind + ref -> { note: true/false, status }
  var state = { ready: false, guest: false, used: 0, limit: 0 };
  function key(kind, ref) { return kind + "\u0000" + ref; }

  // What this page shows, and where its buttons go.
  function things() {
    var out = [];
    var nodes = document.querySelectorAll("[data-keep-kind][data-keep-ref]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var kind = el.getAttribute("data-keep-kind");
      var ref = el.getAttribute("data-keep-ref");
      if (!KINDS[kind] || !ref) continue;
      if (el.hasAttribute("data-keep-query")) {
        var q = viewQuery(el.getAttribute("data-keep-query"));
        ref = ref + (q ? "?" + q : "");
      }
      out.push({
        el: el,
        kind: kind,
        ref: ref.slice(0, 200),
        tools: el.hasAttribute("data-keep-tools") ? el : el.querySelector("[data-keep-tools]")
      });
    }
    return out;
  }

  function cardOf(t) {
    var el = t.el;
    var card = {
      kind: t.kind,
      ref: t.ref,
      title: el.getAttribute("data-keep-title") || "",
      extra: el.getAttribute("data-keep-extra") || "",
      url: el.getAttribute("data-keep-url") || "",
      year: el.getAttribute("data-keep-year") || "",
      country: el.getAttribute("data-keep-country") || "",
      // The reference the site itself gives for the thing, and its BibTeX
      // where the page has one. Write builds its reference list from these
      // and formats nothing by hand (batch 3).
      cite: el.getAttribute("data-keep-cite") || "",
      bibtex: el.getAttribute("data-keep-bib") || ""
    };
    if (t.kind === "work") {
      var from = el.getAttribute("data-keep-abstract");
      var text = from ? (document.getElementById(from) || {}).textContent : "";
      text = String(text || "").trim();
      // The Library fetches abstracts only when they are first needed; while
      // one is still on its way its place holds a line about waiting, not the
      // text itself (library.js), and that line is not an abstract.
      var waiting = /^(Loading the abstract|The abstract could not be loaded)/i.test(text);
      if (text && text.length > 40 && !waiting) card.abstract = text.slice(0, 6000);
    }
    return card;
  }

  // ------------------------------------------------------------ the controls

  function draw(t) {
    if (!t.tools) return;
    var row = t.tools;
    var mine = kept[key(t.kind, t.ref)];
    var old = row.querySelector(".pv-keep");
    if (old) old.parentNode.removeChild(old);

    var save = h("button", {
      type: "button",
      class: "pv-keep-b" + (mine ? " is-on" : ""),
      "aria-pressed": mine ? "true" : "false",
      text: mine ? "Saved" : "Save",
      onclick: function () { pressSave(t, wrap, save); }
    });
    var note = h("button", {
      type: "button",
      class: "pv-keep-b",
      text: mine && mine.note ? "Edit Note" : "Note",
      onclick: function () { openNote(t, wrap); }
    });
    var wrap = h("span", { class: "pv-keep" }, save, h("span", { class: "pv-keep-dot", "aria-hidden": "true", text: "\u00b7" }), note);
    // A chart the page can draw as a picture can also go straight into a draft,
    // with its source line and the numbers of today (batch 3).
    if (t.kind === "chart" && typeof row.__pvFigure === "function") {
      var send = h("button", {
        type: "button",
        class: "pv-keep-b",
        text: "Send to Write",
        onclick: function () { sendFigure(t, wrap, send); }
      });
      wrap.appendChild(h("span", { class: "pv-keep-dot", "aria-hidden": "true", text: "\u00b7" }));
      wrap.appendChild(send);
    }
    row.appendChild(wrap);
    showNote(t);
  }

  // Draws the picture with the page's own code and sends it to Write. The
  // picture never leaves this site: it goes to our own server and nowhere else.
  function sendFigure(t, wrap, button) {
    if (!signedIn) return invite(t, wrap);
    var maker = (t.tools || t.el).__pvFigure;
    var PV = window.PVData;
    if (typeof maker !== "function" || !PV || !PV.figurePng) return;
    var label = button.textContent;
    button.disabled = true;
    button.textContent = "Drawing the picture\u2026";
    function back() { button.disabled = false; button.textContent = label; }
    PV.figurePng(maker).then(function (fig) {
      fig.ref = t.ref;
      fig.url = location.href.split("#")[0];
      if (!fig.cite) fig.cite = t.el.getAttribute("data-keep-cite") || "";
      return ask("/api/figures", { method: "POST", body: fig }).then(function (r) {
        back();
        if (r.status === 401 || r.status === 403) return signedOut();
        var here = live(t) || wrap;
        if (!r.ok) return sayTo(here, r.data.error || "That picture could not be sent just now.", "error");
        sayTo(here, "Sent to Write. Open a draft and press Insert a Chart or Table.");
      });
    }, function () {
      back();
      sayTo(live(t) || wrap, "The picture could not be drawn just now.", "error");
    });
  }

  // The note's first line, above the buttons, as it stands on the drawn screens.
  function showNote(t) {
    var el = t.el;
    var mine = kept[key(t.kind, t.ref)];
    var host = t.tools || el;
    // The line always stands right before the buttons of this one thing, so
    // that a page full of things never finds another thing's line.
    var before = host.previousElementSibling;
    var line = before && before.className === "pv-keep-line" ? before : null;
    // In a wide table the buttons sit in a cell of their own; a line of text
    // there would break the table, so the note shows on the thing's own page.
    if (/^(TD|TH)$/.test(host.tagName || "")) {
      if (line) line.parentNode.removeChild(line);
      return;
    }
    if (!mine || !mine.note) {
      if (line) line.parentNode.removeChild(line);
      return;
    }
    if (!line) {
      line = h("p", { class: "pv-keep-line" }, h("span", { class: "pv-keep-label", text: "Your Note" }), h("em", { class: "pv-keep-words" }));
      if (host.parentNode) host.parentNode.insertBefore(line, host);
      else el.appendChild(line);
    }
    line.querySelector(".pv-keep-words").textContent = firstLine(mine.note);
  }

  function sayTo(wrap, words, kind) {
    // The page may have drawn its buttons again while we waited, so the line
    // this started from can be off the page by now.
    if (!wrap || !wrap.parentNode) return;
    var said = wrap.parentNode.querySelector(".pv-keep-said");
    if (said) said.parentNode.removeChild(said);
    if (!words) return;
    wrap.parentNode.insertBefore(
      h("span", { class: "pv-keep-said" + (kind ? " is-" + kind : ""), role: "status", text: words }),
      wrap.nextSibling
    );
  }

  function pressSave(t, wrap, button) {
    if (!signedIn) return invite(t, wrap);
    var k = key(t.kind, t.ref);
    var mine = kept[k];
    if (!mine) {
      button.disabled = true;
      ask("/api/keep", { method: "POST", body: cardOf(t) }).then(function (r) {
        button.disabled = false;
        if (r.status === 401 || r.status === 403) return signedOut();
        if (!r.ok) return sayTo(wrap, r.data.error || "That could not be saved just now.", "error");
        var thing = r.data.thing || {};
        kept[k] = fromThing(thing);
        state.used = r.data.used || state.used;
        sayTo(wrap, "");
        redraw();
      });
      return;
    }
    // A second press removes it. A note goes with it, so it is asked first.
    if (mine.note) {
      sayTo(wrap, "");
      var ask1 = h("span", { class: "pv-keep-ask" },
        h("span", { text: "Remove it and your note?" }),
        h("button", { type: "button", class: "pv-keep-b", text: "Remove", onclick: function () { remove(t, wrap); } }),
        h("button", { type: "button", class: "pv-keep-b", text: "Keep", onclick: function () { redraw(); } }));
      clear(wrap);
      wrap.appendChild(ask1);
      return;
    }
    remove(t, wrap);
  }

  // Where this thing's buttons stand on the page right now.
  function live(t) {
    var host = t.tools || t.el;
    return host && host.querySelector ? host.querySelector(".pv-keep") : null;
  }

  function remove(t, wrap) {
    ask("/api/keep", { method: "DELETE", body: { kind: t.kind, ref: t.ref } }).then(function (r) {
      if (r.status === 401 || r.status === 403) return signedOut();
      if (!r.ok && r.status !== 404) return sayTo(wrap, r.data.error || "That could not be removed just now.", "error");
      delete kept[key(t.kind, t.ref)];
      state.used = r.data.used !== undefined ? r.data.used : state.used;
      redraw();
    });
  }

  // The note box, opened in place under the thing.
  function openNote(t, wrap) {
    if (!signedIn) return invite(t, wrap);
    var host = t.tools || t.el;
    var already = t.el.querySelector(".pv-keep-box");
    if (already) { already.parentNode.removeChild(already); return; }
    var mine = kept[key(t.kind, t.ref)];
    var area = h("textarea", { rows: "4", placeholder: "Your note" });
    area.value = mine && mine.note ? mine.note : "";
    var id = "keep-note-" + Math.random().toString(36).slice(2, 9);
    area.id = id;
    var err = h("p", { class: "pv-keep-error", "aria-live": "polite" });
    var box = h("div", { class: "pv-keep-box" },
      h("label", { class: "pv-keep-label", for: id, text: "Your Note" }),
      area,
      err,
      h("p", { class: "pv-keep-row" },
        h("button", { type: "button", class: "pv-button pv-keep-do", text: "Save Note", onclick: keepIt }),
        h("button", { type: "button", class: "pv-keep-b", text: "Cancel", onclick: function () { box.parentNode.removeChild(box); } })));
    if (/^(TD|TH)$/.test(host.tagName || "")) host.appendChild(box);
    else if (host.parentNode) host.parentNode.insertBefore(box, host.nextSibling);
    else t.el.appendChild(box);
    area.focus();

    function keepIt() {
      var body = cardOf(t);
      body.body = area.value;
      err.textContent = "";
      ask("/api/keep/note", { method: "POST", body: body }).then(function (r) {
        if (r.status === 401 || r.status === 403) return signedOut();
        if (!r.ok) { err.textContent = r.data.error || "That note could not be saved just now."; return; }
        var thing = r.data.thing || {};
        kept[key(t.kind, t.ref)] = { note: thing.note ? thing.note.body : false, status: thing.status || null };
        state.used = r.data.used || state.used;
        if (box.parentNode) box.parentNode.removeChild(box);
        redraw();
      });
    }
  }

  // Once the Workspace is open to all, a reader who is not signed in is asked in.
  function invite(t, wrap) {
    var host = t.tools || t.el;
    if (t.el.querySelector(".pv-keep-box")) return;
    var box = h("div", { class: "pv-keep-box" },
      h("p", { class: "pv-keep-lede", text: "Keep it in your Workspace." }),
      h("p", { class: "pv-keep-row" },
        h("a", { class: "pv-button", href: WS, text: "Sign In" }),
        h("a", { class: "pv-button pv-keep-ghost", href: WS + "?guest=1", text: "Try It as a Guest" }),
        h("button", { type: "button", class: "pv-keep-b", text: "Close", onclick: function () { box.parentNode.removeChild(box); } })));
    if (/^(TD|TH)$/.test(host.tagName || "")) host.appendChild(box);
    else if (host.parentNode) host.parentNode.insertBefore(box, host.nextSibling);
  }

  // The session has ended: the page goes back to how it looks for a reader who
  // has not signed in, and the mark in the browser is taken away.
  function signedOut() {
    signedIn = false;
    forget(MARK);
    var gone = document.querySelectorAll(".pv-keep, .pv-keep-line, .pv-keep-box, .pv-keep-said");
    for (var i = 0; i < gone.length; i++) gone[i].parentNode.removeChild(gone[i]);
  }

  // ------------------------------------------------------------ drawing again

  var asked = {};                      // the things already asked about
  var waiting = false;

  function fromThing(thing) {
    return {
      note: thing && thing.note ? thing.note.body : false,
      status: (thing && thing.status) || null,
      tags: (thing && thing.tags) || []
    };
  }

  function redraw() {
    var list = things();
    if (!list.length) return;
    if (waiting) { window.setTimeout(redraw, 150); return; }
    // At most 300 things in one question; the rest are asked about as soon as
    // it is answered, and none is marked as asked before it is sent (Fable's
    // check of batches 2 and 3, point 2).
    var fresh = [];
    var seen = {};
    list.forEach(function (t) {
      var k = key(t.kind, t.ref);
      if (asked[k] || seen[k] || fresh.length >= 300) return;
      seen[k] = true;
      fresh.push({ kind: t.kind, ref: t.ref });
    });
    if (signedIn && fresh.length) return tell(fresh);
    if (!state.ready) return;
    paint(list);
  }

  // One question for the things of this page the server has not been asked
  // about yet. Nothing is drawn until it answers, so a page whose server
  // cannot be reached stays exactly as it is.
  function tell(fresh) {
    if (waiting) { window.setTimeout(redraw, 150); return; }
    waiting = true;
    fresh.forEach(function (f) { asked[key(f.kind, f.ref)] = true; });
    ask("/api/keep/mine", { method: "POST", body: { refs: fresh } }).then(function (r) {
      waiting = false;
      if (r.status === 401 || r.status === 403) { signedOut(); return; }
      if (!r.ok) {
        // Not there just now: these things are asked about again next time.
        fresh.forEach(function (f) { delete asked[key(f.kind, f.ref)]; });
        return;
      }
      (r.data.things || []).forEach(function (thing) {
        kept[key(thing.kind, thing.ref)] = fromThing(thing);
      });
      state.guest = !!r.data.guest;
      state.used = r.data.used || 0;
      state.limit = r.data.limit || 0;
      state.ready = true;
      var now = things();
      paint(now);
      // Things beyond the first 300 of a long page are asked about now.
      if (now.some(function (t) { return !asked[key(t.kind, t.ref)]; })) redraw();
    });
  }

  var painting = false;
  function paint(list) {
    painting = true;
    list.forEach(draw);
    // A work saved before its abstract arrived: the abstract is sent once it is
    // on the page, so that passages can be marked on the shelf.
    list.forEach(function (t) {
      if (t.kind !== "work") return;
      var mine = kept[key(t.kind, t.ref)];
      if (!mine || mine.abstractSent) return;
      var card = cardOf(t);
      if (!card.abstract) return;
      mine.abstractSent = true;
      ask("/api/keep", { method: "POST", body: card });
    });
    window.setTimeout(function () { painting = false; }, 0);
  }

  // The Library, the Data pages and an actor's or a country's page draw their
  // lists a moment after the page has loaded, so this script always watches,
  // even when the page is still empty when it starts (Fable's check of batches
  // 2 and 3, point 1).
  function start() {
    if (!signedIn) state.ready = true;        // the Workspace is open: ask readers in
    redraw();
    watch();
  }

  // The Library and the Data pages draw their lists again as a reader searches
  // or filters; the buttons follow.
  function watch() {
    var timer = null;
    var again = function () {
      if (painting) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(redraw, 150);
    };
    if (window.MutationObserver) {
      new MutationObserver(again).observe(document.body, { childList: true, subtree: true });
    }
    document.addEventListener("pv:view", again);
    window.addEventListener("popstate", again);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
