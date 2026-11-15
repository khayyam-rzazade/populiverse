/* PopuliVerse Workspace: the editor's desk (master plan, section 18, the row on
 * batch 1, point 4). Counts of accounts and use, the invitations, the switch
 * that opens the workspace, and a download of the accounts.
 *
 * The server gives this page counts and accounts only. It never gives it a word
 * of what anyone writes, so this page could not show it even by mistake.
 */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  // The site's muted slate, light to dark (the Edition look; no party colours).
  var SLATE = ["#E4E2DC", "#B9C4C8", "#7E9198", "#4A5F66", "#2B3A3F"];
  var ACCOUNTS = "#4A5F66";
  var GUESTS = "#B9C4C8";
  var A2NUM = {"AW":"533","AF":"004","AO":"024","AI":"660","AX":"248","AL":"008","AD":"020","AE":"784","AR":"032","AM":"051","AS":"016","AQ":"010","TF":"260","AG":"028","AU":"036","AT":"040","AZ":"031","BI":"108","BE":"056","BJ":"204","BQ":"535","BF":"854","BD":"050","BG":"100","BH":"048","BS":"044","BA":"070","BL":"652","BY":"112","BZ":"084","BM":"060","BO":"068","BR":"076","BB":"052","BN":"096","BT":"064","BV":"074","BW":"072","CF":"140","CA":"124","CC":"166","CH":"756","CL":"152","CN":"156","CI":"384","CM":"120","CD":"180","CG":"178","CK":"184","CO":"170","KM":"174","CV":"132","CR":"188","CU":"192","CW":"531","CX":"162","KY":"136","CY":"196","CZ":"203","DE":"276","DJ":"262","DM":"212","DK":"208","DO":"214","DZ":"012","EC":"218","EG":"818","ER":"232","EH":"732","ES":"724","EE":"233","ET":"231","FI":"246","FJ":"242","FK":"238","FR":"250","FO":"234","FM":"583","GA":"266","GB":"826","GE":"268","GG":"831","GH":"288","GI":"292","GN":"324","GP":"312","GM":"270","GW":"624","GQ":"226","GR":"300","GD":"308","GL":"304","GT":"320","GF":"254","GU":"316","GY":"328","HK":"344","HM":"334","HN":"340","HR":"191","HT":"332","HU":"348","ID":"360","IM":"833","IN":"356","IO":"086","IE":"372","IR":"364","IQ":"368","IS":"352","IL":"376","IT":"380","JM":"388","JE":"832","JO":"400","JP":"392","KZ":"398","KE":"404","KG":"417","KH":"116","KI":"296","KN":"659","KR":"410","KW":"414","LA":"418","LB":"422","LR":"430","LY":"434","LC":"662","LI":"438","LK":"144","LS":"426","LT":"440","LU":"442","LV":"428","MO":"446","MF":"663","MA":"504","MC":"492","MD":"498","MG":"450","MV":"462","MX":"484","MH":"584","MK":"807","ML":"466","MT":"470","MM":"104","ME":"499","MN":"496","MP":"580","MZ":"508","MR":"478","MS":"500","MQ":"474","MU":"480","MW":"454","MY":"458","YT":"175","NA":"516","NC":"540","NE":"562","NF":"574","NG":"566","NI":"558","NU":"570","NL":"528","NO":"578","NP":"524","NR":"520","NZ":"554","OM":"512","PK":"586","PA":"591","PN":"612","PE":"604","PH":"608","PW":"585","PG":"598","PL":"616","PR":"630","KP":"408","PT":"620","PY":"600","PS":"275","PF":"258","QA":"634","RE":"638","RO":"642","RU":"643","RW":"646","SA":"682","SD":"729","SN":"686","SG":"702","GS":"239","SH":"654","SJ":"744","SB":"090","SL":"694","SV":"222","SM":"674","SO":"706","PM":"666","RS":"688","SS":"728","ST":"678","SR":"740","SK":"703","SI":"705","SE":"752","SZ":"748","SX":"534","SC":"690","SY":"760","TC":"796","TD":"148","TG":"768","TH":"764","TJ":"762","TK":"772","TM":"795","TL":"626","TO":"776","TT":"780","TN":"788","TR":"792","TV":"798","TW":"158","TZ":"834","UG":"800","UA":"804","UM":"581","UY":"858","US":"840","UZ":"860","VA":"336","VC":"670","VE":"862","VG":"092","VI":"850","VN":"704","VU":"548","WF":"876","WS":"882","YE":"887","ZA":"710","ZM":"894","ZW":"716"};

  window.PVDesk = function (ctx) {
    var api = ctx.api, h = ctx.h, me = ctx.me, countryName = ctx.countryName;
    var W = window.PVW;

    function s(tag, attrs) {
      var el = document.createElementNS(SVGNS, tag);
      Object.keys(attrs || {}).forEach(function (k) { if (k === "text") el.textContent = attrs[k]; else el.setAttribute(k, attrs[k]); });
      for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
      return el;
    }

    // One tooltip for every chart on the desk.
    var tip = h("div", { class: "pv-ws-tip", role: "tooltip", hidden: true });
    document.body.appendChild(tip);
    function hover(el, text) {
      el.addEventListener("mousemove", function (e) {
        tip.textContent = text;
        tip.hidden = false;
        var x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
        tip.style.left = x + "px";
        tip.style.top = e.clientY + 14 + "px";
      });
      el.addEventListener("mouseleave", function () { tip.hidden = true; });
      el.appendChild(s("title", { text: text }));
    }

    var root = h("div", { class: "pv-ws-desk" });
    ctx.show(W.head(me, "desk"), root);
    load();

    function load() {
      api("/api/desk/summary").then(function (r) {
        if (!r.ok) { root.textContent = r.data.error || "The desk could not load."; return; }
        draw(r.data);
      });
    }

    function draw(d) {
      while (root.firstChild) root.removeChild(root.firstChild);
      var tiles = [
        [d.accounts, "Accounts"],
        [d.activeAccounts30, "Accounts used in the last 30 days"],
        [d.activeGuests, "Guests now"],
        [d.newsletter, "Asked for the newsletter"],
        [d.orcid, "With ORCID connected"],
        [d.countries.length, d.countries.length === 1 ? "Country" : "Countries"]
      ];
      root.appendChild(h("div", { class: "pv-wc-stats pv-ws-tiles" }, tiles.map(function (t) {
        return h("div", { class: "pv-wc-stat" }, h("span", { class: "pv-wc-stat-n", text: String(t[0]) }), h("span", { class: "pv-wc-stat-l", text: t[1] }));
      })));

      var notes = [];
      if (d.unfinished) notes.push(d.unfinished + (d.unfinished === 1 ? " person has" : " people have") + " signed in with a code but not finished the account.");
      if (d.newsletterFailed) notes.push(d.newsletterFailed + " newsletter sign-up" + (d.newsletterFailed === 1 ? " did" : "s did") + " not reach Sender. They are marked in the download of the accounts.");
      notes.forEach(function (n) { root.appendChild(h("p", { class: "pv-ws-small", text: n })); });

      root.appendChild(block("Sign-Ups by Week", "The last 26 weeks. An account counts in the week it was finished; a guest in the week it started.", weeks(d.weeks)));
      root.appendChild(block("Where They Are", "Accounts by the country of their institution.", countries(d.countries)));
      root.appendChild(block("Institutions", null, institutions(d.institutions)));
      root.appendChild(h("div", { class: "pv-ws-pair" },
        block("Positions", null, bars(d.positions, d.accounts)),
        block("Fields", null, bars(d.fields, d.accounts))));
      root.appendChild(block("Who May Sign Up", null, access(d)));
      root.appendChild(block("The Accounts", null, h("p", null,
        h("button", { class: "pv-button", type: "button", onclick: downloadCsv }, "Download the Accounts"),
        h("span", { class: "pv-ws-small", text: " One spreadsheet file: names, emails, institutions, positions, fields, ORCID and newsletter." }))));
      root.appendChild(h("p", { class: "pv-ws-promise" }, "This desk counts accounts and use. It never shows what anyone writes: the server does not give it."));
    }

    function block(title, lede, content) {
      return h("section", { class: "pv-ws-section" }, h("h2", { class: "pv-ws-h", text: title }), lede ? h("p", { class: "pv-ws-small", text: lede }) : null, content);
    }

    // ---------------------------------------------------------- Sign-ups by week

    function weeks(rows) {
      var WID = 760, HEI = 220, L = 34, R = 22, B = 26, T = 22;
      var max = Math.max(1, d3max(rows.map(function (r) { return r.accounts + r.guests; })));
      var step = niceStep(max);
      var top = Math.ceil(max / step) * step;
      var bw = (WID - L - R) / rows.length;
      var y = function (v) { return HEI - B - (v / top) * (HEI - B - T); };
      var svg = s("svg", { viewBox: "0 0 " + WID + " " + HEI, class: "pv-ws-chart", role: "img", "aria-label": "Sign-ups by week: accounts and guests, the last 26 weeks" });
      for (var v = 0; v <= top; v += step) {
        svg.appendChild(s("line", { x1: L, x2: WID - R, y1: y(v), y2: y(v), stroke: "#E4E2DC", "stroke-width": 1 }));
        svg.appendChild(s("text", { x: L - 6, y: y(v) + 3, "text-anchor": "end", "font-size": 10, fill: "#4A4A4A", text: String(v) }));
      }
      rows.forEach(function (r, i) {
        var x = L + i * bw + 2;
        var w = Math.max(2, bw - 4);
        var label = "Week of " + new Date(r.week + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) +
          ": " + r.accounts + (r.accounts === 1 ? " account, " : " accounts, ") + r.guests + (r.guests === 1 ? " guest" : " guests");
        var g = s("g", { class: "pv-ws-hit" });
        g.appendChild(s("rect", { x: L + i * bw, y: T, width: bw, height: HEI - B - T, fill: "transparent" }));
        if (r.accounts) g.appendChild(s("rect", { x: x, y: y(r.accounts), width: w, height: y(0) - y(r.accounts), fill: ACCOUNTS }));
        if (r.guests) {
          var gap = r.accounts ? 2 : 0;
          g.appendChild(s("rect", { x: x, y: y(r.accounts + r.guests), width: w, height: Math.max(0, y(r.accounts) - y(r.accounts + r.guests) - gap), fill: GUESTS }));
        }
        hover(g, label);
        svg.appendChild(g);
        if (i % 4 === 1 || i === rows.length - 1) {
          svg.appendChild(s("text", { x: L + i * bw + bw / 2, y: HEI - 8, "text-anchor": "middle", "font-size": 10, fill: "#4A4A4A",
            text: new Date(r.week + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) }));
        }
      });
      svg.appendChild(s("line", { x1: L, x2: WID - R, y1: y(0), y2: y(0), stroke: "#111111", "stroke-width": 1 }));
      var legend = h("p", { class: "pv-ws-legend" },
        h("span", { class: "pv-ws-key", style: "background:" + ACCOUNTS }), "Accounts  ",
        h("span", { class: "pv-ws-key", style: "background:" + GUESTS }), "Guests");
      var table = h("table", { class: "pv-ws-table" }, h("thead", null, h("tr", null, h("th", { text: "Week of" }), h("th", { text: "Accounts" }), h("th", { text: "Guests" }))),
        h("tbody", null, rows.slice().reverse().map(function (r) {
          return h("tr", null, h("td", { text: r.week }), h("td", { text: String(r.accounts) }), h("td", { text: String(r.guests) }));
        })));
      return [legend, h("div", { class: "pv-ws-chart-wrap" }, svg), details("Show as a table", table)];
    }

    function details(summary, content) {
      return h("details", { class: "pv-ws-details-t" }, h("summary", { text: summary }), content);
    }

    // ---------------------------------------------------------- The map

    function countries(rows) {
      var wrap = h("div", { class: "pv-ws-map" });
      var mapBox = h("div", { class: "pv-ws-map-svg" });
      var list = h("ol", { class: "pv-ws-rank" }, rows.length ? rows.map(function (r) {
        return h("li", null, h("span", { text: countryName(r.value) }), h("span", { class: "pv-ws-rank-n", text: String(r.n) }));
      }) : h("li", { class: "pv-ws-empty", text: "No accounts yet." }));
      wrap.appendChild(mapBox);
      wrap.appendChild(list);
      if (!window.d3 || !window.topojson) { mapBox.appendChild(h("p", { class: "pv-ws-small", text: "The map could not load." })); return wrap; }
      fetch("../data/world.json").then(function (r) { return r.json(); }).then(function (world) {
        var byNum = {};
        var kosovo = 0;
        rows.forEach(function (r) { if (r.value === "XK") kosovo = r.n; else if (A2NUM[r.value]) byNum[A2NUM[r.value]] = r; });
        var max = Math.max(1, d3max(rows.map(function (r) { return r.n; })));
        // Four steps of one hue, light to dark; no accounts is the paper grey.
        var shade = function (n) { return !n ? SLATE[0] : SLATE[Math.min(4, 1 + Math.floor((n / max) * 3.999))]; };
        var WID = 760, HEI = 380;
        var svg = s("svg", { viewBox: "0 0 " + WID + " " + HEI, class: "pv-ws-chart", role: "img", "aria-label": "Map of accounts by country" });
        var proj = window.d3.geoNaturalEarth1().fitExtent([[4, 4], [WID - 4, HEI - 4]], { type: "Sphere" });
        var path = window.d3.geoPath(proj);
        svg.appendChild(s("path", { d: path({ type: "Sphere" }), fill: "#FFFFFF", stroke: "#D9D9D6" }));
        window.topojson.feature(world, world.objects.countries).features.forEach(function (f) {
          var isK = !f.id && f.properties && f.properties.name === "Kosovo";
          var row = isK ? (kosovo ? { value: "XK", n: kosovo } : null) : byNum[f.id];
          var p = s("path", { d: path(f), fill: shade(row && row.n), stroke: "#FCFCFB", "stroke-width": 0.5 });
          if (row) hover(p, countryName(row.value) + ": " + row.n + (row.n === 1 ? " account" : " accounts"));
          svg.appendChild(p);
        });
        mapBox.appendChild(svg);
        mapBox.appendChild(h("p", { class: "pv-ws-legend" },
          h("span", { class: "pv-ws-key", style: "background:" + SLATE[0] }), "None  ",
          h("span", { class: "pv-ws-key", style: "background:" + SLATE[1] }), "Fewer  ",
          h("span", { class: "pv-ws-key", style: "background:" + SLATE[4] }), "More (" + max + ")"));
      }, function () { mapBox.appendChild(h("p", { class: "pv-ws-small", text: "The map could not load." })); });
      return wrap;
    }

    // ---------------------------------------------------------- Lists

    function institutions(rows) {
      if (!rows.length) return h("p", { class: "pv-ws-small", text: "No accounts yet." });
      var tbody = h("tbody");
      var table = h("table", { class: "pv-ws-table" },
        h("thead", null, h("tr", null, h("th", { text: "Institution" }), h("th", { text: "Country" }), h("th", { class: "is-n", text: "Accounts" }))), tbody);
      function fill(n) {
        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
        rows.slice(0, n).forEach(function (r) {
          tbody.appendChild(h("tr", null,
            h("td", null, r.ror ? h("a", { href: "https://ror.org/" + r.ror, rel: "noopener", text: r.name }) : h("span", { text: r.name + " (typed by hand)" })),
            h("td", { text: countryName(r.country) }), h("td", { class: "is-n", text: String(r.n) })));
        });
      }
      fill(15);
      return [table, rows.length > 15 ? h("p", null, h("button", { class: "pv-lib-link", type: "button", onclick: function () { fill(rows.length); this.remove(); } }, "Show all " + rows.length)) : null];
    }

    function bars(rows, total) {
      if (!rows.length) return h("p", { class: "pv-ws-small", text: "None given yet." });
      var max = d3max(rows.map(function (r) { return r.n; }));
      return h("ul", { class: "pv-ws-bars" }, rows.map(function (r) {
        return h("li", null,
          h("span", { class: "pv-ws-bars-l", text: r.value }),
          h("span", { class: "pv-ws-bars-track" }, h("span", { class: "pv-ws-bars-fill", style: "width:" + Math.max(2, (r.n / max) * 100) + "%" })),
          h("span", { class: "pv-ws-bars-n", text: r.n + (total ? " (" + Math.round((r.n / total) * 100) + "%)" : "") }));
      }));
    }

    // ---------------------------------------------------------- Who may sign up

    function access(d) {
      var box = h("div", { class: "pv-ws-access" });
      var state = h("p", { class: "pv-ws-access-state" },
        d.open ? "Open to everyone. Anyone can sign up, and guests are welcome." : "By invitation. Only the emails below can sign up, and there is no guest door.");
      var toggle = h("button", { class: "pv-button" + (d.open ? " pv-ws-ghost" : ""), type: "button", onclick: function () {
        toggle.disabled = true;
        api("/api/desk/open", { method: "POST", body: { open: !d.open } }).then(function () { load(); });
      } }, d.open ? "Close It to Invitations Only" : "Open It to Everyone");
      var area = h("textarea", { id: "ws-invites", rows: "3", placeholder: "One or more emails, separated by commas or new lines" });
      var msg = h("p", { class: "pv-ws-small", "aria-live": "polite" });
      var list = h("ul", { class: "pv-ws-invites" });
      var addBtn = h("button", { class: "pv-button", type: "button", onclick: function () {
        api("/api/desk/invites", { method: "POST", body: { emails: area.value } }).then(function (r) {
          if (!r.ok) { msg.textContent = r.data.error; return; }
          msg.textContent = r.data.added.length + " added." + (r.data.notEmails.length ? " Not emails: " + r.data.notEmails.join(", ") : "");
          area.value = "";
          refresh();
        });
      } }, "Invite");
      function refresh() {
        api("/api/desk/invites").then(function (r) {
          while (list.firstChild) list.removeChild(list.firstChild);
          (r.data.invites || []).forEach(function (i) {
            list.appendChild(h("li", null, h("span", { text: i.email }),
              h("span", { class: "pv-ws-small", text: i.joined ? "joined" : "not yet" }),
              h("button", { class: "pv-lib-link", type: "button", onclick: function () {
                api("/api/desk/invites", { method: "DELETE", body: { email: i.email } }).then(refresh);
              } }, "Remove")));
          });
          if (!list.firstChild) list.appendChild(h("li", { class: "pv-ws-empty", text: "No one invited yet." }));
        });
      }
      refresh();
      box.appendChild(state);
      box.appendChild(toggle);
      box.appendChild(h("label", { for: "ws-invites", class: "pv-wc-label pv-ws-gap" }, "Invite by email"));
      box.appendChild(area);
      box.appendChild(addBtn);
      box.appendChild(msg);
      box.appendChild(list);
      box.appendChild(h("p", { class: "pv-ws-small", text: "An invitation is a place on this list. Write to the person yourself; the workspace sends no invitations." }));
      return box;
    }

    function downloadCsv() {
      api("/api/desk/accounts.csv", { raw: true }).then(function (res) {
        if (!res.ok) return;
        var name = ((res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/) || [])[1] || "populiverse-accounts.csv";
        res.blob().then(function (b) {
          var url = URL.createObjectURL(b);
          var a = h("a", { href: url, download: name });
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        });
      });
    }

    function d3max(a) { return a.reduce(function (m, v) { return v > m ? v : m; }, 0); }
    function niceStep(max) { return max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.pow(10, Math.floor(Math.log10(max))); }
  };
})();
