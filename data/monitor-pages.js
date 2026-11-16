/* PopuliVerse: "Actors in Monitor" and "Countries in Monitor", and the upper part
   of each actor's and each country's page. Reads monitor.json, which
   scripts/make_pages.py writes at every build: the actors (with the source that
   classes each, who holds power today and what the datasets say, in short), the
   items with their dates and types, and the countries. Every verdict shown is
   the dataset's own. Without JavaScript the plain pages stay as they are.

   On the two lists the cards come 20 at a time, with a button for the next 20,
   and a period filter stands first, "Last 12 months", counted back from the
   month of the latest issue. The period narrows everything on the page: the
   numbers, the dots, the bars, the map, the order and the downloads. Every
   actor and every country stays in the list; a card with nothing in the period
   says so. */

(function () {
  "use strict";

  var PV = window.PVData;
  var host = document.getElementById("ma-app");
  var ones = document.querySelectorAll(".pv-ma-one");
  if (!PV || (!host && !ones.length)) return;
  var el = PV.el;
  var SITE = "https://populiverse.com/";

  // The 14 event types of the Monitor in their six families, and "Other"
  var FAM = {
    "Election": "Votes", "Referendum": "Votes", "Campaign": "Votes", "Office": "Office and Party", "Party": "Office and Party",
    "Law": "Rules", "Measure": "Rules", "Court": "Justice", "Police and Prosecutors": "Justice",
    "Diplomacy": "Abroad", "Agreement": "Abroad", "Sanctions and Trade": "Abroad", "Armed Forces": "Abroad", "Protest": "Street"
  };
  var FAMS = ["Votes", "Office and Party", "Rules", "Justice", "Abroad", "Street", "Other"];
  var FC = { "Votes": "#111111", "Office and Party": "#B08D57", "Rules": "#6E8790", "Justice": "#8A5A2B", "Abroad": "#27485A", "Street": "#C9B48A", "Other": "#BDBBB4" };
  var REG = { "europe": "Europe", "latin-america": "Latin America", "north-america": "North America", "asia-pacific": "Asia-Pacific", "mena": "Middle East and North Africa", "sub-saharan-africa": "Sub-Saharan Africa" };
  var POWER = { leads: "Leads the government", partner: "Partner in government", supports: "Supports from outside" };
  var SHADE = ["#F1EFEA", "#C5D0D3", "#8FA3A9", "#4A5F66", "#1D2B30"];
  // The cards of a list, 20 at a time, and the periods, the first one first
  var STEP = 20;
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var PERIODS = [["12", "Last 12 months"], ["6", "Last 6 months"], ["24", "Last 24 months"], ["all", "All time"]];

  var M = null, ACTORS = [], PLACES = [], BYISO = {}, T0 = 0, T1 = 1, MONTHS = [];
  // ALL holds every month the Monitor has, MONTHS the months of the period in
  // view, ITEMS the items of that period, WORLD the map file
  var ALL = [], ITEMS = [], PERIOD = "", WORLD = null;

  // The map file is read together with the Monitor's data, not after it, so that
  // the map stands as soon as the cards do.
  var mapUrl = host && window.d3 && window.topojson ? host.getAttribute("data-map") : "";
  var jobs = [PV.load((host || ones[0]).getAttribute("data-monitor"))];
  if (mapUrl) jobs.push(PV.load(mapUrl).catch(function () { return null; }));
  Promise.all(jobs).then(function (res) {
    M = res[0];
    WORLD = res[1] || null;
    prepare();
    if (host) (host.getAttribute("data-kind") === "countries" ? countries : actors)();
    Array.prototype.forEach.call(ones, one);
  }).catch(function () {
    if (host) { host.innerHTML = ""; host.appendChild(el("p", { class: "pv-lib-nomatch", text: "The cards could not be loaded. The full list is below." })); }
  });

  // ============================================================ the data

  function fam(t) { return FAM[t] || "Other"; }
  function day(d) { return Date.parse(d.length === 7 ? d + "-15" : d) / 86400000; }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.n - b.n; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function heading(it) { return (it.k === "entry" ? "Also this month: " : "") + it.title; }
  function when(d) { return d.length === 7 ? PV.month(d) : PV.date(d); }
  function itemLink(it) { return "../monitor/" + it.folder + "/index.html#item-" + it.n; }
  function cut(s, n) { return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; }

  function prepare() {
    M.items.sort(byDate);
    ACTORS = M.actors.map(function (a) {
      var p = M.places[a.iso];
      a.reg = p ? p[2] : "";
      a.all = M.items.filter(function (it) { return it.actors.indexOf(a.id) >= 0; });
      a.find = PV.fold([a.name, a.c, a.src, REG[a.reg] || ""].join(" "));
      return a;
    });
    Object.keys(M.places).forEach(function (iso) {
      var p = M.places[iso];
      var c = { iso: iso, name: p[0], num: p[1], reg: p[2], lon: p[3], lat: p[4], dot: p[5], tag: p[6] };
      c.works = (M.works && M.works[iso]) || 0;
      c.all = M.items.filter(function (it) { return it.iso.indexOf(iso) >= 0; });
      c.actors = ACTORS.filter(function (a) { return a.iso === iso; });
      c.power = c.actors.filter(function (a) { return a.power; });
      c.find = PV.fold([c.name, REG[c.reg] || ""].concat(c.actors.map(function (a) { return a.name; })).join(" "));
      BYISO[iso] = c;
      PLACES.push(c);
    });
    // The time axis: from the first month with an item to the last, so it grows with the Monitor
    if (M.items.length) {
      var a = M.items[0].date.slice(0, 7), b = M.items[M.items.length - 1].date.slice(0, 7);
      var y = +a.slice(0, 4), mo = +a.slice(5, 7);
      while (true) {
        var key = y + "-" + (mo < 10 ? "0" : "") + mo;
        ALL.push(key);
        if (key >= b) break;
        mo += 1; if (mo > 12) { mo = 1; y += 1; }
      }
    }
    applyPeriod("");
  }

  function monthsBack(key, n) {
    var y = +key.slice(0, 4), mo = +key.slice(5, 7) - (n - 1);
    while (mo < 1) { mo += 12; y -= 1; }
    return y + "-" + (mo < 10 ? "0" : "") + mo;
  }

  // The period in view. "" is all time. A period is counted back from the month
  // of the latest issue, not from today, so that a late issue never empties the
  // page. The axis covers the months of the period that the Monitor has.
  function applyPeriod(p) {
    // "all" and not an empty value, so that the address of the page carries it
    PERIOD = /^\d+$/.test(p || "") ? p : "";
    var cut = PERIOD && ALL.length ? monthsBack(ALL[ALL.length - 1], +PERIOD) : "";
    var keep = function (it) { return !cut || it.date.slice(0, 7) >= cut; };
    ITEMS = M.items.filter(keep);
    ACTORS.forEach(function (a) { a.its = a.all.filter(keep); });
    PLACES.forEach(function (c) { c.its = c.all.filter(keep); });
    MONTHS = ALL.filter(function (m) { return !cut || m >= cut; });
    if (MONTHS.length) {
      T0 = day(MONTHS[0] + "-01");
      var last = MONTHS[MONTHS.length - 1], ly = +last.slice(0, 4), lm = +last.slice(5, 7);
      T1 = Date.UTC(lm === 12 ? ly + 1 : ly, lm === 12 ? 0 : lm, 1) / 86400000;
    }
  }

  // The period in words, for a downloaded file
  function periodNote() {
    return (PERIOD ? "The items counted are those of the last " + PERIOD + " months, " : "The items counted are those of all time, ") + span() + ".";
  }

  function span() { return MONTHS.length ? PV.month(MONTHS[0]) + (MONTHS.length > 1 ? " to " + PV.month(MONTHS[MONTHS.length - 1]) : "") : ""; }

  // ============================================================ small pieces

  function label(text) { return el("span", { class: "pv-ma-label", text: text }); }

  function powerPill(pw) {
    if (!pw) return PV.pill("Not in government", "is-out");
    return PV.pill(POWER[pw], pw === "leads" ? "is-p3" : pw === "partner" ? "is-p2" : "is-p1", "Today, as of PopuliVerse Monitor " + M.issue);
  }

  function popuPill(word) {
    return PV.pill(word, word === "Populist" ? "is-p3" : word === "Borderline" ? "is-p2" : word === "Not populist" ? "is-no" : "is-p1");
  }

  function datasets(a, wide) {
    // What the datasets say, in short: each in its own words
    var d = a.ds || {}, rows = [];
    if (d.pl) rows.push(el("div", { class: "pv-ma-ds" }, [label("The PopuList"), popuPill(d.pl), wide ? el("span", { class: "pv-ma-dim", text: a.kind === "leader" ? "for the party, as of 2026" : "as of 2026" }) : null]));
    if (d.gd) {
      var v = PV.verdict.gpd(d.gd[3]);
      rows.push(el("div", { class: "pv-ma-ds" }, [label("Speeches"), PV.pill(v.label, v.cls, v.long),
        el("span", { class: "pv-ma-dim", text: PV.num(d.gd[2]) + " · " + d.gd[0] + (d.gd[4] ? " on" : " to " + d.gd[1]) + (wide ? ", the last term the Global Populism Database graded" : "") })]));
    }
    if (d.vp) rows.push(el("div", { class: "pv-ma-ds" }, [label("V-Party"),
      el("span", { class: "pv-ma-meter", title: "A score from 0 to 1, not a verdict" }, [el("span", { style: "width:" + Math.round(d.vp[1] * 100) + "%" })]),
      el("span", { class: "pv-ma-dim", text: PV.num(d.vp[1]) + " in " + d.vp[0] + (wide ? (a.kind === "leader" ? ", for the party" : "") + ". A score, not a verdict" : "") })]));
    if (!rows.length) rows.push(el("p", { class: "pv-ma-dim", text: a.data ? "The datasets hold no verdict to show." : "Not in the four datasets. On the list by a study." }));
    return el("div", { class: "pv-ma-dsbox" }, rows);
  }

  function strip(items, w, h, r, names) {
    // The items over time, one dot each, on the day of the action that gives the
    // type. Dots of the same or nearby days stand in a column and never cover each
    // other; the months are named under the line; a dot opens its item.
    w = w || 240; h = h || 26; r = r || 4;
    names = names !== false;
    var gap = 2 * r + 1, fs = Math.max(7, Math.round(r * 2));
    var x = function (d) { return r + 2 + (w - 2 * r - 4) * (day(d) - T0) / (T1 - T0); };
    var placed = [], top = 0;
    items.forEach(function (it) {
      var cx = x(it.date), lv = 0;
      while (placed.some(function (p) { return p.lv === lv && Math.abs(p.cx - cx) < gap; })) lv += 1;
      placed.push({ it: it, cx: cx, lv: lv });
      if (lv > top) top = lv;
    });
    var line = Math.max(h - r - 2, top * gap + r + 2);
    var height = line + r + 2 + (names ? fs + 4 : 0);
    var s = '<svg viewBox="0 0 ' + w + " " + height.toFixed(1) + '" width="100%" role="group" aria-label="' + plural(items.length, "Monitor item", "Monitor items") + ", " + PV.esc(span()) + '">' +
      '<line x1="0" x2="' + w + '" y1="' + line + '" y2="' + line + '" stroke="#D9D9D6"/>';
    var colW = (w - 2 * r - 4) / Math.max(1, MONTHS.length), every = Math.max(1, Math.ceil(fs * 4.6 / colW));
    MONTHS.forEach(function (m, i) {
      var x0 = x(m + "-01");
      if (i) s += '<line x1="' + x0.toFixed(1) + '" x2="' + x0.toFixed(1) + '" y1="1" y2="' + (line + r + 1) + '" stroke="#D9D9D6"/>';
      if (!names || i % every) return;
      var label = SHORT[+m.slice(5, 7) - 1] + (i === 0 || m.slice(5, 7) === "01" ? " " + m.slice(0, 4) : "");
      s += '<text x="' + (x0 + 2).toFixed(1) + '" y="' + (height - 3).toFixed(1) + '" font-size="' + fs + '" fill="#6B6B66">' + label + "</text>";
    });
    placed.forEach(function (p) {
      var it = p.it, tip = PV.esc(when(it.date) + " · " + it.type + " · " + heading(it));
      // A dot is not a link element, because the site's menu script reads every
      // link of the page as text; a click on the dot opens the item instead
      s += '<circle class="is-link" data-href="' + itemLink(it) + '" cx="' + p.cx.toFixed(1) + '" cy="' + (line - p.lv * gap).toFixed(1) +
        '" r="' + r + '" fill="' + FC[fam(it.type)] + '" stroke="#FCFCFB"><title>' + tip + "</title></circle>";
    });
    var d = el("div", { class: "pv-ma-strip" });
    d.innerHTML = s + "</svg>";
    d.addEventListener("click", function (e) {
      var href = e.target && e.target.getAttribute ? e.target.getAttribute("data-href") : null;
      if (href) window.location.href = href;
    });
    return d;
  }

  function counts(items) {
    var c = {};
    items.forEach(function (it) { c[fam(it.type)] = (c[fam(it.type)] || 0) + 1; });
    return c;
  }

  function typeBar(items) {
    var c = counts(items);
    var words = FAMS.filter(function (k) { return c[k]; }).map(function (k) { return k + " " + c[k]; }).join(", ");
    return el("div", { class: "pv-ma-bar", role: "img", "aria-label": "Kinds of news: " + words, title: words },
      FAMS.filter(function (k) { return c[k]; }).map(function (k) { return el("span", { style: "flex:" + c[k] + " 1 0;background:" + FC[k] }); }));
  }

  function legend() {
    return el("p", { class: "pv-ma-legend" }, [label("Kinds of news")].concat(FAMS.map(function (k) {
      return el("span", { class: "pv-key" }, [el("span", { class: "pv-ma-dotkey", style: "background:" + FC[k] }), k]);
    })));
  }

  function inMonitor(items) {
    var none = PERIOD ? "No item in this period" : "No item yet";
    var kids = [el("div", { class: "pv-ma-row" }, [label("In the Monitor"),
      el("span", { text: items.length ? plural(items.length, "item", "items") : none })])];
    if (items.length) {
      var last = items[items.length - 1];
      kids.push(strip(items), typeBar(items),
        el("p", { class: "pv-ma-latest" }, [el("span", { class: "pv-ma-dim", text: when(last.date) + " · " }), el("a", { href: itemLink(last), text: cut(heading(last), 96) })]));
    }
    return kids;
  }

  function tiles(list, apply) {
    return el("div", { class: "pv-wc-stats" }, list.map(function (t) {
      var b = el("button", { type: "button", class: "pv-wc-stat" }, [el("span", { class: "pv-wc-stat-n", text: String(t[0]) }), el("span", { class: "pv-wc-stat-l", text: t[1] })]);
      b.addEventListener("click", function () { apply(t[2]); });
      return b;
    }));
  }

  function countText(n, total, one, many, shown) {
    return plural(n, one, many) + (n < total ? " of " + total : "") +
      (shown && shown < n ? ", showing the first " + shown : "");
  }

  function more(left, fn) {
    var b = el("button", { type: "button", class: "pv-button pv-wc-more", text: "Show " + Math.min(STEP, left) + " more" });
    b.addEventListener("click", fn);
    return b;
  }

  function tool(text, fn) {
    var b = el("button", { type: "button", class: "pv-lib-link", text: text });
    b.addEventListener("click", function () { fn(b); });
    return b;
  }

  function itemsCsv(name, items) {
    var rows = [["issue", "item", "date", "type", "family", "heading", "countries", "actors", "link"]];
    items.forEach(function (it) {
      rows.push([it.issue, it.n, it.date, it.type, fam(it.type), heading(it), it.iso.join("; "), it.actors.join("; "), SITE + "monitor/" + it.folder + "/#item-" + it.n]);
    });
    rows.push([], ["PopuliVerse Monitor, issues to " + M.issue + ". The date is the day of the action that gives the type. Please cite the issue of each item."]);
    PV.save.csv(name, rows);
  }

  function sourceLines() {
    return ["Source: PopuliVerse Monitor, issues to " + M.issue + " (populiverse.com/monitor). An actor is on the Monitor's list when a dataset or a study classes it as populist; the source stands on its page.",
      "A dot is one item, on the day of the action that gives its type. Licence of this picture: CC BY 4.0."];
  }

  // The controls shared by the two lists: search, selects, the address of the view
  function Controls(defaults, onChange) {
    var S = Object.assign({}, defaults), st = PV.state.get(), f = {};
    Object.keys(S).forEach(function (k) { if (st[k] !== undefined) S[k] = st[k]; });
    var q = el("input", { type: "search", id: "ma-q", autocomplete: "off", value: S.q });
    q.addEventListener("input", function () { S.q = q.value; onChange(); });
    return {
      S: S,
      search: function (placeholder) {
        q.setAttribute("placeholder", placeholder);
        return el("div", { class: "pv-wc-search" }, [el("label", { for: "ma-q", class: "pv-wc-label", text: "Search" }), q]);
      },
      select: function (key, text, opts) {
        var s = el("select", { id: "ma-" + key });
        opts.forEach(function (o) { s.appendChild(el("option", { value: o[0], text: o[1] })); });
        s.value = S[key];
        s.addEventListener("change", function () { S[key] = s.value; onChange(); });
        f[key] = s;
        return el("div", { class: "pv-wc-field" }, [el("label", { for: "ma-" + key, class: "pv-wc-label", text: text }), s]);
      },
      reset: function (set) {
        Object.keys(defaults).forEach(function (k) { if (k !== "view" && k !== "sort" && k !== "map") S[k] = defaults[k]; });
        Object.keys(set || {}).forEach(function (k) { S[k] = set[k]; });
        Object.keys(f).forEach(function (k) { f[k].value = S[k]; });
        q.value = S.q;
        onChange();
      },
      save: function () {
        var keep = {};
        Object.keys(S).forEach(function (k) { if (S[k] !== defaults[k]) keep[k] = S[k]; });
        PV.state.set(keep);
      },
      words: function () { return PV.fold(S.q).trim().split(/\s+/).filter(Boolean); }
    };
  }

  function has(find, q) { for (var i = 0; i < q.length; i++) if (find.indexOf(q[i]) < 0) return false; return true; }

  // ============================================================ Actors in Monitor

  function actors() {
    var TITLE = "Actors in Monitor", URL = SITE + "actors/";
    var ui = {}, list = [], shown = STEP;
    var C = Controls({ q: "", period: "12", kind: "", region: "", country: "", power: "", src: "", fam: "", sort: "items", view: "cards" }, run), S = C.S;
    var srcs = {}, lands = {}, regs = {};
    ACTORS.forEach(function (a) { srcs[a.src] = 1; lands[a.iso] = a.c; if (a.reg) regs[a.reg] = 1; });
    host.innerHTML = "";
    ui.stats = el("div");
    host.appendChild(ui.stats);
    host.appendChild(C.search("An actor or a country"));
    host.appendChild(el("div", { class: "pv-wc-filters" }, [
      C.select("period", "Period", PERIODS),
      C.select("kind", "Parties or leaders", [["", "Both"], ["party", "Parties"], ["leader", "Leaders"]]),
      C.select("region", "Region", [["", "All regions"]].concat(Object.keys(REG).filter(function (k) { return regs[k]; }).map(function (k) { return [k, REG[k]]; }))),
      C.select("country", "Country", [["", "All countries"]].concat(Object.keys(lands).sort(function (a, b) { return lands[a].localeCompare(lands[b]); }).map(function (k) { return [k, lands[k]]; }))),
      C.select("power", "Power today", [["", "All"], ["any", "In power today"], ["leads", "Leads the government"], ["partner", "Partner in government"], ["none", "Not in government"]]),
      C.select("src", "On the list by", [["", "Any source"]].concat(Object.keys(srcs).sort().map(function (k) { return [k, k]; }))),
      C.select("fam", "Kind of news", [["", "Any"]].concat(FAMS.map(function (k) { return [k, k]; }))),
      C.select("sort", "Order", [["items", "Most reported first"], ["name", "Name"], ["country", "Country, then name"], ["latest", "Latest item first"]])
    ]));
    ui.tabs = el("div", { class: "pv-wc-tabs", role: "tablist" }, [["cards", "Cards"], ["table", "Table"], ["timeline", "Timeline"]].map(function (v) {
      var b = el("button", { type: "button", role: "tab", class: "pv-wc-tab", "data-view": v[0], text: v[1] });
      b.addEventListener("click", function () { S.view = v[0]; run(); });
      return b;
    }));
    ui.count = el("p", { class: "pv-wc-count", "aria-live": "polite" });
    ui.tools = PV.keepChart(el("div", { class: "pv-wc-tools" }), "view", "Actors in Monitor");
    host.appendChild(el("div", { class: "pv-wc-head" }, [ui.tabs, ui.count, ui.tools]));
    host.appendChild(legend());
    ui.view = el("div", { class: "pv-wc-view" });
    host.appendChild(ui.view);
    run();

    function stats() {
      ui.stats.innerHTML = "";
      ui.stats.appendChild(tiles([
        [ACTORS.length, "actors", {}],
        [ACTORS.filter(function (a) { return a.kind === "party"; }).length, "parties", { kind: "party" }],
        [ACTORS.filter(function (a) { return a.kind === "leader"; }).length, "leaders", { kind: "leader" }],
        [ACTORS.filter(function (a) { return a.power; }).length, "in power today", { power: "any" }],
        [ITEMS.length, ITEMS.length === 1 ? "Monitor item" : "Monitor items", {}]
      ], C.reset));
    }

    function run() {
      applyPeriod(S.period);
      var q = C.words();
      list = ACTORS.filter(function (a) {
        if (S.kind && a.kind !== S.kind) return false;
        if (S.region && a.reg !== S.region) return false;
        if (S.country && a.iso !== S.country) return false;
        if (S.power === "any" && !a.power) return false;
        if (S.power === "none" && a.power) return false;
        if ((S.power === "leads" || S.power === "partner") && a.power !== S.power) return false;
        if (S.src && a.src !== S.src) return false;
        if (S.fam && !counts(a.its)[S.fam]) return false;
        return has(a.find, q);
      });
      var latest = function (a) { return a.its.length ? a.its[a.its.length - 1].date : ""; };
      list.sort({
        items: function (a, b) { return b.its.length - a.its.length || a.name.localeCompare(b.name); },
        name: function (a, b) { return a.name.localeCompare(b.name); },
        country: function (a, b) { return a.c.localeCompare(b.c) || a.name.localeCompare(b.name); },
        latest: function (a, b) { return latest(b).localeCompare(latest(a)) || a.name.localeCompare(b.name); }
      }[S.sort]);
      C.save();
      stats();
      Array.prototype.forEach.call(ui.tabs.children, function (b) {
        var on = b.getAttribute("data-view") === S.view;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      ui.tools.innerHTML = "";
      // A saved view carries its filters in its name, as Events in Monitor
      // does, so that two saved views of different filters are told apart on
      // the shelf (Fable's re-check of the trial build, point 4d).
      // The name also says which view it is, and the period when it is not
      // the usual one, since each of these is its own row on the shelf
      // (Fable's check before the push of 16 November).
      var lead = [];
      if (S.view !== "cards") lead.push(S.view === "table" ? "Table" : "Timeline");
      if (S.period !== "12") lead.push(S.period === "all" ? "All Time" : "Last " + S.period + " Months");
      ui.tools.setAttribute("data-keep-title", "Actors in Monitor" + titleFilters(lead));
      ui.tools.appendChild(tool("Download the list (CSV)", listCsv));
      ui.tools.appendChild(tool("Their items (CSV)", function () { itemsCsv("populiverse-monitor-items.csv", ITEMS.filter(function (it) { return list.some(function (a) { return it.actors.indexOf(a.id) >= 0; }); })); }));
      var hasPicture = S.view === "timeline" && list.length > 0;
      if (hasPicture) {
        ui.tools.appendChild(tool("Picture (PNG)", function (b) { PV.save.picture(b, "populiverse-actors-timeline", "png", figure); }));
        ui.tools.appendChild(tool("Picture (SVG)", function (b) { PV.save.picture(b, "populiverse-actors-timeline", "svg", figure); }));
      }
      // The cards, the table and a view that nothing fits have no picture of
      // their own, so there the page forgets the timeline it drew before and
      // "Send to Write" is not offered (Fable's re-check, point 3).
      PV.figureMaker(ui.tools, hasPicture ? figure : null);
      ui.tools.appendChild(tool("Copy the link to this view", function (b) { PV.copy(window.location.href, b); }));
      shown = STEP;
      render();
    }

    // The cards come 20 at a time; the table and the timeline stand whole
    function render() {
      ui.count.textContent = countText(list.length, ACTORS.length, "actor", "actors", S.view === "cards" ? shown : 0);
      ui.view.innerHTML = "";
      if (!list.length) { ui.view.appendChild(el("p", { class: "pv-lib-nomatch", text: "Nothing fits these filters." })); return; }
      if (S.view === "table") table();
      else if (S.view === "timeline") {
        var box = el("div", { class: "pv-wc-scroll pv-wc-chartbox" });
        ui.view.appendChild(box);
        timeline(box, Math.max(760, ui.view.clientWidth || 900), list, false);
        ui.view.appendChild(el("p", { class: "pv-ma-dim", text: "A dot is one item, on the day of the action that gives its type. Point at a dot for its heading and click it to read the item. Click a name to open the actor." }));
      } else {
        ui.view.appendChild(el("div", { class: "pv-ma-grid" }, list.slice(0, shown).map(card)));
        if (list.length > shown) ui.view.appendChild(more(list.length - shown, function () { shown += STEP; render(); }));
      }
    }

    function card(a) {
      return el("article", { class: "pv-ma-card" }, [
        el("div", { class: "pv-ma-row" }, [label((a.kind === "leader" ? "Leader" : "Party") + " · " + a.c), powerPill(a.power)]),
        el("h3", {}, [el("a", { href: a.id + ".html", text: a.name })]),
        el("p", { class: "pv-ma-why", text: "On the Monitor's list by " + a.src + (a.bl ? ", as a borderline case" : "") }),
        datasets(a)
      ].concat(inMonitor(a.its)));
    }

    function table() {
      var tb = el("tbody");
      list.forEach(function (a) {
        var d = a.ds || {}, last = a.its[a.its.length - 1];
        tb.appendChild(el("tr", {}, [
          el("th", { scope: "row" }, [el("a", { class: "pv-wc-n", href: a.id + ".html", text: a.name }), el("span", { class: "pv-wc-meta", text: (a.kind === "leader" ? "Leader" : "Party") + " · " + a.c })]),
          el("td", { "data-label": "On the list by", text: a.src + (a.bl ? ", borderline" : "") }),
          el("td", { "data-label": "Power today" }, [powerPill(a.power)]),
          el("td", { "data-label": "The datasets" }, [datasets(a)]),
          el("td", { "data-label": "Items" }, [el("span", { text: String(a.its.length) }), strip(a.its, 150, 22, 3.5, false), typeBar(a.its)]),
          el("td", { "data-label": "Latest item" }, last ? [el("span", { class: "pv-ma-dim", text: when(last.date) + " · " }), el("a", { href: itemLink(last), text: cut(heading(last), 70) })] : [])
        ]));
      });
      ui.view.appendChild(el("div", { class: "pv-wc-scroll" }, [el("table", { class: "pv-wc-table pv-ma-table" }, [
        el("thead", {}, [el("tr", {}, ["Actor", "On the list by", "Power today", "The datasets", "Items", "Latest item"].map(function (h) { return el("th", { scope: "col", text: h }); }))]), tb])]));
    }

    function listCsv() {
      var rows = [["id", "name", "kind", "country", "country_code", "region", "on_the_list_by", "borderline", "power_today", "power_today_source",
        "popu_list_as_of_2026", "gpd_last_graded_term", "gpd_average", "gpd_in_the_papers_words", "vparty_year", "vparty_score", "items", "first_item", "latest_item", "page"]];
      list.forEach(function (a) {
        var d = a.ds || {};
        rows.push([a.id, a.name, a.kind, a.c, a.iso, REG[a.reg] || "", a.src, a.bl ? "yes" : "", a.power, a.why, d.pl || "",
          d.gd ? d.gd[0] + "-" + (d.gd[4] ? "current in the file" : d.gd[1]) : "", d.gd ? d.gd[2] : "", d.gd ? PV.verdict.gpd(d.gd[3]).label.toLowerCase() : "",
          d.vp ? d.vp[0] : "", d.vp ? d.vp[1] : "", a.its.length, a.its.length ? a.its[0].date : "", a.its.length ? a.its[a.its.length - 1].date : "", URL + a.id + ".html"]);
      });
      rows.push([], [periodNote()], ["Power today as of PopuliVerse Monitor " + M.issue + ". Every verdict is the dataset's own; for a leader, The PopuList and V-Party speak of the party. Sources and licences: " + SITE + "data/sources.txt"], [PV.citation(TITLE, URL)]);
      PV.save.csv("populiverse-actors-in-monitor.csv", rows);
    }

    // The filters in use, short, for the title of the picture: a figure of a
    // filtered view never carries the title of every actor (the live check
    // before the trial, point 3). The period stands in the title already.
    function titleFilters(lead) {
      var bits = lead ? lead.slice() : [];
      if (S.kind) bits.push(S.kind === "party" ? "Parties Only" : "Leaders Only");
      if (S.region) bits.push("Region: " + (REG[S.region] || S.region));
      if (S.country) bits.push("Country: " + (lands[S.country] || S.country));
      if (S.power) bits.push({ any: "In Power Today", leads: "Leading the Government", partner: "Partner in Government", none: "Not in Government" }[S.power] || S.power);
      if (S.src) bits.push("On the List by " + S.src);
      if (S.fam) bits.push("Kind of News: " + S.fam);
      if (S.q.trim()) bits.push("Search: \u201c" + S.q.trim() + "\u201d");
      return bits.length ? " (" + bits.join("; ") + ")" : "";
    }

    function figure() {
      var shown = list;
      return {
        host: host,
        chart: function (holder, w) { return timeline(holder, w, shown, true); },
        title: "The Actors in PopuliVerse Monitor, " + span() + titleFilters(),
        lines: [plural(shown.length, "actor", "actors") + (shown.length < ACTORS.length ? " of " + ACTORS.length : "") + ", each with its items in the Monitor. The number at the end of a row is the count of its items."],
        legend: FAMS.map(function (k) { return { fill: FC[k], dot: true, label: k }; }),
        notes: ["The kinds of news are the six families of the Monitor's event types, and Other."],
        sources: sourceLines(),
        cite: PV.citation(TITLE, URL)
      };
    }
  }

  function timeline(box, width, rows, pic) {
    // Every actor on one time axis; each dot an item
    var left = Math.min(300, Math.round(width * 0.3)), right = 34, rowH = 26, top = 46, H = top + rows.length * rowH + 8;
    var NS = "http://www.w3.org/2000/svg";
    var x = function (t) { return left + (width - left - right) * (t - T0) / (T1 - T0); };
    var svg = document.createElementNS(NS, "svg");
    function add(tag, attrs, text, parent) {
      var n = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      if (text !== undefined) n.textContent = text;
      (parent || svg).appendChild(n);
      return n;
    }
    svg.setAttribute("width", width); svg.setAttribute("height", H); svg.setAttribute("class", "pv-ma-tl"); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Monitor items of " + plural(rows.length, "actor", "actors") + ", " + span());
    MONTHS.forEach(function (m, i) {
      var a = x(day(m + "-01")), b = i + 1 < MONTHS.length ? x(day(MONTHS[i + 1] + "-01")) : x(T1);
      if (i % 2 === 0) add("rect", { x: a, y: top - 8, width: b - a, height: H - top + 8, fill: "#F4F3EF" });
      add("text", { x: a + 5, y: 12, class: "pv-tl-meta" }, PV.month(m));
      [8, 15, 22].forEach(function (d) {
        var t = x(day(m + "-" + (d < 10 ? "0" : "") + d));
        add("line", { x1: t, x2: t, y1: top - 8, y2: H, class: "pv-grid" });
        add("text", { x: t, y: top - 12, "text-anchor": "middle", class: "pv-tl-meta" }, String(d));
      });
    });
    rows.forEach(function (a, i) {
      var y = top + i * rowH + rowH / 2;
      add("line", { x1: 0, x2: width, y1: y + rowH / 2, y2: y + rowH / 2, class: "pv-grid" });
      var name = add("text", { x: 0, y: y + 4, class: "pv-tl-name" }, cut(a.name, left > 240 ? 30 : 22));
      add("text", { x: left - 10, y: y + 4, "text-anchor": "end", class: "pv-tl-meta" }, left > 240 ? a.c : a.iso);
      add("text", { x: width, y: y + 4, "text-anchor": "end", class: "pv-tl-meta" }, String(a.its.length));
      if (!pic) { name.style.cursor = "pointer"; name.addEventListener("click", function () { window.location.href = a.id + ".html"; }); }
      var seen = {};
      a.its.forEach(function (it) {
        var k = it.date;
        seen[k] = (seen[k] || 0) + 1;
        var c = add("circle", { cx: x(day(it.date)) + (seen[k] - 1) * 7, cy: y, r: 5, fill: FC[fam(it.type)], stroke: "#FCFCFB", "stroke-width": 1.2 });
        if (pic) return;
        c.style.cursor = "pointer";
        c.addEventListener("mousemove", function (ev) { PV.tip.show(ev, "<strong>" + PV.esc(a.name) + "</strong><br>" + PV.esc(when(it.date) + " · " + it.type) + "<br>" + PV.esc(cut(heading(it), 140)) + "<br><em>" + PV.esc(it.issue + ", item " + it.n) + ". Click to read</em>"); });
        c.addEventListener("mouseleave", PV.tip.hide);
        c.addEventListener("click", function () { window.location.href = itemLink(it); });
      });
    });
    box.appendChild(svg);
    return svg;
  }

  // ============================================================ Countries in Monitor

  function countries() {
    var TITLE = "Countries in Monitor", URL = SITE + "countries/";
    var ui = {}, list = [], shown = STEP;
    var C = Controls({ q: "", period: "12", region: "", power: "", fam: "", sort: "items", map: "items" }, run), S = C.S;
    var regs = {};
    PLACES.forEach(function (c) { if (c.reg) regs[c.reg] = 1; });
    host.innerHTML = "";
    ui.stats = el("div");
    host.appendChild(ui.stats);
    ui.modes = el("div", { class: "pv-ma-modes" }, [["items", "Monitor items"], ["power", "Actors in power today"]].map(function (m) {
      var b = el("button", { type: "button", "data-mode": m[0], text: m[1] });
      b.addEventListener("click", function () { S.map = m[0]; run(); });
      return b;
    }));
    ui.key = el("p", { class: "pv-ma-legend" });
    ui.map = el("div", { class: "pv-ip-map" });
    ui.tools = PV.keepChart(el("div", { class: "pv-wc-tools" }), "map", "Countries in Monitor: the map");
    host.appendChild(el("div", { class: "pv-ma-maphead" }, [ui.modes, ui.key]));
    host.appendChild(ui.map);
    host.appendChild(ui.tools);
    host.appendChild(C.search("A country or an actor"));
    host.appendChild(el("div", { class: "pv-wc-filters" }, [
      C.select("period", "Period", PERIODS),
      C.select("region", "Region", [["", "All regions"]].concat(Object.keys(REG).filter(function (k) { return regs[k]; }).map(function (k) { return [k, REG[k]]; }))),
      C.select("power", "Actors", [["", "All countries"], ["listed", "With an actor on the list"], ["any", "With an actor in power today"]]),
      C.select("fam", "Kind of news", [["", "Any"]].concat(FAMS.map(function (k) { return [k, k]; }))),
      C.select("sort", "Order", [["items", "Most reported first"], ["name", "Name"], ["latest", "Latest item first"], ["works", "Fewest works in the Library first"]])
    ]));
    ui.count = el("p", { class: "pv-wc-count", "aria-live": "polite" });
    host.appendChild(el("div", { class: "pv-wc-head" }, [ui.count]));
    host.appendChild(legend());
    ui.view = el("div", { class: "pv-wc-view" });
    host.appendChild(ui.view);
    run();
    if (WORLD) window.addEventListener("resize", function () { drawMap(); });

    function stats() {
      ui.stats.innerHTML = "";
      ui.stats.appendChild(tiles([
        [PLACES.length, "countries", {}],
        [PLACES.filter(function (c) { return c.actors.length; }).length, "with an actor on the list", { power: "listed" }],
        [PLACES.filter(function (c) { return c.power.length; }).length, "with an actor in power today", { power: "any" }],
        [ITEMS.length, ITEMS.length === 1 ? "Monitor item" : "Monitor items", {}]
      ], C.reset));
    }

    function powerOf(c) {
      var best = 0;
      c.power.forEach(function (a) { best = Math.max(best, { leads: 3, partner: 2, supports: 1 }[a.power] || 0); });
      return best;
    }
    function fill(c) {
      if (!c) return "#FFFFFF";
      if (S.map === "power") return [SHADE[0], PV.colour.p1, PV.colour.p2, PV.colour.p3][powerOf(c)];
      var n = c.its.length;
      return SHADE[!n ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 9 ? 3 : 4];
    }
    function mapKey() {
      return S.map === "power"
        ? [[PV.colour.p3, "An actor on the Monitor's list leads the government"], [PV.colour.p2, "is a partner in government"], [PV.colour.p1, "supports it from outside"], [SHADE[0], "in the Monitor, no actor in government"], ["#FFFFFF", "not in the Monitor yet"]]
        : [[SHADE[1], "1 item"], [SHADE[2], "2 or 3"], [SHADE[3], "4 to 9"], [SHADE[4], "10 or more"], [SHADE[0], "no item yet"], ["#FFFFFF", "not in the Monitor yet"]];
    }

    function mapChart(box, width, pic) {
      var height = Math.round(width * 0.5);
      var svg = d3.select(box).append("svg").attr("width", width).attr("height", height).attr("class", "pv-ip-svg").attr("role", "img")
        .attr("aria-label", "World map of the countries in PopuliVerse Monitor, by " + (S.map === "power" ? "actors in power today" : "the number of items"));
      var proj = d3.geoNaturalEarth1().fitExtent([[4, 4], [width - 4, height - 4]], { type: "Sphere" }), path = d3.geoPath(proj);
      svg.append("path").datum({ type: "Sphere" }).attr("d", path).attr("class", "pv-ip-sphere");
      var byNum = {};
      PLACES.forEach(function (c) { if (c.num) byNum[+c.num] = c; });
      function hook(sel, c) {
        if (pic) return;
        sel.attr("tabindex", 0).attr("role", "link").attr("aria-label", c.name + ", " + plural(c.its.length, "item", "items"))
          .on("mousemove", function (ev) {
            PV.tip.show(ev, "<strong>" + PV.esc(c.name) + "</strong><br>" + plural(c.its.length, "item", "items") + " in the Monitor" +
              c.actors.map(function (a) { return "<br>" + PV.esc(a.name) + (a.power ? ", " + PV.esc(POWER[a.power].toLowerCase()) : ""); }).join("") + "<br><em>Click to open the country</em>");
          }).on("mouseleave", PV.tip.hide)
          .on("click", function () { window.location.href = c.tag + ".html"; })
          .on("keydown", function (ev) { if (ev.key === "Enter") window.location.href = c.tag + ".html"; });
      }
      topojson.feature(WORLD, WORLD.objects.countries).features.forEach(function (f) {
        var c = f.id ? byNum[+f.id] : null;
        var p = svg.append("path").attr("d", path(f)).attr("fill", fill(c)).attr("class", "pv-ip-land" + (c && !pic ? " is-click" : ""));
        if (c) hook(p, c);
      });
      PLACES.forEach(function (c) {
        if (!c.dot || c.lon === null) return;
        var xy = proj([c.lon, c.lat]);
        if (xy) hook(svg.append("circle").attr("cx", xy[0]).attr("cy", xy[1]).attr("r", Math.max(3, width / 260)).attr("fill", fill(c)).attr("class", "pv-ip-dot" + (pic ? "" : " is-click")), c);
      });
      return svg.node();
    }

    function drawMap() {
      if (!WORLD) return;
      ui.map.innerHTML = "";
      mapChart(ui.map, Math.max(320, ui.map.clientWidth || 900), false);
    }

    function run() {
      applyPeriod(S.period);
      var q = C.words();
      list = PLACES.filter(function (c) {
        if (S.region && c.reg !== S.region) return false;
        if (S.power === "listed" && !c.actors.length) return false;
        if (S.power === "any" && !c.power.length) return false;
        if (S.fam && !counts(c.its)[S.fam]) return false;
        return has(c.find, q);
      });
      var latest = function (c) { return c.its.length ? c.its[c.its.length - 1].date : ""; };
      list.sort({
        items: function (a, b) { return b.its.length - a.its.length || a.name.localeCompare(b.name); },
        name: function (a, b) { return a.name.localeCompare(b.name); },
        latest: function (a, b) { return latest(b).localeCompare(latest(a)) || a.name.localeCompare(b.name); },
        works: function (a, b) { return a.works - b.works || b.its.length - a.its.length || a.name.localeCompare(b.name); }
      }[S.sort] || function (a, b) { return b.its.length - a.its.length || a.name.localeCompare(b.name); });
      C.save();
      stats();
      Array.prototype.forEach.call(ui.modes.children, function (b) { b.classList.toggle("is-on", b.getAttribute("data-mode") === S.map); });
      ui.key.innerHTML = "";
      mapKey().forEach(function (k) { ui.key.appendChild(el("span", { class: "pv-key" }, [el("span", { class: "pv-key-sw", style: "background:" + k[0] }), k[1]])); });
      drawMap();
      ui.tools.innerHTML = "";
      ui.tools.appendChild(tool("Map as a picture (PNG)", function (b) { PV.save.picture(b, "populiverse-countries-in-monitor", "png", figure); }));
      ui.tools.appendChild(tool("Map (SVG)", function (b) { PV.save.picture(b, "populiverse-countries-in-monitor", "svg", figure); }));
      PV.figureMaker(ui.tools, figure);
      ui.tools.appendChild(tool("Download the list (CSV)", listCsv));
      ui.tools.appendChild(tool("Their items (CSV)", function () { itemsCsv("populiverse-monitor-items.csv", ITEMS.filter(function (it) { return list.some(function (c) { return it.iso.indexOf(c.iso) >= 0; }); })); }));
      ui.tools.appendChild(tool("Copy the link to this view", function (b) { PV.copy(window.location.href, b); }));
      shown = STEP;
      render();
    }

    // The cards come 20 at a time, in the order chosen, grouped by region
    function render() {
      ui.count.textContent = countText(list.length, PLACES.length, "country", "countries", shown);
      ui.view.innerHTML = "";
      if (!list.length) { ui.view.appendChild(el("p", { class: "pv-lib-nomatch", text: "Nothing fits these filters." })); return; }
      var first = list.slice(0, shown);
      // "Fewest works in the Library first" is shown in one row of cards, so that
      // the order across the regions stays as it is chosen
      if (S.sort === "works") ui.view.appendChild(el("div", { class: "pv-ma-grid" }, first.map(card)));
      else Object.keys(REG).forEach(function (r) {
        var cs = first.filter(function (c) { return c.reg === r; });
        if (!cs.length) return;
        var n = cs.reduce(function (s, c) { return s + c.its.length; }, 0);
        ui.view.appendChild(el("section", { class: "pv-ma-region" }, [
          el("h2", {}, [REG[r], el("span", { class: "pv-ma-dim", text: " " + plural(cs.length, "country", "countries") + ", " + plural(n, "item", "items") })]),
          el("div", { class: "pv-ma-grid" }, cs.map(card))
        ]));
      });
      if (list.length > shown) ui.view.appendChild(more(list.length - shown, function () { shown += STEP; render(); }));
    }

    function card(c) {
      return el("article", { class: "pv-ma-card" }, [
        label(REG[c.reg] || ""),
        el("h3", {}, [el("a", { href: c.tag + ".html", text: c.name })]),
        el("div", { class: "pv-ma-dsbox" }, [label("Actors followed")].concat(c.actors.length ? c.actors.map(function (a) {
          return el("div", { class: "pv-ma-ds" }, [el("a", { href: "../actors/" + a.id + ".html", text: a.name }), a.power ? powerPill(a.power) : null]);
        }) : [el("p", { class: "pv-ma-dim", text: "No actor on the Monitor's list." })]))
      ].concat(inMonitor(c.its)).concat([
        el("p", { class: "pv-ma-links" }, [el("a", { href: "../data/in-power.html#" + c.iso, text: "In Populists in Power" }), c.works ? el("a", { href: "../library/index.html?country=" + c.tag, text: plural(c.works, "work", "works") + " in the Library" }) : el("span", { class: "pv-ma-dim", text: "No work in the Library yet" })])
      ]));
    }

    function listCsv() {
      var rows = [["country", "country_code", "region", "actors_followed", "actors_in_power_today", "items", "first_item", "latest_item", "kinds_of_news", "library_works", "page"]];
      list.forEach(function (c) {
        var k = counts(c.its);
        rows.push([c.name, c.iso, REG[c.reg] || "", c.actors.map(function (a) { return a.name; }).join("; "),
          c.power.map(function (a) { return a.name + " (" + a.power + ")"; }).join("; "), c.its.length,
          c.its.length ? c.its[0].date : "", c.its.length ? c.its[c.its.length - 1].date : "",
          FAMS.filter(function (f) { return k[f]; }).map(function (f) { return f + " " + k[f]; }).join("; "), c.works, URL + c.tag + ".html"]);
      });
      rows.push([], [periodNote()], ["library_works: the works of the PopuliVerse Library tagged with the country, as of its last update."], ["Power today as of PopuliVerse Monitor " + M.issue + ". A country without an actor in power here is not a country without populists in power: only the actors on the Monitor's list are followed."], [PV.citation(TITLE, URL)]);
      PV.save.csv("populiverse-countries-in-monitor.csv", rows);
    }

    function figure() {
      var groups = {};
      PLACES.forEach(function (c) {
        var k = S.map === "power" ? ["", "Supports", "Partner", "Leads"][powerOf(c)] : (c.its.length >= 10 ? "10 or more items" : c.its.length >= 4 ? "4 to 9" : c.its.length >= 2 ? "2 or 3" : c.its.length === 1 ? "1 item" : "");
        if (k) (groups[k] = groups[k] || []).push(c);
      });
      var order = S.map === "power" ? ["Leads", "Partner", "Supports"] : ["10 or more items", "4 to 9", "2 or 3", "1 item"];
      return {
        host: host,
        chart: function (holder, w) { return mapChart(holder, w, true); },
        title: S.map === "power" ? "Where an Actor on the Monitor's List Is in Power Today" : "The Countries in PopuliVerse Monitor, " + span(),
        lines: [S.map === "power" ? "As of PopuliVerse Monitor " + M.issue + ". Only the actors on the Monitor's list are followed." : plural(PLACES.length, "country", "countries") + ", shaded by the number of items that name each. " + plural(ITEMS.length, "item", "items") + " in all; an item can name more than one country."],
        legend: mapKey().map(function (k) { return { fill: k[0], label: k[1] }; }),
        lists: order.filter(function (k) { return groups[k]; }).map(function (k) {
          return { head: k + " (" + groups[k].length + ")", text: groups[k].sort(function (a, b) { return b.its.length - a.its.length || a.name.localeCompare(b.name); }).map(function (c) {
            return c.name + " (" + (S.map === "power" ? c.power.map(function (a) { return a.name; }).join(", ") : c.its.length) + ")";
          }).join(", ") + "." };
        }),
        notes: S.map === "power" ? ["An actor is on the list because a dataset or a study classed it at some time. A country without one is not a country without populists in power."] : [],
        sources: [sourceLines()[0], "Map from Natural Earth. Licence of this picture: CC BY 4.0."],
        cite: PV.citation(TITLE, URL)
      };
    }
  }

  // ============================================================ one actor, one country

  function one(box) {
    var id = box.getAttribute("data-actor"), iso = box.getAttribute("data-country");
    var a = id ? ACTORS.filter(function (x) { return x.id === id; })[0] : null;
    var c = iso ? BYISO[iso] : null;
    var items = a ? a.its : c ? c.its : [];
    if (!a && !c) return;
    var name = a ? a.name : c.name, url = SITE + (a ? "actors/" + a.id : "countries/" + c.tag) + ".html";
    var kids = [];
    // "Save" and "Note" under the name: to save an actor or a country is to
    // follow it (master plan, section 18, stage 2, batch 2). keep.js reads
    // these marks and draws the two buttons here.
    var keep = el("p", { class: "pv-keep-row" });
    keep.setAttribute("data-keep-kind", a ? "actor" : "country");
    keep.setAttribute("data-keep-ref", a ? a.id : c.iso);
    keep.setAttribute("data-keep-title", name);
    keep.setAttribute("data-keep-url", url);
    keep.setAttribute("data-keep-tools", "");
    if (a) {
      keep.setAttribute("data-keep-extra", (a.kind === "leader" ? "Leader" : "Party") + (a.c ? " \u00b7 " + a.c : ""));
      if (a.iso) keep.setAttribute("data-keep-country", a.iso);
    } else {
      keep.setAttribute("data-keep-country", c.iso);
    }
    kids.push(keep);
    if (a) kids.push(el("section", {}, [el("h2", { text: "In the Datasets" }), a.bl ? el("p", {}, [PV.pill("On the list as a borderline case", "is-out")]) : null, datasets(a, true)]));
    else if (c.actors.length) kids.push(el("section", {}, [el("h2", { text: "Actors Followed Here" }), el("div", { class: "pv-ma-grid" }, c.actors.map(function (x) {
      return el("article", { class: "pv-ma-card" }, [el("div", { class: "pv-ma-row" }, [label(x.kind === "leader" ? "Leader" : "Party"), powerPill(x.power)]),
        el("h3", {}, [el("a", { href: "../actors/" + x.id + ".html", text: x.name })]), el("p", { class: "pv-ma-why", text: "On the Monitor's list by " + x.src + (x.bl ? ", as a borderline case" : "") }), datasets(x)]);
    }))]));
    if (items.length) {
      var k = counts(items), max = Math.max.apply(null, FAMS.map(function (f) { return k[f] || 0; }));
      kids.push(el("section", {}, [
        el("h2", { text: "Over Time" }),
        el("p", { class: "pv-ma-dim", text: plural(items.length, "item", "items") + " in the Monitor, " + span() + ". Each dot is one item. Point at it for its heading and click it to read the item." }),
        strip(items, Math.max(280, Math.min(720, box.clientWidth || 720)), 40, 6),
        el("div", { class: "pv-ma-kinds" }, FAMS.filter(function (f) { return k[f]; }).map(function (f) {
          return el("div", {}, [el("span", { text: f }), el("span", { class: "pv-ma-kbar" }, [el("span", { style: "width:" + Math.round(100 * k[f] / max) + "%;background:" + FC[f] })]), el("span", { class: "pv-ma-dim", text: String(k[f]) })]);
        }))
      ]));
    }
    kids.push(el("p", { class: "pv-wc-tools" }, [
      items.length ? tool("Download the " + plural(items.length, "item", "items") + " (CSV)", function () { itemsCsv("populiverse-monitor-" + (a ? a.id : c.tag) + ".csv", items); }) : null,
      tool("Copy the citation", function (b) { PV.copy(PV.citation(name + " in PopuliVerse Monitor", url), b); }),
      tool("Copy the link", function (b) { PV.copy(url, b); }),
      el("a", { class: "pv-lib-link", href: "index.html", text: a ? "All actors" : "All countries" })
    ]));
    kids.forEach(function (n) { box.appendChild(n); });
    box.classList.add("is-on");
  }
})();
