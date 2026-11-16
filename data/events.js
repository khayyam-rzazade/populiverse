/* PopuliVerse: "Events in Monitor", the Monitor as a dataset with its explorer.
   Reads monitor.json, which scripts/make_pages.py writes at every build, and
   shows one row per item of the Monitor: its date, type, countries and actors.
   The whole dataset also stands as one file, events.csv, written by the same
   script. Nothing is computed here that the Monitor does not already hold.
   Without JavaScript the page names the file and the issues. */

(function () {
  "use strict";

  var PV = window.PVData;
  var host = document.getElementById("ev-app");
  if (!PV || !host) return;
  var el = PV.el;
  var SITE = "https://populiverse.com/";
  var TITLE = "Events in Monitor";
  var URL = SITE + "data/events.html";
  var STEP = 20;

  // The 14 event types of the Monitor in their six families, and "Other".
  // The same table stands on the Monitor's page "How the Items Are Tagged".
  var FAM = {
    "Election": "Votes", "Referendum": "Votes", "Campaign": "Votes", "Office": "Office and Party", "Party": "Office and Party",
    "Law": "Rules", "Measure": "Rules", "Court": "Justice", "Police and Prosecutors": "Justice",
    "Diplomacy": "Abroad", "Agreement": "Abroad", "Sanctions and Trade": "Abroad", "Armed Forces": "Abroad", "Protest": "Street"
  };
  var FAMS = ["Votes", "Office and Party", "Rules", "Justice", "Abroad", "Street", "Other"];
  var FC = { "Votes": "#111111", "Office and Party": "#B08D57", "Rules": "#6E8790", "Justice": "#8A5A2B", "Abroad": "#27485A", "Street": "#C9B48A", "Other": "#BDBBB4" };
  var TYPES = ["Election", "Referendum", "Campaign", "Office", "Party", "Law", "Measure", "Court",
    "Police and Prosecutors", "Diplomacy", "Agreement", "Sanctions and Trade", "Armed Forces", "Protest", "Other"];
  var REG = { "europe": "Europe", "north-america": "North America", "latin-america": "Latin America",
    "asia-pacific": "Asia-Pacific", "mena": "Middle East and North Africa", "sub-saharan-africa": "Sub-Saharan Africa" };
  var PERIODS = [["", "All time"], ["12", "Last 12 months"], ["6", "Last 6 months"], ["24", "Last 24 months"]];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var M = null, EV = [], MONTHS = [], AXIS = [], ACT = {}, LAND = {};
  var DEF = { q: "", period: "", fam: "", type: "", region: "", country: "", actor: "", issue: "", kind: "", sort: "new", view: "time" };
  var S = Object.assign({}, DEF), ui = {}, list = [], shown = STEP, f = {};

  PV.load(host.getAttribute("data-monitor")).then(function (m) {
    M = m;
    prepare();
    build();
  }).catch(function () {
    host.innerHTML = "";
    host.appendChild(el("p", { class: "pv-lib-nomatch", text: "The dataset could not be loaded. The whole file stands under “The Whole Dataset” below." }));
  });

  // ============================================================ the data

  function fam(t) { return FAM[t] || "Other"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  // A full item's heading is its title. A one-line entry's title is only the
  // place, so its own sentence stands with it.
  function heading(e) { return e.k === "entry" && e.s ? e.title + ". " + e.s : e.title; }
  function when(d) { return d.length === 7 ? PV.month(d) : PV.date(d); }
  function cut(s, n) { return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.n - b.n; }
  function monthsBack(key, n) {
    var y = +key.slice(0, 4), mo = +key.slice(5, 7) - (n - 1);
    while (mo < 1) { mo += 12; y -= 1; }
    return y + "-" + (mo < 10 ? "0" : "") + mo;
  }

  function prepare() {
    M.actors.forEach(function (a) { ACT[a.id] = a; });
    Object.keys(M.places).forEach(function (iso) {
      var p = M.places[iso];
      LAND[iso] = { name: p[0], reg: p[2], tag: p[6] };
    });
    EV = M.items.slice().sort(byDate).map(function (it) {
      var e = {
        issue: it.issue, folder: it.folder, n: it.n, title: it.title, type: it.type, f: fam(it.type),
        date: it.date, de: it.de || "", month: it.date.slice(0, 7), k: it.k, s: it.s || "", iso: it.iso, actors: it.actors
      };
      e.lands = it.iso.map(function (i) { return LAND[i] ? LAND[i].name : i; });
      e.regs = it.iso.map(function (i) { return LAND[i] ? LAND[i].reg : ""; });
      e.names = it.actors.map(function (a) { return ACT[a] ? ACT[a].name : a; });
      e.link = "../monitor/" + it.folder + "/index.html#item-" + it.n;
      e.find = PV.fold([e.title, e.s, e.type, e.f].concat(e.lands, e.names, e.regs.map(function (r) { return REG[r] || ""; })).join(" "));
      return e;
    });
    if (EV.length) {
      var a = EV[0].month, b = EV[EV.length - 1].month, y = +a.slice(0, 4), mo = +a.slice(5, 7);
      while (true) {
        var key = y + "-" + (mo < 10 ? "0" : "") + mo;
        MONTHS.push(key);
        if (key >= b) break;
        mo += 1; if (mo > 12) { mo = 1; y += 1; }
      }
    }
  }

  function from() {
    // "Last 12 months" is counted back from the month of the latest issue, not
    // from today, so the page never stands empty when an issue is late.
    if (!S.period || !MONTHS.length) return "";
    return monthsBack(MONTHS[MONTHS.length - 1], +S.period);
  }

  function span(ms) {
    if (!ms.length) return "";
    return PV.month(ms[0]) + (ms.length > 1 ? " to " + PV.month(ms[ms.length - 1]) : "");
  }

  function stamp() {
    return "PopuliVerse Monitor, issues to " + M.issue + ". " + span(MONTHS) + ".";
  }

  function issues() {
    var seen = [];
    EV.forEach(function (e) { if (seen.indexOf(e.issue) < 0) seen.push(e.issue); });
    return seen.sort().reverse();
  }

  // ============================================================ the page

  function build() {
    var st = PV.state.get();
    Object.keys(S).forEach(function (k) { if (st[k] !== undefined) S[k] = st[k]; });
    // An address typed by hand: a view, an order or a period this page does not have
    if (["time", "kinds", "table"].indexOf(S.view) < 0) S.view = DEF.view;
    if (["new", "old", "type", "country"].indexOf(S.sort) < 0) S.sort = DEF.sort;
    if (!/^\d+$/.test(S.period)) S.period = "";
    host.innerHTML = "";

    ui.stats = el("div");
    host.appendChild(ui.stats);
    host.appendChild(el("p", { class: "pv-ev-stamp", text: stamp() }));

    ui.q = el("input", { type: "search", id: "ev-q", autocomplete: "off", value: S.q, placeholder: "An actor, a country, a type or a heading" });
    ui.q.addEventListener("input", function () { S.q = ui.q.value; shown = STEP; run(); });
    host.appendChild(el("div", { class: "pv-wc-search" }, [el("label", { for: "ev-q", class: "pv-wc-label", text: "Search" }), ui.q]));

    var lands = {}, regs = {}, acts = {}, types = {};
    EV.forEach(function (e) {
      e.iso.forEach(function (i) { if (LAND[i]) { lands[i] = LAND[i].name; regs[LAND[i].reg] = 1; } });
      e.actors.forEach(function (a) { if (ACT[a]) acts[a] = ACT[a].name; });
      types[e.type] = 1;
    });
    host.appendChild(el("div", { class: "pv-wc-filters" }, [
      select("period", "Period", PERIODS),
      select("fam", "Kind of news", [["", "Any"]].concat(FAMS.map(function (k) { return [k, k]; }))),
      select("type", "Type", [["", "Any"]].concat(TYPES.filter(function (t) { return types[t]; }).map(function (t) { return [t, t]; }))),
      select("region", "Region", [["", "All regions"]].concat(Object.keys(REG).filter(function (k) { return regs[k]; }).map(function (k) { return [k, REG[k]]; }))),
      select("country", "Country", [["", "All countries"]].concat(Object.keys(lands).sort(function (a, b) { return lands[a].localeCompare(lands[b]); }).map(function (k) { return [k, lands[k]]; }))),
      select("actor", "Actor", [["", "All actors"]].concat(Object.keys(acts).sort(function (a, b) { return acts[a].localeCompare(acts[b]); }).map(function (k) { return [k, acts[k]]; }))),
      select("issue", "Issue", [["", "All issues"]].concat(issues().map(function (i) { return [i, i]; }))),
      select("kind", "Full items or entries", [["", "Both"], ["full", "Full items"], ["entry", "One-line entries"]]),
      select("sort", "Order", [["new", "Newest first"], ["old", "Oldest first"], ["type", "Type, then date"], ["country", "Country, then date"]])
    ]));

    ui.tabs = el("div", { class: "pv-wc-tabs", role: "tablist" }, [["time", "Over time"], ["kinds", "Kinds and types"], ["table", "Table"]].map(function (v) {
      var b = el("button", { type: "button", role: "tab", class: "pv-wc-tab", "data-view": v[0], text: v[1] });
      b.addEventListener("click", function () { S.view = v[0]; shown = STEP; run(); });
      return b;
    }));
    ui.count = el("p", { class: "pv-wc-count", "aria-live": "polite" });
    ui.tools = PV.keepChart(el("div", { class: "pv-wc-tools" }), "view", "Events in Monitor");
    host.appendChild(el("div", { class: "pv-wc-head" }, [ui.tabs, ui.count, ui.tools]));
    host.appendChild(legend());
    ui.view = el("div", { class: "pv-wc-view" });
    host.appendChild(ui.view);
    run();

    var timer = null;
    window.addEventListener("resize", function () {
      if (S.view === "table") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { draw(); }, 200);
    });
  }

  function select(key, text, opts) {
    var s = el("select", { id: "ev-" + key });
    opts.forEach(function (o) { s.appendChild(el("option", { value: o[0], text: o[1] })); });
    s.value = S[key];
    s.addEventListener("change", function () { S[key] = s.value; shown = STEP; run(); });
    f[key] = s;
    return el("div", { class: "pv-wc-field" }, [el("label", { for: "ev-" + key, class: "pv-wc-label", text: text }), s]);
  }

  function reset(set) {
    Object.keys(DEF).forEach(function (k) { if (k !== "view" && k !== "sort") S[k] = DEF[k]; });
    Object.keys(set || {}).forEach(function (k) { S[k] = set[k]; });
    Object.keys(f).forEach(function (k) { if (f[k]) f[k].value = S[k]; });
    ui.q.value = S.q;
    shown = STEP;
    run();
  }

  function tiles() {
    var all = period(EV);
    var t = [
      [all.length, all.length === 1 ? "item" : "items", {}],
      [all.filter(function (e) { return e.k === "full"; }).length, "full items", { kind: "full" }],
      [all.filter(function (e) { return e.k === "entry"; }).length, "one-line entries", { kind: "entry" }],
      [all.filter(function (e) { return e.issue === M.issue; }).length, "in issue " + M.issue, { issue: M.issue }]
    ];
    ui.stats.innerHTML = "";
    ui.stats.appendChild(el("div", { class: "pv-wc-stats" }, t.map(function (x) {
      var b = el("button", { type: "button", class: "pv-wc-stat" }, [
        el("span", { class: "pv-wc-stat-n", text: String(x[0]) }), el("span", { class: "pv-wc-stat-l", text: x[1] })]);
      b.addEventListener("click", function () { reset(x[2]); });
      return b;
    })));
  }

  function legend() {
    return el("p", { class: "pv-ma-legend" }, [el("span", { class: "pv-ma-label", text: "Kinds of news" })].concat(FAMS.map(function (k) {
      return el("span", { class: "pv-key" }, [el("span", { class: "pv-key-sw", style: "background:" + FC[k] }), k]);
    })));
  }

  function tool(text, fn) {
    var b = el("button", { type: "button", class: "pv-lib-link", text: text });
    b.addEventListener("click", function () { fn(b); });
    return b;
  }

  function period(rows) {
    var cut = from();
    if (!cut) return rows;
    return rows.filter(function (e) { return e.month >= cut; });
  }

  function words() { return PV.fold(S.q).trim().split(/\s+/).filter(Boolean); }

  function run() {
    var q = words();
    list = period(EV).filter(function (e) {
      if (S.fam && e.f !== S.fam) return false;
      if (S.type && e.type !== S.type) return false;
      if (S.region && e.regs.indexOf(S.region) < 0) return false;
      if (S.country && e.iso.indexOf(S.country) < 0) return false;
      if (S.actor && e.actors.indexOf(S.actor) < 0) return false;
      if (S.issue && e.issue !== S.issue) return false;
      if (S.kind && e.k !== S.kind) return false;
      for (var i = 0; i < q.length; i++) if (e.find.indexOf(q[i]) < 0) return false;
      return true;
    });
    list.sort({
      new: function (a, b) { return byDate(b, a); },
      old: byDate,
      type: function (a, b) { return a.type.localeCompare(b.type) || byDate(a, b); },
      country: function (a, b) { return (a.lands[0] || "").localeCompare(b.lands[0] || "") || byDate(a, b); }
    }[S.sort]);

    AXIS = MONTHS.filter(function (m) { return !from() || m >= from(); });
    var keep = {};
    Object.keys(S).forEach(function (k) { if (S[k] !== DEF[k]) keep[k] = S[k]; });
    PV.state.set(keep);
    tiles();
    Array.prototype.forEach.call(ui.tabs.children, function (b) {
      var on = b.getAttribute("data-view") === S.view;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    ui.tools.innerHTML = "";
    ui.tools.setAttribute("data-keep-title", TITLE + titleFilters(true));
    ui.tools.appendChild(tool("Download what you see (CSV)", csv));
    ui.tools.appendChild(el("a", { class: "pv-lib-link", href: "events.csv", download: "populiverse-monitor-events.csv", text: "The whole dataset (CSV)" }));
    var hasPicture = S.view !== "table" && list.length > 0;
    if (hasPicture) {
      ui.tools.appendChild(tool("Picture (PNG)", function (b) { PV.save.picture(b, "populiverse-events-in-monitor", "png", figure); }));
      ui.tools.appendChild(tool("Picture (SVG)", function (b) { PV.save.picture(b, "populiverse-events-in-monitor", "svg", figure); }));
    }
    // The Table and a view that nothing fits have no picture of their own, so
    // there the page forgets the chart it drew before and "Send to Write" is not
    // offered (Fable's re-check of the trial fixes, point 3).
    PV.figureMaker(ui.tools, hasPicture ? figure : null);
    ui.tools.appendChild(tool("Copy the link to this view", function (b) { PV.copy(window.location.href, b); }));
    ui.tools.appendChild(tool("Copy the citation", function (b) { PV.copy(PV.citation(TITLE, URL), b); }));
    draw();
  }

  function countLine() {
    var n = period(EV).length;
    var text = plural(list.length, "item", "items") + (list.length < n ? " of " + n : "");
    if (S.period) text += ", " + span(AXIS);
    if (S.view === "table" && list.length > shown) text += ", showing the first " + shown;
    return text;
  }

  function draw() {
    ui.count.textContent = countLine();
    ui.view.innerHTML = "";
    if (!list.length) {
      ui.view.appendChild(el("p", { class: "pv-lib-nomatch", text: "No item fits these filters." }));
      return;
    }
    if (S.view === "table") table();
    else {
      var box = el("div", { class: "pv-wc-scroll pv-wc-chartbox" });
      ui.view.appendChild(box);
      if (S.view === "time") {
        // Wide enough for the months in view, and not stretched when they are few
        var w = box.clientWidth || 900;
        months(box, Math.min(Math.max(w, AXIS.length * 46 + 120), AXIS.length * 120 + 150), false);
        ui.view.appendChild(el("p", { class: "pv-ma-dim", text: "One block is one item, in the month of its date. Point at a block for its kind of news, and click it to open the items behind it." }));
      } else {
        bars(box, Math.max(320, box.clientWidth || 900), false);
        ui.view.appendChild(el("p", { class: "pv-ma-dim", text: "Click a bar to open the items behind it. A family holds the types under it; every item has one type." }));
      }
    }
  }

  // ============================================================ the items behind a number

  function openItems(title, sub, items) {
    PV.panel.open(title, sub, function (body) {
      var ul = el("ul", { class: "pv-ev-items" }, items.slice().sort(function (a, b) { return byDate(b, a); }).map(function (e) {
        return el("li", {}, [
          el("span", { class: "pv-ma-dim", text: when(e.date) + " · " + e.type + " · " }),
          el("a", { href: e.link, text: heading(e) }),
          el("span", { class: "pv-ma-dim", text: " (" + e.issue + ", item " + e.n + ")" })
        ]);
      }));
      PV.section(body, plural(items.length, "item", "items"), [ul],
        "Each item opens in its issue, where its own sources stand.");
    });
  }

  // ============================================================ over time

  function months(box, width, pic) {
    var NS = "http://www.w3.org/2000/svg";
    var left = 38, right = 14, top = 14, foot = 34;
    var height = (pic ? 320 : 280);
    var inner = width - left - right, plot = height - top - foot;
    var cols = AXIS.length || 1;
    var step = inner / cols, bw = Math.min(54, step * 0.62);
    var by = {};
    list.forEach(function (e) {
      var m = by[e.month] || (by[e.month] = { n: 0 });
      m[e.f] = (m[e.f] || 0) + 1;
      m.n += 1;
    });
    var max = 1;
    AXIS.forEach(function (m) { if (by[m] && by[m].n > max) max = by[m].n; });
    var nice = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 20;
    var ceiling = Math.ceil(max / nice) * nice;
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", width); svg.setAttribute("height", height);
    svg.setAttribute("class", "pv-ev-chart"); svg.setAttribute("role", pic ? "img" : "group");
    svg.setAttribute("aria-label", "The items of PopuliVerse Monitor by month and kind of news, " + span(AXIS) + ", " + plural(list.length, "item", "items"));
    function add(tag, attrs, text, parent) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text !== undefined) n.textContent = text;
      (parent || svg).appendChild(n);
      return n;
    }
    var y = function (v) { return top + plot - plot * v / ceiling; };
    for (var t = 0; t <= ceiling; t += nice) {
      add("line", { x1: left, x2: width - right, y1: y(t), y2: y(t), class: t ? "pv-grid" : "pv-ev-base" });
      add("text", { x: left - 8, y: y(t) + 4, "text-anchor": "end", class: "pv-tl-meta" }, String(t));
    }
    AXIS.forEach(function (m, i) {
      var x = left + i * step + (step - bw) / 2, acc = 0;
      // The month in short, with the year at the first column and at every January
      var label = SHORT[+m.slice(5, 7) - 1] + (i === 0 || m.slice(5, 7) === "01" ? " " + m.slice(0, 4) : "");
      add("text", { x: left + i * step + step / 2, y: height - foot + 18, "text-anchor": "middle", class: "pv-tl-meta" }, label);
      var c = by[m];
      if (!c) return;
      FAMS.forEach(function (k) {
        if (!c[k]) return;
        var h = plot * c[k] / ceiling;
        acc += c[k];
        var r = add("rect", { x: x, y: y(acc), width: bw, height: Math.max(1, h), fill: FC[k], stroke: "#FCFCFB", "stroke-width": 0.6 });
        if (pic) return;
        r.setAttribute("class", "is-click");
        r.setAttribute("tabindex", 0);
        r.setAttribute("role", "button");
        r.setAttribute("aria-label", plural(c[k], "item", "items") + ", " + k + ", " + PV.month(m));
        var items = list.filter(function (e) { return e.month === m && e.f === k; });
        var open = function () { openItems(k + " in " + PV.month(m), stamp(), items); };
        r.addEventListener("mousemove", function (ev) {
          PV.tip.show(ev, "<strong>" + PV.esc(PV.month(m)) + "</strong><br>" + PV.esc(k) + ": " + plural(c[k], "item", "items") +
            "<br>" + plural(c.n, "item", "items") + " in the month<br><em>Click for the items</em>");
        });
        r.addEventListener("mouseleave", PV.tip.hide);
        r.addEventListener("click", open);
        r.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
      });
      add("text", { x: left + i * step + step / 2, y: y(c.n) - 6, "text-anchor": "middle", class: "pv-tl-meta" }, String(c.n));
    });
    box.appendChild(svg);
    return svg;
  }

  // ============================================================ kinds and types

  function bars(box, width, pic) {
    var NS = "http://www.w3.org/2000/svg";
    var rows = [];
    FAMS.forEach(function (k) {
      var items = list.filter(function (e) { return e.f === k; });
      if (!items.length) return;
      rows.push({ head: true, label: k, n: items.length, fill: FC[k], items: items, what: k });
      TYPES.filter(function (t) { return fam(t) === k; }).forEach(function (t) {
        var sub = items.filter(function (e) { return e.type === t; });
        if (sub.length) rows.push({ label: t, n: sub.length, fill: FC[k], items: sub, what: t });
      });
    });
    var left = Math.min(200, Math.max(120, Math.round(width * 0.34))), right = 44, rowH = 26, top = 8;
    var height = top + rows.length * rowH + 8, inner = width - left - right;
    var max = rows.reduce(function (m, r) { return Math.max(m, r.n); }, 1);
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", width); svg.setAttribute("height", height);
    svg.setAttribute("class", "pv-ev-bars"); svg.setAttribute("role", pic ? "img" : "group");
    svg.setAttribute("aria-label", "The items of PopuliVerse Monitor by kind of news and by type, " + plural(list.length, "item", "items"));
    function add(tag, attrs, text) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text !== undefined) n.textContent = text;
      svg.appendChild(n);
      return n;
    }
    rows.forEach(function (r, i) {
      var y = top + i * rowH, h = r.head ? 14 : 10, w = Math.max(1, inner * r.n / max);
      add("text", { x: r.head ? 0 : 14, y: y + 14, class: r.head ? "pv-ev-head" : "pv-tl-meta" }, cut(r.label, left > 170 ? 26 : 18));
      var bar = add("rect", { x: left, y: y + (18 - h) / 2, width: w, height: h, fill: r.fill, "fill-opacity": r.head ? 1 : 0.55 });
      add("text", { x: left + w + 8, y: y + 14, class: "pv-tl-meta" }, String(r.n));
      if (pic) return;
      bar.setAttribute("class", "is-click");
      bar.setAttribute("tabindex", 0);
      bar.setAttribute("role", "button");
      bar.setAttribute("aria-label", plural(r.n, "item", "items") + ", " + r.label);
      var open = function () { openItems(r.what, stamp(), r.items); };
      bar.addEventListener("mousemove", function (ev) {
        PV.tip.show(ev, "<strong>" + PV.esc(r.label) + "</strong><br>" + plural(r.n, "item", "items") + "<br><em>Click for the items</em>");
      });
      bar.addEventListener("mouseleave", PV.tip.hide);
      bar.addEventListener("click", open);
      bar.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } });
    });
    box.appendChild(svg);
    return svg;
  }

  // ============================================================ the table

  // The cell that carries "Save" and "Note" for the item behind a row.
  function keepCell(e) {
    var cell = el("td", { class: "pv-keep-cell" });
    cell.setAttribute("data-keep-kind", "item");
    cell.setAttribute("data-keep-ref", e.folder + ":" + e.n);
    cell.setAttribute("data-keep-title", cut(heading(e), 300));
    // The same line and the same full address as on the item's own issue
    // page, so that an item saved here is cited as its issue cites it:
    // "PopuliVerse Monitor 2026/2, item 8".
    cell.setAttribute("data-keep-extra", "Monitor " + e.issue + ", item " + e.n + " \u00b7 " + when(e.date));
    cell.setAttribute("data-keep-url", SITE + "monitor/" + e.folder + "/#item-" + e.n);
    if (e.iso && e.iso.length === 1) cell.setAttribute("data-keep-country", e.iso[0]);
    cell.setAttribute("data-keep-tools", "");
    return cell;
  }

  function table() {
    var tb = el("tbody");
    list.slice(0, shown).forEach(function (e) {
      tb.appendChild(el("tr", {}, [
        el("th", { scope: "row" }, [
          el("a", { class: "pv-wc-n", href: e.link, text: cut(heading(e), 110) }),
          el("span", { class: "pv-wc-meta", text: e.issue + ", item " + e.n + (e.k === "entry" ? " · one-line entry" : "") })
        ]),
        el("td", { "data-label": "Date" }, [el("span", { text: when(e.date) + (e.de ? " to " + when(e.de) : "") }),
          e.date.length === 7 ? el("span", { class: "pv-wc-meta", text: "the month, no day" }) : null]),
        el("td", { "data-label": "Type" }, [el("span", { text: e.type }),
          el("span", { class: "pv-wc-meta" }, [el("span", { class: "pv-ma-dotkey", style: "background:" + FC[e.f] }), " " + e.f])]),
        el("td", { "data-label": "Countries" }, e.iso.length ? e.iso.map(function (i, k) {
          return el("span", {}, [k ? el("span", { text: ", " }) : null,
            LAND[i] ? el("a", { href: "../countries/" + LAND[i].tag + ".html", text: LAND[i].name }) : el("span", { text: i })]);
        }) : [el("span", { class: "pv-ma-dim", text: "—" })]),
        el("td", { "data-label": "Actors" }, e.actors.length ? e.actors.map(function (a, k) {
          return el("span", {}, [k ? el("span", { text: ", " }) : null,
            ACT[a] ? el("a", { href: "../actors/" + a + ".html", text: ACT[a].name }) : el("span", { text: a })]);
        }) : [el("span", { class: "pv-ma-dim", text: "—" })]),
        // "Save" and "Note" on a row keep the Monitor item behind the row, not
        // the row (master plan, section 18, stage 2, batch 2).
        keepCell(e)
      ]));
    });
    ui.view.appendChild(el("div", { class: "pv-wc-scroll" }, [el("table", { class: "pv-wc-table pv-ev-table" }, [
      el("thead", {}, [el("tr", {}, ["Item", "Date", "Type", "Countries", "Actors"].map(function (h) { return el("th", { scope: "col", text: h }); })
        .concat([el("th", { scope: "col", class: "pv-keep-cell" }, [el("span", { class: "pv-lib-offscreen", text: "Keep" })])]))]),
      tb
    ])]));
    if (list.length > shown) {
      var more = el("button", { type: "button", class: "pv-button pv-wc-more", text: "Show " + Math.min(STEP, list.length - shown) + " more" });
      more.addEventListener("click", function () { shown += STEP; draw(); });
      ui.view.appendChild(more);
    }
  }

  // ============================================================ downloads

  function filterLine() {
    var bits = [];
    if (S.period) bits.push("the last " + S.period + " months, " + span(AXIS));
    if (S.fam) bits.push("kind of news: " + S.fam);
    if (S.type) bits.push("type: " + S.type);
    if (S.region) bits.push("region: " + REG[S.region]);
    if (S.country) bits.push("country: " + (LAND[S.country] ? LAND[S.country].name : S.country));
    if (S.actor) bits.push("actor: " + (ACT[S.actor] ? ACT[S.actor].name : S.actor));
    if (S.issue) bits.push("issue: " + S.issue);
    if (S.kind) bits.push(S.kind === "full" ? "full items only" : "one-line entries only");
    if (S.q) bits.push('search: "' + S.q + '"');
    return bits.length ? "Filters: " + bits.join("; ") + "." : "No filter: every item of the Monitor.";
  }

  // The same filters, short, for the title of a picture and of a saved view:
  // a figure of a filtered view never carries the title of the whole Monitor
  // (the live check before the trial, point 3). The period stands in the title
  // of the view by month already, so it is named here only when asked.
  function titleFilters(withPeriod) {
    var bits = [];
    if (withPeriod && S.period) bits.push("Last " + S.period + " Months");
    if (S.fam) bits.push("Kind of News: " + S.fam);
    if (S.type) bits.push("Type: " + S.type);
    if (S.region) bits.push("Region: " + REG[S.region]);
    if (S.country) bits.push("Country: " + (LAND[S.country] ? LAND[S.country].name : S.country));
    if (S.actor) bits.push("Actor: " + (ACT[S.actor] ? ACT[S.actor].name : S.actor));
    if (S.issue) bits.push("Issue " + S.issue);
    if (S.kind) bits.push(S.kind === "full" ? "Full Items Only" : "One-Line Entries Only");
    if (S.q.trim()) bits.push("Search: \u201c" + S.q.trim() + "\u201d");
    return bits.length ? " (" + bits.join("; ") + ")" : "";
  }

  function csv() {
    var rows = [["issue", "item", "date", "date_end", "date_precision", "type", "family", "countries", "country_codes",
      "actors", "item_kind", "heading", "link"]];
    list.slice().sort(byDate).forEach(function (e) {
      rows.push([e.issue, e.n, e.date, e.de, e.date.length === 7 ? "month" : "day", e.type, e.f,
        e.lands.join("; "), e.iso.join("; "), e.names.join("; "), e.k === "entry" ? "one-line entry" : "full item",
        heading(e), SITE + "monitor/" + e.folder + "/#item-" + e.n]);
    });
    rows.push([], [filterLine()], [stamp() + " The whole dataset: " + SITE + "data/events.csv"], [PV.citation(TITLE, URL)]);
    PV.save.csv("populiverse-monitor-events-selection.csv", rows);
  }

  function figure() {
    var mode = S.view === "time";
    return {
      host: host,
      chart: function (holder, w) { return mode ? months(holder, w, true) : bars(holder, w, true); },
      title: (mode ? "The Items of PopuliVerse Monitor by Month, " + span(AXIS) : "The Items of PopuliVerse Monitor by Kind of News and Type") + titleFilters(!mode),
      lines: [plural(list.length, "item", "items") + ", in the order “" + f.sort.options[f.sort.selectedIndex].text + "”.", filterLine()],
      legend: FAMS.map(function (k) { return { fill: FC[k], label: k }; }),
      notes: ["The kinds of news are the six families of the Monitor's event types, and Other. Every item has one type.",
        "An item can name more than one country and more than one actor."],
      sources: ["Source: PopuliVerse Monitor, issues to " + M.issue + " (populiverse.com/monitor). The date is the day of the action that gives the type.",
        "The whole dataset: " + SITE + "data/events.csv. Licence of this picture: CC BY 4.0."],
      cite: PV.citation(TITLE, URL)
    };
  }
})();
