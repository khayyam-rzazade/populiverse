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
  var PAGES = { home: BASE, notes: BASE + "notes.html", notebook: BASE + "notebook.html",
    write: BASE + "write.html", projects: BASE + "projects.html", tools: BASE + "tools.html",
    account: BASE + "account.html", desk: BASE + "desk.html" };
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

  // The one mark the rest of the site reads: while it is there, the page script
  // keep.js draws "Save" and "Note"; while it is not, a reader makes no request
  // to the server at all and every page is exactly as it was (master plan,
  // section 18, stage 2, batch 2). The server never trusts it: it asks the gate.
  var MARK = "pv-workspace";
  var OPEN_MARK = "pv-workspace-open";
  function remember(signedIn, open) {
    try {
      if (signedIn) window.localStorage.setItem(MARK, "in");
      else window.localStorage.removeItem(MARK);
      if (open) window.localStorage.setItem(OPEN_MARK, "yes");
      else window.localStorage.removeItem(OPEN_MARK);
    } catch (e) { /* a browser that keeps nothing: the Workspace still works */ }
  }

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
    return api("/api/auth/sign-out", { method: "POST", body: {} }).then(function () {
      remember(false, true);
      location.href = PAGES.home;
    });
  }

  // ------------------------------------------------------------ The trial note

  // The Workspace is new. One quiet line at the top of its pages says so, in
  // the editor's own words, with a way to write to him. It says nothing that
  // could make anyone fear for their work. A reader can hide it, and this
  // browser remembers that (master plan, section 18, the open trial).
  var TRIAL_MARK = "pv-workspace-trial-note";
  (function trialNote() {
    try { if (window.localStorage.getItem(TRIAL_MARK) === "hidden") return; } catch (e) { /* no storage: show it */ }
    var note = h("div", { class: "pv-ws-trial", role: "note" },
      h("p", { class: "pv-ws-trial-t" },
        "The Workspace is new and we are still making it better. Everything you save stays yours and is not going anywhere. If something feels missing or awkward, ",
        h("a", { href: "mailto:editor@populiverse.com" }, "write to the editor"),
        " and tell us what would help."),
      h("button", { class: "pv-lib-link pv-ws-trial-x", type: "button", "aria-label": "Hide this note", onclick: function () {
        try { window.localStorage.setItem(TRIAL_MARK, "hidden"); } catch (e) { /* hidden for this visit only */ }
        if (note.parentNode) note.parentNode.removeChild(note);
      } }, "Hide"));
    app.parentNode.insertBefore(note, app);
  })();

  // ------------------------------------------------------------ Start

  var params = new URLSearchParams(location.search);

  reachable().then(function (status) {
    if (!status) return VIEW === "shelf" ? preview() : previewOther();
    // The library answers "no session" without an error; only then ask for more.
    return api("/api/auth/get-session").then(function (s) {
      return s.ok && s.data && s.data.user ? api("/api/me") : { status: 401, data: {} };
    }).then(function (r) {
      var me = r.status === 200 ? r.data : null;
      remember(!!me, !!status.open);
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
      if (VIEW === "notes") return notes(me);
      if (VIEW === "notebook") return notebook(me);
      // Write, Projects and Tools live in write.js, loaded beside this file.
      if (VIEW === "write" || VIEW === "projects" || VIEW === "tools") {
        if (window.PVWrite) return window.PVWrite(me, VIEW);
        return show(message("This page could not load. Please reload it.", "error"));
      }
      return shelf(me);
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

  // A try with ORCID that found no account comes back here with ?orcid=no. Its
  // message stands inside the ORCID box, as an error, and the address is
  // tidied so that a reload does not show it again (the live check before the
  // trial, point 2c).
  function doors(open) {
    var notes = [];
    var orcidRefused = params.get("orcid") === "no";
    if (orcidRefused) {
      try { history.replaceState(null, "", PAGES.home); } catch (e) {}
    }
    if (params.get("signedout")) notes.push(message("You are signed out."));
    show(notes, doorsBlock(open, false, orcidRefused));
    var refused = app.querySelector(".pv-ws-door-error");
    if (refused && refused.scrollIntoView) refused.scrollIntoView({ block: "center" });
  }

  function doorsBlock(open, inert, orcidRefused) {
    var wrap = h("div", { class: "pv-ws-doors-wrap" });
    add(wrap, h("p", { class: "pv-ws-lede" },
      "Your own place on ", pv(), ". Save a work, a Monitor item, an actor, a country or a chart, write a note on any of them, keep a notebook, and write a draft that cites them. A project holds it all in one view."));
    if (!open && !inert) {
      add(wrap, message("The workspace is open by invitation for now. If you were invited, use the email the invitation went to."));
    }
    var grid = h("div", { class: "pv-ws-doors" });
    grid.appendChild(emailDoor(inert, null));
    var orcid = door("Sign In with ORCID",
      "New here? Sign in with your email first, then connect ORCID on your account page. After that, ORCID is all you need.",
      h("button", { class: "pv-button pv-ws-orcid", type: "button", disabled: inert, onclick: orcidSignIn }, "Continue with ORCID"));
    if (orcidRefused) {
      orcid.insertBefore(h("p", { class: "pv-ws-door-error", role: "alert" },
        "No account has this ORCID iD yet. Sign in or sign up with your email first. Then connect ORCID on your account page, and next time ORCID is enough."),
        orcid.lastChild);
    }
    grid.appendChild(orcid);
    if (open || inert) {
      grid.appendChild(door("Try It as a Guest", "No name, no email. Your work can be opened from this browser only, until you sign up.",
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

    // The name in three boxes (Fable's check of batches 2 and 3, point 16).
    var firstName = h("input", { type: "text", id: "ws-firstName", autocomplete: "given-name", maxlength: "120", required: true, value: me.firstName || "" });
    var middleName = h("input", { type: "text", id: "ws-middleName", autocomplete: "additional-name", maxlength: "120", value: me.middleName || "" });
    var surname = h("input", { type: "text", id: "ws-surname", autocomplete: "family-name", maxlength: "120", required: true, value: me.surname || "" });
    var names = h("div", { class: "pv-ws-names" },
      field("firstName", "First Name", firstName),
      field("middleName", "Middle Name (if any)", middleName),
      field("surname", "Surname", surname));

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

    // A field's red line goes as soon as the field is put right, not only at
    // the next press of the button (the live check before the trial, point 4).
    // The server still checks everything when the form is sent.
    var LETTER = /\p{L}/u;
    function settle(id, ok) {
      if (errs[id] && ok) errs[id].textContent = "";
    }
    firstName.addEventListener("input", function () { settle("firstName", LETTER.test(firstName.value)); });
    surname.addEventListener("input", function () { settle("surname", LETTER.test(surname.value)); });
    position.addEventListener("change", function () { settle("position", true); });
    fieldSel.addEventListener("change", function () { settle("field", true); });
    // The institution box is drawn again as it changes; one listener on it
    // hears the typed name, the country and a pick from the list alike.
    function instDone() {
      return !!inst.rorId || (inst.typed && inst.name.trim().length >= 2 && !!inst.country);
    }
    instBox.addEventListener("input", function () { settle("institution", instDone()); });
    instBox.addEventListener("change", function () { settle("institution", instDone()); });
    instBox.addEventListener("click", function () { window.setTimeout(function () { settle("institution", instDone()); }, 0); });
    var news = opts.newsletter ? h("input", { type: "checkbox", id: "ws-news" }) : null;
    var formErr = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
    var btn = h("button", { class: "pv-button", type: "submit" }, opts.button);

    var form = h("form", { class: "pv-ws-form pv-ws-details", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      Object.keys(errs).forEach(function (k) { errs[k].textContent = ""; });
      formErr.textContent = "";
      var body = { firstName: firstName.value, middleName: middleName.value, surname: surname.value };
      if (!opts.nameOnly) {
        body.position = position.value;
        body.field = fieldSel.value;
        if (inst.rorId) body.rorId = inst.rorId;
        else { body.institution = inst.name; body.country = inst.country; }
        if (news) body.newsletter = news.checked;
      }
      btn.disabled = true;
      api("/api/me", { method: "PATCH", body: body }).then(function (r) {
        btn.disabled = false;
        if (r.ok) return opts.done();
        var f = r.data.fields || {};
        Object.keys(f).forEach(function (k) { (errs[k === "country" ? "institution" : k] || formErr).textContent = f[k]; });
        if (!Object.keys(f).length) formErr.textContent = r.data.error || "That did not work. Please try again.";
      });
    } },
      names,
      opts.nameOnly ? null : field("institution", "Your institution", instBox),
      opts.nameOnly ? null : h("div", { class: "pv-ws-pair" }, field("position", "Position", position), field("field", "Field", fieldSel)),
      news && !opts.nameOnly ? h("p", { class: "pv-ws-check" }, news, h("label", { for: "ws-news" }, "Send me the monthly newsletter")) : null,
      formErr, btn);
    return form;
  }

  function finish(me) {
    // An account from before the surname was asked: only the name, once.
    if (me.needsName) {
      return show(
        h("section", { class: "pv-ws-narrow" },
          h("h2", { class: "pv-ws-h", text: "Add Your Surname" }),
          h("p", null, "We now keep your first name and surname apart. Please check them, and you are in."),
          detailsForm(me, { nameOnly: true, button: "Save", done: function () { location.href = PAGES.home; } }),
          h("p", { class: "pv-ws-small" }, "Not you? ", h("button", { class: "pv-lib-link", type: "button", onclick: signOut }, "Sign out"))));
    }
    show(
      h("section", { class: "pv-ws-narrow" },
        h("h2", { class: "pv-ws-h", text: "Finish Your Account" }),
        h("p", null, "Signed in as ", h("strong", { text: me.email }), ". Three things, and you are in."),
        detailsForm(me, { newsletter: true, button: "Finish", done: function () { location.href = PAGES.home + "?welcome=1"; } }),
        h("p", { class: "pv-ws-small" }, "Not you? ", h("button", { class: "pv-lib-link", type: "button", onclick: signOut }, "Sign out"))));
  }

  // ------------------------------------------------------------ The head

  // The tabs of this batch, and who is signed in. No title above them: the menu
  // already says where the reader is (master plan, section 18, the row on the
  // mockup, point 6). Home arrives with batch 5.
  var TABS = [["shelf", "Shelf", "home"], ["notes", "Notes", "notes"], ["notebook", "Notebook", "notebook"],
    ["write", "Write", "write"], ["projects", "Projects", "projects"], ["tools", "Tools", "tools"]];

  function head(me, here) {
    var list = h("ul", { class: "pv-ws-tablist" });
    TABS.forEach(function (t) {
      add(list, h("li", null, t[0] === here
        ? h("span", { class: "pv-ws-tab is-on", "aria-current": "page", text: t[1] })
        : h("a", { class: "pv-ws-tab", href: PAGES[t[2]], text: t[1] })));
    });
    var links = [];
    if (here !== "account") links.push(h("a", { href: PAGES.account }, "Account"));
    if (me.editor && here !== "desk") links.push(h("a", { href: PAGES.desk }, "Your Desk"));
    links.push(h("button", { class: "pv-lib-link", type: "button", onclick: signOut }, "Sign Out"));
    var who = me.guest
      ? h("span", null, "You are a ", h("strong", null, "guest"))
      : h("span", null, "Signed in as ", h("strong", { text: me.name }));
    var bar = h("div", { class: "pv-ws-head" },
      h("nav", { class: "pv-ws-tabs", "aria-label": "Workspace" }, list),
      h("p", { class: "pv-ws-who" }, who, h("span", { class: "pv-ws-bar-links" }, links.map(function (l, i) {
        return i ? [h("span", { class: "pv-ws-dot", "aria-hidden": "true", text: "\u00b7" }), l] : l;
      }))));
    var out = [bar];
    if (me.guest) out.push(guestStrip(me, here));
    return out;
  }

  function guestStrip(me, here) {
    var count = here === "notebook"
      ? "As a guest you keep " + me.pages + " of " + LIMIT_PAGES + " pages."
      : "As a guest you keep " + (me.kept || 0) + " of " + (me.keptLimit || 0) + " things.";
    return h("div", { class: "pv-ws-guest" },
      h("p", null, "Your work can be opened from this browser only, and is lost if you sign out, clear the browser or change device. " + count),
      h("button", { class: "pv-button", type: "button", onclick: function () {
        var slot = document.getElementById("ws-guest-signup");
        clear(slot);
        slot.appendChild(emailDoor(false, "Sign Up to Keep Your Work"));
        slot.hidden = false;
        slot.querySelector("input").focus();
      } }, "Sign Up to Keep Your Work"),
      h("div", { id: "ws-guest-signup", class: "pv-ws-guest-signup", hidden: true }));
  }

  var LIMIT_PAGES = 20;

  // ------------------------------------------------------------ The Notebook

  function notebook(me) {
    var state = { pages: [], open: null, base: null, dirty: false, saving: false, q: "", limit: null,
      projects: [], project: params.get("project") || "" };
    var listEl = h("ul", { class: "pv-ws-list" });
    var count = h("p", { class: "pv-ws-count" });
    var search = h("input", { type: "search", id: "ws-search", placeholder: "Search your pages", "aria-label": "Search your pages" });
    var pickRow = h("div", { class: "pv-ws-side-pick" });
    var editorEl = h("div", { class: "pv-ws-editor" });
    var shell = h("div", { class: "pv-ws-notebook" },
      // A plain div: Quarto moves an <aside> into the page margin.
      h("div", { class: "pv-ws-side" },
        h("div", { class: "pv-ws-side-head" },
          h("h2", { class: "pv-ws-h", text: "Notebook" }),
          h("button", { class: "pv-button", type: "button", onclick: newPage }, "New Page")),
        search, pickRow, count, listEl),
      editorEl);

    var said = [];
    if (params.get("welcome")) {
      said.push(message("Your account is ready. You can connect your ORCID iD on your account page, so that next time ORCID is enough."));
      history.replaceState(null, "", PAGES.notebook);
    }
    show(head(me, "notebook"), said, shell);
    search.addEventListener("input", debounce(function () { state.q = search.value.trim(); load(); }, 300));
    api("/api/projects").then(function (r) {
      state.projects = (r.data && r.data.projects) || [];
      drawPick();
      if (state.open) drawProject(state.open);
    });
    load().then(function () {
      var want = params.get("page");
      if (want) return openPage(want);
      if (params.get("new")) return newPage();
      if (!state.open) blank();
    });

    window.addEventListener("beforeunload", function (e) {
      if (state.dirty || state.saving) { e.preventDefault(); e.returnValue = ""; }
    });

    // The Project filter, beside the search, as on the Shelf and the Notes.
    function drawPick() {
      clear(pickRow);
      if (!state.projects.length) return;
      var box = h("select", { class: "pv-ws-pick-s", id: "nb-filter", "aria-label": "Show" });
      add(box, h("option", { value: "", text: "All Pages" }));
      add(box, h("option", { value: "loose", text: "Loose Pages", selected: state.project === "loose" }));
      state.projects.forEach(function (p) {
        add(box, h("option", { value: p.id, text: p.title, selected: state.project === p.id }));
      });
      box.addEventListener("change", function () { state.project = box.value; load(); });
      add(pickRow, h("label", { class: "pv-ws-small", for: "nb-filter", text: "Show" }), box);
    }

    function load() {
      var q = "/api/pages?from=0";
      if (state.q) q += "&q=" + encodeURIComponent(state.q);
      if (state.project === "loose") q += "&loose=1";
      else if (state.project) q += "&project=" + encodeURIComponent(state.project);
      return api(q).then(function (r) {
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
          h("span", { class: "pv-ws-item-d", text: when(p.updated_at) + (p.project_title ? " \u00b7 in " + p.project_title : "") }))));
      });
      count.textContent = state.q ? state.pages.length + (state.pages.length === 1 ? " page found" : " pages found")
        : state.pages.length + (state.pages.length === 1 ? " page" : " pages") + (me.guest ? " of " + state.limit + " a guest can keep" : "");
    }

    function blank() {
      shell.classList.remove("is-open");
      clear(editorEl);
      add(editorEl, h("div", { class: "pv-ws-blank" },
        h("p", { class: "pv-ws-blank-t", text: state.pages.length ? "Pick a page, or start a new one." : "Your Notebook is empty." }),
        h("p", { text: "A page takes bold, italic, a heading, a quote and a list, and @ cites a work or a Monitor item." }),
        h("button", { class: "pv-button", type: "button", onclick: newPage }, "Start a Page")));
    }

    // A page with no title and no words, that nobody has written in yet. "New
    // Page" opens such a page of the same project rather than make one more,
    // so that pressing it twice, or coming back to it, leaves no clutter of
    // empty pages (the live check before the trial, point 3).
    function untouched(into) {
      return state.pages.filter(function (p) {
        return !p.title && !p.chars && (p.project_id || null) === (into || null);
      })[0] || null;
    }

    function newPage() {
      var into = params.get("project");
      into = into && into !== "loose" ? into : null;
      flush().then(function () {
        // The open page leaves the screen at once, so nothing typed now lands in it.
        state.open = null;
        clear(editorEl);
        add(editorEl, h("p", { class: "pv-lib-loading", text: "Starting a new page…" }));
        var spare = untouched(into);
        if (spare) return { reuse: spare.id };
        return api("/api/pages", { method: "POST", body: { title: "", body: "", words: "", project_id: into } });
      }).then(function (r) {
        if (r.reuse) return openPage(r.reuse, true);
        if (!r.ok) { alertBox(r.data.error || "A new page could not be made."); return; }
        state.q = ""; search.value = "";
        return load().then(function () { draw(r.data.page, true); });
      });
    }

    // The address no longer names a page that is not open: the project is kept
    // and the page dropped, so a reload shows the list and not an empty right
    // half (Fable's re-check of the trial fixes, point 4a).
    function tidy() {
      var keepProject = params.get("project");
      try {
        history.replaceState(null, "", PAGES.notebook +
          (keepProject ? "?project=" + encodeURIComponent(keepProject) : ""));
      } catch (e) {}
    }

    function openPage(id, fresh) {
      return flush().then(function () { return api("/api/pages/" + encodeURIComponent(id)); }).then(function (r) {
        if (r.ok) return draw(r.data.page, !!fresh);
        // A page that is not there any more, or never this reader's: the
        // address is tidied and the reader is asked to pick one. Any other
        // trouble leaves the address alone, so a moment without a connection
        // does not lose the page the reader was on.
        if (r.status === 404) {
          state.open = null;
          tidy();
          return load().then(blank);
        }
        return load();
      });
    }

    var titleEl, editor, statusEl, projectRow;
    function draw(page, fresh) {
      // The address names the page that is open, and no longer says "new", so
      // a reload opens this page again instead of making another (the live
      // check before the trial, point 3).
      var keepProject = params.get("project");
      try {
        history.replaceState(null, "", PAGES.notebook + "?" + (keepProject ? "project=" + encodeURIComponent(keepProject) + "&" : "") +
          "page=" + encodeURIComponent(page.id));
      } catch (e) {}
      state.open = page;
      state.base = page.updated_at;
      state.dirty = false;
      shell.classList.add("is-open");
      drawList();
      clear(editorEl);
      titleEl = h("input", { type: "text", class: "pv-ws-title", maxlength: "200", placeholder: "Title", "aria-label": "Title of the page", value: page.title });
      statusEl = h("span", { class: "pv-ws-status", "aria-live": "polite", text: "Saved" });
      var del = h("button", { class: "pv-lib-link", type: "button", onclick: function () { confirmDelete(del); } }, "Delete this page");
      projectRow = h("span", { class: "pv-ws-pick-in" });
      add(editorEl,
        h("div", { class: "pv-ws-editor-head" },
          h("button", { class: "pv-lib-link pv-ws-backlist", type: "button", onclick: function () { flush().then(function () { state.open = null; drawList(); blank(); }); } }, "← All Pages"),
          statusEl),
        titleEl);
      var slot = h("div");
      add(editorEl, slot);
      // The same editor as Write, with the five formats and "@" to cite. A cite
      // on a page is a link to the thing; only Write builds a reference list.
      editor = window.PVEditor.make({
        host: slot,
        label: "Text of the page",
        placeholder: "Write here.",
        search: window.PVCite ? window.PVCite.pick : null,
        onChange: changed
      });
      editor.open(page.body);
      drawProject(page);
      add(editorEl,
        h("div", { class: "pv-ws-editor-foot" },
          h("span", { class: "pv-ws-dates", text: "Started " + DATE_LONG.format(new Date(page.created_at)) }),
          h("span", { class: "pv-ws-foot-end" }, projectRow, del)));
      (fresh ? titleEl : editor).focus();
      titleEl.addEventListener("input", changed);
    }

    // One control at the foot of a page puts it into a project, or takes it out.
    function drawProject(page) {
      clear(projectRow);
      if (!state.projects.length) return;
      var id = "nb-project";
      var box = h("select", { class: "pv-ws-pick-s", id: id });
      add(box, h("option", { value: "", text: "No project" }));
      state.projects.forEach(function (p) {
        add(box, h("option", { value: p.id, text: p.title, selected: page.project_id === p.id }));
      });
      box.addEventListener("change", function () {
        api("/api/pages/" + encodeURIComponent(page.id), { method: "PATCH", body: { project_id: box.value || null } })
          .then(function (r) {
            if (!r.ok) { statusEl.textContent = "Not saved: " + (r.data.error || "the project could not be set."); return; }
            page.project_id = box.value || null;
            state.base = r.data.updated_at;
            load();
          });
      });
      add(projectRow, h("label", { class: "pv-ws-small", for: id, text: "Project" }), box);
    }

    function changed() {
      state.dirty = true;
      statusEl.textContent = "Not saved yet";
      save();
    }

    var save = debounce(function () { flush(); }, 900);

    function flush() {
      if (!state.open || !state.dirty || !editor) return Promise.resolve();
      if (state.saving) return state.saving;
      var page = state.open;
      var sent = { title: titleEl.value, body: editor.stored(), words: editor.words(), base: state.base };
      state.dirty = false;
      statusEl.textContent = "Saving…";
      state.saving = api("/api/pages/" + encodeURIComponent(page.id), { method: "PATCH", body: sent }).then(function (r) {
        state.saving = false;
        if (r.ok) {
          state.base = r.data.updated_at;
          page.title = sent.title; page.body = sent.body; page.updated_at = r.data.updated_at;
          var item = state.pages.filter(function (p) { return p.id === page.id; })[0];
          if (item) { item.title = sent.title; item.snippet = sent.words.slice(0, 240); item.chars = sent.body.length; item.updated_at = r.data.updated_at; }
          state.pages.sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; });
          drawList();
          if (state.dirty) return flush();
          statusEl.textContent = "Saved";
          return;
        }
        state.dirty = true;
        if (r.status === 409) {
          statusEl.textContent = "";
          editorEl.insertBefore(h("div", { class: "pv-ws-note is-error", role: "alert" },
            "This page was changed in another window. Copy what you wrote here if you need it, then ",
            h("button", { class: "pv-lib-link", type: "button", onclick: function () { state.dirty = false; openPage(page.id); } }, "load the newest text"), "."),
            editorEl.firstChild);
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
            // The address stops naming the deleted page, so a reload shows the
            // list (Fable's re-check of the trial fixes, point 4a).
            tidy();
            load().then(blank);
          });
        } }, "Yes, delete"), " · ",
        h("button", { class: "pv-lib-link", type: "button", onclick: function () { row.replaceChild(btn, ask); } }, "Keep it"));
      row.replaceChild(ask, btn);
    }
  }

  // ------------------------------------------------------------ The account page

  function account(me) {
    var blocks = [head(me, "account")];
    var notes = [];
    if (params.get("orcid") === "yes") notes.push(message("Your ORCID iD is connected. Next time, ORCID is enough to sign in."));
    if (params.get("orcid") === "no") {
      notes.push(message(params.get("error") === "account_already_linked_to_different_user"
        ? "This ORCID iD is already connected to another account."
        : "ORCID was not connected. Please try again.", "error"));
    }
    if (params.get("orcid")) history.replaceState(null, "", PAGES.account);

    if (me.guest) {
      blocks.push(notes, section("Your Work", [
        h("p", { text: "As a guest you keep " + (me.kept || 0) + (me.kept === 1 ? " thing" : " things") + " on your shelf, "
          + (me.notes || 0) + (me.notes === 1 ? " note" : " notes") + " and " + me.pages + (me.pages === 1 ? " page" : " pages")
          + " in this browser. Sign up to keep them for good." }),
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
        h("p", { text: "One file with everything you keep here: your account, your shelf, your notes and a plain-text file for each page and each note. It opens without PopuliVerse." }),
        downloadButton()
      ]),
      section("Sign Out Everywhere", [
        h("p", { text: "Ends every session of this account, on every device, this one too." }),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () {
          api("/api/auth/revoke-sessions", { method: "POST", body: {} }).then(function () {
            remember(false, true);
            location.href = PAGES.home + "?signedout=1";
          });
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
        if (r.ok) { remember(false, true); location.href = PAGES.home + "?signedout=1"; return; }
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
      h("p", { text: "Your account and everything in it are deleted at once, and cannot be brought back. Download it first if you want a copy." +
        (me.newsletter ? " The newsletter is separate: to leave it, use the link in any newsletter." : "") }),
      h("p", { class: "pv-ws-check" }, box, h("label", { for: "ws-del" }, "I understand that this deletes my account and everything in it")),
      err, btn);
  }

  // ------------------------------------------------------------ The Shelf

  // The site's own data: the Monitor's items, actors and countries, and how
  // many works the Library holds on each country. One small file (27 kB), so
  // the counts and the cross links on the shelf are never out of date.
  var siteData = null;
  function site() {
    if (siteData) return siteData;
    siteData = fetch(BASE + "../data/monitor.json", { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var out = { items: {}, actors: {}, places: {}, works: {} };
        if (!d) return out;
        (d.items || []).forEach(function (it) { out.items[it.folder + ":" + it.n] = it; });
        (d.actors || []).forEach(function (a) { out.actors[a.id] = a; });
        out.places = d.places || {};
        out.works = d.works || {};
        return out;
      }, function () { return { items: {}, actors: {}, places: {}, works: {} }; });
    return siteData;
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  var KINDS = [["work", "Works"], ["item", "Monitor Items"], ["actor", "Actors"], ["country", "Countries"], ["chart", "Charts"]];
  // The same kinds inside a sentence: "3 Monitor items", "No works yet."
  var ONE = { work: "work", item: "Monitor item", actor: "actor", country: "country", chart: "chart" };
  var MANY = { work: "works", item: "Monitor items", actor: "actors", country: "countries", chart: "charts" };
  // The shelf's search box names the kind it searches (Fable's second run, point f).
  var SEARCH_LABEL = { work: "Search your works", item: "Search your Monitor items", actor: "Search your actors",
    country: "Search your countries", chart: "Search your charts" };
  var READING = [["to-read", "To Read"], ["reading", "Reading"], ["read", "Read"]];
  var READING_NAME = { "to-read": "To Read", reading: "Reading", read: "Read" };

  // The frame the Library wears: search and order on top, filters on the left,
  // the list on the right.
  function frame(opts) {
    var search = h("input", { type: "search", id: "ws-q", placeholder: opts.placeholder, value: opts.q || "" });
    var order = h("select", { id: "ws-order" });
    opts.orders.forEach(function (o) { order.appendChild(h("option", { value: o[0], selected: o[0] === opts.order, text: o[1] })); });
    var side = h("div", { class: "pv-ws-side-filters" });
    var list = h("div", { class: "pv-ws-shelf-list" });
    var head = h("div", { class: "pv-ws-shelf-head" });
    var folded = h("button", {
      class: "pv-ws-fold", type: "button", "aria-expanded": "false",
      onclick: function () {
        var open = side.classList.toggle("is-open");
        folded.setAttribute("aria-expanded", open ? "true" : "false");
        folded.querySelector(".pv-ws-fold-mark").textContent = open ? "−" : "+";
      }
    }, h("span", { text: opts.filterLabel }), h("span", { class: "pv-ws-fold-mark", "aria-hidden": "true", text: "+" }));
    var label = h("label", { for: "ws-q", text: opts.searchLabel });
    var bar = h("div", { class: "pv-ws-find" },
      h("div", { class: "pv-ws-pick" }, label, search),
      h("div", { class: "pv-ws-pick" }, h("label", { for: "ws-order", text: "Order" }), order));
    var body = h("div", { class: "pv-ws-shelf" }, h("div", { class: "pv-ws-side-wrap" }, folded, side), h("div", { class: "pv-ws-main" }, head, list));
    search.addEventListener("input", debounce(function () { opts.onSearch(search.value.trim()); }, 300));
    order.addEventListener("change", function () { opts.onOrder(order.value); });
    return { bar: bar, body: body, side: side, list: list, head: head, order: order, search: search, label: label };
  }

  function shelf(me) {
    var askedKind = params.get("kind");
    var state = { kind: KINDS.some(function (k) { return k[0] === askedKind; }) ? askedKind : "work",
      q: "", status: "", tag: "", order: "new", from: 0, project: params.get("project") || "",
      // "Add a Case from Your Shelf" in a project: the whole shelf, ready to add
      // to that project (Fable's check of batches 2 and 3, point 10).
      addto: params.get("addto") || "" };
    var counts = {};
    var ui = frame({
      placeholder: "Titles, authors, tags, notes",
      searchLabel: "Search your works",
      filterLabel: "Filters",
      orders: [["new", "Newest saved first"], ["author", "Author"], ["year", "Year"]],
      order: state.order,
      onSearch: function (q) { state.q = q; state.from = 0; load(); },
      onOrder: function (o) { state.order = o; state.from = 0; load(); }
    });
    var kindsNav = h("nav", { class: "pv-ws-kinds", "aria-label": "Kind" });
    var adding = h("div");
    show(head(me, "shelf"), adding, kindsNav, ui.bar, ui.body);
    projects().then(function () {
      var into = state.addto ? myProjects.filter(function (p) { return p.id === state.addto; })[0] : null;
      if (state.addto && !into) state.addto = "";
      if (into) {
        add(adding, h("p", { class: "pv-ws-adding" },
          h("span", null, "Adding to ", h("strong", { text: into.title })),
          h("a", { class: "pv-lib-link", href: PAGES.projects + "?p=" + encodeURIComponent(into.id), text: "Back to the Project" })));
      }
      if (myProjects.length) load();
    });
    load();

    function drawKinds() {
      clear(kindsNav);
      var row = h("div", { class: "pv-ws-kinds-row" });
      KINDS.forEach(function (k) {
        var on = k[0] === state.kind;
        var n = counts[k[0]] === undefined ? "" : String(counts[k[0]]);
        var inner = [k[1], n ? h("span", { class: "pv-ws-kind-n", text: n }) : null];
        row.appendChild(on
          ? h("span", { class: "pv-ws-kind is-on", "aria-current": "true" }, inner)
          : h("button", { class: "pv-ws-kind", type: "button", onclick: function () {
              state.kind = k[0]; state.q = ""; state.status = ""; state.tag = ""; state.from = 0;
              state.order = state.order === "new" ? "new" : "new";
              ui.search.value = "";
              load();
            } }, inner));
      });
      add(kindsNav, row);
    }

    function load() {
      ui.label.textContent = SEARCH_LABEL[state.kind] || "Search your shelf";
      var q = "/api/keep?kind=" + state.kind + "&order=" + state.order + "&from=" + state.from;
      if (state.q) q += "&q=" + encodeURIComponent(state.q);
      if (state.status) q += "&status=" + state.status;
      if (state.tag) q += "&tag=" + encodeURIComponent(state.tag);
      if (state.project) q += "&project=" + encodeURIComponent(state.project);
      return Promise.all([api(q), site()]).then(function (both) {
        var r = both[0], data = both[1];
        if (r.status === 401 || r.status === 403) { location.href = PAGES.home; return; }
        if (!r.ok) { clear(ui.list); add(ui.list, message(r.data.error || "Your shelf could not be loaded just now. Please try again.", "error")); return; }
        counts = r.data.counts || {};
        drawKinds();
        drawSide(r.data);
        drawHead(r.data);
        drawList(r.data, data);
      });
    }

    function drawSide(d) {
      clear(ui.side);
      if (myProjects.length) {
        var pick = h("select", { class: "pv-ws-pick-s", id: "ws-project" });
        add(pick, h("option", { value: "", text: "Everything" }));
        myProjects.forEach(function (p) {
          add(pick, h("option", { value: p.id, text: p.title, selected: state.project === p.id }));
        });
        pick.addEventListener("change", function () { state.project = pick.value; state.from = 0; load(); });
        add(ui.side, h("div", { class: "pv-ws-group" },
          h("h2", { class: "pv-ws-group-h" }, h("label", { for: "ws-project", text: "Project" })), pick));
      }
      var tags = d.tags || [];
      if (!tags.length) {
        add(ui.side, h("p", { class: "pv-ws-small", text: "Your tags appear here once you add one." }));
        return;
      }
      var group = h("div", { class: "pv-ws-group" }, h("h2", { class: "pv-ws-group-h", text: "Your Tags" }));
      tags.forEach(function (t) {
        var box = h("input", { type: "checkbox", id: "tag-" + t.name, checked: state.tag === t.name });
        box.addEventListener("change", function () {
          state.tag = box.checked ? t.name : "";
          state.from = 0;
          load();
        });
        add(group, h("label", { class: "pv-ws-opt", for: "tag-" + t.name }, box,
          h("span", { class: "pv-ws-opt-n", text: t.name }), h("span", { class: "pv-ws-opt-c", text: String(t.n) })));
      });
      add(ui.side, group);
    }

    function drawHead(d) {
      clear(ui.head);
      // "Monitor" keeps its capital in a count, as everywhere on the site (the
      // live check before the trial, point 4).
      var many = MANY[state.kind] || "things";
      var one = ONE[state.kind] || "thing";
      var n = counts[state.kind] || 0;
      var filtered = state.q || state.status || state.tag || state.project;
      var shown = state.from + (d.things || []).length;
      var line = h("p", { class: "pv-ws-count-line", text: filtered
        ? shown + " of " + n + " " + many
        : plural(n, one, many) + " on your shelf" });
      var tools = h("p", { class: "pv-ws-shelf-tools" });
      if (state.kind === "work" && n) {
        add(tools, bibtexButton());
        if (window.PVWriteTools) {
          add(tools, h("button", { class: "pv-lib-link", type: "button", onclick: function (e) {
            window.PVWriteTools.annotated(e.currentTarget, state.project || null);
          } }, "Annotated Bibliography"));
        }
      }
      add(ui.head, h("div", { class: "pv-ws-head-row" }, line, tools));
      if (state.kind === "work" && n) add(ui.head, readingBar(d.reading || {}));
    }

    // The reading bar is the filter: a click on one of its parts shows those works.
    function readingBar(bars) {
      var total = READING.reduce(function (s, r) { return s + (bars[r[0]] || 0); }, 0) || 1;
      var strip = h("div", { class: "pv-ws-read", role: "img",
        "aria-label": "Your works by reading: " + READING.map(function (r) { return r[1] + " " + (bars[r[0]] || 0); }).join(", ") });
      READING.forEach(function (r) {
        var w = Math.round(1000 * (bars[r[0]] || 0) / total) / 10;
        if (w) add(strip, h("span", { class: "pv-ws-read-part is-" + r[0], style: "width:" + w + "%" }));
      });
      var row = h("p", { class: "pv-ws-read-keys", role: "group", "aria-label": "Show" });
      add(row, h("button", { class: "pv-lib-link" + (state.status ? "" : " is-on"), type: "button",
        "aria-pressed": state.status ? "false" : "true",
        onclick: function () { state.status = ""; state.from = 0; load(); } },
        "All " + READING.reduce(function (s, r) { return s + (bars[r[0]] || 0); }, 0)));
      READING.forEach(function (r) {
        add(row, h("button", { class: "pv-lib-link" + (state.status === r[0] ? " is-on" : ""), type: "button",
          "aria-pressed": state.status === r[0] ? "true" : "false",
          onclick: function () { state.status = state.status === r[0] ? "" : r[0]; state.from = 0; load(); } },
          h("span", { class: "pv-ws-swatch is-" + r[0], "aria-hidden": "true" }), r[1] + " " + (bars[r[0]] || 0)));
      });
      return h("div", { class: "pv-ws-reading" }, strip, row);
    }

    function bibtexButton() {
      var note = h("span", { class: "pv-ws-small", "aria-live": "polite" });
      var btn = h("button", { class: "pv-lib-link", type: "button", onclick: function () {
        btn.disabled = true;
        note.textContent = " Fetching the Library's references…";
        api("/api/keep?kind=work&from=0&order=author").then(function (r) {
          // Every work of the shelf, page by page, then the Library's own BibTeX.
          var all = (r.data.things || []).slice();
          function more(from) {
            if (!r.data.more && from === 0) return Promise.resolve(all);
            return api("/api/keep?kind=work&order=author&from=" + from).then(function (next) {
              all = all.concat(next.data.things || []);
              return next.data.more ? more(from + 25) : all;
            });
          }
          return (r.data.more ? more(25) : Promise.resolve(all));
        }).then(function (works) {
          return fetch(BASE + "../library/library-text.json", { cache: "force-cache" })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
              var map = (data && data.text) || {};
              var out = [], missing = 0;
              works.forEach(function (w) {
                var t = map[w.ref];
                if (t && t.bibtex) out.push(t.bibtex);
                else missing++;
              });
              btn.disabled = false;
              if (!out.length) { note.textContent = " The Library's references could not be fetched. Please try again."; return; }
              copyText(out.join("\n"), btn, "Copy BibTeX of These Works", "Copied " + plural(out.length, "reference", "references"));
              note.textContent = missing ? " " + missing + " of these works has no BibTeX in the Library just now." : "";
            });
        }, function () { btn.disabled = false; note.textContent = " The Library's references could not be fetched."; });
      } }, "Copy BibTeX of These Works");
      return h("span", null, btn, note);
    }

    function drawList(d, data) {
      clear(ui.list);
      var things = d.things || [];
      if (!things.length) return add(ui.list, empty(d));
      var ul = h("ul", { class: "pv-ws-things" });
      things.forEach(function (t) { add(ul, thingRow(t, data, load, state.addto)); });
      add(ui.list, ul);
      if (d.more) {
        add(ui.list, h("button", { class: "pv-lib-more", type: "button",
          onclick: function () { state.from += 25; load(); } }, "Show more"));
      }
      if (state.from) {
        add(ui.list, h("p", null, h("button", { class: "pv-lib-link", type: "button",
          onclick: function () { state.from = 0; load(); } }, "Back to the first")));
      }
    }

    function empty(d) {
      if (state.q || state.status || state.tag) {
        return h("div", { class: "pv-ws-blank" }, h("p", { class: "pv-ws-blank-t", text: "Nothing here under those words." }),
          h("p", null, h("button", { class: "pv-lib-link", type: "button", onclick: function () {
            state.q = ""; state.status = ""; state.tag = ""; state.project = ""; ui.search.value = ""; state.from = 0; load();
          } }, "Show everything again")));
      }
      var total = Object.keys(counts).reduce(function (n, k) { return n + (counts[k] || 0); }, 0);
      if (!total) {
        return h("div", { class: "pv-ws-blank" },
          h("p", { class: "pv-ws-blank-t", text: "Nothing on your shelf yet." }),
          h("p", { text: "Press Save on a work, a Monitor item, an actor, a country or a chart, and it is kept here." }),
          h("p", { class: "pv-ws-blank-links" },
            h("a", { href: BASE + "../library/", text: "Open the Library" }),
            h("a", { href: BASE + "../monitor/", text: "Open the Monitor" }),
            h("a", { href: BASE + "../data/events.html", text: "Open Data" })));
      }
      var name = MANY[state.kind] || "things";
      return h("div", { class: "pv-ws-blank" }, h("p", { class: "pv-ws-blank-t", text: "No " + name + " yet." }),
        h("p", { text: "Press Save on one, and it is kept here." }));
    }
  }

  // ------------------------------------------------------------ One thing

  // Which abstracts the reader has opened, so that marking a passage does not
  // close the one being read.
  var openAbstracts = {};

  // The reader's projects, asked once and shared by the Shelf, the Notes and
  // the row of a thing ("Add to Project").
  var myProjects = [];
  var projectsAsked = null;
  function projects() {
    if (projectsAsked) return projectsAsked;
    projectsAsked = api("/api/projects").then(function (r) {
      myProjects = (r.data && r.data.projects) || [];
      return myProjects;
    }, function () { return myProjects; });
    return projectsAsked;
  }

  function thingRow(t, data, reload, addto) {
    var li = h("li", { class: "pv-ws-thing" });
    var head = [];
    if (t.kind !== "work") head.push(h("p", { class: "pv-ws-kind-label", text: kindLabel(t.kind) }));
    var title = t.url
      ? h("a", { href: t.url, text: t.title || t.ref })
      : h("span", { text: t.title || t.ref });
    head.push(h("p", { class: t.kind === "work" ? "pv-ws-cite" : "pv-ws-thing-t" }, title));
    var below = crossLinks(t, data);
    var extra = t.kind === "work" ? "" : t.extra;
    if (extra || below.length) {
      var line = h("p", { class: "pv-ws-thing-m" });
      var parts = (extra ? [h("span", { text: extra })] : []).concat(below);
      parts.forEach(function (part, i) {
        if (i) add(line, h("span", { class: "pv-ws-dot", "aria-hidden": "true", text: "·" }));
        add(line, part);
      });
      head.push(line);
    }
    add(li, head);

    if (t.note) {
      add(li, h("p", { class: "pv-ws-note-line" },
        h("span", { class: "pv-ws-label-s", text: "Your Note" }), h("em", { text: cut(t.note.body, 160) })));
    }

    var row = h("div", { class: "pv-ws-thing-row" });
    if (t.kind === "work") add(row, statusLink(t, reload));
    (t.tags || []).forEach(function (name) { add(row, tagChip(t, name, reload)); });
    add(row, addTag(t, reload));
    var end = h("span", { class: "pv-ws-thing-end" });
    if (addto) {
      var inIt = (t.projects || []).some(function (p) { return p.id === addto; });
      add(end, inIt
        ? h("span", { class: "pv-ws-small pv-ws-in-project", text: "In This Project" })
        : h("button", { class: "pv-button pv-ws-add-here", type: "button", onclick: function (e) {
            var b = e.currentTarget;
            b.disabled = true;
            api("/api/projects/" + encodeURIComponent(addto) + "/things", { method: "POST", body: { kind: t.kind, ref: t.ref } }).then(function (r) {
              b.disabled = false;
              if (!r.ok) { b.textContent = r.data.error || "Could not be added"; return; }
              reload();
            });
          } }, "Add to This Project"));
    }
    if (t.kind === "work" && t.abstract) add(end, abstractButton(t, li, reload));
    add(end, h("button", { class: "pv-lib-link", type: "button",
      onclick: function () { noteBox(t, li, reload); } }, t.note ? "Edit Note" : "Note"));
    add(end, addToProject(t, li, reload));
    add(end, removeButton(t, reload));
    add(row, end);
    add(li, row);
    if ((t.projects || []).length) {
      add(li, h("p", { class: "pv-ws-thing-p" },
        h("span", { class: "pv-ws-label-s", text: "In" }),
        t.projects.map(function (p, i) {
          return [i ? h("span", { class: "pv-ws-dot", "aria-hidden": "true", text: "\u00b7" }) : null,
            h("a", { class: "pv-ws-x", href: PAGES.projects + "?p=" + encodeURIComponent(p.id), text: p.title })];
        })));
    }
    // An abstract the reader has open stays open while passages are marked.
    if (t.kind === "work" && t.abstract && openAbstracts[t.ref]) {
      li.appendChild(drawAbstract(t, reload));
      li.appendChild(h("p", { class: "pv-ws-abs-hint", text: "Select words in the abstract to mark them. Click a marked passage to unmark it." }));
    }
    return li;
  }

  function kindLabel(kind) {
    return { work: "Work", item: "Monitor Item", actor: "Actor", country: "Country", chart: "Chart" }[kind] || kind;
  }

  function cut(s, n) {
    var one = String(s || "").replace(/\s+/g, " ").trim();
    return one.length > n ? one.slice(0, n - 1) + "…" : one;
  }

  // The cross links, drawn from the site's own data.
  function crossLinks(t, data) {
    var out = [];
    var iso = t.country || "";
    if (t.kind === "item") {
      var item = data.items[t.ref];
      if (item && item.iso && item.iso.length === 1) iso = item.iso[0];
    }
    if (t.kind === "actor") {
      var a = data.actors[t.ref];
      if (a) {
        if (a.items) out.push(h("a", { class: "pv-ws-x", href: BASE + "../actors/" + t.ref + ".html", text: plural(a.items, "item", "items") + " in the Monitor" }));
        if (!iso) iso = a.iso || "";
      }
    }
    if (t.kind === "country" && data.items) {
      var n = 0;
      Object.keys(data.items).forEach(function (k) { if ((data.items[k].iso || []).indexOf(t.ref) >= 0) n++; });
      if (n) out.push(h("a", { class: "pv-ws-x", href: BASE + "../countries/" + (data.places[t.ref] ? data.places[t.ref][6] : "") + ".html", text: plural(n, "item", "items") + " in the Monitor" }));
      iso = t.ref;
    }
    var works = iso ? data.works[iso] : 0;
    if (works && data.places[iso]) {
      var place = data.places[iso];
      out.push(h("a", { class: "pv-ws-x", href: BASE + "../library/index.html?country=" + place[6],
        text: plural(works, "work", "works") + (t.kind === "country" ? " in the Library" : " on " + place[0] + " in the Library") }));
    }
    return out;
  }

  // The reading status: one quiet link that moves to the next.
  function statusLink(t, reload) {
    var order = ["to-read", "reading", "read"];
    var now = t.status || "to-read";
    var next = order[(order.indexOf(now) + 1) % order.length];
    return h("button", { class: "pv-lib-link pv-ws-status-link", type: "button",
      "aria-label": "Reading: " + READING_NAME[now] + ". Change to " + READING_NAME[next],
      onclick: function () {
        api("/api/keep/status", { method: "POST", body: { kind: t.kind, ref: t.ref, status: next } }).then(reload);
      } }, h("span", { class: "pv-ws-swatch is-" + now, "aria-hidden": "true" }), READING_NAME[now]);
  }

  function tagChip(t, name, reload) {
    return h("span", { class: "pv-ws-chip" }, h("span", { text: name }),
      h("button", { class: "pv-ws-chip-x", type: "button", "aria-label": "Remove the tag " + name,
        onclick: function () {
          api("/api/keep/tag", { method: "POST", body: { kind: t.kind, ref: t.ref, remove: name } }).then(reload);
        } }, "×"));
  }

  function addTag(t, reload) {
    var btn = h("button", { class: "pv-lib-link", type: "button", onclick: function () {
      var input = h("input", { type: "text", maxlength: "40", "aria-label": "A tag of your own", placeholder: "Your tag" });
      var err = h("span", { class: "pv-ws-small" });
      var form = h("form", { class: "pv-ws-tagform", onsubmit: function (e) {
        e.preventDefault();
        var name = input.value.trim();
        if (!name) { form.parentNode.replaceChild(btn, form); return; }
        api("/api/keep/tag", { method: "POST", body: { kind: t.kind, ref: t.ref, add: name } }).then(function (r) {
          if (!r.ok) { err.textContent = " " + (r.data.error || "That tag could not be added."); return; }
          reload();
        });
      } }, input, h("button", { class: "pv-lib-link", type: "submit", text: "Add" }),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () { form.parentNode.replaceChild(btn, form); } }, "Cancel"), err);
      btn.parentNode.replaceChild(form, btn);
      input.focus();
    } }, "Add a Tag");
    return btn;
  }

  // One control puts a thing into a project, or takes it out again.
  function addToProject(t, li, reload) {
    var btn = h("button", { class: "pv-lib-link", type: "button", onclick: function () {
      projects().then(function (list) {
        var box = li.querySelector(".pv-ws-projbox");
        if (box) { box.parentNode.removeChild(box); return; }
        box = h("div", { class: "pv-ws-projbox" });
        if (!list.length) {
          add(box, h("p", { class: "pv-ws-small", text: "No projects yet." }),
            h("p", null, h("a", { class: "pv-lib-link", href: PAGES.projects, text: "Start one" })));
        } else {
          var inside = {};
          (t.projects || []).forEach(function (p) { inside[p.id] = true; });
          var err = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
          list.forEach(function (p) {
            var mark = h("input", { type: "checkbox", id: "pj-" + p.id + "-" + Math.random().toString(36).slice(2, 7), checked: !!inside[p.id] });
            mark.addEventListener("change", function () {
              var how = mark.checked ? "POST" : "DELETE";
              api("/api/projects/" + encodeURIComponent(p.id) + "/things", { method: how, body: { kind: t.kind, ref: t.ref } })
                .then(function (r) {
                  if (!r.ok) { mark.checked = !mark.checked; err.textContent = r.data.error || "That could not be changed."; return; }
                  reload();
                });
            });
            add(box, h("label", { class: "pv-ws-opt", for: mark.id }, mark, h("span", { class: "pv-ws-opt-n", text: p.title })));
          });
          add(box, err);
        }
        add(box, h("p", { class: "pv-keep-row" },
          h("button", { class: "pv-lib-link", type: "button", onclick: function () { box.parentNode.removeChild(box); } }, "Close")));
        li.appendChild(box);
      });
    } }, "Add to Project");
    return btn;
  }

  function removeButton(t, reload) {
    var btn = h("button", { class: "pv-lib-link", type: "button", onclick: function () {
      if (!t.note) return gone();
      var ask = h("span", { class: "pv-ws-ask" }, h("span", { text: "Remove it and your note?" }),
        h("button", { class: "pv-lib-link", type: "button", onclick: gone }, "Remove"),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () { ask.parentNode.replaceChild(btn, ask); } }, "Keep"));
      btn.parentNode.replaceChild(ask, btn);
    } }, "Remove");
    function gone() {
      api("/api/keep", { method: "DELETE", body: { kind: t.kind, ref: t.ref } }).then(reload);
    }
    return btn;
  }

  // The note, opened in place.
  function noteBox(t, li, reload) {
    var open = li.querySelector(".pv-ws-notebox");
    if (open) { open.parentNode.removeChild(open); return; }
    var area = h("textarea", { rows: "4", placeholder: "Your note" });
    area.value = t.note ? t.note.body : "";
    var id = "ws-note-" + Math.random().toString(36).slice(2, 9);
    area.id = id;
    var err = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
    var box = h("div", { class: "pv-ws-notebox" },
      h("label", { class: "pv-ws-label-s", for: id, text: "Your Note" }), area, err,
      h("p", { class: "pv-ws-notebox-row" },
        h("button", { class: "pv-button", type: "button", onclick: function () {
          api("/api/keep/note", { method: "POST", body: { kind: t.kind, ref: t.ref, body: area.value } }).then(function (r) {
            if (!r.ok) { err.textContent = r.data.error || "That note could not be saved just now."; return; }
            reload();
          });
        } }, "Save Note"),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () { box.parentNode.removeChild(box); } }, "Cancel")));
    li.appendChild(box);
    area.focus();
  }

  // The abstract, with the passages the reader has marked. Selecting words in
  // it marks them; a click on a marked passage unmarks it.
  function abstractButton(t, li, reload) {
    var here = !!openAbstracts[t.ref];
    var btn = h("button", { class: "pv-lib-link", type: "button", "aria-expanded": here ? "true" : "false",
      text: here ? "Hide Abstract" : "Abstract", onclick: function () {
        var open = li.querySelector(".pv-ws-abstract");
        if (open) {
          open.parentNode.removeChild(open);
          var hint = li.querySelector(".pv-ws-abs-hint");
          if (hint) hint.parentNode.removeChild(hint);
          var ask = li.querySelector(".pv-ws-markask");
          if (ask) ask.parentNode.removeChild(ask);
          delete openAbstracts[t.ref];
          btn.textContent = "Abstract";
          btn.setAttribute("aria-expanded", "false");
          return;
        }
        openAbstracts[t.ref] = true;
        btn.textContent = "Hide Abstract";
        btn.setAttribute("aria-expanded", "true");
        li.appendChild(drawAbstract(t, reload));
        li.appendChild(h("p", { class: "pv-ws-abs-hint", text: "Select words in the abstract to mark them. Click a marked passage to unmark it." }));
      } });
    return btn;
  }

  function drawAbstract(t, reload) {
    var text = t.abstract || "";
    var box = h("p", { class: "pv-ws-abstract" });
    // Each marked passage is found by its place, or by its own words if the
    // Library's abstract has changed since.
    var ranges = [];
    var lost = [];
    (t.marks || []).forEach(function (m) {
      var at = text.slice(m.at, m.at + m.text.length) === m.text ? m.at : text.indexOf(m.text);
      if (at < 0) { lost.push(m); return; }
      ranges.push({ at: at, end: at + m.text.length, id: m.id, text: m.text });
    });
    ranges.sort(function (a, b) { return a.at - b.at; });
    var at = 0;
    ranges.forEach(function (r) {
      if (r.at < at) return;
      if (r.at > at) add(box, text.slice(at, r.at));
      add(box, h("button", { class: "pv-ws-mark", type: "button", title: "Unmark this passage", text: r.text,
        onclick: function () { api("/api/keep/mark", { method: "POST", body: { remove: r.id } }).then(reload); } }));
      at = r.end;
    });
    if (at < text.length) add(box, text.slice(at));
    if (lost.length) {
      add(box, h("span", { class: "pv-ws-lost" },
        h("span", { class: "pv-ws-label-s", text: "No longer in the abstract" }),
        lost.map(function (m) {
          return h("span", { class: "pv-ws-lost-one" }, h("em", { text: "“" + m.text + "”" }),
            h("button", { class: "pv-lib-link", type: "button",
              onclick: function () { api("/api/keep/mark", { method: "POST", body: { remove: m.id } }).then(reload); } }, "Unmark"));
        })));
    }
    // Marking: where the selection begins and ends inside the abstract's text.
    box.addEventListener("mouseup", offer);
    box.addEventListener("keyup", offer);
    function offer() {
      var sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed || !sel.anchorNode || !box.contains(sel.anchorNode) || !box.contains(sel.focusNode)) return;
      var a = offsetIn(box, sel.anchorNode, sel.anchorOffset);
      var b = offsetIn(box, sel.focusNode, sel.focusOffset);
      var from = Math.min(a, b), to = Math.max(a, b);
      var words = text.slice(from, to);
      if (!words.trim()) return;
      // A passage keeps no space at either end, so that it reads as a quote.
      from += words.length - words.replace(/^\s+/, "").length;
      to -= words.length - words.replace(/\s+$/, "").length;
      words = text.slice(from, to);
      if (to - from < 2) return;
      var home = box.parentNode;
      if (!home) return;
      var ask = home.querySelector(".pv-ws-markask");
      if (ask) ask.parentNode.removeChild(ask);
      ask = h("p", { class: "pv-ws-markask" },
        h("button", { class: "pv-button", type: "button", onclick: function () {
          api("/api/keep/mark", { method: "POST", body: { kind: t.kind, ref: t.ref, at: from, text: words.slice(0, 1000) } }).then(function (r) {
            if (!r.ok) { ask.textContent = r.data.error || "That passage could not be marked just now."; return; }
            reload();
          });
        } }, "Mark This Passage"),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () { ask.parentNode.removeChild(ask); } }, "Cancel"));
      box.parentNode.insertBefore(ask, box.nextSibling);
    }
    return box;
  }

  // Where a place in the page's text stands in the plain text of the box.
  function offsetIn(root, node, offset) {
    var n = 0, done = false;
    (function walk(el) {
      for (var i = 0; i < el.childNodes.length && !done; i++) {
        var c = el.childNodes[i];
        if (c === node) {
          n += c.nodeType === 3 ? offset : textLength(c, offset);
          done = true;
          return;
        }
        if (c.nodeType === 3) n += c.nodeValue.length;
        else {
          if (c.contains && c.contains(node)) { walk(c); return; }
          n += c.textContent.length;
        }
      }
    })(root);
    return n;
  }
  function textLength(el, childIndex) {
    var n = 0;
    for (var i = 0; i < childIndex && i < el.childNodes.length; i++) n += el.childNodes[i].textContent.length;
    return n;
  }

  function copyText(text, button, idle, done) {
    function say(msg) {
      button.textContent = msg;
      window.setTimeout(function () { button.textContent = idle; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { say(done); }, function () { say("Could not copy"); });
      return;
    }
    try {
      var area = h("textarea", { readonly: true, style: "position:fixed;opacity:0" });
      area.value = text;
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(area);
      say(ok ? done : "Could not copy");
    } catch (e) { say("Could not copy"); }
  }

  // ------------------------------------------------------------ The Notes

  function notes(me) {
    var state = { q: "", on: {}, order: "new", from: 0, project: params.get("project") || "" };
    var counts = {};
    var ui = frame({
      placeholder: "Words in your notes and in what they are on",
      searchLabel: "Search your notes",
      filterLabel: "Filters",
      orders: [["new", "Newest first"], ["old", "Oldest first"], ["kind", "By what they are on"]],
      order: state.order,
      onSearch: function (q) { state.q = q; state.from = 0; load(); },
      onOrder: function (o) { state.order = o; state.from = 0; load(); }
    });
    show(head(me, "notes"), ui.bar, ui.body);
    projects().then(function () { if (myProjects.length) load(); });
    load();

    function on() { return Object.keys(state.on).filter(function (k) { return state.on[k]; }); }

    function load() {
      var q = "/api/notes?order=" + state.order + "&from=" + state.from;
      if (state.q) q += "&q=" + encodeURIComponent(state.q);
      if (on().length) q += "&on=" + on().join(",");
      if (state.project) q += "&project=" + encodeURIComponent(state.project);
      return Promise.all([api(q), site()]).then(function (both) {
        var r = both[0], data = both[1];
        if (r.status === 401 || r.status === 403) { location.href = PAGES.home; return; }
        if (!r.ok) { clear(ui.list); add(ui.list, message(r.data.error || "Your notes could not be loaded just now. Please try again.", "error")); return; }
        counts = r.data.counts || {};
        drawSide();
        clear(ui.head);
        add(ui.head, h("p", { class: "pv-ws-count-line", text: plural(r.data.total || 0, "note", "notes") }));
        drawList(r.data, data);
      });
    }

    function drawSide() {
      clear(ui.side);
      if (myProjects.length) {
        var pick = h("select", { class: "pv-ws-pick-s", id: "ws-nproject" });
        add(pick, h("option", { value: "", text: "Everything" }));
        myProjects.forEach(function (p) {
          add(pick, h("option", { value: p.id, text: p.title, selected: state.project === p.id }));
        });
        pick.addEventListener("change", function () { state.project = pick.value; state.from = 0; load(); });
        add(ui.side, h("div", { class: "pv-ws-group" },
          h("h2", { class: "pv-ws-group-h" }, h("label", { for: "ws-nproject", text: "Project" })), pick));
      }
      var group = h("div", { class: "pv-ws-group" }, h("h2", { class: "pv-ws-group-h", text: "Notes On" }));
      KINDS.forEach(function (k) {
        var box = h("input", { type: "checkbox", id: "on-" + k[0], checked: !!state.on[k[0]] });
        box.addEventListener("change", function () { state.on[k[0]] = box.checked; state.from = 0; load(); });
        add(group, h("label", { class: "pv-ws-opt", for: "on-" + k[0] }, box,
          h("span", { class: "pv-ws-opt-n", text: k[1] }), h("span", { class: "pv-ws-opt-c", text: String(counts[k[0]] || 0) })));
      });
      add(ui.side, group);
    }

    function drawList(d, data) {
      clear(ui.list);
      var list = d.notes || [];
      if (!list.length) {
        if (state.q || on().length || state.project) {
          add(ui.list, h("div", { class: "pv-ws-blank" }, h("p", { class: "pv-ws-blank-t", text: "No note under those words." }),
            h("p", null, h("button", { class: "pv-lib-link", type: "button", onclick: function () {
              state.q = ""; state.on = {}; state.project = ""; ui.search.value = ""; state.from = 0; load();
            } }, "Show every note again"))));
          return;
        }
        add(ui.list, h("div", { class: "pv-ws-blank" },
          h("p", { class: "pv-ws-blank-t", text: "No notes yet." }),
          h("p", { text: "Press Note on anything you read on the site. The note stays with it, and all your notes gather here." })));
        return;
      }
      var ul = h("ul", { class: "pv-ws-notes" });
      list.forEach(function (n) { add(ul, noteRow(n, data, load)); });
      add(ui.list, ul);
      if (d.more) add(ui.list, h("button", { class: "pv-lib-more", type: "button", onclick: function () { state.from += 25; load(); } }, "Show more"));
      if (state.from) add(ui.list, h("p", null, h("button", { class: "pv-lib-link", type: "button", onclick: function () { state.from = 0; load(); } }, "Back to the first")));
    }
  }

  function noteRow(n, data, reload) {
    var li = h("li", { class: "pv-ws-note-item" });
    add(li, h("p", { class: "pv-ws-kind-label", text: "On " + (n.kind === "actor" ? "an " : "a ") + kindLabel(n.kind) }));
    var where = [n.title || n.ref];
    if (n.extra) where.push(n.extra);
    add(li, h("p", { class: "pv-ws-note-src" }, n.url
      ? h("a", { href: n.url, text: where.join(". ") })
      : h("span", { text: where.join(". ") })));
    var words = h("p", { class: "pv-ws-note-words", text: n.body });
    add(li, words);
    var meta = h("p", { class: "pv-ws-note-meta" }, h("span", { text: when(n.note_changed) }));
    add(meta, h("button", { class: "pv-lib-link", type: "button", onclick: function () { edit(); } }, "Edit"));
    add(meta, h("button", { class: "pv-lib-link", type: "button", onclick: function (e) { toNotebook(e.currentTarget); } }, "Send to Notebook"));
    add(meta, h("button", { class: "pv-lib-link", type: "button", onclick: function () { askDelete(meta); } }, "Delete"));
    add(li, meta);
    return li;

    function edit() {
      if (li.querySelector(".pv-ws-notebox")) return;
      var area = h("textarea", { rows: "4" });
      area.value = n.body;
      var id = "ws-note-e-" + Math.random().toString(36).slice(2, 9);
      area.id = id;
      var err = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
      var box = h("div", { class: "pv-ws-notebox" },
        h("label", { class: "pv-ws-label-s", for: id, text: "Your Note" }), area, err,
        h("p", { class: "pv-ws-notebox-row" },
          h("button", { class: "pv-button", type: "button", onclick: function () {
            api("/api/keep/note", { method: "POST", body: { kind: n.kind, ref: n.ref, body: area.value } }).then(function (r) {
              if (!r.ok) { err.textContent = r.data.error || "That note could not be saved just now."; return; }
              reload();
            });
          } }, "Save Note"),
          h("button", { class: "pv-lib-link", type: "button", onclick: function () { box.parentNode.removeChild(box); } }, "Cancel")));
      li.appendChild(box);
      area.focus();
    }

    // A longer thought leaves the note and becomes a page of the Notebook. The
    // note itself stays where it is, with its thing.
    function toNotebook(button) {
      var label = button.textContent;
      button.disabled = true;
      button.textContent = "Sending…";
      var where = [n.title || n.ref, n.extra].filter(Boolean).join(". ");
      var page = {
        ops: [
          { insert: n.body },
          { insert: "\n", attributes: { blockquote: true } },
          { insert: "My note on " + where },
          { insert: "\n" }
        ]
      };
      api("/api/pages", {
        method: "POST",
        body: {
          title: "Note on " + cut(n.title || n.ref, 120),
          body: JSON.stringify(page),
          words: n.body + "\nMy note on " + where
        }
      }).then(function (r) {
        button.disabled = false;
        if (!r.ok) { button.textContent = r.data.error || "Could not be sent"; return; }
        button.textContent = label;
        var row = button.parentNode;
        if (!row.querySelector(".pv-ws-sent")) {
          add(row, h("span", { class: "pv-ws-sent" },
            h("a", { href: PAGES.notebook + "?page=" + encodeURIComponent(r.data.page.id), text: "Open the new page" })));
        }
      });
    }

    function askDelete(row) {
      var ask = h("span", { class: "pv-ws-ask" }, h("span", { text: "Delete this note? The thing stays on your shelf." }),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () {
          api("/api/keep/note", { method: "POST", body: { kind: n.kind, ref: n.ref, body: "" } }).then(reload);
        } }, "Delete"),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () { row.removeChild(ask); } }, "Keep"));
      row.appendChild(ask);
    }
  }

  // Shared with desk.js and with write.js (Write, Projects and Tools).
  window.PVW = {
    api: api, h: h, add: add, clear: clear, show: show, message: message, debounce: debounce,
    countryName: countryName, DATE_LONG: DATE_LONG, head: head, when: when, plural: plural, cut: cut,
    site: site, frame: frame, KINDS: KINDS, crossLinks: crossLinks, params: params,
    PAGES: PAGES, BASE: BASE, projects: projects, copyText: copyText
  };
})();
