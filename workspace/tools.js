/* The three case tools of the Researcher's Workspace: Case Selection, the
 * Chronology Maker and the Case File (master plan, section 18, stage 2,
 * batch 4, Part B).
 *
 * One rule stands above the three. A tool finds, lists and exports. It writes
 * no sentence of judgement, it ranks nothing and it recommends no case. Every
 * row carries its source and its date, and "not covered" is never "none".
 *
 * The four rules for every tool hold here too. One spine: every case on the
 * screen opens the page the site already has for it, and every Monitor item
 * opens the item itself. The site describes and R infers: these tools count,
 * list and export, and do no statistics at all, so nothing leaves the site as
 * a number of ours. Private by design: the events a reader adds are the
 * reader's own, they are marked as the reader's own on screen and in every
 * export, and they are never mixed silently into the Monitor's items.
 *
 * Of the six rules for charts, the four that fit a table hold: every view has
 * an address that opens exactly what is seen, the numbers behind it can be
 * downloaded, every view carries the stamp of the data it was made from, and
 * one click saves what is on the screen into a project.
 *
 * Everything here runs in the page, from the data files the site already
 * publishes. The only thing the server holds for these tools is the events a
 * reader adds (server/src/events.js).
 */
(function () {
  "use strict";

  var W = window.PVW;
  if (!W) return;
  var api = W.api, h = W.h, add = W.add, clear = W.clear, show = W.show, message = W.message;
  var head = W.head, PAGES = W.PAGES, BASE = W.BASE, DATE_LONG = W.DATE_LONG;
  var params = W.params, plural = W.plural, projects = W.projects, copyText = W.copyText;
  var countryName = W.countryName;

  // ------------------------------------------------------------ the data

  var SITE = "https://populiverse.com/";

  var dataJob = null;
  function caseData() {
    if (dataJob) return dataJob;
    function load(name) {
      return fetch(BASE + "../data/" + name, { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error(name);
        return r.json();
      });
    }
    dataJob = Promise.all([load("who-counts.json"), load("in-power.json"), load("monitor.json")])
      .then(function (r) {
        var d = { who: r[0], power: r[1], mon: r[2], byData: {}, actorBy: {}, itemsOf: {} };
        (d.mon.actors || []).forEach(function (a) {
          d.actorBy[a.id] = a;
          if (a.data) d.byData[a.data] = a;
        });
        return d;
      });
    return dataJob;
  }

  var REGIONS = {
    "europe": "Europe", "north-america": "North America", "latin-america": "Latin America",
    "asia-pacific": "Asia-Pacific", "mena": "Middle East and North Africa", "sub-saharan-africa": "Sub-Saharan Africa"
  };
  // The words of Populists in Power, as that page itself gives them.
  var PLACES = {
    "3": "A populist leads the government",
    "2": "A populist party is a partner in government",
    "1": "A populist party supports the government from outside",
    "0": "No populist in government",
    "-1": "Not known: a party in government could not be linked",
    "null": "Not covered by the datasets"
  };
  var ORDER = { "null": -2, "0": -1, "-1": 0, "1": 1, "2": 2, "3": 3 };
  var POWER_NOW = { leads: "Leads the government", partner: "In the government, as a partner", supports: "Supports the government from outside" };
  var DATASETS = { pl: "The PopuList", gd: "Global Populism Database", gs: "Global Party Survey", vp: "V-Party" };
  var MARKS = { agree: "The datasets agree", differ: "The datasets differ", one: "One dataset only" };
  var NOW_YEAR = new Date().getUTCFullYear();

  function stronger(a, b) { return ORDER[String(b)] > ORDER[String(a)] ? b : a; }

  // The place of populists in a country's government in one year, as
  // Populists in Power reads it: the stronger of what the parties in the
  // government say and what the head of government says.
  function placeIn(P, iso, year) {
    var c = P.countries[iso];
    if (!c) return null;
    var p = c.yp[String(year)];
    var l = c.yl[String(year)];
    p = p === undefined ? null : p;
    l = l === undefined ? null : l;
    return stronger(p, l);
  }

  // Across a whole period: the strongest place reached, the years at each
  // place, and whether any year at all is covered.
  function placeOver(P, iso, from, to) {
    var best = null, covered = 0, years = {};
    for (var y = from; y <= to; y++) {
      var v = placeIn(P, iso, y);
      if (v === null) continue;
      covered++;
      years[String(v)] = (years[String(v)] || 0) + 1;
      best = stronger(best, v);
    }
    return { best: best, covered: covered, years: years };
  }

  // The years a dataset speaks for, for one party or leader.
  function yearsOf(r) {
    var from = null, to = null;
    function seen(y) {
      if (!y || typeof y !== "number") return;
      if (from === null || y < from) from = y;
      if (to === null || y > to) to = y;
    }
    (r.vp || []).forEach(function (v) { (v.el || []).forEach(function (e) { seen(e[0]); }); });
    (r.gd || []).forEach(function (t) { seen(t[1]); seen(t[2]); });
    (r.pl || []).forEach(function (e) {
      var s = e.sets && e.sets.p;
      if (!s || !s.y) return;
      if (s.y[0] > 1900) seen(s.y[0]);
      if (s.y[1] < 2100) seen(s.y[1]);
    });
    return { from: from, to: to };
  }

  function datasetsOf(r) {
    var out = [];
    ["pl", "gd", "gs", "vp"].forEach(function (k) {
      var v = r[k];
      if (v && (!Array.isArray(v) || v.length)) out.push(DATASETS[k]);
    });
    return out;
  }

  // ------------------------------------------------------------ small things

  function today() { return new Date().toISOString().slice(0, 10); }
  function longDay() { return DATE_LONG.format(new Date()); }

  // A date as the Monitor gives it: a day, a month or a year.
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function dayWords(d) {
    var s = String(d || "");
    var m = s.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
    if (!m) return s;
    if (!m[2]) return m[1];
    if (!m[3]) return MONTHS[Number(m[2]) - 1] + " " + m[1];
    return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1];
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvFile(head, rows, name) {
    var lines = [head.map(csvCell).join(",")];
    rows.forEach(function (r) { lines.push(r.map(csvCell).join(",")); });
    saveBlob(new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }), name);
  }
  function saveBlob(blob, name) {
    var a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    window.setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function fileName(title, ending) {
    var slug = String(title || "untitled").normalize("NFKD").replace(/[^\w\s-]/g, "").trim()
      .replace(/\s+/g, "-").slice(0, 60).toLowerCase();
    return (slug || "untitled") + "-" + today() + ending;
  }

  // One quiet line that says what a button is doing, and then clears.
  function says() {
    return h("span", { class: "pv-ws-small pv-ws-tool-said", "aria-live": "polite" });
  }
  function saying(said, words) {
    said.textContent = words;
    window.setTimeout(function () { if (said.textContent === words) said.textContent = ""; }, 3000);
  }

  // The address of this very view, so that a link opens exactly what is seen
  // (the third rule for charts, the row of 2026-11-12).
  function addressOf(tool, state) {
    var q = ["tool=" + tool];
    Object.keys(state).forEach(function (k) {
      var v = state[k];
      if (v === "" || v === null || v === undefined) return;
      q.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    });
    return SITE + "workspace/tools.html?" + q.join("&");
  }

  function linkRow(tool, state, said) {
    var btn = h("button", { class: "pv-lib-link", type: "button", onclick: function () {
      copyText(addressOf(tool, state), btn, "Copy the Link to This View", "Link copied");
    } }, "Copy the Link to This View");
    return btn;
  }

  // ------------------------------------------------------------ the Word file

  function withDocx() {
    if (window.docx) return Promise.resolve(window.docx);
    return new Promise(function (done, fail) {
      var s = document.createElement("script");
      s.src = BASE + "vendor/docx.js";
      s.onload = function () { window.docx ? done(window.docx) : fail(new Error("docx")); };
      s.onerror = function () { fail(new Error("docx")); };
      document.head.appendChild(s);
    });
  }

  // A Word file of plain blocks and tables. The shared builder in write.js
  // makes drafts and bibliographies; a chronology and a case file are tables
  // and headed blocks, so they are built here, with the same typeface and the
  // same quiet foot line.
  var FONT = "Libre Baskerville";
  function wordFile(docx, opts) {
    var P = docx.Paragraph, T = docx.TextRun;
    var AUTO = docx.LineRuleType ? docx.LineRuleType.AUTO : "auto";
    var kids = [new P({ text: opts.title || "Untitled", heading: docx.HeadingLevel.TITLE })];
    (opts.blocks || []).forEach(function (b) {
      if (b.heading) {
        kids.push(new P({ text: b.heading, heading: b.level === 1 ? docx.HeadingLevel.HEADING_1 : docx.HeadingLevel.HEADING_2 }));
        return;
      }
      if (b.table) {
        kids.push(tableOf(docx, b.table));
        kids.push(new P({ text: "", spacing: { after: 160 } }));
        return;
      }
      if (b.small) {
        kids.push(new P({ children: [new T({ text: b.small, size: 18, color: "4A4A4A" })], spacing: { after: 160 } }));
        return;
      }
      kids.push(new P({ children: [new T({ text: b.text || "" })], spacing: { after: 120 } }));
    });
    if (opts.foot) kids.push(new P({ children: [new T({ text: opts.foot, size: 18, color: "4A4A4A" })], spacing: { before: 360 } }));
    var heading = function (size) {
      return {
        run: { font: FONT, color: "000000", bold: true, size: size },
        paragraph: { spacing: { before: 240, after: 120, line: 276, lineRule: AUTO } }
      };
    };
    return new docx.Document({
      creator: "PopuliVerse Workspace",
      title: opts.title || "Untitled",
      styles: {
        default: {
          document: { run: { font: FONT, size: 21, color: "000000" }, paragraph: { spacing: { line: 300, lineRule: AUTO } } },
          title: { run: { font: FONT, color: "000000", size: 36 }, paragraph: { spacing: { after: 240, line: 276, lineRule: AUTO } } },
          heading1: heading(28),
          heading2: heading(24)
        }
      },
      sections: [{ children: kids }]
    });
  }

  function tableOf(docx, t) {
    var P = docx.Paragraph, T = docx.TextRun, Row = docx.TableRow, Cell = docx.TableCell;
    function cell(text, bold) {
      return new Cell({
        children: String(text === null || text === undefined ? "" : text).split("\n").map(function (line, i) {
          return new P({ children: [new T({ text: line, bold: !!bold, size: 19 })], spacing: i ? { before: 40 } : {} });
        }),
        margins: { top: 60, bottom: 60, left: 90, right: 90 }
      });
    }
    var rows = [new Row({ children: t.head.map(function (c) { return cell(c, true); }), tableHeader: true })];
    t.rows.forEach(function (r) { rows.push(new Row({ children: r.map(function (c) { return cell(c, false); }) })); });
    return new docx.Table({ rows: rows, width: { size: 100, type: docx.WidthType.PERCENTAGE } });
  }

  function makeWord(opts, said, words) {
    said.textContent = "Making the Word file…";
    withDocx().then(function (docx) {
      return docx.Packer.toBlob(wordFile(docx, opts)).then(function (blob) {
        saveBlob(blob, fileName(opts.file || opts.title, ".docx"));
        saying(said, "Downloaded");
      });
    }, function () { saying(said, "The Word file could not be made"); })
      .catch(function () { saying(said, "The Word file could not be made"); });
  }

  // ------------------------------------------------------------ the frame

  function toolPage(me, title, lede) {
    var body = h("div", { class: "pv-ws-tool-page" });
    show(head(me, "tools"),
      h("p", { class: "pv-ws-small" }, h("a", { href: PAGES.tools }, "Back to the tools")),
      h("h2", { class: "pv-ws-h", text: title }),
      lede ? h("p", { class: "pv-ws-lede-s", text: lede }) : null,
      body);
    return body;
  }

  function waiting(body) {
    clear(body);
    add(body, h("p", { class: "pv-lib-loading", text: "Loading the data of the site…" }));
  }
  function failed(body) {
    clear(body);
    add(body, message("The data of the site could not be loaded. Please try again a little later.", "error"));
  }

  function picker(id, label, list, value, hint) {
    var s = h("select", { id: "pv-" + id });
    list.forEach(function (o) { s.appendChild(h("option", { value: o[0], selected: String(o[0]) === String(value), text: o[1] })); });
    return { el: h("div", { class: "pv-ws-field" }, h("label", { for: "pv-" + id, class: "pv-wc-label" }, label), s,
      hint ? h("p", { class: "pv-ws-hint", text: hint }) : null), sel: s };
  }

  function yearList(from, to) {
    var out = [];
    for (var y = from; y <= to; y++) out.push([String(y), String(y)]);
    return out;
  }

  // The stamp every view carries: the datasets with their versions, the last
  // issue of the Monitor, and the day the view was made.
  function stamp(d) {
    return [
      d.who.sources.pl.name, d.who.sources.gd.name, d.who.sources.gs.name,
      d.who.sources.vp.name, d.power.sources.pp.name
    ];
  }

  // ============================================================ B1. Case Selection

  function caseSelection(me, state) {
    var body = toolPage(me, "Case Selection",
      "The cases that match your criteria, each with why it matched, and a statement you can paste into a methods section.");
    waiting(body);
    caseData().then(function (d) { drawSelection(me, d, body, state); }, function () { failed(body); });
  }

  function drawSelection(me, d, body, state) {
    clear(body);
    var S = {
      cases: state.cases === "actors" ? "actors" : "countries",
      region: state.region || "",
      from: String(Number(state.from) || 1990),
      to: String(Number(state.to) || NOW_YEAR),
      place: state.place || "",
      verdict: state.verdict || "",
      agree: state.agree || "",
      kind: state.kind || "",
      monitor: state.monitor || "",
      power: state.power || ""
    };

    var regions = [["", "All regions"]].concat(Object.keys(REGIONS).map(function (k) { return [k, REGIONS[k]]; }));
    var out = h("div");
    var form = h("div", { class: "pv-ws-form pv-ws-select-form" });
    add(body, form, out);

    function draw() {
      clear(form);
      var kindPick = picker("cases", "What kind of case", [["countries", "Countries"], ["actors", "Parties and leaders"]], S.cases);
      kindPick.sel.addEventListener("change", function () { S.cases = kindPick.sel.value; draw(); run(); });
      var regionPick = picker("region", "Region", regions, S.region);
      var fromPick = picker("from", "From", yearList(1990, NOW_YEAR), S.from);
      var toPick = picker("to", "To", yearList(1990, NOW_YEAR), S.to);
      var monPick = picker("monitor", "Followed by the Monitor",
        [["", "Either way"], ["yes", "On the Monitor's list"], ["no", "Not on the Monitor's list"]], S.monitor);
      var powerPick = picker("power", "In power today",
        [["", "Either way"], ["yes", "In power today, by the Monitor"], ["no", "Not in power today"]], S.power,
        "Today means the last issue of the Monitor, " + d.mon.issue + ".");

      var middle = [];
      var placePick = null, verdictPick = null, agreePick = null, actorKindPick = null;
      if (S.cases === "countries") {
        placePick = picker("place", "The place of populists in government in that period", [
          ["", "Any place, or none"],
          ["any", "A populist in government at some time"],
          ["3", PLACES["3"]],
          ["2", PLACES["2"]],
          ["1", PLACES["1"]],
          ["0", "No populist in government in any year"]
        ], S.place, "A country that no dataset covers for these years is kept and marked. Not covered never means none.");
        middle = [placePick.el];
      } else {
        verdictPick = picker("verdict", "The datasets' verdict", [
          ["", "Any verdict"],
          ["pop", "At least one dataset says populist"],
          ["not", "No dataset says populist"]
        ], S.verdict);
        agreePick = picker("agree", "Whether they agree", [
          ["", "Agree, differ or one only"],
          ["agree", "The datasets agree"],
          ["differ", "The datasets differ"],
          ["one", "One dataset only"]
        ], S.agree);
        actorKindPick = picker("kind", "Parties or leaders", [["", "Both"], ["party", "Parties"], ["leader", "Leaders"]], S.kind);
        middle = [h("div", { class: "pv-ws-pair" }, verdictPick.el, agreePick.el), actorKindPick.el];
      }

      var all = [kindPick, regionPick, fromPick, toPick, monPick, powerPick, placePick, verdictPick, agreePick, actorKindPick];
      all.forEach(function (p) {
        if (!p || p === kindPick) return;
        p.sel.addEventListener("change", function () {
          S.region = regionPick.sel.value;
          S.from = fromPick.sel.value;
          S.to = toPick.sel.value;
          S.monitor = monPick.sel.value;
          S.power = powerPick.sel.value;
          S.place = placePick ? placePick.sel.value : "";
          S.verdict = verdictPick ? verdictPick.sel.value : "";
          S.agree = agreePick ? agreePick.sel.value : "";
          S.kind = actorKindPick ? actorKindPick.sel.value : "";
          if (Number(S.from) > Number(S.to)) { S.to = S.from; toPick.sel.value = S.to; }
          run();
        });
      });

      add(form, kindPick.el, h("div", { class: "pv-ws-pair" }, regionPick.el, h("div", { class: "pv-ws-pair" }, fromPick.el, toPick.el)),
        middle, h("div", { class: "pv-ws-pair" }, monPick.el, powerPick.el));
    }

    function run() {
      clear(out);
      var found = S.cases === "countries" ? countryCases(d, S) : actorCases(d, S);
      add(out, resultTable(d, S, found), statementBlock(d, S, found), actions(d, S, found));
    }

    draw();
    run();
  }

  // ---- the countries

  function countryCases(d, S) {
    var from = Number(S.from), to = Number(S.to);
    var rows = [];
    var notCovered = 0;
    Object.keys(d.power.places).forEach(function (iso) {
      var place = d.power.places[iso];
      if (S.region && place[2] !== S.region) return;
      var monCountry = d.mon.places[iso] || null;
      var actors = (d.mon.actors || []).filter(function (a) { return a.iso === iso; });
      var inPower = actors.filter(function (a) { return a.power; });
      if (S.monitor === "yes" && !monCountry && !actors.length) return;
      if (S.monitor === "no" && (monCountry || actors.length)) return;
      if (S.power === "yes" && !inPower.length) return;
      if (S.power === "no" && inPower.length) return;

      var over = placeOver(d.power, iso, from, to);
      var covered = over.covered > 0;
      if (!covered) {
        // A country no dataset covers for these years is kept and marked,
        // whatever place was asked for, and is never called "none". It is
        // counted apart from the cases that matched, and stands under them.
        notCovered++;
      } else {
        if (S.place === "any" && ORDER[String(over.best)] < ORDER["1"]) return;
        if (S.place === "0" && over.best !== 0) return;
        if (/^[123]$/.test(S.place) && String(over.best) !== S.place) return;
      }
      var why = [];
      if (S.region) why.push(REGIONS[S.region]);
      why.push(covered ? PLACES[String(over.best)] + " at some time between " + from + " and " + to
        : "No dataset covers " + place[0] + " between " + from + " and " + to);
      if (S.monitor === "yes") why.push("On the Monitor's list");
      if (S.power === "yes") why.push(inPower.map(function (a) { return a.name + ", " + POWER_NOW[a.power].toLowerCase(); }).join("; "));
      rows.push({
        kind: "country",
        ref: iso,
        judged: covered,
        name: place[0],
        region: REGIONS[place[2]] || place[2],
        covered: covered,
        place: covered ? PLACES[String(over.best)] : PLACES["null"],
        years: over.years,
        monitor: monCountry || actors.length ? "Yes" : "No",
        now: inPower.length ? inPower.map(function (a) { return a.name + " (" + POWER_NOW[a.power].toLowerCase() + ")"; }).join("; ") : "",
        page: d.mon.places[iso] ? SITE + "countries/" + d.mon.places[iso][6] + ".html" : "",
        why: why.join(". ")
      });
    });
    // The cases that matched stand first, then those no dataset can judge.
    rows.sort(function (a, b) {
      return (a.judged === b.judged ? 0 : a.judged ? -1 : 1) || a.name.localeCompare(b.name);
    });
    return { rows: rows, matched: rows.length - notCovered, notCovered: notCovered };
  }

  // ---- the parties and leaders

  function actorCases(d, S) {
    var from = Number(S.from), to = Number(S.to);
    var rows = [];
    var notCovered = 0;
    (d.who.rows || []).forEach(function (r) {
      var region = d.who.regions[r.c] || "";
      if (S.region && region !== S.region) return;
      if (S.kind && r.k !== S.kind) return;
      if (S.verdict === "pop" && !r.pop) return;
      if (S.verdict === "not" && r.pop) return;
      if (S.agree && r.m !== S.agree) return;
      var mon = d.byData[r.id] || null;
      if (S.monitor === "yes" && !mon) return;
      if (S.monitor === "no" && mon) return;
      if (S.power === "yes" && !(mon && mon.power)) return;
      if (S.power === "no" && mon && mon.power) return;

      var span = yearsOf(r);
      var covered = span.from !== null;
      if (!covered) notCovered++;
      else if (span.to < from || span.from > to) return;

      var sets = datasetsOf(r);
      var why = [];
      if (S.region) why.push(REGIONS[S.region]);
      if (S.kind) why.push(r.k === "leader" ? "A leader" : "A party");
      if (S.verdict === "pop") why.push("At least one dataset says populist");
      if (S.verdict === "not") why.push("No dataset says populist");
      if (S.agree) why.push(MARKS[S.agree]);
      why.push(covered ? "The datasets speak for " + span.from + " to " + span.to
        : "No dataset gives years for this case");
      if (S.monitor === "yes") why.push("On the Monitor's list");
      if (S.power === "yes" && mon) why.push(POWER_NOW[mon.power]);
      rows.push({
        kind: "actor",
        ref: mon ? mon.id : r.id,
        judged: covered,
        savable: !!mon,
        name: r.n + (r.s ? " (" + r.s + ")" : ""),
        country: r.cl || r.c,
        region: REGIONS[region] || region,
        what: r.k === "leader" ? "Leader" : "Party",
        covered: covered,
        span: covered ? span.from + " to " + span.to : "Not covered",
        verdict: r.pop ? "At least one dataset says populist" : "No dataset says populist",
        datasets: sets.length ? sets.join("; ") : "None",
        agree: MARKS[r.m] || r.m,
        monitor: mon ? "Yes" : "No",
        now: mon && mon.power ? POWER_NOW[mon.power] : "",
        page: mon ? SITE + "actors/" + mon.id + ".html" : SITE + "data/who-counts.html#" + encodeURIComponent(r.id),
        why: why.join(". ")
      });
    });
    rows.sort(function (a, b) {
      return (a.judged === b.judged ? 0 : a.judged ? -1 : 1)
        || String(a.country).localeCompare(String(b.country)) || a.name.localeCompare(b.name);
    });
    return { rows: rows, matched: rows.length - notCovered, notCovered: notCovered };
  }

  // ---- what comes out

  function resultTable(d, S, found) {
    var wrap = h("div");
    add(wrap, h("p", { class: "pv-ws-count-line", text:
      plural(found.matched, "case matches", "cases match") + " these criteria."
      + (found.notCovered
        ? " " + found.notCovered + (found.notCovered === 1 ? " more case could" : " more cases could") + " not be judged, because no dataset covers "
          + (found.notCovered === 1 ? "it" : "them") + " for these years. "
          + (found.notCovered === 1 ? "It stands" : "They stand") + " under the rest, and "
          + (found.notCovered === 1 ? "is" : "are") + " never counted as none."
        : "") }));
    if (!found.rows.length) {
      add(wrap, h("p", { class: "pv-lib-nomatch", text: "Nothing fits these criteria." }));
      return wrap;
    }
    var mark = function (r) { return r.judged ? "" : " is-unjudged"; };
    var headRow = S.cases === "countries"
      ? ["Country", "Region", "The place in that period", "On the Monitor's list", "In power today", "Why it matched"]
      : ["Name", "Country", "Party or leader", "The datasets", "Verdict", "They", "Years covered", "On the Monitor's list", "In power today", "Why it matched"];
    var tbody = h("tbody");
    var table = h("table", { class: "pv-ws-table pv-ws-cases" },
      h("thead", null, h("tr", null, headRow.map(function (c) { return h("th", { text: c }); }))), tbody);
    var shown = 0;
    function fill(n) {
      clear(tbody);
      found.rows.slice(0, n).forEach(function (r) {
        var name = r.page ? h("a", { href: r.page, text: r.name }) : h("span", { text: r.name });
        var cells = S.cases === "countries"
          ? [name, h("span", { text: r.region }), h("span", { text: r.place }), h("span", { text: r.monitor }),
             h("span", { text: r.now || "No" }), h("span", { text: r.why })]
          : [name, h("span", { text: r.country }), h("span", { text: r.what }), h("span", { text: r.datasets }),
             h("span", { text: r.verdict }), h("span", { text: r.agree }), h("span", { text: r.span }),
             h("span", { text: r.monitor }), h("span", { text: r.now || "No" }), h("span", { text: r.why })];
        tbody.appendChild(h("tr", { class: "pv-ws-case-row" + mark(r) }, cells.map(function (c, i) {
          return h("td", { "data-label": headRow[i] }, c);
        })));
      });
      shown = Math.min(n, found.rows.length);
    }
    fill(50);
    add(wrap, h("div", { class: "pv-ws-table-wrap" }, table));
    if (found.rows.length > 50) {
      var more = h("button", { class: "pv-lib-link", type: "button", onclick: function () { fill(found.rows.length); more.remove(); } },
        "Show all " + found.rows.length);
      add(wrap, h("p", null, more));
    }
    return wrap;
  }

  // The selection statement: one paragraph a reader can paste into a methods
  // section. It names the criteria, each dataset with its version, the day,
  // how many cases matched and how many could not be judged.
  function statementWords(d, S, found) {
    var bits = [];
    bits.push(S.cases === "countries"
      ? "The cases were selected with the Case Selection tool of PopuliVerse on " + longDay() + "."
      : "The cases were selected with the Case Selection tool of PopuliVerse on " + longDay() + ".");
    var crit = [];
    crit.push(S.cases === "countries" ? "countries" : "parties and leaders");
    crit.push(S.region ? "in " + REGIONS[S.region] : "in every region");
    crit.push("for the years " + S.from + " to " + S.to);
    if (S.cases === "countries") {
      if (S.place === "any") crit.push("where a populist held a place in government at some time in those years");
      else if (S.place === "0") crit.push("where no populist held a place in government in any of those years");
      else if (/^[123]$/.test(S.place)) crit.push("where, at the strongest, " + PLACES[S.place].toLowerCase());
    } else {
      if (S.kind) crit.push(S.kind === "leader" ? "leaders only" : "parties only");
      if (S.verdict === "pop") crit.push("where at least one dataset gives the verdict populist");
      if (S.verdict === "not") crit.push("where no dataset gives the verdict populist");
      if (S.agree === "agree") crit.push("where every dataset that speaks for the same years gives the same verdict");
      if (S.agree === "differ") crit.push("where the datasets differ");
      if (S.agree === "one") crit.push("where one dataset only speaks for the case");
    }
    if (S.monitor === "yes") crit.push("on the watchlist of the PopuliVerse Monitor");
    if (S.monitor === "no") crit.push("not on the watchlist of the PopuliVerse Monitor");
    if (S.power === "yes") crit.push("holding a place in government at the last issue of the Monitor, " + d.mon.issue);
    if (S.power === "no") crit.push("holding no place in government at the last issue of the Monitor, " + d.mon.issue);
    bits.push("The criteria were " + crit.join(", ") + ".");
    bits.push("The verdicts are those of " + stamp(d).join(", ") + ", each dataset's own, and the places in government are those of Populists in Power as built on " + dayWords(d.power.built) + ".");
    bits.push(plural(found.matched, "case matched", "cases matched") + " the criteria"
      + (found.notCovered
        ? ", and " + found.notCovered + (found.notCovered === 1 ? " further case" : " further cases")
          + " could not be judged, because no dataset covers " + (found.notCovered === 1 ? "it" : "them")
          + " for these years, so " + (found.notCovered === 1 ? "it is listed apart" : "they are listed apart")
        : ", and every one of them is covered by at least one dataset for these years") + ".");
    bits.push("PopuliVerse settles no disagreement between the datasets, and not covered never means none.");
    return bits.join(" ");
  }

  function statementBlock(d, S, found) {
    var words = statementWords(d, S, found);
    var said = says();
    var copy = h("button", { class: "pv-lib-link", type: "button", onclick: function () {
      copyText(words, copy, "Copy the Statement", "Copied");
    } }, "Copy the Statement");
    return h("section", { class: "pv-ws-section pv-ws-statement" },
      h("h3", { class: "pv-ws-h", text: "The Selection Statement" }),
      h("p", { class: "pv-ws-statement-t", text: words }),
      h("p", null, copy, said));
  }

  function actions(d, S, found) {
    var said = says();
    var state = {};
    Object.keys(S).forEach(function (k) { state[k] = S[k]; });
    var csv = h("button", { class: "pv-lib-link", type: "button", onclick: function () {
      if (!found.rows.length) { saying(said, "Nothing to download"); return; }
      if (S.cases === "countries") {
        csvFile(["country", "iso3", "region", "place_in_that_period", "on_the_monitors_list", "in_power_today", "why_it_matched", "page", "selected_on"],
          found.rows.map(function (r) { return [r.name, r.ref, r.region, r.place, r.monitor, r.now || "No", r.why, r.page, today()]; }),
          fileName("case-selection-countries", ".csv"));
      } else {
        csvFile(["name", "country", "party_or_leader", "datasets", "verdict", "the_datasets", "years_covered", "on_the_monitors_list", "in_power_today", "why_it_matched", "page", "selected_on"],
          found.rows.map(function (r) { return [r.name, r.country, r.what, r.datasets, r.verdict, r.agree, r.span, r.monitor, r.now || "No", r.why, r.page, today()]; }),
          fileName("case-selection-actors", ".csv"));
      }
      saying(said, "Downloaded");
    } }, "Download the Table");

    var saveable = found.rows.filter(function (r) { return r.kind === "country" ? !!r.page : r.savable; });
    var box = h("span");
    projects().then(function (list) {
      if (!list.length) {
        add(box, h("span", { class: "pv-ws-small", text: "Make a project first, and the cases can go into it." }));
        return;
      }
      var pick = h("select", { class: "pv-ws-pick-s", "aria-label": "Add as cases to a project" },
        h("option", { value: "", text: "Add as Cases to a Project…" }),
        list.map(function (p) { return h("option", { value: p.id, text: p.title }); }));
      pick.addEventListener("change", function () {
        if (!pick.value) return;
        var id = pick.value;
        pick.disabled = true;
        said.textContent = "Adding " + plural(saveable.length, "case", "cases") + "…";
        addCases(id, saveable).then(function (n) {
          pick.disabled = false;
          pick.selectedIndex = 0;
          saying(said, n + (n === 1 ? " case added" : " cases added")
            + (saveable.length < found.rows.length
              ? ". " + (found.rows.length - saveable.length) + " of the cases have no page of their own on the site, so they are listed and downloaded but not kept."
              : ""));
        }, function () { pick.disabled = false; saying(said, "They could not be added"); });
      });
      add(box, pick);
    });

    return h("p", { class: "pv-ws-tool-row" }, csv, linkRow("cases", state), box, said);
  }

  // A case is saved as the site already saves an actor or a country, so that
  // it sits beside everything else on the shelf and in the project. A case
  // with no page of its own on the site is listed and downloaded, and never
  // kept, so that nothing stands on a shelf leading nowhere.
  function addCases(projectId, rows) {
    var done = 0;
    var queue = rows.slice(0, 200);
    function next() {
      if (!queue.length) return Promise.resolve(done);
      var r = queue.shift();
      var card = r.kind === "country"
        ? { kind: "country", ref: r.ref, title: r.name, extra: r.region, url: r.page, country: r.ref }
        : { kind: "actor", ref: r.ref, title: r.name, extra: r.what + " · " + r.country, url: r.page };
      return api("/api/keep", { method: "POST", body: card }).then(function (saved) {
        if (!saved.ok) return next();
        return api("/api/projects/" + encodeURIComponent(projectId) + "/things", {
          method: "POST", body: { kind: card.kind, ref: card.ref }
        }).then(function (put) {
          if (put.ok) done++;
          return next();
        });
      });
    }
    return next();
  }

  // ============================================================ B2. Chronology Maker

  function chronology(me, state) {
    var body = toolPage(me, "Chronology Maker",
      "The Monitor's items on one actor, one country or the cases of a project, in order, with the events you add yourself.");
    waiting(body);
    Promise.all([caseData(), projects()]).then(function (r) {
      drawChronology(me, r[0], r[1], body, state);
    }, function () { failed(body); });
  }

  function subjectList(d, projectList) {
    var out = [["", "Choose one"]];
    (d.mon.actors || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (a) { out.push(["actor:" + a.id, a.name + " (" + (a.c || a.iso) + ")"]); });
    Object.keys(d.mon.places).sort(function (a, b) {
      return d.mon.places[a][0].localeCompare(d.mon.places[b][0]);
    }).forEach(function (iso) { out.push(["country:" + iso, d.mon.places[iso][0]]); });
    (projectList || []).forEach(function (p) { out.push(["project:" + p.id, "The cases of " + p.title]); });
    return out;
  }

  function drawChronology(me, d, projectList, body, state) {
    clear(body);
    var S = {
      on: state.on || "",
      from: String(Number(state.from) || 2026),
      to: String(Number(state.to) || NOW_YEAR)
    };
    if (state.p) S.on = "project:" + state.p;
    var form = h("div", { class: "pv-ws-form pv-ws-select-form" });
    var out = h("div");
    add(body, form, out);

    var subject = picker("on", "The chronology is of", subjectList(d, projectList), S.on);
    var fromPick = picker("cfrom", "From", yearList(1990, NOW_YEAR), S.from);
    var toPick = picker("cto", "To", yearList(1990, NOW_YEAR), S.to);
    add(form, subject.el, h("div", { class: "pv-ws-pair" }, fromPick.el, toPick.el));
    [subject, fromPick, toPick].forEach(function (p) {
      p.sel.addEventListener("change", function () {
        S.on = subject.sel.value;
        S.from = fromPick.sel.value;
        S.to = toPick.sel.value;
        if (Number(S.from) > Number(S.to)) { S.to = S.from; toPick.sel.value = S.to; }
        run();
      });
    });

    function run() {
      clear(out);
      if (!S.on) {
        add(out, h("p", { class: "pv-ws-small", text: "Pick an actor, a country or a project, and the chronology is made." }));
        return;
      }
      add(out, h("p", { class: "pv-lib-loading", text: "Making the chronology…" }));
      subjectsOf(d, S.on, projectList).then(function (subjects) {
        if (!subjects.length) {
          clear(out);
          add(out, h("p", { class: "pv-lib-nomatch", text: "That project holds no actor and no country yet." }));
          return;
        }
        ownEventsOf(subjects).then(function (own) {
          clear(out);
          add(out, chronologyView(d, S, subjects, own, run));
        });
      });
    }
    run();
  }

  // What a chronology is of: one actor, one country, or every actor and
  // country of a project.
  function subjectsOf(d, on, projectList) {
    var bits = String(on).split(":");
    if (bits[0] === "actor") {
      var a = d.actorBy[bits[1]];
      return Promise.resolve(a ? [{ kind: "actor", ref: a.id, name: a.name, iso: a.iso }] : []);
    }
    if (bits[0] === "country") {
      var place = d.mon.places[bits[1]];
      return Promise.resolve(place ? [{ kind: "country", ref: bits[1], name: place[0], iso: bits[1] }] : []);
    }
    if (bits[0] === "project") {
      return api("/api/projects/" + encodeURIComponent(bits[1])).then(function (r) {
        var things = (r.data && r.data.things) || [];
        return things.filter(function (t) { return t.kind === "actor" || t.kind === "country"; }).map(function (t) {
          return { kind: t.kind, ref: t.ref, name: t.title || t.ref, iso: t.kind === "country" ? t.ref : (d.actorBy[t.ref] || {}).iso };
        });
      }, function () { return []; });
    }
    return Promise.resolve([]);
  }

  function ownEventsOf(subjects) {
    return Promise.all(subjects.map(function (s) {
      return api("/api/events?kind=" + encodeURIComponent(s.kind) + "&ref=" + encodeURIComponent(s.ref))
        .then(function (r) { return ((r.data && r.data.events) || []).map(function (e) { e.on = s; return e; }); }, function () { return []; });
    })).then(function (lists) {
      var out = [];
      lists.forEach(function (l) { l.forEach(function (e) { out.push(e); }); });
      return out;
    });
  }

  // The Monitor's items on these subjects, inside the period.
  function monitorItems(d, subjects, from, to) {
    var want = {};
    subjects.forEach(function (s) { want[s.kind + ":" + s.ref] = s; });
    var out = [];
    (d.mon.items || []).forEach(function (it) {
      var year = Number(String(it.date).slice(0, 4));
      if (!year || year < from || year > to) return;
      var on = null;
      (it.actors || []).forEach(function (a) { if (!on && want["actor:" + a]) on = want["actor:" + a]; });
      (it.iso || []).forEach(function (c) { if (!on && want["country:" + c]) on = want["country:" + c]; });
      if (!on) return;
      out.push({
        mine: false,
        on: on,
        day: it.date,
        what: it.title || it.s || "",
        type: it.type || "",
        reference: "PopuliVerse Monitor " + it.issue + ", item " + it.n,
        url: SITE + "monitor/" + it.folder + "/#item-" + it.n
      });
    });
    return out;
  }

  function sortRows(rows) {
    return rows.slice().sort(function (a, b) {
      return String(a.day).localeCompare(String(b.day)) || (a.mine === b.mine ? 0 : a.mine ? 1 : -1);
    });
  }

  function chronologyView(d, S, subjects, own, reload) {
    var from = Number(S.from), to = Number(S.to);
    var items = monitorItems(d, subjects, from, to);
    var mine = own.filter(function (e) {
      var y = Number(String(e.day).slice(0, 4));
      return y >= from && y <= to;
    }).map(function (e) {
      return { mine: true, on: e.on, day: e.day, what: e.what, type: "Your own", reference: "Added by you. Source: " + e.source,
        url: "", source: e.source, id: e.id };
    });
    var rows = sortRows(items.concat(mine));
    var wrap = h("div");
    var said = says();

    // One line on every chronology says what it is.
    var whatItIs = "This chronology holds the items of the PopuliVerse Monitor since September 2026, the first issue, and the events you added yourself. It is not a full record of what happened.";

    add(wrap,
      h("p", { class: "pv-ws-count-line", text:
        plural(items.length, "item of the Monitor", "items of the Monitor") + " and "
        + plural(mine.length, "event of your own", "events of your own") + ", "
        + from + " to " + to + ", on " + subjects.map(function (s) { return s.name; }).join(", ") + "." }),
      h("p", { class: "pv-ws-small pv-ws-whatitis", text: whatItIs }));

    if (!rows.length) {
      add(wrap, h("p", { class: "pv-lib-nomatch", text: "The Monitor holds no item on this for these years, and you have added no event. Not covered never means nothing happened." }));
    } else {
      var headRow = ["Date", "What happened", "Type", "Reference"];
      if (subjects.length > 1) headRow.splice(1, 0, "On");
      var tbody = h("tbody", null, rows.map(function (r) {
        var cells = [h("span", { text: dayWords(r.day) })];
        if (subjects.length > 1) cells.push(h("span", { text: r.on ? r.on.name : "" }));
        cells.push(h("span", { text: r.what }));
        cells.push(h("span", { text: r.type }));
        cells.push(r.url
          ? h("a", { href: r.url, text: r.reference })
          : h("span", null, h("span", { class: "pv-ws-mine-mark", text: "Your own" }), " ", h("span", { text: r.reference }),
              " ", h("button", { class: "pv-lib-link", type: "button", onclick: function () {
                api("/api/events/" + encodeURIComponent(r.id), { method: "DELETE" }).then(function () { reload(); });
              } }, "Remove")));
        return h("tr", { class: r.mine ? "is-mine" : "" }, cells.map(function (c, i) {
          return h("td", { "data-label": headRow[i] }, c);
        }));
      }));
      add(wrap, h("div", { class: "pv-ws-table-wrap" },
        h("table", { class: "pv-ws-table pv-ws-chrono" },
          h("thead", null, h("tr", null, headRow.map(function (c) { return h("th", { text: c }); }))), tbody)));
    }

    add(wrap, addEventForm(subjects, reload));

    // Out: a Word file for an appendix, and the table as data.
    var titleOf = "Chronology, " + subjects.map(function (s) { return s.name; }).join(", ") + ", " + from + " to " + to;
    var word = h("button", { class: "pv-lib-link", type: "button", onclick: function () {
      if (!rows.length) { saying(said, "Nothing to put in a file"); return; }
      makeWord({
        title: titleOf,
        file: "chronology-" + subjects.map(function (s) { return s.name; }).join("-"),
        blocks: [
          { text: whatItIs },
          { small: "Made on " + longDay() + ". The last issue of the Monitor is " + d.mon.issue + "." },
          { table: {
            head: subjects.length > 1 ? ["Date", "On", "What happened", "Type", "Reference"] : ["Date", "What happened", "Type", "Reference"],
            rows: rows.map(function (r) {
              var line = [dayWords(r.day)];
              if (subjects.length > 1) line.push(r.on ? r.on.name : "");
              line.push(r.what);
              line.push(r.type);
              line.push(r.mine ? "Your own. " + r.reference : r.reference + "\n" + r.url);
              return line;
            })
          } }
        ],
        foot: "Made with the Chronology Maker of the PopuliVerse Workspace. The items are those of the PopuliVerse Monitor, each with its issue and number; the rows marked as your own were added by you. populiverse.com"
      }, said);
    } }, "Word File for an Appendix");

    var csv = h("button", { class: "pv-lib-link", type: "button", onclick: function () {
      if (!rows.length) { saying(said, "Nothing to download"); return; }
      csvFile(["date", "on", "what_happened", "type", "reference", "link", "added_by", "source", "made_on"],
        rows.map(function (r) {
          return [r.day, r.on ? r.on.name : "", r.what, r.type, r.mine ? r.reference : r.reference, r.url,
            r.mine ? "you" : "PopuliVerse Monitor", r.mine ? r.source : "", today()];
        }), fileName("chronology", ".csv"));
      saying(said, "Downloaded");
    } }, "Download the Table");

    add(wrap, h("p", { class: "pv-ws-tool-row" }, word, csv,
      linkRow("chronology", { on: S.on, from: S.from, to: S.to }), said));
    // A draft in Write holds bold, italics, headings, quotes and lists, and no
    // table, so a chronology cannot go into one yet (batch 4, B2).
    add(wrap, h("p", { class: "pv-ws-small", text:
      "A draft in Write holds no table yet, so a chronology goes out as a Word file or as data for now." }));
    return wrap;
  }

  function addEventForm(subjects, reload) {
    var errs = {};
    function field(id, label, control, hint) {
      errs[id] = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
      return h("div", { class: "pv-ws-field" }, h("label", { for: "pv-ev-" + id, class: "pv-wc-label" }, label), control,
        hint ? h("p", { class: "pv-ws-hint", text: hint }) : null, errs[id]);
    }
    var on = h("select", { id: "pv-ev-on" }, subjects.map(function (s, i) {
      return h("option", { value: i, text: s.name });
    }));
    var day = h("input", { type: "text", id: "pv-ev-day", maxlength: "10", placeholder: "2026-11-16" });
    var what = h("input", { type: "text", id: "pv-ev-what", maxlength: "600" });
    var source = h("input", { type: "text", id: "pv-ev-source", maxlength: "300" });
    var err = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
    var btn = h("button", { class: "pv-button", type: "submit" }, "Add the Event");
    var form = h("form", { class: "pv-ws-form", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      Object.keys(errs).forEach(function (k) { errs[k].textContent = ""; });
      err.textContent = "";
      var s = subjects[Number(on.value) || 0];
      btn.disabled = true;
      api("/api/events", { method: "POST", body: {
        aboutKind: s.kind, aboutRef: s.ref, day: day.value, what: what.value, source: source.value
      } }).then(function (r) {
        btn.disabled = false;
        if (r.status === 201) { day.value = ""; what.value = ""; source.value = ""; reload(); return; }
        var f = (r.data && r.data.fields) || {};
        Object.keys(f).forEach(function (k) { (errs[k] || err).textContent = f[k]; });
        if (!Object.keys(f).length) err.textContent = (r.data && r.data.error) || "That did not work. Please try again.";
      });
    } },
      subjects.length > 1 ? field("on", "On", on) : null,
      field("day", "Date", day, "A year, a year and a month, or a full day. 2026, 2026-11 or 2026-11-16."),
      field("what", "What happened", what),
      field("source", "Source", source, "Where you read it. A source is needed, because an event without one is of no use later."),
      err, btn);
    return h("section", { class: "pv-ws-section" },
      h("h3", { class: "pv-ws-h", text: "Add an Event of Your Own" }),
      h("p", { class: "pv-ws-small", text:
        "Your events are yours alone. They are marked as your own on this page and in every file that leaves here, and they are never mixed into the Monitor's items." }),
      form);
  }

  // ============================================================ B3. Case File

  function caseFile(me, state) {
    var body = toolPage(me, "Case File",
      "One briefing on an actor or a country, to print or to keep: what the datasets say, the place in government year by year, the chronology, and what the Library holds.");
    waiting(body);
    Promise.all([caseData(), projects()]).then(function (r) {
      drawCaseFile(me, r[0], r[1], body, state);
    }, function () { failed(body); });
  }

  function drawCaseFile(me, d, projectList, body, state) {
    clear(body);
    var S = { on: state.on || "", from: String(Number(state.from) || 1990), to: String(Number(state.to) || NOW_YEAR) };
    var list = subjectList(d, null);
    var form = h("div", { class: "pv-ws-form pv-ws-select-form pv-ws-noprint" });
    var out = h("div");
    add(body, form, out);
    var subject = picker("fon", "The case file is of", list, S.on);
    var fromPick = picker("ffrom", "From", yearList(1990, NOW_YEAR), S.from);
    var toPick = picker("fto", "To", yearList(1990, NOW_YEAR), S.to);
    add(form, subject.el, h("div", { class: "pv-ws-pair" }, fromPick.el, toPick.el));
    [subject, fromPick, toPick].forEach(function (p) {
      p.sel.addEventListener("change", function () {
        S.on = subject.sel.value;
        S.from = fromPick.sel.value;
        S.to = toPick.sel.value;
        if (Number(S.from) > Number(S.to)) { S.to = S.from; toPick.sel.value = S.to; }
        run();
      });
    });

    function run() {
      clear(out);
      if (!S.on) {
        add(out, h("p", { class: "pv-ws-small", text: "Pick an actor or a country, and the case file is made." }));
        return;
      }
      add(out, h("p", { class: "pv-lib-loading", text: "Making the case file…" }));
      subjectsOf(d, S.on, null).then(function (subjects) {
        var s = subjects[0];
        if (!s) { clear(out); add(out, h("p", { class: "pv-lib-nomatch", text: "That case could not be found." })); return; }
        Promise.all([
          ownEventsOf([s]),
          api("/api/keep?kind=work").then(function (r) { return (r.data && r.data.things) || []; }, function () { return []; }),
          api("/api/notes").then(function (r) { return (r.data && r.data.notes) || []; }, function () { return []; })
        ]).then(function (got) {
          clear(out);
          add(out, caseFileView(d, S, s, got[0], got[1], got[2], run));
        });
      });
    }
    run();
  }

  function caseFileView(d, S, s, own, works, notes, reload) {
    var from = Number(S.from), to = Number(S.to);
    var iso = s.iso || (s.kind === "country" ? s.ref : "");
    var actor = s.kind === "actor" ? d.actorBy[s.ref] : null;
    var wrap = h("article", { class: "pv-ws-casefile" });
    var said = says();
    var blocks = [];

    function section(title, kids) {
      return h("section", { class: "pv-ws-cf-sec" }, h("h3", { class: "pv-ws-h", text: title }), kids);
    }
    function dl(pairs) {
      var out = h("dl", { class: "pv-ws-cf-dl" });
      pairs.forEach(function (p) {
        add(out, h("dt", { text: p[0] }), h("dd", { text: p[1] }));
      });
      return out;
    }

    // The head: what it is, and as of when.
    var title = s.name + ", " + from + " to " + to;
    var asOf = "As of " + longDay() + ". The last issue of the Monitor is " + d.mon.issue + ".";
    add(wrap, h("h3", { class: "pv-ws-cf-title", text: title }), h("p", { class: "pv-ws-small", text: asOf }));
    blocks.push({ small: asOf });

    // ---- what the datasets say
    var says1 = [];
    if (actor) {
      var row = (d.who.rows || []).filter(function (r) { return r.id === actor.data; })[0] || null;
      says1.push(["On the Monitor's list by", actor.src + (actor.bl ? ", as a borderline case" : "")]);
      if (actor.power) says1.push(["In power today", POWER_NOW[actor.power]]);
      if (actor.why) says1.push(["Why", actor.why]);
      if (row) {
        says1.push(["The datasets that speak for it", datasetsOf(row).join("; ") || "None"]);
        says1.push(["Whether they agree", MARKS[row.m] || row.m]);
        says1.push(["The verdict", row.pop ? "At least one dataset says populist" : "No dataset says populist"]);
        var span = yearsOf(row);
        says1.push(["The years they speak for", span.from === null ? "Not covered" : span.from + " to " + span.to]);
      } else {
        says1.push(["The datasets", "Not covered by the datasets of Who Counts as Populist?"]);
      }
    } else {
      var here = (d.mon.actors || []).filter(function (a) { return a.iso === iso; });
      says1.push(["Actors on the Monitor's list in this country", here.length ? here.map(function (a) { return a.name; }).join("; ") : "None"]);
      var nowIn = here.filter(function (a) { return a.power; });
      says1.push(["In power today", nowIn.length ? nowIn.map(function (a) { return a.name + ", " + POWER_NOW[a.power].toLowerCase(); }).join("; ") : "No actor on the Monitor's list is in government"]);
    }
    says1.push(["The datasets, with their versions", stamp(d).join("; ")]);
    add(wrap, section("What the Datasets Say", dl(says1)));
    blocks.push({ heading: "What the Datasets Say", level: 2 });
    // In the Word file these stand as lines, not as a table with no head.
    says1.forEach(function (pair) { blocks.push({ text: pair[0] + ": " + pair[1] }); });

    // ---- the place in government, year by year
    var yearRows = [];
    if (iso && d.power.countries[iso]) {
      for (var y = from; y <= to; y++) {
        var v = placeIn(d.power, iso, y);
        yearRows.push([String(y), v === null ? PLACES["null"] : PLACES[String(v)]]);
      }
    }
    if (yearRows.length) {
      add(wrap, section("The Place in Government, Year by Year", [
        h("div", { class: "pv-ws-table-wrap" },
          h("table", { class: "pv-ws-table pv-ws-years" },
            h("thead", null, h("tr", null, h("th", { text: "Year" }), h("th", { text: "The place of populists in government" }))),
            h("tbody", null, yearRows.map(function (r) {
              return h("tr", null, h("td", { "data-label": "Year", text: r[0] }), h("td", { "data-label": "The place", text: r[1] }));
            })))),
        h("p", { class: "pv-ws-small", text: "Every year is the state on 1 July, as Populists in Power reads it. Not covered never means none." })
      ]));
      blocks.push({ heading: "The Place in Government, Year by Year", level: 2 });
      blocks.push({ table: { head: ["Year", "The place of populists in government"], rows: yearRows } });
      blocks.push({ small: "Every year is the state on 1 July, as Populists in Power reads it. Not covered never means none." });
    } else {
      var none = "Populists in Power does not cover " + s.name + ". Not covered never means none.";
      add(wrap, section("The Place in Government, Year by Year", h("p", { text: none })));
      blocks.push({ heading: "The Place in Government, Year by Year", level: 2 });
      blocks.push({ text: none });
    }

    // ---- the chronology
    var items = monitorItems(d, [s], from, to);
    var mine = own.filter(function (e) {
      var yy = Number(String(e.day).slice(0, 4));
      return yy >= from && yy <= to;
    }).map(function (e) {
      return { mine: true, day: e.day, what: e.what, type: "Your own", reference: "Added by you. Source: " + e.source, url: "" };
    });
    var chrono = sortRows(items.concat(mine));
    var chronoLine = "The items of the PopuliVerse Monitor since September 2026, the first issue, and the events you added yourself. Not a full record of what happened.";
    if (chrono.length) {
      add(wrap, section("Chronology", [
        h("p", { class: "pv-ws-small", text: chronoLine }),
        h("div", { class: "pv-ws-table-wrap" },
          h("table", { class: "pv-ws-table pv-ws-chrono" },
            h("thead", null, h("tr", null, h("th", { text: "Date" }), h("th", { text: "What happened" }), h("th", { text: "Type" }), h("th", { text: "Reference" }))),
            h("tbody", null, chrono.map(function (r) {
              return h("tr", { class: r.mine ? "is-mine" : "" },
                h("td", { "data-label": "Date", text: dayWords(r.day) }),
                h("td", { "data-label": "What happened", text: r.what }),
                h("td", { "data-label": "Type", text: r.type }),
                h("td", { "data-label": "Reference" }, r.url
                  ? h("a", { href: r.url, text: r.reference })
                  : h("span", null, h("span", { class: "pv-ws-mine-mark", text: "Your own" }), " ", h("span", { text: r.reference }))));
            }))))
      ]));
    } else {
      add(wrap, section("Chronology", h("p", { text: chronoLine + " There is none for these years." })));
    }
    blocks.push({ heading: "Chronology", level: 2 });
    blocks.push({ small: chronoLine });
    if (chrono.length) {
      blocks.push({ table: { head: ["Date", "What happened", "Type", "Reference"],
        rows: chrono.map(function (r) { return [dayWords(r.day), r.what, r.type, r.mine ? "Your own. " + r.reference : r.reference + "\n" + r.url]; }) } });
    } else {
      blocks.push({ text: "There is none for these years." });
    }

    // ---- the Library, and the reader's own works and notes
    var libCount = iso ? (d.mon.works[iso] || 0) : 0;
    var libLink = iso && d.mon.places[iso] ? SITE + "library/index.html?country=" + encodeURIComponent(d.mon.places[iso][6]) : SITE + "library/index.html";
    var libLine = iso
      ? (libCount ? plural(libCount, "work in the Library", "works in the Library") + " on " + (d.mon.places[iso] ? d.mon.places[iso][0] : iso) + "."
         : "The Library holds no work tagged for this country yet.")
      : "The Library is tagged by country, so there is no count for one actor.";
    var mineWorks = works.filter(function (w) { return iso && w.country === iso; });
    var mineNotes = notes.filter(function (n) { return n.on && ((n.on.kind === "country" && n.on.ref === iso) || (n.on.kind === "actor" && n.on.ref === s.ref)); });
    add(wrap, section("The Library, and What You Keep", [
      h("p", null, h("span", { text: libLine + " " }), h("a", { href: libLink, text: "Open the Library" })),
      h("p", { text: mineWorks.length
        ? plural(mineWorks.length, "work you keep", "works you keep") + " on this country, on your shelf."
        : "You keep no work on this on your shelf yet." }),
      mineNotes.length
        ? h("ul", { class: "pv-ws-cf-notes" }, mineNotes.map(function (n) {
            return h("li", null, h("strong", { text: n.on.title || n.on.ref }), " ", h("span", { text: n.note }));
          }))
        : h("p", { text: "You have written no note on this yet." })
    ]));
    blocks.push({ heading: "The Library, and What You Keep", level: 2 });
    blocks.push({ text: libLine + " " + libLink });
    blocks.push({ text: mineWorks.length ? plural(mineWorks.length, "work you keep", "works you keep") + " on this country, on your shelf." : "You keep no work on this on your shelf yet." });
    mineNotes.forEach(function (n) { blocks.push({ text: (n.on.title || n.on.ref) + ". " + n.note }); });

    // ---- how to cite
    var cite = "PopuliVerse. " + new Date().getUTCFullYear() + ". “Case File: " + s.name + ".” PopuliVerse Workspace, "
      + longDay() + ". " + (s.kind === "actor" ? SITE + "actors/" + s.ref + ".html" : (d.mon.places[iso] ? SITE + "countries/" + d.mon.places[iso][6] + ".html" : SITE));
    add(wrap, section("How to Cite", h("p", { class: "pv-ws-cf-cite", text: cite })));
    blocks.push({ heading: "How to Cite", level: 2 });
    blocks.push({ text: cite });

    var printBtn = h("button", { class: "pv-lib-link", type: "button", onclick: function () { window.print(); } }, "Print This Page");
    var word = h("button", { class: "pv-lib-link", type: "button", onclick: function () {
      makeWord({ title: "Case File: " + title, file: "case-file-" + s.name, blocks: blocks,
        foot: "Made with the Case File of the PopuliVerse Workspace. Every verdict is its dataset's own, and PopuliVerse settles no disagreement between them. populiverse.com" }, said);
    } }, "Word File");
    var row = h("p", { class: "pv-ws-tool-row pv-ws-noprint" }, printBtn, word, linkRow("casefile", { on: S.on, from: S.from, to: S.to }), said);
    add(wrap, row);
    return wrap;
  }

  // ============================================================ the board

  var TOOLS = [
    { id: "cases", name: "Case Selection",
      blurb: "The countries, parties and leaders that match your criteria, each with why it matched, and a statement you can paste into a methods section.",
      open: caseSelection },
    { id: "chronology", name: "Chronology Maker",
      blurb: "The Monitor's items on an actor, a country or the cases of a project, in order, with the events you add yourself.",
      open: chronology },
    { id: "casefile", name: "Case File",
      blurb: "One briefing on an actor or a country, to print or to keep, with what the datasets say and what the Library holds.",
      open: caseFile }
  ];

  // The three tools on the Tools tab, beside the Annotated Bibliography.
  function board(list) {
    return TOOLS.map(function (t) {
      return h("div", { class: "pv-ws-tool" },
        h("h3", { class: "pv-ws-tool-h", text: t.name }),
        h("p", { text: t.blurb }),
        h("p", { class: "pv-ws-tool-row" },
          h("a", { class: "pv-lib-link", href: PAGES.tools + "?tool=" + t.id, text: "Open " + t.name })));
    });
  }

  // The same three, from inside a project. The Chronology Maker and the Case
  // File open on the project's own cases; Case Selection opens so that what it
  // finds can be added to this project.
  function fromProject(projectId) {
    return h("p", { class: "pv-ws-tool-row" },
      h("a", { class: "pv-lib-link", href: PAGES.tools + "?tool=chronology&p=" + encodeURIComponent(projectId), text: "Chronology Maker" }),
      h("a", { class: "pv-lib-link", href: PAGES.tools + "?tool=casefile", text: "Case File" }),
      h("a", { class: "pv-lib-link", href: PAGES.tools + "?tool=cases", text: "Case Selection" }));
  }

  // The tool named in the address, with its whole view in the address too.
  function openFromAddress(me) {
    var want = params.get("tool");
    if (!want) return false;
    var tool = TOOLS.filter(function (t) { return t.id === want; })[0];
    if (!tool) return false;
    var state = {};
    params.forEach(function (v, k) { if (k !== "tool") state[k] = v; });
    tool.open(me, state);
    return true;
  }

  window.PVTools = { board: board, fromProject: fromProject, openFromAddress: openFromAddress, count: TOOLS.length };
})();
