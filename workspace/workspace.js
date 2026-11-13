/* PopuliVerse Workspace: the pages of the workspace (sign-in, Notebook, account).
 * Master plan, section 18, stage 2, batch 1.
 *
 * The page talks only to the workspace server, api.populiverse.com. The sign-in
 * itself happens there (the library Better Auth); this file only asks it.
 * Everything a person writes is put on the page as plain text, never as HTML.
 *
 * On populiverse.com the server is api.populiverse.com. On a computer's own
 * preview (localhost) the page looks for a local copy of the server; when there
 * is none (the editor's Mac), it says that sign-in works on populiverse.com.
 */
(function () {
  "use strict";

  // ------------------------------------------------------------ Where things are

  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var API = location.hostname === "populiverse.com" ? "https://api.populiverse.com" : LOCAL ? "http://localhost:8787" : null;
  var HERE = location.origin;
  var BASE = (function () {
    // the folder of the workspace pages, e.g. /workspace/
    var p = location.pathname;
    return p.slice(0, p.lastIndexOf("/") + 1);
  })();
  var PAGES = { home: BASE, account: BASE + "account.html", desk: BASE + "desk.html" };
  var app = document.getElementById("ws-app");
  if (!app) return;
  var VIEW = app.getAttribute("data-view");

  var POSITIONS = ["PhD Candidate", "Postdoctoral Researcher", "Lecturer or Assistant Professor", "Associate Professor", "Professor",
    "Researcher Outside Academia", "Student", "Journalist", "Policy or NGO", "Other"];
  var FIELDS = ["Political Science", "International Relations", "Sociology", "Communication and Media", "History", "Economics",
    "Law", "Philosophy", "Other"];
  var COUNTRY_CODES = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
    "UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");

  // ------------------------------------------------------------ Small tools

  // Builds an element. Text is always set as text, so nothing a person writes
  // can ever run as code on the page.
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "text") el.textContent = v;
        else if (k === "class") el.className = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  // Adds any number of children: elements, text, lists of them; skips empties.
  function add(el) {
    for (var i = 1; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
      else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
  }
  // The name PopuliVerse, with "Verse" in italics, as everywhere on the site.
  function pv() {
    return h("span", { class: "pv-name" }, "Populi", h("em", null, "Verse"));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function show() { clear(app); for (var i = 0; i < arguments.length; i++) add(app, arguments[i]); }
  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }
  var DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
  var DATE_LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
  var TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
  function when(iso) {
    var d = new Date(iso);
    var today = new Date();
    return d.toDateString() === today.toDateString() ? "Today, " + TIME.format(d) : DATE.format(d);
  }
  var REGION = (function () {
    try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { return { of: function (c) { return c; } }; }
  })();
  function countryName(code) { return code ? REGION.of(code) || code : ""; }

  function message(text, kind) {
    return h("div", { class: "pv-ws-note" + (kind ? " is-" + kind : ""), role: kind === "error" ? "alert" : "status" }, text);
  }

  // ------------------------------------------------------------ The server

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "include", headers: {} };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API + path, init).then(function (res) {
      if (opts.raw) return res;
      return res.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        return { status: res.status, ok: res.ok, data: data || {} };
      });
    }, function () {
      return { status: 0, ok: false, data: { error: "The workspace could not be reached. Please check your connection and try again." } };
    });
  }

  function reachable() {
    if (!API) return Promise.resolve(false);
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 4000);
    return fetch(API + "/api/status", { credentials: "include", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { clearTimeout(timer); return r.ok ? r.json() : null; }, function () { clearTimeout(timer); return null; });
  }

  function signOut() {
    return api("/api/auth/sign-out", { method: "POST", body: {} }).then(function () { location.href = PAGES.home; });
  }

  // ------------------------------------------------------------ Start

  var params = new URLSearchParams(location.search);

  reachable().then(function (status) {
    if (!status) return VIEW === "home" ? preview() : previewOther();
    // The library answers "no session" without an error; only then ask for more.
    return api("/api/auth/get-session").then(function (s) {
      return s.ok && s.data && s.data.user ? api("/api/me") : { status: 401, data: {} };
    }).then(function (r) {
      var me = r.status === 200 ? r.data : null;
      if (VIEW === "desk") {
        if (!me || !me.editor) return show(message("This desk is for the editor only.", "error"), back());
        if (window.PVDesk) return window.PVDesk({ api: api, h: h, show: show, app: app, message: message, countryName: countryName, me: me, pv: pv });
        return show(message("The desk could not load. Please reload the page.", "error"));
      }
      if (VIEW === "account") {
        if (!me) return show(message("Please sign in first."), back());
        if (!me.guest && !me.finished) { location.href = PAGES.home; return; }
        return account(me);
      }
      if (!me) return doors(status.open);
      if (!me.guest && !me.finished) return finish(me);
      return notebook(me);
    });
  });

  function back() {
    return h("p", null, h("a", { href: PAGES.home }, "Go to the workspace"));
  }

  // The editor's Mac: the pages are there, the server is not.
  // On the site itself, a server that does not answer means the workspace is
  // not open yet (or is down for a moment); nothing is lost either way.
  function preview() {
    show(
      message(LOCAL
        ? "This is a preview on your own computer. Sign-in works on populiverse.com only, so the doors below do nothing here."
        : "The workspace cannot be reached just now. Please try again a little later."),
      doorsBlock(true, true)
    );
  }
  function previewOther() {
    show(message(LOCAL
      ? "This is a preview on your own computer. This page shows its content on populiverse.com, after sign-in."
      : "The workspace cannot be reached just now. Please try again a little later."), back());
  }

  // ------------------------------------------------------------ The doors

  function doors(open) {
    var notes = [];
    if (params.get("orcid") === "no") {
      notes.push(message(
        "No account has this ORCID iD yet. Sign in or sign up with your email first. Then connect ORCID on your account page, and next time ORCID is enough.",
        "error"
      ));
    }
    if (params.get("signedout")) notes.push(message("You are signed out."));
    show(notes, doorsBlock(open, false));
  }

  function doorsBlock(open, inert) {
    var wrap = h("div", { class: "pv-ws-doors-wrap" });
    add(wrap, h("p", { class: "pv-ws-lede" },
      "Your own place on ", pv(), ". Keep a notebook here now. Soon you will also save works and Monitor items, write notes on them and draft with them."));
    if (!open && !inert) {
      add(wrap, message("The workspace is open by invitation for now. If you were invited, use the email the invitation went to."));
    }
    var grid = h("div", { class: "pv-ws-doors" });
    grid.appendChild(emailDoor(inert, null));
    grid.appendChild(door("Sign In with ORCID", "Once you have connected ORCID in your account, it is all you need.",
      h("button", { class: "pv-button pv-ws-orcid", type: "button", disabled: inert, onclick: orcidSignIn }, "Continue with ORCID")));
    if (open || inert) {
      grid.appendChild(door("Try It as a Guest", "No name, no email. Your pages can be opened from this browser only, until you sign up.",
        h("button", { class: "pv-button pv-ws-ghost", type: "button", disabled: inert, onclick: startGuest }, "Continue as a Guest")));
    }
    add(wrap, grid);
    add(wrap, h("p", { class: "pv-ws-small" }, "No passwords. What an account holds is on the ",
      h("a", { href: "../legal/privacy.html" }, "Privacy page"), "."));
    return wrap;
  }

  function door(title, text, action) {
    return h("section", { class: "pv-ws-door" }, h("h2", { text: title }), h("p", { text: text }), action);
  }

  // Sign in and sign up are the same step: an email, then a code.
  function emailDoor(inert, heading) {
    var box = h("section", { class: "pv-ws-door pv-ws-door-email" });
    var input = h("input", { type: "email", id: "ws-email", autocomplete: "email", required: true, disabled: inert, placeholder: "you@university.edu" });
    var err = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
    var btn = h("button", { class: "pv-button", type: "submit", disabled: inert }, "Send Me a Code");
    var form = h("form", { class: "pv-ws-form", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var email = input.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "Please give a full email address."; input.focus(); return; }
      btn.disabled = true;
      err.textContent = "";
      api("/api/auth/email-otp/send-verification-otp", { method: "POST", body: { email: email, type: "sign-in" } }).then(function (r) {
        btn.disabled = false;
        if (r.status === 429) { err.textContent = "Too many codes asked for. Please try again later."; return; }
        if (!r.ok) { err.textContent = r.data.error || r.data.message || "That did not work. Please try again."; return; }
        codeStep(box, email);
      });
    } },
      h("label", { for: "ws-email", class: "pv-wc-label" }, "Your email"), input, err, btn);
    add(box, h("h2", { text: heading || "Sign In or Sign Up" }),
      h("p", { text: "We send a code to your email. New here? The same code opens a new account." }), form);
    return box;
  }

  function codeStep(box, email) {
    clear(box);
    var input = h("input", { type: "text", id: "ws-code", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", pattern: "[0-9]{6}", required: true });
    var err = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
    var btn = h("button", { class: "pv-button", type: "submit" }, "Sign In");
    var form = h("form", { class: "pv-ws-form", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var code = input.value.replace(/\D/g, "");
      if (code.length !== 6) { err.textContent = "The code has six digits."; input.focus(); return; }
      btn.disabled = true;
      api("/api/auth/sign-in/email-otp", { method: "POST", body: { email: email, otp: code } }).then(function (r) {
        btn.disabled = false;
        if (r.ok) { location.href = PAGES.home; return; }
        if (r.status === 429) err.textContent = "Too many tries. Please wait a few minutes, then ask for a new code.";
        else err.textContent = "That code did not work. It may be wrong, used or older than 10 minutes. Try again, or ask for a new one.";
        input.select();
      });
    } },
      h("label", { for: "ws-code", class: "pv-wc-label" }, "The six-digit code"), input, err, btn);
    add(box,
      h("h2", { text: "Check Your Email" }),
      h("p", null, "We sent a code to ", h("strong", { text: email }), ". It works for 10 minutes. It may take a minute to arrive, and it may be in your spam folder."),
      form,
      h("p", { class: "pv-ws-small" },
        h("button", { class: "pv-lib-link", type: "button", onclick: function () {
          api("/api/auth/email-otp/send-verification-otp", { method: "POST", body: { email: email, type: "sign-in" } }).then(function (r) {
            err.textContent = r.ok ? "A new code is on its way." : r.status === 429 ? "Too many codes asked for. Please try again later." : "That did not work.";
          });
        } }, "Send a new code"),
        " · ",
        h("button", { class: "pv-lib-link", type: "button", onclick: function () {
          var fresh = emailDoor(false, null);
          box.parentNode.replaceChild(fresh, box);
        } }, "Use another email")));
    input.focus();
  }

  function orcidSignIn() {
    api("/api/auth/sign-in/social", { method: "POST", body: {
      provider: "orcid", callbackURL: HERE + PAGES.home, errorCallbackURL: HERE + PAGES.home + "?orcid=no"
    } }).then(function (r) {
      if (r.ok && r.data.url) location.href = r.data.url;
      else alertBox(r.data.error || "ORCID could not be reached. Please try again.");
    });
  }

  function startGuest() {
    api("/api/auth/sign-in/anonymous", { method: "POST", body: {} }).then(function (r) {
      if (r.ok) location.href = PAGES.home;
      else alertBox(r.status === 429 ? "Too many guests from here. Please try again later." : "The guest door is closed for now.");
    });
  }

  function alertBox(text) {
    app.insertBefore(message(text, "error"), app.firstChild);
  }

  // ------------------------------------------------------------ The account form

  // Used to finish an account and, later, to change it.
  function detailsForm(me, opts) {
    var errs = {};
    function field(id, label, control, hint) {
      errs[id] = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
      return h("div", { class: "pv-ws-field" }, h("label", { for: "ws-" + id, class: "pv-wc-label" }, label), control,
        hint ? h("p", { class: "pv-ws-hint", text: hint }) : null, errs[id]);
    }
    function select(id, list, value, empty) {
      var s = h("select", { id: "ws-" + id }, h("option", { value: "" }, empty));
      list.forEach(function (v) { s.appendChild(h("option", { value: v, selected: v === value }, v)); });
      return s;
    }

    var name = h("input", { type: "text", id: "ws-name", autocomplete: "name", maxlength: "120", required: true, value: me.name || "" });

    // The institution: picked from ROR, or typed by hand with its country.
    var inst = { rorId: me.rorId || null, name: me.institution || "", country: me.country || "", typed: !me.rorId && !!me.institution };
    var instBox = h("div", { class: "pv-ws-inst" });
    function drawInst() {
      clear(instBox);
      if (inst.rorId) {
        add(instBox, h("p", { class: "pv-ws-picked" },
          h("strong", { text: inst.name }), inst.country ? ", " + countryName(inst.country) : "", " ",
          h("button", { class: "pv-lib-link", type: "button", onclick: function () { inst.rorId = null; inst.name = ""; drawInst(); } }, "Change")));
        return;
      }
      if (inst.typed) {
        var t = h("input", { type: "text", id: "ws-institution", maxlength: "200", value: inst.name, oninput: function () { inst.name = t.value; } });
        var codes = COUNTRY_CODES.slice().sort(function (a, b) { return countryName(a).localeCompare(countryName(b)); });
        var c = h("select", { id: "ws-country", onchange: function () { inst.country = c.value; } }, h("option", { value: "" }, "Country of the institution"));
        codes.forEach(function (code) { c.appendChild(h("option", { value: code, selected: code === inst.country }, countryName(code))); });
        add(instBox, t, c, h("p", { class: "pv-ws-hint" },
          h("button", { class: "pv-lib-link", type: "button", onclick: function () { inst.typed = false; inst.name = ""; drawInst(); } }, "Search the list instead")));
        return;
      }
      var q = h("input", { type: "text", id: "ws-institution", role: "combobox", "aria-expanded": "false", "aria-controls": "ws-inst-list",
        "aria-autocomplete": "list", autocomplete: "off", placeholder: "Type a few letters of your university or institute" });
      var list = h("ul", { id: "ws-inst-list", class: "pv-ws-suggest", role: "listbox", hidden: true });
      var note = h("p", { class: "pv-ws-hint" });
      var search = debounce(function () {
        var v = q.value.trim();
        if (v.length < 2) { list.hidden = true; q.setAttribute("aria-expanded", "false"); return; }
        api("/api/ror?q=" + encodeURIComponent(v)).then(function (r) {
          clear(list);
          var items = (r.data && r.data.items) || [];
          note.textContent = r.data && r.data.unavailable ? "The list of institutions cannot be reached just now. Please type yours by hand." : "";
          items.forEach(function (o) {
            list.appendChild(h("li", { role: "option", tabindex: "-1", onclick: function () {
              inst.rorId = o.id; inst.name = o.name; inst.country = o.country; drawInst();
            }, onkeydown: function (e) { if (e.key === "Enter") { e.preventDefault(); this.click(); } } },
              h("span", { text: o.name }), h("span", { class: "pv-ws-suggest-where", text: [o.city, o.countryName].filter(Boolean).join(", ") })));
          });
          list.hidden = !items.length;
          q.setAttribute("aria-expanded", items.length ? "true" : "false");
        });
      }, 300);
      q.addEventListener("input", search);
      q.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" && !list.hidden && list.firstChild) { e.preventDefault(); list.firstChild.focus(); }
      });
      list.addEventListener("keydown", function (e) {
        var cur = document.activeElement;
        if (e.key === "ArrowDown" && cur.nextSibling) { e.preventDefault(); cur.nextSibling.focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); (cur.previousSibling || q).focus(); }
      });
      add(instBox, q, list, note, h("p", { class: "pv-ws-hint" }, "From ROR, the open list of research institutions. Not in the list? ",
        h("button", { class: "pv-lib-link", type: "button", onclick: function () { inst.typed = true; inst.name = q.value; drawInst(); } }, "Type it yourself")));
    }
    drawInst();

    var position = select("position", POSITIONS, me.position, "Position (if you wish)");
    var fieldSel = select("field", FIELDS, me.field, "Field (if you wish)");
    var news = opts.newsletter ? h("input", { type: "checkbox", id: "ws-news" }) : null;
    var formErr = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
    var btn = h("button", { class: "pv-button", type: "submit" }, opts.button);

    var form = h("form", { class: "pv-ws-form pv-ws-details", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      Object.keys(errs).forEach(function (k) { errs[k].textContent = ""; });
      formErr.textContent = "";
      var body = { name: name.value, position: position.value, field: fieldSel.value };
      if (inst.rorId) body.rorId = inst.rorId;
      else { body.institution = inst.name; body.country = inst.country; }
      if (news) body.newsletter = news.checked;
      btn.disabled = true;
      api("/api/me", { method: "PATCH", body: body }).then(function (r) {
        btn.disabled = false;
        if (r.ok) return opts.done();
        var f = r.data.fields || {};
        Object.keys(f).forEach(function (k) { (errs[k === "country" ? "institution" : k] || formErr).textContent = f[k]; });
        if (!Object.keys(f).length) formErr.textContent = r.data.error || "That did not work. Please try again.";
      });
    } },
      field("name", "Your name", name),
      field("institution", "Your institution", instBox),
      h("div", { class: "pv-ws-pair" }, field("position", "Position", position), field("field", "Field", fieldSel)),
      news ? h("p", { class: "pv-ws-check" }, news, h("label", { for: "ws-news" }, "Send me the monthly newsletter")) : null,
      formErr, btn);
    return form;
  }

  function finish(me) {
    show(
      h("section", { class: "pv-ws-narrow" },
        h("h2", { class: "pv-ws-h", text: "Finish Your Account" }),
        h("p", null, "Signed in as ", h("strong", { text: me.email }), ". Three things, and you are in."),
        detailsForm(me, { newsletter: true, button: "Finish", done: function () { location.href = PAGES.home + "?welcome=1"; } }),
        h("p", { class: "pv-ws-small" }, "Not you? ", h("button", { class: "pv-lib-link", type: "button", onclick: signOut }, "Sign out"))));
  }

  // ------------------------------------------------------------ The bar on top

  function topBar(me, here) {
    var links = [];
    if (here !== "home") links.push(h("a", { href: PAGES.home }, "Notebook"));
    if (here !== "account") links.push(h("a", { href: PAGES.account }, me.guest ? "Your Pages" : "Account"));
    if (me.editor && here !== "desk") links.push(h("a", { href: PAGES.desk }, "Your Desk"));
    links.push(h("button", { class: "pv-lib-link", type: "button", onclick: signOut }, "Sign Out"));
    var who = me.guest ? h("span", null, "You are a ", h("strong", null, "guest")) : h("span", null, "Signed in as ", h("strong", { text: me.name }));
    var bar = h("div", { class: "pv-ws-bar" }, who, h("span", { class: "pv-ws-bar-links" }, links.map(function (l, i) {
      return i ? [h("span", { class: "pv-ws-dot", "aria-hidden": "true", text: "·" }), l] : l;
    })));
    var out = [bar];
    if (me.guest) {
      out.push(h("div", { class: "pv-ws-guest" },
        h("p", null, "Your pages can be opened from this browser only. Clearing the browser, signing out or a new device loses them. ",
          h("strong", null, "Sign up to keep them.")),
        h("button", { class: "pv-button", type: "button", onclick: function () {
          var slot = document.getElementById("ws-guest-signup");
          clear(slot);
          slot.appendChild(emailDoor(false, "Sign Up to Keep Your Pages"));
          slot.hidden = false;
          slot.querySelector("input").focus();
        } }, "Sign Up"),
        h("div", { id: "ws-guest-signup", class: "pv-ws-guest-signup", hidden: true })));
    }
    return out;
  }

  // ------------------------------------------------------------ The Notebook

  function notebook(me) {
    var state = { pages: [], open: null, base: null, dirty: false, saving: false, q: "", limit: null };
    var listEl = h("ul", { class: "pv-ws-list" });
    var count = h("p", { class: "pv-ws-count" });
    var search = h("input", { type: "search", id: "ws-search", placeholder: "Search your pages", "aria-label": "Search your pages" });
    var editor = h("div", { class: "pv-ws-editor" });
    var shell = h("div", { class: "pv-ws-notebook" },
      // A plain div: Quarto moves an <aside> into the page margin.
      h("div", { class: "pv-ws-side" },
        h("div", { class: "pv-ws-side-head" },
          h("h2", { class: "pv-ws-h", text: "Notebook" }),
          h("button", { class: "pv-button", type: "button", onclick: newPage }, "New Page")),
        search, count, listEl),
      editor);

    var notes = [];
    if (params.get("welcome")) {
      notes.push(message("Your account is ready. You can connect your ORCID iD on your account page, so that next time ORCID is enough."));
      history.replaceState(null, "", PAGES.home);
    }
    show(topBar(me, "home"), notes, shell);
    search.addEventListener("input", debounce(function () { state.q = search.value.trim(); load(); }, 300));
    load().then(function () { if (!state.open) blank(); });

    window.addEventListener("beforeunload", function (e) {
      if (state.dirty || state.saving) { e.preventDefault(); e.returnValue = ""; }
    });

    function load() {
      return api("/api/pages" + (state.q ? "?q=" + encodeURIComponent(state.q) : "")).then(function (r) {
        if (!r.ok) { clear(listEl); listEl.appendChild(h("li", { class: "pv-ws-empty", text: r.data.error || "Your pages could not be loaded." })); return; }
        state.pages = r.data.pages;
        state.limit = r.data.limit;
        drawList();
      });
    }

    function drawList() {
      clear(listEl);
      if (!state.pages.length) {
        listEl.appendChild(h("li", { class: "pv-ws-empty", text: state.q ? "No page has these words." : "No pages yet." }));
      }
      state.pages.forEach(function (p) {
        var first = (p.snippet || "").split("\n").filter(Boolean)[0] || "";
        listEl.appendChild(h("li", null, h("button", {
          type: "button", class: "pv-ws-item" + (state.open && state.open.id === p.id ? " is-open" : ""),
          "aria-current": state.open && state.open.id === p.id ? "true" : null,
          onclick: function () { openPage(p.id); }
        }, h("span", { class: "pv-ws-item-t", text: p.title || "Untitled" }),
          first ? h("span", { class: "pv-ws-item-s", text: first }) : null,
          h("span", { class: "pv-ws-item-d", text: when(p.updated_at) }))));
      });
      count.textContent = state.q ? state.pages.length + (state.pages.length === 1 ? " page found" : " pages found")
        : state.pages.length + (state.pages.length === 1 ? " page" : " pages") + (me.guest ? " of " + state.limit + " a guest can keep" : "");
    }

    function blank() {
      shell.classList.remove("is-open");
      clear(editor);
      add(editor, h("div", { class: "pv-ws-blank" },
        h("p", { class: "pv-ws-blank-t", text: state.pages.length ? "Pick a page, or start a new one." : "Your Notebook is empty." }),
        h("p", { text: "Pages are plain text, saved as you type. Only you can open them." }),
        h("button", { class: "pv-button", type: "button", onclick: newPage }, "Start a Page")));
    }

    function newPage() {
      flush().then(function () {
        // The open page leaves the screen at once, so nothing typed now lands in it.
        state.open = null;
        clear(editor);
        add(editor, h("p", { class: "pv-lib-loading", text: "Starting a new page…" }));
        return api("/api/pages", { method: "POST", body: { title: "", body: "" } });
      }).then(function (r) {
        if (!r.ok) { alertBox(r.data.error || "A new page could not be made."); return; }
        state.q = ""; search.value = "";
        return load().then(function () { draw(r.data.page, true); });
      });
    }

    function openPage(id) {
      flush().then(function () { return api("/api/pages/" + encodeURIComponent(id)); }).then(function (r) {
        if (r.ok) draw(r.data.page, false);
        else load();
      });
    }

    var titleEl, bodyEl, statusEl;
    function draw(page, fresh) {
      state.open = page;
      state.base = page.updated_at;
      state.dirty = false;
      shell.classList.add("is-open");
      drawList();
      clear(editor);
      titleEl = h("input", { type: "text", class: "pv-ws-title", maxlength: "200", placeholder: "Title", "aria-label": "Title of the page", value: page.title });
      bodyEl = h("textarea", { class: "pv-ws-body", placeholder: "Write here.", "aria-label": "Text of the page" });
      bodyEl.value = page.body;
      statusEl = h("span", { class: "pv-ws-status", "aria-live": "polite", text: "Saved" });
      var del = h("button", { class: "pv-lib-link", type: "button", onclick: function () { confirmDelete(del); } }, "Delete this page");
      add(editor,
        h("div", { class: "pv-ws-editor-head" },
          h("button", { class: "pv-lib-link pv-ws-backlist", type: "button", onclick: function () { flush().then(function () { state.open = null; drawList(); blank(); }); } }, "← All pages"),
          statusEl),
        titleEl, bodyEl,
        h("div", { class: "pv-ws-editor-foot" },
          h("span", { class: "pv-ws-dates", text: "Started " + DATE_LONG.format(new Date(page.created_at)) }), del));
      var changed = function () { state.dirty = true; statusEl.textContent = "Not saved yet"; save(); };
      titleEl.addEventListener("input", changed);
      bodyEl.addEventListener("input", changed);
      (fresh ? titleEl : bodyEl).focus();
    }

    var save = debounce(function () { flush(); }, 900);

    function flush() {
      if (!state.open || !state.dirty) return Promise.resolve();
      if (state.saving) return state.saving;
      var page = state.open;
      var sent = { title: titleEl.value, body: bodyEl.value, base: state.base };
      state.dirty = false;
      statusEl.textContent = "Saving…";
      state.saving = api("/api/pages/" + encodeURIComponent(page.id), { method: "PATCH", body: sent }).then(function (r) {
        state.saving = false;
        if (r.ok) {
          state.base = r.data.updated_at;
          page.title = sent.title; page.body = sent.body; page.updated_at = r.data.updated_at;
          var item = state.pages.filter(function (p) { return p.id === page.id; })[0];
          if (item) { item.title = sent.title; item.snippet = sent.body.slice(0, 240); item.updated_at = r.data.updated_at; }
          state.pages.sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; });
          drawList();
          if (state.dirty) return flush();
          statusEl.textContent = "Saved";
          return;
        }
        state.dirty = true;
        if (r.status === 409) {
          statusEl.textContent = "";
          editor.insertBefore(h("div", { class: "pv-ws-note is-error", role: "alert" },
            "This page was changed in another window. Copy what you wrote here if you need it, then ",
            h("button", { class: "pv-lib-link", type: "button", onclick: function () { state.dirty = false; openPage(page.id); } }, "load the newest text"), "."),
            editor.firstChild);
          return;
        }
        statusEl.textContent = r.status === 401 ? "Not saved: you are signed out." : r.data.error ? "Not saved: " + r.data.error : "Not saved. Trying again…";
        if (r.status === 0 || r.status >= 500) setTimeout(function () { flush(); }, 5000);
      });
      return state.saving;
    }

    function confirmDelete(btn) {
      var row = btn.parentNode;
      var ask = h("span", { class: "pv-ws-ask" }, "Delete this page for good? ",
        h("button", { class: "pv-lib-link", type: "button", onclick: function () {
          api("/api/pages/" + encodeURIComponent(state.open.id), { method: "DELETE" }).then(function (r) {
            if (!r.ok && r.status !== 404) { alertBox(r.data.error || "The page could not be deleted."); return; }
            state.open = null; state.dirty = false;
            load().then(blank);
          });
        } }, "Yes, delete"), " · ",
        h("button", { class: "pv-lib-link", type: "button", onclick: function () { row.replaceChild(btn, ask); } }, "Keep it"));
      row.replaceChild(ask, btn);
    }
  }

  // ------------------------------------------------------------ The account page

  function account(me) {
    var blocks = [topBar(me, "account")];
    var notes = [];
    if (params.get("orcid") === "yes") notes.push(message("Your ORCID iD is connected. Next time, ORCID is enough to sign in."));
    if (params.get("orcid") === "no") {
      notes.push(message(params.get("error") === "account_already_linked_to_different_user"
        ? "This ORCID iD is already connected to another account."
        : "ORCID was not connected. Please try again.", "error"));
    }
    if (params.get("orcid")) history.replaceState(null, "", PAGES.account);

    if (me.guest) {
      blocks.push(notes, section("Your Pages", [
        h("p", { text: "As a guest you keep " + me.pages + (me.pages === 1 ? " page" : " pages") + " in this browser. Sign up from the Notebook to keep them for good." }),
        downloadButton()
      ]));
      return show(blocks);
    }

    var saved = h("p", { class: "pv-ws-saved", "aria-live": "polite" });
    blocks.push(notes,
      section("Your Details", [
        h("p", { class: "pv-ws-small" }, "Email: ", h("strong", { text: me.email }), ". Member since " + DATE_LONG.format(new Date(me.since)) + "."),
        detailsForm(me, { button: "Save", done: function () { saved.textContent = "Saved."; } }), saved
      ]),
      section("ORCID", me.orcid
        ? [h("p", null, "Connected: ", h("a", { href: "https://orcid.org/" + me.orcid, rel: "noopener", text: "https://orcid.org/" + me.orcid }),
            ". You can sign in with ORCID."),
          h("button", { class: "pv-lib-link", type: "button", onclick: function () {
            api("/api/me/orcid", { method: "DELETE" }).then(function () { location.reload(); });
          } }, "Disconnect ORCID")]
        : [h("p", { text: "Connect your ORCID iD, and you can sign in with ORCID from then on." }),
          h("button", { class: "pv-button pv-ws-orcid", type: "button", onclick: function () {
            api("/api/auth/link-social", { method: "POST", body: {
              provider: "orcid", callbackURL: HERE + PAGES.account + "?orcid=yes", errorCallbackURL: HERE + PAGES.account + "?orcid=no"
            } }).then(function (r) {
              if (r.ok && r.data.url) location.href = r.data.url;
              else alertBox("ORCID could not be reached. Please try again.");
            });
          } }, "Connect ORCID")]),
      section("Newsletter", me.newsletter
        ? [h("p", { text: "You asked for the monthly newsletter on " + DATE_LONG.format(new Date(me.newsletterAt)) + ". Every newsletter has a link to unsubscribe." })]
        : [h("p", null, "You are not on the newsletter list from here. See the ", h("a", { href: "../newsletter/index.html" }, "Newsletter page"), ".")]),
      section("Your Data", [
        h("p", { text: "One file with everything you keep here: your account and a plain-text file for each page. It opens without PopuliVerse." }),
        downloadButton()
      ]),
      section("Sign Out Everywhere", [
        h("p", { text: "Ends every session of this account, on every device, this one too." }),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () {
          api("/api/auth/revoke-sessions", { method: "POST", body: {} }).then(function () { location.href = PAGES.home + "?signedout=1"; });
        } }, "Sign out everywhere")
      ]),
      deleteSection(me));
    show(blocks);
  }

  function section(title, content) {
    return h("section", { class: "pv-ws-section" }, h("h2", { class: "pv-ws-h", text: title }), content);
  }

  function downloadButton() {
    var note = h("span", { class: "pv-ws-small", "aria-live": "polite" });
    var btn = h("button", { class: "pv-button", type: "button", onclick: function () {
      btn.disabled = true;
      note.textContent = " Preparing the file…";
      api("/api/me/export", { raw: true }).then(function (res) {
        btn.disabled = false;
        if (!res || !res.ok) { note.textContent = " The file could not be made. Please try again."; return; }
        var cd = res.headers.get("Content-Disposition") || "";
        var name = (cd.match(/filename="([^"]+)"/) || [])[1] || "populiverse-workspace.zip";
        return res.blob().then(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = h("a", { href: url, download: name });
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
          note.textContent = " Downloaded.";
        });
      }, function () { btn.disabled = false; note.textContent = " The file could not be made. Please try again."; });
    } }, "Download Everything");
    return h("p", null, btn, note);
  }

  function deleteSection(me) {
    var box = h("input", { type: "checkbox", id: "ws-del" });
    var err = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
    var btn = h("button", { class: "pv-button pv-ws-danger", type: "button", onclick: function () {
      if (!box.checked) { err.textContent = "Please tick the box first."; return; }
      btn.disabled = true;
      api("/api/me", { method: "DELETE", body: { confirm: "delete" } }).then(function (r) {
        btn.disabled = false;
        if (r.ok) { location.href = PAGES.home + "?signedout=1"; return; }
        if (r.data.fresh === false) {
          clear(err);
          add(err, "For safety, deleting needs a sign-in in the last 15 minutes. ",
            h("button", { class: "pv-lib-link", type: "button", onclick: signOut }, "Sign out and sign in again"), ", then come back here.");
          return;
        }
        err.textContent = r.data.error || "That did not work. Please try again.";
      });
    } }, "Delete My Account");
    return h("section", { class: "pv-ws-section pv-ws-delete" },
      h("h2", { class: "pv-ws-h", text: "Delete Your Account" }),
      h("p", { text: "Your account and every page in it are deleted at once, and cannot be brought back. Download them first if you want a copy." +
        (me.newsletter ? " The newsletter is separate: to leave it, use the link in any newsletter." : "") }),
      h("p", { class: "pv-ws-check" }, box, h("label", { for: "ws-del" }, "I understand that this deletes my account and all my pages")),
      err, btn);
  }

  // Shared with desk.js
  window.PVW = { api: api, h: h, debounce: debounce, countryName: countryName, DATE_LONG: DATE_LONG, topBar: topBar };
})();
