/* PopuliVerse: "Who Counts as Populist?"
   Reads who-counts.json (written by scripts/make_data.py) and monitor.json
   (written at every build by scripts/make_pages.py). Every verdict shown is
   the dataset's own; the page adds none. See the notes in make_data.py. */

(function () {
  "use strict";

  var PV = window.PVData;
  var app = document.getElementById("wc-app");
  if (!app || !PV) return;
  var el = PV.el;
  var PAGE_URL = "https://populiverse.com/data/who-counts.html";
  var PAGE_TITLE = "Who Counts as Populist?";
  var STEP = 60;

  var D = null, MON = null, ROWS = [], BY = {}, POPU_COUNTRIES = {}, MON_BY_DATA = {}, COUNTRY = {};
  var DEFAULTS = { q: "", show: "pop", region: "", country: "", kind: "", mark: "", ds: "", mon: "", sort: "name", view: "table", group: "pl" };
  var S = Object.assign({}, DEFAULTS);
  var shown = STEP, list = [], wide = [];
  var ui = {};

  var REGIONS = {
    "europe": "Europe", "north-america": "North America", "latin-america": "Latin America",
    "asia-pacific": "Asia-Pacific", "mena": "Middle East and North Africa", "sub-saharan-africa": "Sub-Saharan Africa"
  };
  var POWER = { leads: "Leads the government", partner: "In the government, as a partner", supports: "Supports the government from outside" };
  var DATASETS = { pl: "The PopuList", gs: "Global Party Survey", gd: "Global Populism Database", vp: "V-Party" };
  var MARKS = { agree: "the datasets agree", differ: "the datasets differ", one: "one dataset only" };

  Promise.all([
    PV.load(app.getAttribute("data-source")),
    PV.load(app.getAttribute("data-monitor")).catch(function () { return null; })
  ]).then(function (res) { D = res[0]; MON = res[1]; start(); })
    .catch(function () {
      app.innerHTML = "";
      app.appendChild(el("div", { class: "pv-lib-message" }, [el("p", { text: "The data could not be loaded. Please try again later." })]));
    });

  // ============================================================ the data

  function start() {
    ROWS = D.rows;
    ROWS.forEach(function (r) {
      BY[r.id] = r;
      if (r.pl) POPU_COUNTRIES[r.c] = true;
      if (r.c) COUNTRY[r.c] = r.cl;
    });
    if (MON) MON.actors.forEach(function (a) { if (a.data) MON_BY_DATA[a.data] = a; });
    ROWS.forEach(prepare);
    var st = PV.state.get();
    Object.keys(S).forEach(function (k) { if (st[k] !== undefined) S[k] = st[k]; });
    build();
    run();
    var h = decodeURIComponent((window.location.hash || "").slice(1));
    if (h && BY[h]) openRow(BY[h]);
    window.addEventListener("hashchange", function () {
      var id = decodeURIComponent((window.location.hash || "").slice(1));
      if (id && BY[id]) openRow(BY[id]);
    });
  }

  // The file of the Global Populism Database marks some terms as "current". That
  // was true when the file was made, not today.
  function fileMonth() { return PV.month(D.gpd_end); }

  function partyOf(r) {
    // A leader's party in the data: the party of the latest linked term
    if (r.k !== "leader" || !r.parties || !r.parties.length) return null;
    return BY[r.parties[r.parties.length - 1]] || null;
  }

  function partyLink(r) {
    // The line of the list of links, if the leader's party was linked by PopuliVerse
    var p = partyOf(r), n = 0;
    if (!p) return 0;
    (r.gd || []).forEach(function (t) { if (t[9] === p.id && t[12]) n = t[12]; });
    return n;
  }

  function leadersOf(r) {
    return (r.leaders || []).map(function (id) { return BY[id]; }).filter(Boolean);
  }

  function prepare(r) {
    r.region = D.regions[r.c] || "";
    var words = [r.n, r.s, r.o, r.cl].concat(r.aka || []);
    if (r.k === "leader") (r.gd || []).forEach(function (t) { words.push(t[8]); });
    leadersOf(r).forEach(function (l) { words.push(l.n); });
    r.find = PV.fold(words.join(" "));
    r.names = [r.n, r.s, r.o].concat(r.aka || []).filter(Boolean).map(PV.fold);
    // The PopuList, as of the latest year it covers
    r.plv = popuNow(r.k === "leader" ? partyOf(r) : r, r);
    r.gpdMax = null;
    termsOf(r).forEach(function (t) { if (t.avg !== null && (r.gpdMax === null || t.avg > r.gpdMax)) r.gpdMax = t.avg; });
    var el0 = vpLatest(r.k === "leader" ? partyOf(r) : r);
    r.vpNow = el0 ? el0[1] : null;
    r.mon = MON_BY_DATA[r.id] || null;
  }

  function popuNow(p, r) {
    // label, class, sort weight
    if (!p) return r && POPU_COUNTRIES[r.c] ? { label: "Party not linked", cls: "is-out", w: 0 } : { label: "Not covered", cls: "is-out", w: 0 };
    if (!p.pl) return POPU_COUNTRIES[p.c] ? { label: "No entry", cls: "is-out", w: 0, none: true } : { label: "Not covered", cls: "is-out", w: 0 };
    var best = null;
    p.pl.forEach(function (e) {
      var s = e.sets.p;
      if (!s || !s.y) return;
      var now = s.y[1] >= 2026;
      var full = s.nb && s.nb[0] <= 2026 && s.nb[1] >= 2026;
      var v = now ? (full ? { label: "Populist", cls: "is-p3", w: 3 } : { label: "Borderline", cls: "is-p2", w: 2 })
        : { label: "Populist until " + s.y[1], cls: "is-p1", w: 1 };
      if (!best || v.w > best.w) best = v;
    });
    return best || { label: "Not populist", cls: "is-no", w: 0.5 };
  }

  function termsOf(r) {
    // The terms of the Global Populism Database for a leader, or for a party's leaders
    var out = [];
    function add(lead, t) {
      out.push({ leader: lead, n: t[0], yb: t[1], ye: t[2], start: t[3], end: t[4], avg: t[5], g: t[6], sp: t[7], party: t[8], pid: t[9], cur: t[10], pres: t[11], lk: t[12] });
    }
    if (r.k === "leader") (r.gd || []).forEach(function (t) { add(r, t); });
    else leadersOf(r).forEach(function (l) { (l.gd || []).forEach(function (t) { if (t[9] === r.id) add(l, t); }); });
    out.sort(function (a, b) { return (a.yb || 0) - (b.yb || 0); });
    return out;
  }

  function termYears(t) {
    if (t.cur) return (t.yb || "") + " on, current in the file of " + fileMonth();
    return (t.yb || "") + (t.ye && t.ye !== t.yb ? " to " + t.ye : "");
  }

  function vpLatest(p) {
    if (!p || !p.vp) return null;
    var last = null;
    p.vp.forEach(function (v) { v.el.forEach(function (e) { if (e[1] !== null && (!last || e[0] >= last[0])) last = e; }); });
    return last;
  }

  function popuText(e) {
    // The PopuList's own words for one entry and one set
    var out = [];
    var s = e.sets.p;
    if (s && s.y) {
      if (s.bl && s.nb && s.nb[0] < 2100) {
        if (s.nb[0] > s.y[0]) out.push("Borderline populist " + PV.span(s.y[0], s.nb[0] - 1) + ", populist " + PV.span(s.nb[0], s.nb[1]));
        else out.push("Populist " + PV.span(s.nb[0], s.nb[1]) + ", borderline " + PV.span(s.nb[1] + 1, s.y[1]));
      } else if (s.bl) out.push("Borderline populist " + PV.span(s.y[0], s.y[1]));
      else out.push("Populist " + PV.span(s.y[0], s.y[1]));
    } else out.push("Not populist");
    [["fr", "Far right"], ["fl", "Far left"], ["eu", "Eurosceptic"]].forEach(function (k) {
      var x = e.sets[k[0]];
      if (x && x.y) out.push(k[1] + (x.bl ? " (borderline)" : "") + " " + PV.span(x.y[0], x.y[1]));
    });
    return out;
  }

  function linksOf(r) {
    // Every line of the list of links that this row rests on
    var out = [];
    function add(n) { if (n && out.indexOf(n) < 0) out.push(n); }
    var p = r.k === "leader" ? partyOf(r) : r;
    if (p && p.pl) p.pl.forEach(function (e) { add(e.lk); });
    termsOf(r).forEach(function (t) { add(t.lk); });
    return out;
  }

  // ============================================================ the page

  function build() {
    app.innerHTML = "";
    // The numbers at the top, each a filter
    var nPop = ROWS.filter(function (r) { return r.pop; }).length;
    var nAgree = ROWS.filter(function (r) { return r.m === "agree"; }).length;
    var nDiffer = ROWS.filter(function (r) { return r.m === "differ"; }).length;
    var nLead = ROWS.filter(function (r) { return r.k === "leader"; }).length;
    ui.stats = el("div", { class: "pv-wc-stats" }, [
      stat(PV.thousands(ROWS.length), "parties and leaders", { show: "all" }),
      stat(PV.thousands(nPop), "classed populist by at least one dataset", { show: "pop" }),
      stat(nLead, "leaders, from their speeches", { show: "all", kind: "leader" }),
      stat(nAgree, "where the datasets agree", { show: "all", mark: "agree" }),
      stat(nDiffer, "where they differ", { show: "all", mark: "differ" })
    ]);
    app.appendChild(ui.stats);

    // Search and filters
    ui.q = el("input", { type: "search", id: "wc-q", placeholder: "A party, a leader or a country", autocomplete: "off", value: S.q });
    ui.q.addEventListener("input", function () { S.q = ui.q.value; shown = STEP; run(); });
    var bar = el("div", { class: "pv-wc-search" }, [
      el("label", { for: "wc-q", class: "pv-wc-label", text: "Search" }), ui.q
    ]);
    app.appendChild(bar);

    ui.f = {};
    var cList = Object.keys(COUNTRY).sort(function (a, b) { return COUNTRY[a].localeCompare(COUNTRY[b]); });
    var filters = el("div", { class: "pv-wc-filters" }, [
      select("show", "Show", [["pop", "Classed populist by at least one"], ["all", "Everyone the datasets hold"]]),
      select("kind", "Parties or leaders", [["", "Both"], ["party", "Parties"], ["leader", "Leaders"]]),
      select("region", "Region", [["", "All regions"]].concat(Object.keys(REGIONS).map(function (k) { return [k, REGIONS[k]]; }))),
      select("country", "Country", [["", "All countries"]].concat(cList.map(function (c) { return [c, COUNTRY[c]]; }))),
      select("mark", "The datasets", [["", "Agree, differ or one only"], ["agree", "Agree"], ["differ", "Differ"], ["one", "One dataset only"]]),
      select("ds", "Held by", [["", "Any dataset"], ["pl", "The PopuList"], ["gs", "Global Party Survey"], ["gd", "Global Populism Database"], ["vp", "V-Party"]]),
      select("mon", "Monitor", [["", "All"], ["1", "Followed by the Monitor"], ["power", "In power today"]]),
      select("sort", "Order", [["name", "Country, then name"], ["az", "Name"], ["vp", "V-Party score, highest first"], ["gd", "Speeches, most populist first"], ["mark", "Differ first"]])
    ]);
    app.appendChild(filters);

    // The views
    ui.tabs = el("div", { class: "pv-wc-tabs", role: "tablist" });
    [["table", "Table"], ["timeline", "Timeline"], ["compare", "Compare"]].forEach(function (v) {
      var b = el("button", { type: "button", role: "tab", class: "pv-wc-tab", "data-view": v[0], text: v[1] });
      b.addEventListener("click", function () { S.view = v[0]; run(); });
      ui.tabs.appendChild(b);
    });
    ui.count = el("p", { class: "pv-wc-count", "aria-live": "polite" });
    ui.tools = el("div", { class: "pv-wc-tools" });
    app.appendChild(el("div", { class: "pv-wc-head" }, [ui.tabs, ui.count, ui.tools]));
    ui.legend = el("div", { class: "pv-wc-legend" });
    app.appendChild(ui.legend);
    ui.view = el("div", { class: "pv-wc-view" });
    app.appendChild(ui.view);
    app.appendChild(PV.linksBox(D.links, function (c) { return COUNTRY[c] || c; }));
  }

  function stat(n, label, set) {
    var b = el("button", { type: "button", class: "pv-wc-stat" }, [el("span", { class: "pv-wc-stat-n", text: String(n) }), el("span", { class: "pv-wc-stat-l", text: label })]);
    b.addEventListener("click", function () {
      // A number shows exactly what it counts: every other filter is cleared
      var keep = { view: S.view, sort: S.sort, group: S.group };
      Object.keys(DEFAULTS).forEach(function (k) { S[k] = DEFAULTS[k]; });
      Object.keys(keep).forEach(function (k) { S[k] = keep[k]; });
      Object.keys(set).forEach(function (k) { S[k] = set[k]; });
      Object.keys(ui.f).forEach(function (k) { ui.f[k].value = S[k]; });
      ui.q.value = "";
      shown = STEP; run();
    });
    return b;
  }

  function select(key, label, opts) {
    var id = "wc-" + key;
    var s = el("select", { id: id });
    opts.forEach(function (o) { s.appendChild(el("option", { value: o[0], text: o[1] })); });
    s.value = S[key];
    s.addEventListener("change", function () { S[key] = s.value; shown = STEP; run(); });
    ui.f[key] = s;
    return el("div", { class: "pv-wc-field" }, [el("label", { for: id, class: "pv-wc-label", text: label }), s]);
  }

  // ============================================================ filtering

  function words() { return PV.fold(S.q).trim().split(/\s+/).filter(Boolean); }

  function fits(r, q) {
    // Every filter but "Show"
    if (S.kind && r.k !== S.kind) return false;
    if (S.region && r.region !== S.region) return false;
    if (S.country && r.c !== S.country) return false;
    if (S.mark && r.m !== S.mark) return false;
    if (S.ds) {
      if (S.ds === "gd" && !termsOf(r).length) return false;
      if (S.ds !== "gd" && !r[S.ds]) return false;
    }
    if (S.mon === "1" && !r.mon) return false;
    if (S.mon === "power" && !(r.mon && r.mon.power)) return false;
    for (var i = 0; i < q.length; i++) if (r.find.indexOf(q[i]) < 0) return false;
    return true;
  }

  function closeness(r, whole, first) {
    // In a search, a name that is the word typed comes before one that only holds it
    var i, best = 3;
    for (i = 0; i < r.names.length; i++) {
      var n = r.names[i];
      if (n === whole) return 0;
      if (n.indexOf(whole) === 0) best = Math.min(best, 1);
      else if ((" " + n).indexOf(" " + first) >= 0) best = Math.min(best, 2);
    }
    return best;
  }

  function run() {
    var q = words();
    // A search looks in everyone the datasets hold, whatever "Show" says
    wide = ROWS.filter(function (r) { return fits(r, q); });
    list = wide.filter(function (r) { return S.show === "all" || r.pop || q.length; });
    var cmp = {
      name: function (a, b) { return (a.cl || "").localeCompare(b.cl || "") || a.n.localeCompare(b.n); },
      az: function (a, b) { return a.n.localeCompare(b.n); },
      vp: function (a, b) { return (b.vpNow === null ? -1 : b.vpNow) - (a.vpNow === null ? -1 : a.vpNow); },
      gd: function (a, b) { return (b.gpdMax === null ? -1 : b.gpdMax) - (a.gpdMax === null ? -1 : a.gpdMax); },
      mark: function (a, b) { var o = { differ: 0, agree: 1, one: 2 }; return o[a.m] - o[b.m] || a.n.localeCompare(b.n); }
    }[S.sort] || function () { return 0; };
    if (q.length) {
      var whole = q.join(" ");
      list.forEach(function (r) { r.near = closeness(r, whole, q[0]); });
      list.sort(function (a, b) { return a.near - b.near || cmp(a, b); });
    } else list.sort(cmp);
    var keep = {};
    Object.keys(S).forEach(function (k) { if (S[k] !== DEFAULTS[k]) keep[k] = S[k]; });
    PV.state.set(keep);
    Array.prototype.forEach.call(ui.tabs.children, function (b) {
      var on = b.getAttribute("data-view") === S.view;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    ui.view.innerHTML = "";
    ui.tools.innerHTML = "";
    ui.legend.innerHTML = "";
    if (S.view === "compare") {
      drawCompare();
      return;
    }
    ui.count.textContent = PV.thousands(list.length) + (list.length === 1 ? " party or leader" : " parties and leaders") +
      (q.length ? ". The search looks in everyone the datasets hold" : S.show !== "all" ? ", classed populist by at least one dataset" : "");
    if (S.view === "timeline") drawTimeline();
    else drawTable();
  }

  function filterLine(skipShow) {
    // The filters in use, in words, for a picture and a download
    var bits = [];
    if (S.q.trim()) bits.push("search “" + S.q.trim() + "”");
    if (S.kind) bits.push(S.kind === "party" ? "parties only" : "leaders only");
    if (S.region) bits.push(REGIONS[S.region]);
    if (S.country) bits.push(COUNTRY[S.country] || S.country);
    if (S.mark) bits.push(MARKS[S.mark]);
    if (S.ds) bits.push("held by " + (S.ds === "pl" ? "The PopuList" : "the " + DATASETS[S.ds]).replace("the V-Party", "V-Party"));
    if (S.mon) bits.push(S.mon === "1" ? "followed by PopuliVerse Monitor" : "in power today, by PopuliVerse Monitor");
    if (!skipShow && !S.q.trim()) bits.unshift(S.show === "all" ? "everyone the datasets hold" : "classed populist by at least one dataset");
    return bits.length ? "Filters: " + bits.join("; ") + "." : "Filters: none.";
  }

  // ============================================================ the table

  function legendTable() {
    ui.legend.appendChild(el("p", {}, [
      PV.pill("Populist", "is-p3"), " ", PV.pill("Borderline", "is-p2"), " ", PV.pill("Not populist", "is-no"), " ",
      PV.pill("No entry or not covered", "is-out"),
      el("span", { class: "pv-wc-legend-note", text: " Each column is one dataset in its own words. For the speeches, each small box is a term: " }),
      chipKey(3), chipKey(2), chipKey(1), chipKey(0),
      el("span", { class: "pv-wc-legend-note", text: " V-Party gives a score from 0 to 1, shown in grey because it is not a verdict." })
    ]));
  }

  function chipKey(b) {
    var v = PV.verdict.gpd(b);
    return el("span", { class: "pv-key" }, [el("span", { class: "pv-chip " + v.cls }), v.label.toLowerCase()]);
  }

  function drawTable() {
    legendTable();
    tools();
    if (!list.length) {
      ui.view.appendChild(el("p", { class: "pv-lib-nomatch", text: "Nothing fits these filters." }));
      return;
    }
    var t = el("table", { class: "pv-wc-table" });
    t.appendChild(el("thead", {}, [el("tr", {}, [
      el("th", { scope: "col", text: "Party or leader" }),
      el("th", { scope: "col" }, [abbr("The PopuList", "Populist, far-left and far-right parties in 31 European countries, since 1989. Shown as of 2026")]),
      el("th", { scope: "col" }, [abbr("Global Party Survey", "Experts on parties in 2019, as V-Party carries the survey")]),
      el("th", { scope: "col" }, [abbr("Global Populism Database", "The speeches of presidents and prime ministers, each term")]),
      el("th", { scope: "col" }, [abbr("V-Party", "A score from 0 to 1 at each election, 1970 to 2019")]),
      el("th", { scope: "col", text: "The datasets" })
    ])]));
    var tb = el("tbody");
    list.slice(0, shown).forEach(function (r) { tb.appendChild(tableRow(r)); });
    t.appendChild(tb);
    ui.view.appendChild(el("div", { class: "pv-wc-scroll" }, [t]));
    if (list.length > shown) {
      var more = el("button", { type: "button", class: "pv-button pv-wc-more", text: "Show " + Math.min(STEP, list.length - shown) + " more" });
      more.addEventListener("click", function () { shown += STEP; run(); });
      ui.view.appendChild(more);
    }
  }

  function abbr(text, title) { return el("span", { title: title, text: text }); }

  function tableRow(r) {
    var party = r.k === "leader" ? partyOf(r) : null;
    var name = el("button", { type: "button", class: "pv-wc-name" }, [
      el("span", { class: "pv-wc-n", text: r.n }),
      el("span", { class: "pv-wc-meta", text: [r.k === "leader" ? "Leader" : "Party", r.cl, r.s && r.s !== r.n ? r.s : ""].filter(Boolean).join(" · ") })
    ]);
    name.addEventListener("click", function () { openRow(r); });
    var plCell = el("td", { "data-label": "The PopuList" }, [PV.pill(r.plv.label, r.plv.cls, r.plv.none ? "The PopuList has no entry under this party's Party Facts ID" : null)]);
    if (party) plCell.appendChild(el("span", { class: "pv-wc-via", text: "party" }));
    var lk = linksOf(r);
    if (lk.length) plCell.appendChild(el("span", { class: "pv-wc-via pv-linked", title: lk.map(function (n) { return PV.linkText(n, D.links); }).join(" "), text: "linked by PopuliVerse" }));
    var gsSrc = r.gs ? r : party && party.gs ? party : null;
    var gsCell = el("td", { "data-label": "Global Party Survey" }, gsSrc ? [PV.pill(PV.verdict.gps(gsSrc.gs.t).label, PV.verdict.gps(gsSrc.gs.t).cls)] : [el("span", { class: "pv-wc-dash", title: "Here the survey is read from V-Party's file, which carries about half of its parties", text: "Not in the copy used" })]);
    if (party && gsSrc) gsCell.appendChild(el("span", { class: "pv-wc-via", text: "party" }));
    var tr = el("tr", { class: r.mon ? "is-mon" : null }, [
      el("th", { scope: "row" }, [name, r.mon ? el("span", { class: "pv-wc-mon", title: "Followed by PopuliVerse Monitor", text: "Monitor" }) : null]),
      plCell,
      gsCell,
      el("td", { "data-label": "Global Populism Database" }, [chips(r)]),
      el("td", { "data-label": "V-Party" }, [spark(r.k === "leader" ? party : r, !!party)]),
      el("td", { "data-label": "The datasets" }, [markPill(r)])
    ]);
    return tr;
  }

  function markPill(r) {
    if (r.m === "agree") return PV.pill("Agree", "is-agree", "Every dataset that speaks for the same years gives the same verdict");
    if (r.m === "differ") return PV.pill("Differ " + years(r.md), "is-differ", "In these years one dataset says populist and another says not");
    return el("span", { class: "pv-wc-dash", title: "No two datasets speak for the same years", text: "One only" });
  }

  function years(ys) {
    if (!ys || !ys.length) return "";
    var parts = [], a = ys[0], b = ys[0];
    for (var i = 1; i <= ys.length; i++) {
      if (ys[i] === b + 1) { b = ys[i]; continue; }
      parts.push(a === b ? String(a) : a + " to " + b);
      a = b = ys[i];
    }
    return parts.join(", ");
  }

  function chips(r) {
    var ts = termsOf(r);
    if (!ts.length) return el("span", { class: "pv-wc-dash", text: "No term" });
    var box = el("span", { class: "pv-wc-chips" });
    ts.forEach(function (t) {
      var v = t.g === null ? null : PV.verdict.gpd(t.g);
      var label = t.leader.n + ", " + termYears(t) + ". Average " + PV.num(t.avg) + (v ? ", " + v.label.toLowerCase() : "");
      box.appendChild(el("span", { class: "pv-chip " + (v ? v.cls : "is-out"), title: label, "aria-label": label }));
    });
    var last = ts[ts.length - 1];
    box.appendChild(el("span", { class: "pv-wc-chiptext", text: PV.num(last.avg) + " in " + (last.yb || "") }));
    return box;
  }

  function spark(p, via) {
    if (!p || !p.vp) return el("span", { class: "pv-wc-dash", text: "Not covered" });
    var pts = [];
    p.vp.forEach(function (v) { v.el.forEach(function (e) { if (e[1] !== null) pts.push(e); }); });
    if (!pts.length) return el("span", { class: "pv-wc-dash", text: "No score" });
    pts.sort(function (a, b) { return a[0] - b[0]; });
    var W = 92, H = 22, x0 = 1970, x1 = 2019;
    var x = function (y) { return 3 + (W - 6) * (y - x0) / (x1 - x0); };
    var y = function (s) { return H - 3 - (H - 6) * s; };
    var d = pts.map(function (e, i) { return (i ? "L" : "M") + x(e[0]).toFixed(1) + "," + y(e[1]).toFixed(1); }).join("");
    var last = pts[pts.length - 1];
    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true">' +
      '<line x1="3" x2="' + (W - 3) + '" y1="' + y(0.5) + '" y2="' + y(0.5) + '" class="pv-spark-mid"/>' +
      '<path d="' + d + '" class="pv-spark-line"/>' +
      '<circle cx="' + x(last[0]) + '" cy="' + y(last[1]) + '" r="2.6" class="pv-spark-dot"/></svg>';
    var s = el("span", { class: "pv-wc-spark", title: "V-Party populism score at each election, " + pts[0][0] + " to " + last[0] + ". Latest " + PV.num(last[1]) + " in " + last[0] });
    s.innerHTML = svg;
    s.appendChild(el("span", { class: "pv-wc-sparktext", text: PV.num(last[1]) + " in " + last[0] + (via ? " · party" : "") }));
    return s;
  }

  // ============================================================ tools: download and link

  function tools(picture) {
    var b = el("button", { type: "button", class: "pv-lib-link", text: "Download the list (CSV)" });
    b.addEventListener("click", downloadCsv);
    ui.tools.appendChild(b);
    if (picture) {
      var b2 = el("button", { type: "button", class: "pv-lib-link", text: "Picture (PNG)" });
      b2.addEventListener("click", function () { PV.save.picture(b2, picture.name, "png", picture.make); });
      var b3 = el("button", { type: "button", class: "pv-lib-link", text: "Picture (SVG)" });
      b3.addEventListener("click", function () { PV.save.picture(b3, picture.name, "svg", picture.make); });
      ui.tools.appendChild(b2);
      ui.tools.appendChild(b3);
    }
    ui.tools.appendChild(el("a", { class: "pv-lib-link", href: "sources.txt", download: "populiverse-data-sources.txt", text: "Sources and licences" }));
    var link = el("button", { type: "button", class: "pv-lib-link", text: "Copy the link to this view" });
    link.addEventListener("click", function () { PV.copy(window.location.href, link); });
    ui.tools.appendChild(link);
  }

  function sourceLines(keys) {
    var names = {
      pl: "The PopuList 4.0 (Rooduijn et al. 2024)",
      gs: "Global Party Survey 2019 (Norris 2020), as V-Party carries it",
      gd: "Global Populism Database 2.1 (Hawkins et al. 2019)",
      vp: "V-Party, version 2 (Lindberg et al. 2022)",
      pf: "Party Facts, Version 2023 (Döring and Regel 2019)"
    };
    return [
      "Sources: " + keys.map(function (k) { return names[k]; }).join("; ") + ". Full references: populiverse.com/data/sources.txt.",
      "The datasets are linked by Party Facts IDs and, in " + D.links.length + " places, by PopuliVerse's own checked list (populiverse.com/data/links.csv). Data as built on " + PV.date(D.built) + ".",
      "Every verdict is the dataset's own. Licence of this picture: CC BY-SA 4.0, as it carries V-Party's scores."
    ];
  }

  var CSV_HEAD = ["id", "kind", "name", "short_name", "original_name", "country", "country_code", "partyfacts_id", "party_of_leader",
    "popu_list_4_0", "global_party_survey_2019", "gps_populist_rhetoric_0_10", "gps_salience_0_10",
    "global_populism_database_2_1_terms", "vparty_latest_election", "vparty_populism_score", "vparty_low", "vparty_high",
    "datasets_agree", "years_they_differ", "linked_by_populiverse", "populiverse_monitor"];

  function rowCsv(r) {
    var party = r.k === "leader" ? partyOf(r) : null;
    var p = r.k === "leader" ? party : r;
    var plText = p && p.pl ? p.pl.map(function (e) { return popuText(e).join("; "); }).join(" | ")
      : r.plv.none ? "no entry under this Party Facts ID" : r.plv.label.toLowerCase();
    var gsSrc = r.gs ? r : party && party.gs ? party : null;
    var last = vpLatest(p);
    var ts = termsOf(r);
    return [
      r.id, r.k, r.n, r.s || "", r.o || "", r.cl || "", r.c || "", r.k === "party" ? r.pf || "" : party ? party.pf || "" : "",
      party ? party.n : "",
      plText,
      gsSrc ? PV.verdict.gps(gsSrc.gs.t).label : "", gsSrc ? gsSrc.gs.rh : "", gsSrc ? gsSrc.gs.sal : "",
      ts.map(function (t) { return t.leader.n + " " + (t.yb || "") + "-" + (t.cur ? "current in the file" : t.ye || "") + " " + PV.num(t.avg) + " (" + PV.verdict.gpd(t.g).label.toLowerCase() + ")"; }).join("; "),
      last ? last[0] : "", last ? last[1] : "", last ? last[2] : "", last ? last[3] : "",
      r.m === "one" ? "one dataset only" : r.m, years(r.md),
      linksOf(r).map(function (n) { return "line " + n + ": " + PV.link(n, D.links).b; }).join(" | "),
      r.mon ? "https://populiverse.com/actors/" + r.mon.id + ".html" : ""
    ];
  }

  function csvFoot() {
    return [
      [],
      [filterLine()],
      ["Every verdict is the dataset's own. popu_list_4_0 is the party's entry in The PopuList, for a leader the entry of his or her party. The Global Populism Database's words for a term's average are those of its paper: not populist below 0.5, somewhat populist 0.5 to 0.99, populist 1.0 to 1.49, very populist 1.5 and above."],
      ["Sources and licences: https://populiverse.com/data/sources.txt. The list of links made by PopuliVerse: https://populiverse.com/data/links.csv. V-Party's scores are under CC BY-SA 4.0, so this file is too."],
      [PV.citation(PAGE_TITLE, PAGE_URL)]
    ];
  }

  function downloadCsv() {
    var rows = S.view === "compare" ? wide.filter(function (r) { return r.k === "party"; }) : list;
    PV.save.csv("populiverse-who-counts-" + D.built + ".csv", [CSV_HEAD].concat(rows.map(rowCsv)).concat(csvFoot()));
  }

  // ============================================================ the timeline

  var LANES = ["The PopuList", "Global Party Survey", "Global Populism Database", "V-Party"];

  function timelineKey() {
    return [
      { fill: PV.colour.p3, label: "Populist (The PopuList), very populist (speeches), strongly populist (survey)" },
      { fill: PV.colour.p2, label: "Populist (speeches), moderately populist (survey)" },
      { fill: PV.colour.p1, label: "Somewhat populist (speeches)" },
      { fill: "url(#pv-bl3)", label: "Borderline populist (The PopuList)" },
      { fill: PV.colour.none, label: "Not populist" },
      { fill: PV.colour.s1, label: "Moderately pluralist (survey)" },
      { fill: PV.colour.s2, label: "Strongly pluralist (survey)" },
      { fill: "url(#pv-hatch)", label: "No entry or not covered (The PopuList)" },
      { fill: "#555555", dot: true, label: "V-Party score at an election, darker is higher" }
    ];
  }

  function drawTimeline() {
    var N = 40;
    var rows = list.slice(0, Math.max(N, Math.min(shown, list.length)));
    var key = el("p");
    timelineKey().forEach(function (k) {
      var sw = k.dot ? el("span", { class: "pv-key-dot" })
        : el("span", { class: "pv-key-sw" + (k.fill === "url(#pv-hatch)" ? " is-hatch" : k.fill === "url(#pv-bl3)" ? " is-bl3" : ""), style: k.fill.indexOf("url") === 0 ? null : "background:" + k.fill });
      key.appendChild(el("span", { class: "pv-key" }, [sw, k.label]));
    });
    key.appendChild(el("span", { class: "pv-wc-legend-note", text: " The four lanes of each row, from the top: " + LANES.join(", ") + "." }));
    ui.legend.appendChild(key);
    if (!rows.length) { tools(); ui.view.appendChild(el("p", { class: "pv-lib-nomatch", text: "Nothing fits these filters." })); return; }
    var box = el("div", { class: "pv-wc-scroll pv-wc-chartbox" });
    ui.view.appendChild(box);
    timelineChart(box, Math.max(640, ui.view.clientWidth || 900), rows, false);
    if (list.length > rows.length) {
      var more = el("button", { type: "button", class: "pv-button pv-wc-more", text: "Show " + Math.min(STEP, list.length - rows.length) + " more" });
      more.addEventListener("click", function () { shown = rows.length + STEP; run(); });
      ui.view.appendChild(more);
    }
    tools({
      name: "populiverse-who-counts-timeline",
      make: function () {
        return {
          host: app,
          chart: function (holder, w) { return timelineChart(holder, w, rows, true); },
          title: "Who Counts as Populist? Four Datasets, Year by Year",
          lines: [
            filterLine() + " " + rows.length + " of " + list.length + (list.length === 1 ? " party or leader" : " parties and leaders") + " shown, in the order “" + ui.f.sort.options[ui.f.sort.selectedIndex].text + "”.",
            "Each row has four lanes, from the top: " + LANES.join(", ") + ". A leader's row shows his or her party in the lanes of the parties."
          ],
          legend: timelineKey(),
          notes: [
            "The PopuList classes parties in 31 European countries from 1989 to 2026. The Global Party Survey asked experts once, in 2019. The Global Populism Database grades speeches term by term; the words for a term's average are those of its paper (below 0.5 not populist, 0.5 to 0.99 somewhat populist, 1.0 to 1.49 populist, 1.5 and above very populist). V-Party gives a score from 0 to 1 and no category.",
            "An empty lane means that the dataset does not hold the party or the leader. It never means not populist."
          ],
          sources: sourceLines(["pl", "gs", "gd", "vp", "pf"]),
          cite: PV.citation(PAGE_TITLE, PAGE_URL)
        };
      }
    });
  }

  function timelineChart(host, width, rows, pic) {
    var labelW = pic ? 300 : width < 700 ? 150 : 240, lane = 7, gap = 2, rowH = 4 * (lane + gap) + 14;
    var x0 = 1970, x1 = 2026;
    var height = rows.length * rowH + 30;
    var x = d3.scaleLinear().domain([x0, x1 + 1]).range([labelW, width - 10]);
    var svg = d3.select(host).append("svg").attr("class", "pv-wc-tl").attr("width", width).attr("height", height).attr("role", "img")
      .attr("aria-label", "Timeline of the datasets' verdicts for " + rows.length + " parties and leaders");
    PV.defs(svg);
    var axis = svg.append("g").attr("class", "pv-axis").attr("transform", "translate(0,18)");
    [1970, 1980, 1990, 2000, 2010, 2020].forEach(function (y) {
      axis.append("line").attr("x1", x(y)).attr("x2", x(y)).attr("y1", 4).attr("y2", height - 18).attr("class", "pv-grid");
      axis.append("text").attr("x", x(y)).attr("y", 0).attr("text-anchor", "middle").text(y);
    });
    rows.forEach(function (r, i) {
      var g = svg.append("g").attr("transform", "translate(0," + (28 + i * rowH) + ")").attr("class", "pv-tl-row");
      if (!pic) {
        g.style("cursor", "pointer").on("click", function () { openRow(r); });
        g.append("rect").attr("x", 0).attr("y", -4).attr("width", width).attr("height", rowH - 2).attr("class", "pv-tl-hit");
      }
      g.append("text").attr("x", 0).attr("y", 9).attr("class", "pv-tl-name").text(trim(r.n, labelW < 200 ? 20 : labelW < 280 ? 32 : 42));
      g.append("text").attr("x", 0).attr("y", 22).attr("class", "pv-tl-meta").text((r.k === "leader" ? "Leader · " : "") + (r.cl || ""));
      var p = r.k === "leader" ? partyOf(r) : r;
      // The PopuList
      var yy = 0;
      if (p && p.pl) {
        g.append("rect").attr("x", x(1989)).attr("y", yy).attr("width", x(x1 + 1) - x(1989)).attr("height", lane).attr("fill", PV.colour.none);
        p.pl.forEach(function (e) {
          var s = e.sets.p;
          if (!s || !s.y) return;
          var a = Math.max(1989, s.y[0]), b = Math.min(x1, s.y[1]);
          g.append("rect").attr("x", x(a)).attr("y", yy).attr("width", Math.max(1, x(b + 1) - x(a))).attr("height", lane).attr("fill", s.bl ? "url(#pv-bl3)" : PV.colour.p3);
          if (s.bl && s.nb && s.nb[0] < 2100) {
            var a2 = Math.max(1989, s.nb[0]), b2 = Math.min(x1, s.nb[1]);
            g.append("rect").attr("x", x(a2)).attr("y", yy).attr("width", Math.max(1, x(b2 + 1) - x(a2))).attr("height", lane).attr("fill", PV.colour.p3);
          }
        });
      } else g.append("rect").attr("x", x(1989)).attr("y", yy).attr("width", x(x1 + 1) - x(1989)).attr("height", lane).attr("fill", "url(#pv-hatch)");
      // Global Party Survey
      yy += lane + gap;
      var gs = r.gs ? r.gs : p && p.gs ? p.gs : null;
      if (gs) g.append("rect").attr("x", x(2019)).attr("y", yy).attr("width", x(2020) - x(2019)).attr("height", lane)
        .attr("fill", PV.verdict.gps(gs.t).fill);
      // Global Populism Database
      yy += lane + gap;
      termsOf(r).forEach(function (t) {
        if (!t.yb) return;
        var a = Math.max(x0, t.yb), b = Math.min(x1, t.ye || t.yb);
        g.append("rect").attr("x", x(a)).attr("y", yy).attr("width", Math.max(2, x(b + 1) - x(a) - 1)).attr("height", lane)
          .attr("fill", PV.verdict.gpd(t.g).fill);
      });
      // V-Party
      yy += lane + gap;
      if (p && p.vp) p.vp.forEach(function (v) {
        v.el.forEach(function (e) {
          if (e[1] === null) return;
          g.append("circle").attr("cx", x(e[0] + 0.5)).attr("cy", yy + lane / 2).attr("r", 3.2)
            .attr("fill", d3.interpolateGreys(0.25 + 0.7 * e[1])).attr("stroke", PV.colour.paper).attr("stroke-width", 1);
        });
      });
      if (!pic) g.on("mousemove", function (ev) {
        PV.tip.show(ev, "<strong>" + PV.esc(r.n) + "</strong><br>The PopuList: " + PV.esc(r.plv.label.toLowerCase()) +
          (gs ? "<br>Survey of 2019: " + PV.esc(PV.verdict.gps(gs.t).label.toLowerCase()) : "") +
          (r.gpdMax !== null ? "<br>Speeches: up to " + PV.num(r.gpdMax) + " in a term" : "") +
          (r.vpNow !== null ? "<br>V-Party: " + PV.num(r.vpNow) : "") + "<br><em>Click for everything the datasets hold</em>");
      }).on("mouseleave", PV.tip.hide);
    });
    return svg.node();
  }

  function trim(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  // ============================================================ compare

  function groupsOf() {
    return S.group === "gs"
      ? [[4, "Strongly populist", "p3"], [3, "Moderately populist", "p2"], [2, "Moderately pluralist", "s1"], [1, "Strongly pluralist", "s2"]]
      : [["Populist", "Populist", "p3"], ["Borderline", "Borderline populist", "p2"], ["Populist until", "Populist earlier", "p1"], ["Not populist", "Not populist", "none"], ["No entry", "No entry", "none"]];
  }

  function comparePoints(groups) {
    // Every party that the filters leave, whatever "Show" says: a comparison of the
    // parties classed populist alone would hide the ones they are compared with
    var pts = [];
    wide.forEach(function (r) {
      if (r.k !== "party" || r.vpNow === null) return;
      var last = vpLatest(r);
      // The PopuList covers elections from 1989, so only parties that V-Party saw since then
      var key = S.group === "gs" ? (r.gs ? r.gs.t : null) : ((r.pl || POPU_COUNTRIES[r.c]) && last[0] >= 1989 ? r.plv.label.replace(/ \d+$/, "") : null);
      if (key === null) return;
      var gi = -1;
      groups.forEach(function (g, i) { if (g[0] === key) gi = i; });
      if (gi >= 0) pts.push({ r: r, g: gi, v: r.vpNow, year: last[0], vote: last[4] });
    });
    return pts;
  }

  function drawCompare() {
    var groups = groupsOf();
    var pts = comparePoints(groups);
    var grp = el("select", { id: "wc-group" }, [el("option", { value: "pl", text: "The PopuList, as of 2026" }), el("option", { value: "gs", text: "the Global Party Survey of 2019" })]);
    grp.value = S.group;
    grp.addEventListener("change", function () { S.group = grp.value; run(); });
    ui.legend.appendChild(el("p", {}, [
      el("label", { for: "wc-group", text: "V-Party's score set against the verdict of " }), grp,
      el("span", { class: "pv-wc-legend-note", text: ". Each dot is a party, at its latest election in V-Party. Where the dots of two verdicts overlap, a score alone does not tell them apart. This view uses every party the filters leave, whatever “Show” says" + (S.group === "pl" ? ", in The PopuList's 31 countries." : ".") })
    ]));
    ui.count.textContent = PV.thousands(pts.length) + (pts.length === 1 ? " party" : " parties") + " with a V-Party score and this verdict";
    if (!pts.length) { tools(); ui.view.appendChild(el("p", { class: "pv-lib-nomatch", text: "No party here has both a V-Party score and this verdict." })); return; }
    var box = el("div", { class: "pv-wc-scroll pv-wc-chartbox" });
    ui.view.appendChild(box);
    compareChart(box, Math.max(600, ui.view.clientWidth || 900), groups, pts, false);
    var by = S.group === "gs" ? "the Global Party Survey of 2019" : "The PopuList, as of 2026";
    tools({
      name: "populiverse-who-counts-compare",
      make: function () {
        return {
          host: app,
          chart: function (holder, w) { return compareChart(holder, w, groups, pts, true); },
          title: "V-Party's Populism Score, Set Against the Verdict of " + (S.group === "gs" ? "the Global Party Survey" : "The PopuList"),
          lines: [
            PV.thousands(pts.length) + " parties, each at its latest election in V-Party (1970 to 2019), grouped by the verdict of " + by + ". " + filterLine(true),
            S.group === "pl" ? "Parties in The PopuList's 31 European countries that V-Party saw at an election since 1989." : "Parties that the Global Party Survey holds in V-Party's copy of it."
          ],
          legend: groups.map(function (g) { return { fill: PV.colour[g[2]], stroke: g[2] === "none" ? "#8E8B83" : "#FFFFFF", dot: true, label: g[1] }; })
            .concat([{ fill: "#111111", line: true, label: "Median of the group" }]),
          notes: [
            "V-Party's score runs from 0 to 1, from many experts; it gives no category and is not a verdict. Where the dots of two groups overlap, a score alone does not tell them apart. The height of a dot within its row has no meaning.",
            (S.group === "pl" ? "“No entry” means that The PopuList has no entry under the party's Party Facts ID. It lists the parties it classes as populist, far left or far right. “Populist earlier” means that its populist years ended before 2026. " : "") +
            "Names are shown where they fit, larger parties first, with the short name and the country code. The middle half is the range between the first and the third quartile."
          ],
          sources: sourceLines(S.group === "gs" ? ["gs", "vp", "pf"] : ["pl", "vp", "pf"]),
          cite: PV.citation(PAGE_TITLE, PAGE_URL)
        };
      }
    });
  }

  function compareChart(host, width, groups, pts, pic) {
    var labelW = pic ? 230 : width < 700 ? 120 : 190, band = pic ? 150 : 74;
    var height = groups.length * band + 50;
    var x = d3.scaleLinear().domain([0, 1]).range([labelW, width - 20]);
    var svg = d3.select(host).append("svg").attr("class", "pv-wc-cmp").attr("width", width).attr("height", height).attr("role", "img")
      .attr("aria-label", "V-Party scores of " + pts.length + " parties by verdict");
    var ax = svg.append("g").attr("class", "pv-axis");
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      ax.append("line").attr("x1", x(t)).attr("x2", x(t)).attr("y1", 18).attr("y2", height - 26).attr("class", "pv-grid");
      ax.append("text").attr("x", x(t)).attr("y", height - 8).attr("text-anchor", "middle").text(t);
    });
    ax.append("text").attr("x", width - 20).attr("y", 12).attr("text-anchor", "end").attr("class", "pv-axis-title").text("V-Party populism score, more populist to the right");
    groups.forEach(function (g, i) {
      var ps = pts.filter(function (p) { return p.g === i; });
      var y0 = 24 + i * band;
      if (i) svg.append("line").attr("x1", 0).attr("x2", width).attr("y1", y0 - 3).attr("y2", y0 - 3).attr("class", "pv-grid");
      var ty = y0 + (pic ? 34 : band / 2 - 4);
      svg.append("text").attr("x", 0).attr("y", ty).attr("class", "pv-tl-name").text(g[1]);
      svg.append("text").attr("x", 0).attr("y", ty + 16).attr("class", "pv-tl-meta").text(ps.length + (ps.length === 1 ? " party" : " parties"));
      var med = null;
      if (ps.length) {
        var vs = ps.map(function (p) { return p.v; }).sort(d3.ascending);
        med = d3.quantile(vs, 0.5);
        if (pic) {
          svg.append("text").attr("x", 0).attr("y", ty + 31).attr("class", "pv-tl-meta").text("median " + PV.num(med));
          if (ps.length >= 4) svg.append("text").attr("x", 0).attr("y", ty + 46).attr("class", "pv-tl-meta").text("middle half " + PV.num(d3.quantile(vs, 0.25)) + " to " + PV.num(d3.quantile(vs, 0.75)));
        }
        svg.append("line").attr("x1", x(med)).attr("x2", x(med)).attr("y1", y0 + 2).attr("y2", y0 + band - 10).attr("class", "pv-median");
        if (!pic) svg.append("text").attr("x", x(med) + 4).attr("y", y0 + 2).attr("class", "pv-tl-meta pv-median-l").text("median " + PV.num(med));
      }
      var spread = pic ? band - 34 : (band - 30) * 0.85;
      ps.forEach(function (p) {
        p.cx = x(p.v);
        p.cy = y0 + 16 + hash(p.r.id) * spread;
        var c = svg.append("circle").attr("cx", p.cx).attr("cy", p.cy).attr("r", 4.5)
          .attr("fill", PV.colour[g[2]]).attr("stroke", g[2] === "none" ? "#8E8B83" : PV.colour.paper).attr("stroke-width", 1.5)
          .attr("class", "pv-dot");
        if (!pic) c.style("cursor", "pointer")
          .on("mousemove", function (ev) { PV.tip.show(ev, "<strong>" + PV.esc(p.r.n) + "</strong>, " + PV.esc(p.r.cl) + "<br>" + PV.esc(g[1]) + "<br>V-Party " + PV.num(p.v) + " in " + p.year + "<br><em>Click for more</em>"); })
          .on("mouseleave", PV.tip.hide)
          .on("click", function () { openRow(p.r); });
      });
      if (pic) nameDots(svg, ps, labelW, width - 4, y0, y0 + band - 6, med === null ? null : x(med));
    });
    return svg.node();
  }

  function nameDots(svg, ps, left, right, top, bottom, medianX) {
    // Names beside the dots, where they fit: the parties followed by the Monitor
    // first, then the larger parties. A name never covers another name or a dot.
    var size = 9, boxes = [];
    var order = ps.slice().sort(function (a, b) { return (b.r.mon ? 1 : 0) - (a.r.mon ? 1 : 0) || (b.vote || 0) - (a.vote || 0); });
    function free(bx) {
      if (bx.x0 < left || bx.x1 > right || bx.y0 < top || bx.y1 > bottom) return false;
      if (medianX !== null && bx.x0 < medianX + 2 && bx.x1 > medianX - 2) return false;
      for (var i = 0; i < boxes.length; i++) {
        var o = boxes[i];
        if (bx.x0 < o.x1 && bx.x1 > o.x0 && bx.y0 < o.y1 && bx.y1 > o.y0) return false;
      }
      for (var j = 0; j < ps.length; j++) {
        var d = ps[j];
        if (d.cx > bx.x0 - 4 && d.cx < bx.x1 + 4 && d.cy > bx.y0 - 4 && d.cy < bx.y1 + 4) return false;
      }
      return true;
    }
    order.forEach(function (p) {
      var name = p.r.s && p.r.s.length <= 16 ? p.r.s : trim(p.r.n, 20);
      var text = name + " (" + p.r.c + ")";
      var w = PV.textWidth(text, size) + 2;
      var tries = [
        { x0: p.cx + 7, y0: p.cy - 5, anchor: "start", tx: p.cx + 7 },
        { x0: p.cx - 7 - w, y0: p.cy - 5, anchor: "end", tx: p.cx - 7 },
        { x0: p.cx - w / 2, y0: p.cy - 17, anchor: "middle", tx: p.cx },
        { x0: p.cx - w / 2, y0: p.cy + 7, anchor: "middle", tx: p.cx }
      ];
      for (var i = 0; i < tries.length; i++) {
        var t = tries[i];
        var bx = { x0: t.x0, x1: t.x0 + w, y0: t.y0, y1: t.y0 + size + 2 };
        // A name may stand beside its own dot
        var own = p.cx, ownY = p.cy;
        p.cx = -999; p.cy = -999;
        var ok = free(bx);
        p.cx = own; p.cy = ownY;
        if (!ok) continue;
        boxes.push(bx);
        svg.append("text").attr("x", t.tx).attr("y", t.y0 + size).attr("text-anchor", t.anchor)
          .attr("font-size", size).attr("fill", "#111111").text(text);
        break;
      }
    });
  }

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 1000) / 1000;
  }

  // ============================================================ the panel

  function openRow(r) {
    var party = r.k === "leader" ? partyOf(r) : null;
    var sub = (r.k === "leader" ? (r.pres ? "President" : "Leader") : "Party") + " · " + (r.cl || "");
    PV.panel.open(r.n, sub, function (body) {
      var names = [r.s, r.o].concat(r.aka || []).filter(function (x, i, a) { return x && x !== r.n && a.indexOf(x) === i; });
      if (names.length) body.appendChild(el("p", { class: "pv-dp-aka", text: "Also " + names.join(", ") }));
      if (r.mon) {
        body.appendChild(el("p", { class: "pv-dp-mon" }, [
          el("a", { href: "../actors/" + r.mon.id + ".html", text: "Followed by PopuliVerse Monitor" }),
          ". " + r.mon.items + (r.mon.items === 1 ? " item" : " items") + "." + (r.mon.power ? " " + POWER[r.mon.power] + " today, as of " + MON.issue + "." : "")
        ]));
      }
      markBlock(body, r);
      if (r.k === "leader") { gpdSection(body, r); if (party) partyBlock(body, r, party); else body.appendChild(el("p", { class: "pv-dp-note", text: "Party Facts does not link this leader's party, so no party verdict is shown." })); }
      else { popuSection(body, r); gpsSection(body, r); gpdSection(body, r); vpSection(body, r); }
      moreSection(body, r, party);
    }, r.id);
  }

  function markBlock(body, r) {
    var p, t;
    if (r.m === "agree") { p = PV.pill("The datasets agree", "is-agree"); t = "Every dataset that speaks for the same years gives the same verdict."; }
    else if (r.m === "differ") { p = PV.pill("The datasets differ in " + years(r.md), "is-differ"); t = "In these years one dataset says populist and another says not. PopuliVerse does not settle it."; }
    else { p = PV.pill("One dataset only", "is-out"); t = "No two datasets speak for the same years, so there is nothing to compare."; }
    var how = r.k === "leader"
      ? "Compared here: the leader's speeches in each term, with the party's verdicts in the same years."
      : "Compared here: The PopuList, the survey of 2019 and the speeches of the party's leaders in office, year by year. A borderline year of The PopuList counts as populist. V-Party is shown and not counted.";
    body.appendChild(el("div", { class: "pv-dp-mark" }, [p, el("p", { text: t + " " + how })]));
  }

  function popuSection(body, p, isParty) {
    var kids = [];
    if (p.pl) {
      p.pl.forEach(function (e) {
        kids.push(el("p", { class: "pv-dp-strong", text: [e.n, e.s, e.o].filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(" · ") }));
        kids.push(el("ul", { class: "pv-dp-list" }, popuText(e).map(function (t) { return el("li", { text: t }); })));
        if (e.parl) kids.push(el("p", { class: "pv-dp-note", text: "In parliament after its latest election, as The PopuList marks it." }));
        if (e.lk) kids.push(el("p", { class: "pv-dp-note pv-dp-linked", text: PV.linkText(e.lk, D.links) }));
      });
      kids.push(miniPopu(p));
    } else if (POPU_COUNTRIES[p.c]) {
      kids.push(el("p", { text: "No entry under this party's Party Facts ID. The PopuList lists the parties it classes as populist, far left or far right, if they won a seat or 2 per cent of the vote in a national election since 1989. A party without an entry is most likely none of these by its count. The match rests on an ID, which can fail, so this page does not count it as a verdict." }));
    } else kids.push(el("p", { class: "pv-dp-note", text: "Not covered. The PopuList holds 31 European countries." }));
    PV.section(body, isParty ? "The PopuList 4.0, for the party" : "The PopuList 4.0", kids);
  }

  function miniPopu(p) {
    var W = 360, H = 30, x0 = 1989, x1 = 2026;
    var x = function (y) { return 2 + (W - 4) * (y - x0) / (x1 + 1 - x0); };
    var s = '<svg width="100%" viewBox="0 0 ' + W + " " + H + '" class="pv-dp-svg" role="img" aria-label="Years The PopuList classes it as populist">' + PV.defsText("-m");
    s += '<rect x="' + x(x0) + '" y="2" width="' + (x(x1 + 1) - x(x0)) + '" height="10" fill="' + PV.colour.none + '"/>';
    p.pl.forEach(function (e) {
      var v = e.sets.p;
      if (!v || !v.y) return;
      var a = Math.max(x0, v.y[0]), b = Math.min(x1, v.y[1]);
      s += '<rect x="' + x(a) + '" y="2" width="' + (x(b + 1) - x(a)) + '" height="10" fill="' + (v.bl ? "url(#pv-bl3-m)" : PV.colour.p3) + '"/>';
      if (v.bl && v.nb && v.nb[0] < 2100) {
        var a2 = Math.max(x0, v.nb[0]), b2 = Math.min(x1, v.nb[1]);
        s += '<rect x="' + x(a2) + '" y="2" width="' + (x(b2 + 1) - x(a2)) + '" height="10" fill="' + PV.colour.p3 + '"/>';
      }
    });
    [1989, 2000, 2010, 2020].forEach(function (y) { s += '<text x="' + x(y) + '" y="27" font-size="9" fill="#4A4A4A">' + y + "</text>"; });
    s += "</svg>";
    var d = el("div", { class: "pv-dp-chart" });
    d.innerHTML = s;
    d.appendChild(el("p", { class: "pv-dp-note", text: "Dark, populist. Striped, borderline. Grey, not populist." }));
    return d;
  }

  function gpsSection(body, p, isParty) {
    var kids = [];
    if (p.gs) {
      var v = PV.verdict.gps(p.gs.t);
      kids.push(el("p", {}, [PV.pill(v.label, v.cls)]));
      kids.push(bar("Populist rhetoric, 0 pluralist to 10 populist", p.gs.rh, 10));
      kids.push(bar("How much it matters to the party, 0 to 10", p.gs.sal, 10));
      kids.push(el("p", { class: "pv-dp-note", text: "The survey asked experts in 2019. Its four categories are its own. Taken as V-Party carries it." }));
    } else kids.push(el("p", { class: "pv-dp-note", text: "Not in the copy used. Here the survey is read from V-Party's file, which carries about half of its 1,043 parties. The survey itself may hold this party." }));
    PV.section(body, isParty ? "Global Party Survey 2019, for the party" : "Global Party Survey 2019", kids);
  }

  function bar(label, v, max) {
    var w = v === null || v === undefined ? 0 : Math.max(0, Math.min(1, v / max)) * 100;
    return el("div", { class: "pv-dp-bar" }, [
      el("span", { class: "pv-dp-bar-l", text: label }),
      el("span", { class: "pv-dp-bar-t" }, [el("span", { class: "pv-dp-bar-f", style: "width:" + w.toFixed(1) + "%" })]),
      el("span", { class: "pv-dp-bar-v", text: v === null || v === undefined ? "none" : PV.num(v, 1) })
    ]);
  }

  function gpdSection(body, r) {
    var ts = termsOf(r);
    var kids = [];
    if (!ts.length) {
      kids.push(el("p", { class: "pv-dp-note", text: r.k === "party" ? "None of the party's leaders is in the database, or Party Facts does not link them to it." : "No term." }));
    } else {
      var tb = el("table", { class: "pv-dp-table" }, [el("thead", {}, [el("tr", {}, [
        el("th", { text: r.k === "party" ? "Leader and term" : "Term" }), el("th", { text: "Average" }), el("th", { text: "In the paper's words" }), el("th", { text: "The four speeches" })
      ])])]);
      var b = el("tbody");
      var anyCur = false, links = [];
      ts.forEach(function (t) {
        var v = PV.verdict.gpd(t.g);
        var who = r.k === "party" ? el("button", { type: "button", class: "pv-dp-link", text: t.leader.n }) : null;
        if (who) who.addEventListener("click", function () { openRow(t.leader); });
        if (t.cur) anyCur = true;
        if (t.lk && links.indexOf(t.lk) < 0) links.push(t.lk);
        b.appendChild(el("tr", {}, [
          el("td", {}, [who, who ? el("br") : null, (t.start ? PV.month(t.start) : t.yb) + (t.cur ? " on, current in the file" : " to " + (t.end ? PV.month(t.end) : t.ye))]),
          el("td", { text: PV.num(t.avg) }),
          el("td", {}, [v ? PV.pill(v.label, v.cls, v.long) : "none"]),
          el("td", {}, [speeches(t.sp)])
        ]));
      });
      tb.appendChild(b);
      kids.push(el("div", { class: "pv-wc-scroll" }, [tb]));
      kids.push(el("p", { class: "pv-dp-note", text: "Each speech is graded from 0 to 2 and the term's average is shown. The words are those of the database's paper (Hawkins et al. 2019): below 0.5 not populist, 0.5 to 0.99 somewhat populist, 1.0 to 1.49 populist, 1.5 and above very populist. On this page a term counts as populist from 0.5. The speeches are a campaign speech, a famous one, an international one and a ribbon cutting." }));
      if (anyCur) kids.push(el("p", { class: "pv-dp-note", text: "“Current” is the word of the database's file of " + fileMonth() + ". It says nothing about today." }));
      links.forEach(function (n) { kids.push(el("p", { class: "pv-dp-note pv-dp-linked", text: PV.linkText(n, D.links) })); });
    }
    PV.section(body, "Global Populism Database 2.1", kids);
  }

  function speeches(sp) {
    var names = ["Campaign", "Famous", "International", "Ribbon cutting"];
    var box = el("span", { class: "pv-dp-sp" });
    (sp || []).forEach(function (v, i) {
      var h = v === null ? 0 : Math.max(2, 20 * v / 2);
      box.appendChild(el("span", { class: "pv-dp-sp-b" + (v === null ? " is-none" : ""), title: names[i] + " speech, " + (v === null ? "none" : PV.num(v)), style: "height:" + h.toFixed(1) + "px" }));
    });
    return box;
  }

  function vpSection(body, p, isParty) {
    var kids = [];
    var els = [];
    (p.vp || []).forEach(function (v) { v.el.forEach(function (e) { if (e[1] !== null) els.push({ e: e, n: v.n }); }); });
    if (!els.length) {
      kids.push(el("p", { class: "pv-dp-note", text: "Not covered." }));
    } else {
      els.sort(function (a, b) { return a.e[0] - b.e[0]; });
      kids.push(vpChart(els));
      var gov = { 0: "senior partner in government", 1: "junior partner in government", 2: "supports the government from outside", 3: "in opposition" };
      var last = els[els.length - 1].e;
      kids.push(el("p", { text: "Latest, " + last[0] + ". Score " + PV.num(last[1]) + ", likely between " + PV.num(last[2]) + " and " + PV.num(last[3]) + (last[4] !== null ? ". Vote " + PV.num(last[4], 1) + " per cent" : "") + (gov[last[5]] ? ". After the election, " + gov[last[5]] : "") + "." }));
      if ((p.vp || []).length > 1) kids.push(el("p", { class: "pv-dp-note", text: "V-Party holds more than one entry under this Party Facts ID: " + p.vp.map(function (v) { return v.n; }).join(", ") + "." }));
      kids.push(el("p", { class: "pv-dp-note", text: "A score from 0 to 1, from many experts, with the range it likely lies in. V-Party gives no category, so the score is not a verdict and is never counted. V-Dem publishes its data under CC BY-SA 4.0." }));
    }
    PV.section(body, isParty ? "V-Party, for the party" : "V-Party", kids);
  }

  function vpChart(els) {
    var W = 360, H = 120, x0 = Math.min(1970, els[0].e[0]), x1 = 2020;
    var x = function (y) { return 26 + (W - 34) * (y - x0) / (x1 - x0); };
    var y = function (v) { return H - 18 - (H - 30) * v; };
    var s = '<svg width="100%" viewBox="0 0 ' + W + " " + H + '" class="pv-dp-svg" role="img" aria-label="V-Party populism score at each election">';
    [0, 0.5, 1].forEach(function (t) { s += '<line x1="26" x2="' + (W - 6) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="#E4E2DC"/><text x="0" y="' + (y(t) + 3) + '" font-size="9" fill="#4A4A4A">' + t + "</text>"; });
    [1970, 1990, 2010].forEach(function (t) { if (t >= x0) s += '<text x="' + x(t) + '" y="' + (H - 4) + '" font-size="9" fill="#4A4A4A" text-anchor="middle">' + t + "</text>"; });
    var path = els.map(function (o, i) { return (i ? "L" : "M") + x(o.e[0]).toFixed(1) + "," + y(o.e[1]).toFixed(1); }).join("");
    s += '<path d="' + path + '" fill="none" stroke="#4A4A4A" stroke-width="1.5"/>';
    els.forEach(function (o) {
      var e = o.e;
      if (e[2] !== null && e[3] !== null) s += '<line x1="' + x(e[0]) + '" x2="' + x(e[0]) + '" y1="' + y(e[2]) + '" y2="' + y(e[3]) + '" stroke="#B9B8B4" stroke-width="3"/>';
      s += '<circle cx="' + x(e[0]) + '" cy="' + y(e[1]) + '" r="3.5" fill="#111" stroke="#FCFCFB" stroke-width="1.5"><title>' + e[0] + ": " + PV.num(e[1]) + " (" + PV.num(e[2]) + " to " + PV.num(e[3]) + ")</title></circle>";
    });
    s += "</svg>";
    var d = el("div", { class: "pv-dp-chart" });
    d.innerHTML = s;
    return d;
  }

  function partyBlock(body, r, party) {
    var lk = partyLink(r);
    var head = el("p", { class: "pv-dp-party" }, ["The party in the datasets ", (function () {
      var b = el("button", { type: "button", class: "pv-dp-link", text: party.n });
      b.addEventListener("click", function () { openRow(party); });
      return b;
    })(), lk ? ". " + PV.linkText(lk, D.links) : ". Party Facts links it to the leader's latest term."]);
    body.appendChild(head);
    popuSection(body, party, true);
    gpsSection(body, party, true);
    vpSection(body, party, true);
  }

  function moreSection(body, r, party) {
    var p = r.k === "leader" ? party : r;
    var kids = [];
    if (p && p.pf) kids.push(el("p", {}, ["Party Facts ID ", el("a", { href: "https://partyfacts.herokuapp.com/data/partycodes/" + p.pf + "/", text: String(p.pf) }), ", the ID that links the datasets."]));
    if (r.c) kids.push(el("p", {}, [el("a", { href: "in-power.html#" + r.c, text: (r.cl || "The country") + " in Populists in Power" })]));
    var q = r.k === "leader" ? r.n.split(" ").slice(-1)[0] : (r.s && r.s.length > 2 ? r.s : r.n);
    kids.push(el("p", {}, [el("a", { href: "../library/index.html?search=" + encodeURIComponent(q), text: "Works in the Library that name " + q })]));
    var dl = el("button", { type: "button", class: "pv-lib-link", text: "Download this row (CSV)" });
    dl.addEventListener("click", function () {
      PV.save.csv("populiverse-" + r.id + ".csv", [CSV_HEAD, rowCsv(r), [], ["Sources and licences: https://populiverse.com/data/sources.txt. Every verdict is the dataset's own."], [PV.citation(PAGE_TITLE, PAGE_URL)]]);
    });
    var link = el("button", { type: "button", class: "pv-lib-link", text: "Copy the link" });
    link.addEventListener("click", function () { PV.copy(PAGE_URL + "#" + r.id, link); });
    kids.push(el("p", { class: "pv-lib-tools" }, [dl, link]));
    var cites = [];
    var src = D.sources;
    if ((p && p.pl) || (r.k === "party" && POPU_COUNTRIES[r.c])) cites.push(src.pl);
    if (r.gs || (p && p.gs)) cites.push(src.gs);
    if (termsOf(r).length) cites.push(src.gd);
    if (p && p.vp) cites.push(src.vp);
    if (p && p.pf) cites.push(src.pf);
    if (cites.length) {
      kids.push(el("p", { class: "pv-dp-strong", text: "Cite the datasets" }));
      kids.push(el("ul", { class: "pv-dp-cites" }, PV.citeItems(cites)));
    }
    kids.push(el("p", { class: "pv-dp-note", text: "Found an error? Write to editor@populiverse.com and name this page and the row " + r.id + "." }));
    PV.section(body, "More", kids);
  }
})();
