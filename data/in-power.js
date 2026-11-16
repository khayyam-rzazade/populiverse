/* PopuliVerse: "Populists in Power"
   Reads in-power.json (written by scripts/make_data.py), monitor.json (written
   at every build by scripts/make_pages.py) and world.json (the map, from
   Natural Earth through the world-atlas package). The years before the Monitor
   come from PPEG with The PopuList (parties in government) and from the Global
   Populism Database (heads of government). Today comes from the Monitor.
   Every year shows the state on 1 July. */

(function () {
  "use strict";

  var PV = window.PVData;
  var app = document.getElementById("ip-app");
  if (!app || !PV || !window.d3 || !window.topojson) return;
  var el = PV.el;
  var PAGE_URL = "https://populiverse.com/data/in-power.html";
  var PAGE_TITLE = "Populists in Power";
  var NOW = 2026;

  var P = null, MON = null, WORLD = null;
  var S = { year: "2019", lens: "either" };
  var ui = {}, timer = null;
  var NOWSTATE = {}, NOWWHO = {};

  var ORDER = { "null": -2, "0": -1, "-1": 0, "1": 1, "2": 2, "3": 3 };
  var RANK = { L: 3, P: 2, S: 1 };
  var ROLE = { L: "leads", P: "partner", S: "supports from outside" };
  var STATES = [
    { v: 3, label: "A populist leads the government", now: "An actor on the Monitor's list leads the government", short: "Leads", fill: PV.colour.p3 },
    { v: 2, label: "A populist party is a partner in government", now: "An actor on the Monitor's list is a partner in government", short: "Partner", fill: PV.colour.p2 },
    { v: 1, label: "A populist party supports the government from outside", now: "An actor on the Monitor's list supports the government from outside", short: "Supports", fill: PV.colour.p1 },
    { v: -1, label: "Not known: a party in government could not be linked", short: "Not known", fill: "url(#pv-cross)" },
    { v: 0, label: "No populist in government", short: "None", fill: PV.colour.none },
    { v: null, label: "Not covered by the datasets", now: "No actor on the Monitor's list in government", short: "Not covered", fill: "url(#pv-hatch)" }
  ];
  var BORDERLINE = "the party is a borderline case in The PopuList";
  var LENSES = {
    either: "Either dataset",
    party: "Parties in government (PPEG with The PopuList)",
    leader: "Heads of government (Global Populism Database)"
  };
  // The order of the pieces of a bar in the chart of years, from the bottom
  var STACK = ["3", "3b", "2", "2b", "1", "1b", "-1", "0"];

  Promise.all([
    PV.load(app.getAttribute("data-source")),
    PV.load(app.getAttribute("data-monitor")).catch(function () { return null; }),
    PV.load(app.getAttribute("data-map"))
  ]).then(function (res) { P = res[0]; MON = res[1]; WORLD = res[2]; start(); })
    .catch(function () {
      app.innerHTML = "";
      app.appendChild(el("div", { class: "pv-lib-message" }, [el("p", { text: "The data could not be loaded. Please try again later." })]));
    });

  function stronger(a, b) { return ORDER[String(b)] > ORDER[String(a)] ? b : a; }
  function stateMeta(v) { for (var i = 0; i < STATES.length; i++) if (STATES[i].v === v) return STATES[i]; return STATES[5]; }
  function name(iso) { return P.places[iso] ? P.places[iso][0] : iso; }
  function isNow() { return +S.year === NOW; }
  function fileMonth() { return PV.month(P.gpd_end); }

  function fillOf(s, tag) {
    if (s.bl && s.v > 0) return "url(#pv-bl" + s.v + (tag || "") + ")";
    var f = stateMeta(s.v).fill;
    return tag && f.indexOf("url(") === 0 ? f.replace(")", tag + ")") : f;
  }

  function labelOf(s, now) {
    var m = stateMeta(s.v);
    return (now && m.now ? m.now : m.label) + (s.bl ? (now ? ", as a borderline case" : ". Striped, " + BORDERLINE) : "");
  }

  function keyOf(s) { return String(s.v) + (s.bl ? "b" : ""); }
  function ofKey(k) { var bl = k.slice(-1) === "b"; return { v: +(bl ? k.slice(0, -1) : k), bl: bl }; }

  function inRanges(list, y) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (list[i][0] <= y && y <= list[i][1]) return true;
    return false;
  }

  function rangesText(list) {
    return (list || []).map(function (r) { return r[0] === r[1] ? String(r[0]) : r[0] + " to " + r[1]; }).join(", ");
  }

  // ------------------------------------------------------------ why not covered

  // A year without a verdict says why. The datasets end at different years, and
  // "not covered" must never read as "not populist".
  function whyNotLeader(iso, year) {
    var c = P.countries[iso];
    if (!c || !c.lead.length) return "The Global Populism Database holds no graded term for this country.";
    var d = year + "-07-01", before = null, after = null, during = [];
    c.lead.forEach(function (t) {
      if (t[0] <= d && d <= t[1]) during.push(t[2]);
      else if (t[1] < d) { if (!before || t[1] > before[1]) before = t; }
      else if (!after || t[0] < after[0]) after = t;
    });
    if (during.length) return "The Global Populism Database grades " + during.join(" and ") + " for this year, who did not head the government. It holds no term for the head of government.";
    if (before && !after) return "The Global Populism Database's last graded term here ended in " + PV.month(before[1]) + " (" + before[2] + "). It has graded nothing here since.";
    if (after && !before) return "The Global Populism Database's first graded term here begins in " + PV.month(after[0]) + " (" + after[2] + ").";
    return "The Global Populism Database holds no graded term here between " + PV.month(before[1]) + " and " + PV.month(after[0]) + ".";
  }

  function whyNotParty(iso, year) {
    var c = P.countries[iso];
    if (!c || !c.cab.length) return "The parties in government are read only for The PopuList's 31 European countries.";
    return "PPEG holds no government here for 1 July " + year + ".";
  }

  function whyNot(iso, year, lens) {
    if (lens === "party") return whyNotParty(iso, year);
    if (lens === "leader") return whyNotLeader(iso, year);
    return whyNotLeader(iso, year) + " " + whyNotParty(iso, year);
  }

  // ------------------------------------------------------------ what "Now" rests on

  // An actor is on the Monitor's list because a dataset or a study classed it at
  // some time. For a leader of the Global Populism Database, these are the terms
  // whose speeches it graded. "Now" is not a new grading, and the page says so.
  function gradedTerms(a) {
    var c = P.countries[a.iso];
    if (!c || !a.data) return [];
    return c.lead.filter(function (t) { return t[5] === a.data; });
  }

  function termSpan(t) { return t[0].slice(0, 4) + (t[6] ? " on" : " to " + t[1].slice(0, 4)); }

  function termWords(t) { return termSpan(t) + " (" + PV.num(t[3]) + ", " + PV.verdict.gpd(t[4]).label.toLowerCase() + ")"; }

  function basisShort(a) {
    var ts = gradedTerms(a);
    return ts.length ? "last graded term " + termWords(ts[ts.length - 1]) : "";
  }

  function basisLong(a) {
    var ts = gradedTerms(a);
    if (!ts.length) return "";
    var last = ts[ts.length - 1];
    return "The database graded " + (ts.length === 1 ? "the term of " : "the terms of ") + ts.map(termWords).join(", ") + ". " +
      (last[6] ? "The last is marked current in its file of " + fileMonth() + "." : "It holds no later term, so the time since is not graded.");
  }

  function onList(a) {
    return a.src ? "on the list by " + a.src + (basisShort(a) ? ", " + basisShort(a) : "") : "";
  }

  // ============================================================ states

  function start() {
    if (MON) MON.actors.forEach(function (a) {
      var v = { leads: 3, partner: 2, supports: 1 }[a.power];
      if (!v || !a.iso) return;
      NOWSTATE[a.iso] = stronger(NOWSTATE[a.iso] === undefined ? null : NOWSTATE[a.iso], v);
      (NOWWHO[a.iso] = NOWWHO[a.iso] || []).push(a);
    });
    var st = PV.state.get();
    if (st.year && (+st.year >= P.from && +st.year <= NOW)) S.year = st.year;
    if (st.lens && LENSES[st.lens]) S.lens = st.lens;
    build();
    draw();
    var h = decodeURIComponent((window.location.hash || "").slice(1));
    if (h && P.places[h]) openCountry(h);
    window.addEventListener("hashchange", function () {
      var id = decodeURIComponent((window.location.hash || "").slice(1));
      if (id && P.places[id]) openCountry(id);
    });
    window.addEventListener("resize", debounce(function () { drawMap(); drawCounts(); }, 200));
  }

  // The place of populists in a country's government in a year: v is the place,
  // bl says that it rests on a borderline case of The PopuList alone
  function stateOf(iso, year, lens) {
    year = +year;
    if (year === NOW) {
      var nv = NOWSTATE[iso];
      if (nv === undefined) return { v: null, bl: false };
      var top = (NOWWHO[iso] || []).filter(function (a) { return { leads: 3, partner: 2, supports: 1 }[a.power] === nv; });
      return { v: nv, bl: top.length > 0 && top.every(function (a) { return a.bl; }) };
    }
    var c = P.countries[iso];
    if (!c) return { v: null, bl: false };
    var p = c.yp[year], l = c.yl[year];
    p = p === undefined ? null : p;
    l = l === undefined ? null : l;
    var pb = !!(c.yb && c.yb[year]);
    if (lens === "party") return { v: p, bl: pb };
    if (lens === "leader") return { v: l, bl: false };
    // The stronger of the two; a borderline party does not stripe a place that
    // a head of government holds on his or her own
    var v = stronger(p, l);
    return { v: v, bl: pb && ORDER[String(p)] > ORDER[String(l)] };
  }

  function whoAt(iso, year) {
    // The government and the heads on 1 July of a year. lead is the leader who
    // counts as head of government that year; others are in the database and do
    // not count (a president beside a prime minister).
    var c = P.countries[iso], d = year + "-07-01", out = { cab: null, lead: null, others: [] };
    if (!c) return out;
    c.cab.forEach(function (k) { if (k[0] <= d && d <= k[1]) out.cab = k; });
    c.lead.forEach(function (t) {
      if (!(t[0] <= d && d <= t[1])) return;
      if (inRanges(t[9], year)) { if (!out.lead || t[4] > out.lead[4]) out.lead = t; }
      else out.others.push(t);
    });
    return out;
  }

  function cabState(k, year) {
    var full = 0, any = 0;
    k[4].forEach(function (p) {
      var r = RANK[p[0]];
      if (inRanges(p[4], year)) { full = Math.max(full, r); any = Math.max(any, r); }
      if (inRanges(p[5], year)) any = Math.max(any, r);
    });
    if (any) return { v: any, bl: any > full };
    return { v: k[5] ? -1 : 0, bl: false };
  }

  function cabBest(k) {
    // The strongest place in the years of one government
    var best = null;
    for (var y = Math.max(P.from, +k[0].slice(0, 4)); y <= +k[1].slice(0, 4); y++) {
      var s = cabState(k, y);
      if (!best || ORDER[String(s.v)] > ORDER[String(best.v)] || (s.v === best.v && best.bl && !s.bl)) best = s;
    }
    return best || { v: 0, bl: false };
  }

  function populists(k, y) {
    // The parties of a government that The PopuList classes as populist in a year
    var out = [];
    k[4].forEach(function (p) {
      var full = inRanges(p[4], y), bl = inRanges(p[5], y);
      if (full || bl) out.push({ name: p[2] && p[2] !== "NA" ? p[2] : p[1], role: ROLE[p[0]], bl: !full, lk: p[6] });
    });
    return out;
  }

  // ============================================================ the page

  function build() {
    app.innerHTML = "";
    // Controls
    var lens = el("select", { id: "ip-lens" });
    Object.keys(LENSES).forEach(function (k) { lens.appendChild(el("option", { value: k, text: LENSES[k] })); });
    lens.value = S.lens;
    lens.addEventListener("change", function () { S.lens = lens.value; draw(); });
    ui.slider = el("input", { type: "range", id: "ip-year", min: String(P.from), max: String(NOW), step: "1", value: S.year, "aria-label": "Year" });
    ui.slider.addEventListener("input", function () { S.year = ui.slider.value; stop(); draw(); });
    ui.play = el("button", { type: "button", class: "pv-ip-play", "aria-label": "Play the years", text: "Play" });
    ui.play.addEventListener("click", function () { if (timer) stop(); else play(); });
    var prev = el("button", { type: "button", class: "pv-ip-step", "aria-label": "One year back", text: "‹" });
    prev.addEventListener("click", function () { stop(); S.year = String(Math.max(P.from, +S.year - 1)); draw(); });
    var next = el("button", { type: "button", class: "pv-ip-step", "aria-label": "One year on", text: "›" });
    next.addEventListener("click", function () { stop(); S.year = String(Math.min(NOW, +S.year + 1)); draw(); });
    ui.yearLabel = el("p", { class: "pv-ip-year", "aria-live": "polite" });
    // A list to open a country without the map: small countries are hard to tap
    var isos = {};
    Object.keys(P.countries).forEach(function (iso) { isos[iso] = true; });
    Object.keys(NOWSTATE).forEach(function (iso) { isos[iso] = true; });
    var pick = el("select", { id: "ip-country" }, [el("option", { value: "", text: "Choose a country" })]);
    Object.keys(isos).sort(function (a, b) { return name(a).localeCompare(name(b)); }).forEach(function (iso) {
      pick.appendChild(el("option", { value: iso, text: name(iso) }));
    });
    pick.addEventListener("change", function () { var iso = pick.value; pick.value = ""; if (iso) openCountry(iso); });
    app.appendChild(el("div", { class: "pv-ip-controls" }, [
      el("div", { class: "pv-ip-fields" }, [
        el("div", { class: "pv-wc-field pv-ip-lens" }, [el("label", { for: "ip-lens", class: "pv-wc-label", text: "Who decides" }), lens]),
        el("div", { class: "pv-wc-field pv-ip-lens" }, [el("label", { for: "ip-country", class: "pv-wc-label", text: "Open a country" }), pick])
      ]),
      el("div", { class: "pv-ip-time" }, [ui.yearLabel, el("div", { class: "pv-ip-slide" }, [prev, ui.slider, next, ui.play])])
    ]));
    ui.note = el("p", { class: "pv-ip-note" });
    app.appendChild(ui.note);
    // Legend
    ui.legend = el("div", { class: "pv-ip-legend" });
    app.appendChild(ui.legend);
    // Map
    ui.map = el("div", { class: "pv-ip-map" });
    app.appendChild(ui.map);
    ui.tools = PV.keepChart(el("div", { class: "pv-wc-tools pv-ip-tools" }), "map", "Populists in Power: the map");
    app.appendChild(ui.tools);
    // Counts by year
    app.appendChild(el("h2", { class: "pv-ip-h", text: "Year by Year" }));
    app.appendChild(el("p", { class: "pv-ip-sub", text: "Countries by the place populists held in their government on 1 July. The height of a bar is the number of countries the data cover that year, so it changes. Click a year to see it on the map." }));
    ui.counts = el("div", { class: "pv-ip-counts pv-wc-scroll" });
    app.appendChild(ui.counts);
    ui.countTools = PV.keepChart(el("div", { class: "pv-wc-tools pv-ip-tools" }), "year-by-year", "Populists in Power: year by year");
    app.appendChild(ui.countTools);
    // The list of the year
    ui.listHead = el("h2", { class: "pv-ip-h" });
    app.appendChild(ui.listHead);
    ui.list = el("div", { class: "pv-ip-list" });
    app.appendChild(ui.list);
    app.appendChild(PV.linksBox(P.links, name));
  }

  function play() {
    if (+S.year >= NOW) S.year = String(P.from);
    ui.play.textContent = "Pause";
    timer = window.setInterval(function () {
      if (+S.year >= NOW) { stop(); return; }
      S.year = String(+S.year + 1);
      draw();
    }, 900);
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = null;
    if (ui.play) ui.play.textContent = "Play";
  }

  function lensNote() {
    if (isNow()) return "Now shows only the actors on the Monitor's list, and whether they hold power as of its latest issue. An actor is on the list because a dataset or a study classed it at some time, so Now is not a new grading. A country without one is not a country without populists in power.";
    if (S.lens === "party") return "PPEG names the parties in each government. The PopuList says which of them are populist, through Party Facts IDs and, where marked, PopuliVerse's own list of links. Only The PopuList's 31 European countries are covered. Striped means that " + BORDERLINE + ".";
    if (S.lens === "leader") return "The Global Populism Database grades the speeches of presidents and prime ministers. A term with an average of 0.5 or more counts as populist, somewhat populist or above in the words of its paper. A president counts only where he or she heads the government. The database grades only some terms, and for many countries its last one ended years ago. A year it has not graded is hatched as not covered, which never means not populist.";
    return "A country takes the stronger of the two views: the parties in government, or the head of government. Striped means that " + BORDERLINE + ". Hatched means not covered, never none: the datasets end at different years, and a country says why when you point at it. Click a country to see each dataset on its own.";
  }

  function draw() {
    ui.slider.value = S.year;
    PV.state.set({ year: S.year === "2019" ? "" : S.year, lens: S.lens === "either" ? "" : S.lens });
    var y = +S.year;
    ui.yearLabel.innerHTML = y === NOW
      ? "<strong>Now</strong> <span>as reported by PopuliVerse Monitor " + PV.esc(MON ? MON.issue : "") + "</span>"
      : "<strong>" + y + "</strong> <span>on 1 July</span>";
    ui.note.textContent = lensNote();
    drawLegend();
    drawMap();
    drawCounts();
    drawList();
    drawTools();
  }

  function legendItems() {
    // What the colours mean in the view in use
    var out = [];
    STATES.forEach(function (s) {
      if (isNow() && (s.v === 0 || s.v === -1)) return;
      if (S.lens === "leader" && !isNow() && (s.v === 2 || s.v === 1 || s.v === -1)) return;
      var label = isNow() && s.now ? s.now : s.label;
      if (S.lens === "leader" && !isNow() && s.v === 3) label = "A populist heads the government";
      out.push({ fill: s.fill, label: label, v: s.v });
      if (s.v === 1 && (S.lens !== "leader" || isNow())) out.push({ fill: "url(#pv-bl3)", label: "Striped: " + (isNow() ? "the actor is on the list as a borderline case" : BORDERLINE), v: "b" });
    });
    return out;
  }

  function drawLegend() {
    ui.legend.innerHTML = "";
    legendItems().forEach(function (k) {
      var sw = el("span", { class: "pv-key-sw" + (k.v === null ? " is-hatch" : k.v === -1 ? " is-cross" : k.v === "b" ? " is-bl3" : "") });
      if (k.fill.indexOf("url") < 0) sw.style.background = k.fill;
      ui.legend.appendChild(el("span", { class: "pv-key" }, [sw, k.label]));
    });
  }

  // ============================================================ the map

  function drawMap() {
    ui.map.innerHTML = "";
    mapChart(ui.map, Math.max(320, ui.map.clientWidth || 900), false);
  }

  function mapChart(host, width, pic) {
    var height = Math.round(width * 0.5);
    var svg = d3.select(host).append("svg").attr("width", width).attr("height", height).attr("class", "pv-ip-svg")
      .attr("role", "img").attr("aria-label", "World map of populists in power, " + (isNow() ? "now" : S.year));
    PV.defs(svg);
    var proj = d3.geoNaturalEarth1().fitExtent([[4, 4], [width - 4, height - 4]], { type: "Sphere" });
    var path = d3.geoPath(proj);
    svg.append("path").datum({ type: "Sphere" }).attr("d", path).attr("class", "pv-ip-sphere");
    svg.append("path").datum(d3.geoGraticule10()).attr("d", path).attr("class", "pv-ip-grat");
    var feats = topojson.feature(WORLD, WORLD.objects.countries).features;
    var byNum = {};
    Object.keys(P.places).forEach(function (iso) { var n = P.places[iso][1]; if (n) byNum[n] = iso; });
    var year = +S.year;
    var g = svg.append("g");
    feats.forEach(function (f) {
      var iso = f.id ? byNum[f.id] : (f.properties && f.properties.name === "Kosovo" ? "XKX" : null);
      var s = iso ? stateOf(iso, year, S.lens) : { v: null, bl: false };
      var p = g.append("path").attr("d", path(f)).attr("fill", fillOf(s)).attr("class", "pv-ip-land" + (iso && !pic ? " is-click" : ""));
      if (iso && !pic) hook(p, iso, s);
    });
    // Countries too small for this map, drawn as dots where the data hold them
    Object.keys(P.places).forEach(function (iso) {
      var pl = P.places[iso];
      if (!pl[5] || pl[3] === null) return;
      var has = P.countries[iso] || NOWSTATE[iso] !== undefined;
      if (!has) return;
      var s = stateOf(iso, year, S.lens);
      var xy = proj([pl[3], pl[4]]);
      if (!xy) return;
      var c = svg.append("circle").attr("cx", xy[0]).attr("cy", xy[1]).attr("r", Math.max(3, width / 260))
        .attr("fill", fillOf(s)).attr("class", "pv-ip-dot" + (pic ? "" : " is-click"));
      if (!pic) hook(c, iso, s);
    });
    return svg.node();
  }

  function hook(sel, iso, s) {
    sel.attr("tabindex", 0).attr("role", "button").attr("aria-label", name(iso) + ". " + labelOf(s, isNow()))
      .on("mousemove", function (ev) { PV.tip.show(ev, tipText(iso, s)); })
      .on("mouseleave", PV.tip.hide)
      .on("click", function () { PV.tip.hide(); openCountry(iso); })
      .on("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openCountry(iso); } });
  }

  function leadWords(t) {
    return t[2] + ", speeches " + PV.num(t[3]) + ", " + PV.verdict.gpd(t[4]).label.toLowerCase();
  }

  function tipText(iso, s) {
    var y = +S.year, out = "<strong>" + PV.esc(name(iso)) + "</strong><br>" + PV.esc(labelOf(s, y === NOW));
    if (y === NOW) {
      (NOWWHO[iso] || []).forEach(function (a) {
        out += "<br>" + PV.esc(a.name) + ", " + PV.esc({ leads: "leads", partner: "partner", supports: "supports from outside" }[a.power]) + (onList(a) ? "<br><em>" + PV.esc(onList(a)) + "</em>" : "");
      });
      if (NOWSTATE[iso] === undefined) out += "<br>This is not a finding that no populist governs here.";
    } else if (s.v === null) {
      out += "<br>" + PV.esc(whyNot(iso, y, S.lens));
    } else {
      var w = whoAt(iso, y);
      if (S.lens !== "party") {
        if (w.lead) out += "<br>" + PV.esc(leadWords(w.lead));
        w.others.forEach(function (t) { out += "<br>" + PV.esc(t[2]) + (t[7] ? ", president" : "") + ", not head of government, so not counted"; });
      }
      if (w.cab && S.lens !== "leader") {
        var pops = populists(w.cab, y);
        out += "<br>Government of " + PV.esc(w.cab[2]) + (pops.length ? ", with " + PV.esc(pops.map(function (p) { return p.name + (p.bl ? " (borderline)" : ""); }).join(", ")) : "");
      }
    }
    return out + "<br><em>Click for the country's timeline</em>";
  }

  // ============================================================ counts by year

  function counts() {
    var out = [];
    for (var y = P.from; y < NOW; y++) {
      var row = { year: y, n: { "null": 0 } };
      STACK.forEach(function (k) { row.n[k] = 0; });
      Object.keys(P.countries).forEach(function (iso) { row.n[keyOf(stateOf(iso, y, S.lens))] += 1; });
      out.push(row);
    }
    return out;
  }

  function nowCounts() {
    // Now, from the Monitor: only the actors on its list
    var n = {};
    STACK.forEach(function (k) { n[k] = 0; });
    Object.keys(NOWSTATE).forEach(function (iso) { n[keyOf(stateOf(iso, NOW, S.lens))] += 1; });
    return n;
  }

  function sum(n, keys) { return keys.reduce(function (s, k) { return s + (n[k] || 0); }, 0); }

  function drawCounts() {
    ui.counts.innerHTML = "";
    countsChart(ui.counts, Math.max(640, ui.counts.clientWidth || 900), false);
  }

  function countsChart(host, width, pic) {
    var data = counts();
    var height = pic ? 320 : 240, left = 30, right = 70, top = 10, bottom = 26;
    var max = d3.max(data, function (d) { return sum(d.n, STACK); }) || 1;
    var x = d3.scaleBand().domain(data.map(function (d) { return d.year; }).concat([NOW])).range([left, width - right]).paddingInner(0.18);
    var y = d3.scaleLinear().domain([0, max]).nice().range([height - bottom, top]);
    var svg = d3.select(host).append("svg").attr("width", width).attr("height", height).attr("class", "pv-ip-bars")
      .attr("role", "img").attr("aria-label", "Countries by the place populists held in government, " + P.from + " to " + (NOW - 1));
    PV.defs(svg);
    var ax = svg.append("g").attr("class", "pv-axis");
    y.ticks(4).forEach(function (t) {
      ax.append("line").attr("x1", left).attr("x2", width - right).attr("y1", y(t)).attr("y2", y(t)).attr("class", "pv-grid");
      ax.append("text").attr("x", left - 6).attr("y", y(t) + 3).attr("text-anchor", "end").text(t);
    });
    function column(n, gx, bw, on) {
      var base = 0;
      var g = svg.append("g").attr("class", "pv-ip-col" + (on && !pic ? " is-on" : ""));
      STACK.forEach(function (k) {
        if (!n[k]) return;
        g.append("rect").attr("x", gx).attr("width", bw).attr("y", y(base + n[k]) + 1).attr("height", Math.max(0, y(base) - y(base + n[k]) - 1))
          .attr("fill", fillOf(ofKey(k)));
        base += n[k];
      });
      if (!pic) g.style("cursor", "pointer").append("rect").attr("x", gx - 1).attr("width", bw + 2).attr("y", top).attr("height", height - bottom - top).attr("class", "pv-ip-hit");
      return g;
    }
    function tipRows(n) {
      return [["Leads", ["3", "3b"], "3b"], ["Partner", ["2", "2b"], "2b"], ["Supports", ["1", "1b"], "1b"]].map(function (r) {
        return r[0] + " " + sum(n, r[1]) + (n[r[2]] ? ", of which " + n[r[2]] + " on a borderline case" : "");
      });
    }
    data.forEach(function (d) {
      var gx = x(d.year), bw = x.bandwidth();
      var g = column(d.n, gx, bw, String(d.year) === S.year);
      if (!pic) g.on("click", function () { stop(); S.year = String(d.year); draw(); })
        .on("mousemove", function (ev) {
          PV.tip.show(ev, "<strong>" + d.year + "</strong>, 1 July<br>" + tipRows(d.n).concat(["Not known " + d.n["-1"], "None " + d.n["0"], "Covered " + sum(d.n, STACK)]).join("<br>"));
        })
        .on("mouseleave", PV.tip.hide);
      if (d.year % 5 === 0) ax.append("text").attr("x", gx + bw / 2).attr("y", height - 8).attr("text-anchor", "middle").text(d.year);
    });
    var nowN = nowCounts();
    var gn = column(nowN, x(NOW), x.bandwidth(), S.year === String(NOW));
    if (!pic) gn.on("click", function () { stop(); S.year = String(NOW); draw(); })
      .on("mousemove", function (ev) { PV.tip.show(ev, "<strong>Now</strong>, PopuliVerse Monitor " + PV.esc(MON ? MON.issue : "") + "<br>" + tipRows(nowN).join("<br>") + "<br><em>Only the actors on the Monitor's list</em>"); })
      .on("mouseleave", PV.tip.hide);
    ax.append("text").attr("x", x(NOW) + x.bandwidth() / 2).attr("y", height - 8).attr("text-anchor", "middle").text("Now");
    // Direct labels on the latest full year
    var last = data[data.length - 1], acc = 0;
    [["3", "3b"], ["2", "2b"], ["1", "1b"], ["-1"], ["0"]].forEach(function (keys) {
      var n = sum(last.n, keys);
      if (n >= 2) ax.append("text").attr("x", width - right + 4).attr("y", y(acc + n / 2) + 3).attr("class", "pv-ip-lab").text(stateMeta(+keys[0]).short);
      acc += n;
    });
    return svg.node();
  }

  // ============================================================ the list of the year

  function groupsOfYear() {
    // The countries of the year in view, by place; a borderline case is a group of its own
    var y = +S.year, groups = {};
    var isos = y === NOW ? Object.keys(NOWSTATE) : Object.keys(P.countries);
    isos.forEach(function (iso) {
      var s = stateOf(iso, y, S.lens);
      if (s.v === null) return;
      (groups[keyOf(s)] = groups[keyOf(s)] || []).push(iso);
    });
    Object.keys(groups).forEach(function (k) { groups[k].sort(function (a, b) { return name(a).localeCompare(name(b)); }); });
    return groups;
  }

  function groupLabel(k) {
    var s = ofKey(k), m = stateMeta(s.v);
    var label = isNow() && m.now ? m.now : m.label;
    if (S.lens === "leader" && !isNow() && s.v === 3) label = "A populist heads the government";
    return label + (s.bl ? (isNow() ? ", as a borderline case" : ", on a borderline case of The PopuList") : "");
  }

  function drawList() {
    var y = +S.year;
    ui.list.innerHTML = "";
    ui.listHead.textContent = y === NOW ? "Now, in the Monitor" : "In " + y;
    var groups = groupsOfYear(), any = false;
    ["3", "3b", "2", "2b", "1", "1b", "-1"].forEach(function (k) {
      var list = groups[k] || [];
      if (!list.length) return;
      any = true;
      var s = ofKey(k);
      var ul = el("ul", { class: "pv-ip-ul" });
      list.forEach(function (iso) {
        var b = el("button", { type: "button", class: "pv-dp-link", text: name(iso) });
        b.addEventListener("click", function () { openCountry(iso); });
        ul.appendChild(el("li", {}, [b, el("span", { class: "pv-ip-who", text: whoLine(iso, y) })]));
      });
      var sw = el("span", { class: "pv-key-sw" + (s.v === -1 ? " is-cross" : s.bl ? " is-bl" + s.v : "") });
      if (s.v !== -1 && !s.bl) sw.style.background = stateMeta(s.v).fill;
      ui.list.appendChild(el("div", { class: "pv-ip-group" }, [el("h3", {}, [sw, groupLabel(k) + " (" + list.length + ")"]), ul]));
    });
    if (!any) ui.list.appendChild(el("p", { class: "pv-lib-nomatch", text: "None in this year, in the countries the data cover." }));
  }

  function whoLine(iso, y) {
    if (y === NOW) return (NOWWHO[iso] || []).map(function (a) { return a.name + (onList(a) ? " (" + onList(a) + ")" : ""); }).join(", ");
    var w = whoAt(iso, y), bits = [];
    if (w.lead && S.lens !== "party" && w.lead[4] >= 1) bits.push(leadWords(w.lead));
    if (w.cab && S.lens !== "leader") {
      var pops = populists(w.cab, y);
      if (pops.length) bits.push(pops.map(function (p) { return p.name + ", " + p.role + (p.bl ? ", borderline" : "") + (p.lk ? ", linked by PopuliVerse" : ""); }).join("; "));
      else if (w.cab[5]) bits.push("government of " + w.cab[2] + ", with " + unlinked(w.cab).join(", ") + " not linked");
    }
    return bits.join(" · ");
  }

  function unlinked(k) {
    // The parties of a government that have no ID and no line in the list of links
    return k[4].filter(function (p) { return p[4] === null && p[0] !== "S" && !noParty(p); }).map(function (p) { return p[2] && p[2] !== "NA" ? p[2] : p[1]; });
  }

  function noParty(p) { return /^\s*(independents?|non-?partisans?|others?)\b/i.test(p[1]); }

  // ============================================================ download and link

  function viewWords() {
    return isNow() ? "Now, as reported by PopuliVerse Monitor " + (MON ? MON.issue : "") : S.year + ", on 1 July";
  }

  function sourceLines() {
    if (isNow()) return [
      "Source: PopuliVerse Monitor " + (MON ? MON.issue : "") + " (populiverse.com/monitor). Each actor is on the Monitor's list by a research dataset or a study, named on the actor's page (populiverse.com/actors).",
      "Map from Natural Earth. Licence of this picture: CC BY 4.0."
    ];
    return [
      "Sources: PPEG 2025v1 (Krause et al. 2025) for the parties in each government; The PopuList 4.0 (Rooduijn et al. 2024) for which of them are populist; Global Populism Database 2.1 (Hawkins et al. 2019) for heads of government; Party Facts, Version 2023 (Döring and Regel 2019) and PopuliVerse's own checked list (populiverse.com/data/links.csv) to link them; PopuliVerse Monitor for today. Full references: populiverse.com/data/sources.txt.",
      "Every verdict is the dataset's own. Map from Natural Earth. Data as built on " + PV.date(P.built) + ". Licence of this picture: CC BY 4.0."
    ];
  }

  function howNotes() {
    var out = [];
    if (isNow()) out.push("Now shows only the actors on the Monitor's list and whether they hold power as of its latest issue. An actor is on the list because a dataset or a study classed it at some time, so Now is not a new grading. For a leader on the list by the Global Populism Database, the brackets name the last term whose speeches it graded. A country without an actor is not a country without populists in power.");
    else {
      if (S.lens !== "leader") out.push("Parties: PPEG names the parties of the government in office on 1 July; The PopuList says which of them are populist. It covers 31 European countries. Striped means that " + BORDERLINE + ". Not known means that a party in the government has no Party Facts ID and no checked link, so it cannot be looked up.");
      if (S.lens !== "party") out.push("Heads of government: the Global Populism Database grades the speeches of presidents and prime ministers. A term with an average of 0.5 or more counts as populist (somewhat populist or above, in the words of its paper). A president counts only where he or she heads the government.");
      if (S.lens === "either") out.push("A country takes the stronger of the two views.");
      out.push("Hatched means not covered: no dataset holds that country for that year. The datasets end at different years, and the Global Populism Database grades only some terms. Not covered never means none.");
    }
    return out;
  }

  function mapFigure() {
    var groups = groupsOfYear(), y = +S.year, lists = [];
    ["3", "3b", "2", "2b", "1", "1b", "-1", "0"].forEach(function (k) {
      var list = groups[k] || [];
      if (!list.length) return;
      var s = ofKey(k);
      var text = list.map(function (iso) {
        if (s.v === 0) return name(iso);
        var who;
        if (y === NOW) who = (NOWWHO[iso] || []).map(function (a) {
          var ts = gradedTerms(a);
          return a.name + (ts.length ? ", last graded " + termSpan(ts[ts.length - 1]) : "");
        }).join("; ");
        else {
          var w = whoAt(iso, y), bits = [];
          if (w.lead && S.lens !== "party" && w.lead[4] >= 1) bits.push(w.lead[2] + " " + PV.num(w.lead[3]));
          if (w.cab && S.lens !== "leader") {
            var pops = populists(w.cab, y).map(function (p) { return p.name; });
            if (pops.length) bits.push(pops.join(", "));
            else if (s.v === -1) bits.push(unlinked(w.cab).join(", "));
          }
          who = bits.join("; ");
        }
        return name(iso) + (who ? " (" + who + ")" : "");
      }).join(", ");
      lists.push({ head: stateMeta(s.v).short + (s.bl ? ", borderline" : "") + " (" + list.length + ")", text: text + "." });
    });
    return {
      host: app,
      chart: function (holder, w) { return mapChart(holder, w, true); },
      title: PAGE_TITLE + ": " + (isNow() ? "Now" : S.year),
      lines: [viewWords() + ". " + (isNow() ? "" : "View: " + LENSES[S.lens].toLowerCase().replace("ppeg", "PPEG").replace("the popu", "The Popu").replace("global populism database", "Global Populism Database") + ".")],
      legend: legendItems(),
      lists: lists,
      notes: howNotes().concat(isNow() ? [] : ["In brackets: the populist parties in the government, or the head of government with the average of his or her speeches (0 to 2); for not known, the parties that could not be linked."]),
      sources: sourceLines(),
      cite: PV.citation(PAGE_TITLE, PAGE_URL)
    };
  }

  function countsFigure() {
    var data = counts(), nowN = nowCounts();
    function row(head, keys) {
      return { head: head, text: data.map(function (d) { return d.year + ": " + sum(d.n, keys); }).join(" · ") + (keys[0] === "-1" || keys[0] === "0" ? "" : " · Now: " + sum(nowN, keys)) + "." };
    }
    return {
      host: app,
      chart: function (holder, w) { return countsChart(holder, w, true); },
      title: "Countries by the Place of Populists in Their Government, " + P.from + " to Today",
      lines: ["Each bar is a year, on 1 July. View: " + LENSES[S.lens].toLowerCase().replace("ppeg", "PPEG").replace("the popu", "The Popu").replace("global populism database", "Global Populism Database") + ". The last bar, Now, is PopuliVerse Monitor " + (MON ? MON.issue : "") + " and counts only the actors on its list."],
      legend: (function () {
        var keep = S.year; S.year = String(P.from); var items = legendItems(); S.year = keep;
        return items.filter(function (k) { return k.v !== null; });
      })(),
      lists: [row("Leads", ["3", "3b"]), row("Partner", ["2", "2b"]), row("Supports", ["1", "1b"])]
        .concat(S.lens === "leader" ? [] : [row("Not known", ["-1"])]).concat([row("None", ["0"]), row("Covered", STACK)]),
      notes: ["The height of a bar is the number of countries the data cover in that year, so it changes from year to year. The numbers include the borderline cases, drawn striped."].concat((function () {
        var keep = S.year; S.year = String(P.from); var n = howNotes(); S.year = keep; return n;
      })()),
      sources: (function () { var keep = S.year; S.year = String(P.from); var l = sourceLines(); S.year = keep; return l; })(),
      cite: PV.citation(PAGE_TITLE, PAGE_URL)
    };
  }

  // The same filters, short, for the name of a saved view, as Events in Monitor
  // does it, so that two saved views of different years or of a different
  // dataset are told apart on the shelf (Fable's re-check of the trial build,
  // point 4d). The map is of one year; the chart of the years is of all of
  // them, so only the map is named by its year. "Now" comes from the Monitor's
  // own list, where the choice of dataset does not apply.
  var LENS_SHORT = { party: "Parties in Government", leader: "Heads of Government" };

  function titleFilters(withYear) {
    var bits = [];
    if (withYear) bits.push(isNow() ? "Now" : S.year);
    if (!(withYear && isNow()) && LENS_SHORT[S.lens]) bits.push("View: " + LENS_SHORT[S.lens]);
    return bits.length ? " (" + bits.join("; ") + ")" : "";
  }

  function drawTools() {
    ui.tools.innerHTML = "";
    ui.countTools.innerHTML = "";
    ui.tools.setAttribute("data-keep-title", "Populists in Power: the map" + titleFilters(true));
    ui.countTools.setAttribute("data-keep-title", "Populists in Power: year by year" + titleFilters(false));
    var stem = "populiverse-in-power-" + (isNow() ? "now" : S.year);
    var png = el("button", { type: "button", class: "pv-lib-link", text: "Map as a picture (PNG)" });
    png.addEventListener("click", function () { PV.save.picture(png, stem, "png", mapFigure); });
    var svg = el("button", { type: "button", class: "pv-lib-link", text: "Map (SVG)" });
    svg.addEventListener("click", function () { PV.save.picture(svg, stem, "svg", mapFigure); });
    var csv = el("button", { type: "button", class: "pv-lib-link", text: "Every country and year (CSV)" });
    csv.addEventListener("click", downloadCsv);
    var link = el("button", { type: "button", class: "pv-lib-link", text: "Copy the link to this view" });
    link.addEventListener("click", function () { PV.copy(window.location.href, link); });
    [png, svg, csv, el("a", { class: "pv-lib-link", href: "sources.txt", download: "populiverse-data-sources.txt", text: "Sources and licences" }), link].forEach(function (b) { ui.tools.appendChild(b); });
    PV.figureMaker(ui.tools, mapFigure);
    var png2 = el("button", { type: "button", class: "pv-lib-link", text: "This chart as a picture (PNG)" });
    png2.addEventListener("click", function () { PV.save.picture(png2, "populiverse-in-power-years", "png", countsFigure); });
    var svg2 = el("button", { type: "button", class: "pv-lib-link", text: "This chart (SVG)" });
    svg2.addEventListener("click", function () { PV.save.picture(svg2, "populiverse-in-power-years", "svg", countsFigure); });
    ui.countTools.appendChild(png2);
    ui.countTools.appendChild(svg2);
    PV.figureMaker(ui.countTools, countsFigure);
  }

  function word(s) { return s.v === null ? "not covered" : stateMeta(s.v).short.toLowerCase(); }

  function downloadCsv() {
    var rows = [["country", "country_code", "year", "state_either", "either_on_a_borderline_case", "state_parties_ppeg_popu_list", "parties_on_a_borderline_case", "state_heads_gpd",
      "government_on_1_july", "populist_parties_in_it", "parties_not_linked", "linked_by_populiverse", "head_of_government_counted", "gpd_average", "gpd_in_the_papers_words", "in_gpd_but_not_counted", "if_not_covered_why"]];
    Object.keys(P.countries).sort(function (a, b) { return name(a).localeCompare(name(b)); }).forEach(function (iso) {
      for (var y = P.from; y < NOW; y++) {
        var w = whoAt(iso, y), e = stateOf(iso, y, "either"), p = stateOf(iso, y, "party"), l = stateOf(iso, y, "leader");
        var pops = w.cab ? populists(w.cab, y) : [];
        var lines = [];
        pops.forEach(function (q) { if (q.lk && lines.indexOf(q.lk) < 0) lines.push(q.lk); });
        rows.push([name(iso), iso, y, word(e), e.bl ? "yes" : "", word(p), p.bl ? "yes" : "", word(l),
          w.cab ? w.cab[2] + ", from " + w.cab[0] : "",
          pops.map(function (q) { return q.name + " (" + q.role + (q.bl ? ", borderline" : "") + ")"; }).join("; "),
          w.cab ? unlinked(w.cab).join("; ") : "",
          lines.map(function (n) { return "line " + n; }).join("; "),
          w.lead ? w.lead[2] : "", w.lead ? w.lead[3] : "", w.lead ? PV.verdict.gpd(w.lead[4]).label.toLowerCase() : "",
          w.others.map(function (t) { return t[2] + (t[7] ? " (president)" : ""); }).join("; "),
          e.v === null ? whyNot(iso, y, "either") : ""]);
      }
    });
    Object.keys(NOWSTATE).sort(function (a, b) { return name(a).localeCompare(name(b)); }).forEach(function (iso) {
      var s = stateOf(iso, NOW, "either");
      rows.push([name(iso), iso, "now (" + (MON ? "Monitor " + MON.issue : "Monitor") + ")", word(s), s.bl ? "yes" : "", "", "", "", "",
        (NOWWHO[iso] || []).map(function (a) { return a.name + " (" + a.power + (a.src ? "; on the Monitor's list by " + a.src : "") + (basisShort(a) ? "; " + basisShort(a) : "") + ")"; }).join("; "), "", "", "", "", "", "", ""]);
    });
    rows.push([]);
    rows.push(["Every year is the state on 1 July. Every verdict is the dataset's own. A borderline case is a party that The PopuList calls borderline populist in that year. The Global Populism Database's words for a term's average are those of its paper; a term counts as populist from 0.5. A leader counts only where he or she heads the government. The rows of now show only the actors on the Monitor's list; an actor is on the list because a dataset or a study classed it at some time, so now is not a new grading. Not covered never means none."]);
    rows.push(["Sources and licences: https://populiverse.com/data/sources.txt. The list of links made by PopuliVerse: https://populiverse.com/data/links.csv."]);
    rows.push([PV.citation(PAGE_TITLE, PAGE_URL)]);
    PV.save.csv("populiverse-in-power-" + P.built + ".csv", rows);
  }

  // ============================================================ a country

  function openCountry(iso) {
    stop();
    var c = P.countries[iso] || { cab: [], lead: [], yp: {}, yb: {}, yl: {} };
    var region = { "europe": "Europe", "north-america": "North America", "latin-america": "Latin America", "asia-pacific": "Asia-Pacific", "mena": "Middle East and North Africa", "sub-saharan-africa": "Sub-Saharan Africa" }[P.places[iso] ? P.places[iso][2] : ""] || "";
    PV.panel.open(name(iso), region, function (body) {
      if (!isNow()) {
        // The year in view, in words; a year that is not covered says why
        var yv = +S.year, ys = stateOf(iso, yv, S.lens), line;
        if (ys.v === null) line = whyNot(iso, yv, S.lens) + " Not covered never means none.";
        else {
          var m = stateMeta(ys.v), who = whoLine(iso, yv);
          line = (S.lens === "leader" && ys.v === 3 ? "A populist heads the government" : m.label) + (ys.bl ? ", on a borderline case of The PopuList" : "") + "." + (who ? " " + who.charAt(0).toUpperCase() + who.slice(1) + "." : "");
        }
        body.appendChild(el("div", { class: "pv-dp-mark" }, [
          statePill(ys, "In " + yv + ": " + (ys.v === null ? "not covered" : stateMeta(ys.v).short.toLowerCase() + (ys.bl ? ", borderline" : ""))),
          el("p", { text: line + " On 1 July, in the view “" + LENSES[S.lens] + "”." })
        ]));
      }
      if (NOWSTATE[iso] !== undefined) {
        var ns = stateOf(iso, NOW, "either");
        body.appendChild(el("div", { class: "pv-dp-mark" }, [
          statePill(ns, "Now: " + stateMeta(ns.v).short.toLowerCase() + (ns.bl ? ", borderline" : "")),
          el("ul", { class: "pv-dp-list" }, (NOWWHO[iso] || []).map(function (a) {
            return el("li", {}, [el("a", { href: "../actors/" + a.id + ".html", text: a.name }), " · " + { leads: "leads the government", partner: "partner in government", supports: "supports the government from outside" }[a.power] +
              (a.src ? " · on the Monitor's list by " + a.src + (a.bl ? ", as a borderline case" : "") : "") + (a.why ? " · " + a.why : ""),
              basisLong(a) ? el("span", { class: "pv-ip-who", text: basisLong(a) }) : null]);
          })),
          el("p", { text: "As of PopuliVerse Monitor " + (MON ? MON.issue : "") + ". Only the actors on the Monitor's list are shown. An actor is on the list because a dataset or a study classed it at some time. Now is not a new grading." })
        ]));
      } else if (isNow()) {
        body.appendChild(el("div", { class: "pv-dp-mark" }, [
          PV.pill("Now: no actor on the Monitor's list", "is-out"),
          el("p", { text: "No actor on the Monitor's list is in the government here, as of PopuliVerse Monitor " + (MON ? MON.issue : "") + ". This is not a finding that no populist governs." })
        ]));
      }
      body.appendChild(countryTimeline(iso, c));
      // Presidents and prime ministers
      var lk = [];
      if (c.lead.length) {
        var tb = el("tbody"), anyCur = false;
        c.lead.slice().reverse().forEach(function (t) {
          var v = PV.verdict.gpd(t[4]);
          if (t[6]) anyCur = true;
          var counted = t[8] === 0 ? "Yes" : t[8] === 1 ? "No, not head of government" : "In " + rangesText(t[9]) + " only";
          tb.appendChild(el("tr", {}, [
            el("td", {}, [el("a", { href: "who-counts.html#" + t[5], text: t[2] }), t[7] ? el("span", { class: "pv-wc-via", text: "president" }) : null]),
            el("td", { text: PV.month(t[0]) + (t[6] ? " on, current in the file" : " to " + PV.month(t[1])) }),
            el("td", { text: PV.num(t[3]) }),
            el("td", {}, [PV.pill(v.label, v.cls, v.long)]),
            el("td", { text: counted })
          ]));
        });
        lk.push(el("div", { class: "pv-wc-scroll" }, [el("table", { class: "pv-dp-table" }, [el("thead", {}, [el("tr", {}, [el("th", { text: "Leader" }), el("th", { text: "Term" }), el("th", { text: "Average" }), el("th", { text: "In the paper's words" }), el("th", { text: "Counted" })])]), tb])]));
        lk.push(el("p", { class: "pv-dp-note", text: "The words are those of the database's paper (Hawkins et al. 2019): below 0.5 not populist, 0.5 to 0.99 somewhat populist, 1.0 to 1.49 populist, 1.5 and above very populist. On the map a term counts as populist from 0.5." }));
        lk.push(el("p", { class: "pv-dp-note", text: "A leader counts for a year only where he or she heads the government on 1 July: the person PPEG names for the cabinet, or the president where the cabinet is presidential or PPEG holds none. The others are shown here and not counted." }));
        var firstT = c.lead[0][0], lastT = c.lead.reduce(function (m, t) { return t[1] > m ? t[1] : m; }, "");
        lk.push(el("p", { class: "pv-dp-note", text: "The graded terms here run from " + PV.month(firstT) + " to " + (anyCur ? "the database's file of " + fileMonth() : PV.month(lastT)) + ". The database holds nothing here outside them, so those years are not covered. That never means not populist." }));
        if (anyCur) lk.push(el("p", { class: "pv-dp-note", text: "“Current” is the word of the database's file of " + fileMonth() + ". It says nothing about today." }));
      } else lk.push(el("p", { class: "pv-dp-note", text: "The Global Populism Database holds no term for this country." }));
      PV.section(body, "Presidents and Prime Ministers, Global Populism Database 2.1", lk);
      // Governments
      var gk = [];
      if (c.cab.length) {
        c.cab.slice().reverse().forEach(function (k) {
          var parts = k[4].map(function (p) {
            var role = { L: "head of government's party", P: "partner", S: "supports from outside" }[p[0]];
            var pop, cls = "";
            if (p[4] === null) pop = noParty(p) ? "no party" : "not linked, so it cannot be checked";
            else {
              var bits = [];
              if (p[4].length) bits.push("populist in " + rangesText(p[4]));
              if (p[5] && p[5].length) bits.push("borderline populist in " + rangesText(p[5]));
              pop = bits.length ? bits.join(", ") + ", by The PopuList" : "no populist label in The PopuList";
              if (bits.length) cls = "is-pop";
            }
            var nm = p[3] ? el("a", { href: "who-counts.html#" + p[3], text: p[1] }) : el("span", { text: p[1] });
            return el("li", { class: cls }, [nm, " · " + role + " · " + pop, p[6] ? " · " : null, p[6] ? PV.linkMark(p[6], P.links) : null]);
          });
          gk.push(el("div", { class: "pv-ip-cab" }, [
            el("p", { class: "pv-dp-strong" }, [statePill(cabBest(k)), " " + k[2] + ", " + PV.date(k[0]) + " to " + (k[1] === P.ppeg_end ? "the end of the data" : PV.date(k[1]))]),
            el("ul", { class: "pv-dp-list" }, parts)
          ]));
        });
        gk.push(el("p", { class: "pv-dp-note", text: "PPEG names the parties of each government and the party of its head. The PopuList says which of them are populist, through Party Facts IDs and, where marked, PopuliVerse's own list of links. A party with an ID and no populist label in The PopuList is not populist by its count. A party with no ID and no link cannot be checked, so its government shows as not known. Striped means that the place rests on a party The PopuList calls a borderline case. PPEG says its record of supporting parties may be incomplete." }));
        if (iso === "CHE") gk.push(el("p", { class: "pv-dp-note", text: "Switzerland has no head of government. PPEG names the President of the Confederation, who changes every year." }));
      } else gk.push(el("p", { class: "pv-dp-note", text: "Not covered. Here PPEG is read only for The PopuList's 31 European countries." }));
      PV.section(body, "Governments, PPEG 2025v1 with The PopuList 4.0", gk);
      // Monitor
      var mk = [];
      var items = MON ? MON.items.filter(function (it) { return it.iso.indexOf(iso) >= 0; }) : [];
      if (items.length) {
        items.sort(function (a, b) { return b.date.localeCompare(a.date); });
        mk.push(el("ul", { class: "pv-dp-list" }, items.slice(0, 10).map(function (it) {
          return el("li", {}, [it.date.length === 7 ? PV.month(it.date) : PV.date(it.date), " · ", it.type, " · ", el("a", { href: "../monitor/" + it.folder + "/index.html#item-" + it.n, text: it.title }), " (" + it.issue + ", item " + it.n + ")"]);
        })));
        var tag = P.places[iso] ? P.places[iso][6] : "";
        if (tag) mk.push(el("p", {}, [el("a", { href: "../countries/" + tag + ".html", text: "All " + items.length + " items on " + name(iso) })]));
      } else mk.push(el("p", { class: "pv-dp-note", text: "No item yet." }));
      PV.section(body, "In the Monitor", mk);
      // Cite and more
      var src = P.sources;
      body.appendChild(el("section", { class: "pv-dp-sec" }, [
        el("h3", { text: "Cite the Datasets" }),
        el("ul", { class: "pv-dp-cites" }, PV.citeItems([src.pp, src.pl, src.gd, src.pf])),
        el("p", { class: "pv-dp-note", text: "Found an error? Write to editor@populiverse.com and name this page and " + name(iso) + "." })
      ]));
    }, iso);
  }

  function countryTimeline(iso, c) {
    var W = 380, x0 = P.from, x1 = NOW, lane = 16, top = 16;
    var x = function (y) { return 64 + (W - 70) * (y - x0) / (x1 + 1 - x0); };
    var xd = function (d) { var y = +d.slice(0, 4), doy = (Date.parse(d) - Date.parse(y + "-01-01")) / 31536000000; return x(y + Math.max(0, Math.min(1, doy))); };
    var H = top + 3 * (lane + 10) + 18;
    var s = '<svg width="100%" viewBox="0 0 ' + W + " " + H + '" class="pv-dp-svg" role="img" aria-label="Timeline of ' + PV.esc(name(iso)) + '">' + PV.defsText("-p");
    var labels = ["Heads", "Governments", "Monitor"];
    labels.forEach(function (l, i) {
      var y = top + i * (lane + 10);
      s += '<text x="0" y="' + (y + 12) + '" font-size="10" fill="#4A4A4A">' + l + "</text>";
      s += '<rect x="' + x(x0) + '" y="' + y + '" width="' + (x(x1 + 1) - x(x0)) + '" height="' + lane + '" fill="url(#pv-hatch-p)"/>';
    });
    c.lead.forEach(function (t) {
      var a = t[0] < x0 + "-01-01" ? x0 + "-01-01" : t[0];
      var v = PV.verdict.gpd(t[4]);
      var tip = PV.esc(t[2]) + ", " + t[0].slice(0, 4) + (t[6] ? " on" : " to " + t[1].slice(0, 4)) + ", average " + PV.num(t[3]) + ", " + v.label.toLowerCase();
      var w = Math.max(1.5, xd(t[1]) - xd(a) - 0.6);
      // A president who does not head the government: an outline only, half the lane
      if (t[8] === 1) s += '<rect x="' + xd(a) + '" y="' + (top + lane - 5) + '" width="' + w + '" height="4" fill="' + v.fill + '" stroke="#8E8B83" stroke-width="0.5"><title>' + tip + ", not head of government, not counted</title></rect>";
      else s += '<rect x="' + xd(a) + '" y="' + top + '" width="' + w + '" height="' + (lane - 6) + '" fill="' + v.fill + '"><title>' + tip + "</title></rect>";
    });
    c.cab.forEach(function (k) {
      var a = k[0] < x0 + "-01-01" ? x0 + "-01-01" : k[0];
      var st = cabState(k, +a.slice(0, 4));
      s += '<rect x="' + xd(a) + '" y="' + (top + lane + 10) + '" width="' + Math.max(1.2, xd(k[1]) - xd(a) - 0.6) + '" height="' + lane + '" fill="' + fillOf(st, "-p") + '"><title>' + PV.esc(k[2]) + ", " + k[0] + " to " + k[1] + "</title></rect>";
    });
    if (NOWSTATE[iso] !== undefined) s += '<rect x="' + x(NOW) + '" y="' + (top + 2 * (lane + 10)) + '" width="' + (x(NOW + 1) - x(NOW)) + '" height="' + lane + '" fill="' + fillOf(stateOf(iso, NOW, "either"), "-p") + '"><title>Now, as of the Monitor</title></rect>';
    if (MON) MON.items.forEach(function (it) {
      if (it.iso.indexOf(iso) < 0 || !/^\d{4}-\d{2}/.test(it.date)) return;
      s += '<circle cx="' + xd(it.date.length === 7 ? it.date + "-15" : it.date) + '" cy="' + (top + 2 * (lane + 10) + lane / 2) + '" r="2.4" fill="#111"><title>' + PV.esc(it.title) + "</title></circle>";
    });
    [1990, 2000, 2010, 2020].forEach(function (y) { s += '<text x="' + x(y) + '" y="' + (H - 4) + '" font-size="9" fill="#4A4A4A" text-anchor="middle">' + y + "</text>"; });
    s += "</svg>";
    var d = el("div", { class: "pv-dp-chart" });
    d.innerHTML = s;
    d.appendChild(el("p", { class: "pv-dp-note", text: "Governments: dark, a populist party leads; mid, it is a partner; light, it supports from outside; striped, a borderline case; grey, none; crossed, not known. Heads: the darker, the more populist the speeches; a thin bar below is a president who does not head the government. Hatched, not covered. Dots are Monitor items." }));
    return d;
  }

  function statePill(s, text) {
    var cls = { 3: "is-p3", 2: "is-p2", 1: "is-p1", 0: "is-no", "-1": "is-cross" }[String(s.v)] || "is-out";
    return PV.pill(text || stateMeta(s.v).short + (s.bl ? ", borderline" : ""), cls + (s.bl ? " is-bl" : ""));
  }

  function debounce(f, ms) { var t; return function () { window.clearTimeout(t); t = window.setTimeout(f, ms); }; }
})();
