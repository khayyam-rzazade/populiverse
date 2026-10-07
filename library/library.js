/* PopuliVerse Library: the page that lists the works.
 *
 * It reads the light list of works (written by the nightly sync), then draws the
 * search box, the filters with their counts and the list of works. The abstracts
 * and the BibTeX entries are a second, much larger file, fetched only when a
 * visitor first searches, opens an abstract or asks for BibTeX. It uses no
 * outside library and loads nothing from any other server.
 *
 * What a visitor can do:
 *   - search in titles, authors, journals, abstracts and tags;
 *   - filter by approach, topic, region, country, method, type, year, journal
 *     and open access (inside one group the choices add up; across groups a
 *     work must fit all of them);
 *   - copy the BibTeX of one work, or download the works shown as BibTeX or CSV;
 *   - copy a link that reopens the page with the same search and filters.
 *
 * The filters live in the page address, for example
 *   library/?approach=ideational&topic=foreign-policy,government&from=2015
 */
(function () {
  "use strict";

  var root = document.getElementById("library-app");
  if (!root) return;

  // The data comes in two steps, so that the list shows quickly:
  //   SOURCE  the list itself (titles, authors, journals, tags, citations)
  //   TEXT    the abstracts and the BibTeX entries, fetched only when first needed
  //   FULL    the one complete file: the way back if the light list cannot be loaded
  // scripts/split_library.py makes SOURCE and TEXT from FULL every night.
  var SOURCE = root.getAttribute("data-source") || "library.json";
  var TEXT = root.getAttribute("data-text") || "";
  var FULL = root.getAttribute("data-full") || "";
  var textState = "none";           // "none": one file held everything. When there is a TEXT file:
                                    // "idle" (not asked for yet), then "loading", "ready" or "failed".
  var textWaiters = [];             // what to do as soon as the abstracts and BibTeX are here
  var byId = {};                    // id of a work -> the work
  var ZOTERO = root.getAttribute("data-zotero") || "";
  var PAGE_SIZE = 50;               // works drawn at first; "Show more" adds as many again

  // The filter groups that come from taxonomy.yml, in the order shown.
  //   open: unfolded when the page opens;  all: show every tag, even with no work yet
  var GROUPS = [
    { key: "approach", open: true,  all: true  },
    { key: "topic",    open: true,  all: true  },
    { key: "region",   open: true,  all: true  },
    { key: "country",  open: false, all: false },
    { key: "method",   open: false, all: true  },
    { key: "type",     open: false, all: true  }
  ];
  var TAG_KEYS = ["approach", "topic", "region", "country", "method", "type"];
  var SHORT = { approach: "Approach", topic: "Topic", region: "Region", country: "Country", method: "Method" };
  var SORTS = [
    ["author", "Author, A to Z"],
    ["newest", "Newest first"],
    ["oldest", "Oldest first"],
    ["added",  "Recently added"]
  ];

  var taxonomy = {};                // from library.json
  var label = {};                   // tag -> name shown
  var works = [];                   // the works, prepared for searching
  var state = { q: "", sort: "author", from: null, to: null, oa: false, sel: {} };
  var shown = PAGE_SIZE;
  var ui = {};                      // the parts of the page that get updated

  // ---------------------------------------------------------------- helpers

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "text") node.textContent = v;
        else if (k === "class") node.className = v;
        else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  // Lower case, accents removed: "Taş" is found by typing "tas".
  function fold(s) {
    return String(s === null || s === undefined ? "" : s)
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\u0131/g, "i").replace(/\u00df/g, "ss").replace(/\u00f8/g, "o").replace(/\u0142/g, "l");
  }

  function idOf(tag) { return tag.slice(tag.indexOf(":") + 1); }

  function nameOf(tag) { return label[tag] || idOf(tag); }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  // ---------------------------------------------------------------- the data

  function prepare(data) {
    taxonomy = data.taxonomy || {};
    Object.keys(taxonomy).forEach(function (k) {
      (taxonomy[k].tags || []).forEach(function (t) { label[t.tag] = t.label; });
    });
    works = (data.entries || []).map(function (e, i) {
      var people = (e.authors || []).concat(e.editors || []).map(function (p) {
        return [p.given, p.family].filter(Boolean).join(" ");
      });
      var tags = [].concat(e.approach || [], e.topic || [], e.region || [], e.country || [], e.method || []);
      var journal = (e.type === "type:article" || e.type === "type:book-review") ? (e.container || "") : "";
      return {
        e: e,
        order: i,                                   // library.json is sorted by author, then year
        year: typeof e.year === "number" ? e.year : null,
        journal: journal,
        values: {
          approach: e.approach || [], topic: e.topic || [], region: e.region || [],
          country: e.country || [], method: e.method || [],
          type: e.type ? [e.type] : [], journal: journal ? [journal] : []
        },
        base: fold([e.title, people.join(" "), e.container, e.publisher, e.year,
                    tags.map(nameOf).join(" "), e.type ? nameOf(e.type) : "", e.doi].join(" ")),
        text: ""
      };
    });
    works.forEach(function (w) {
      w.text = w.e.abstract ? w.base + " " + fold(w.e.abstract) : w.base;
      byId[w.e.id] = w;
    });
  }

  // The abstracts and the BibTeX entries have arrived: each work gets its own,
  // the search covers the abstracts from now on, and what is on the page is filled in.
  function attachText(data) {
    var map = (data && data.text) || {};
    works.forEach(function (w) {
      var t = map[w.e.id];
      if (!t) return;
      if (t.abstract) { w.e.abstract = t.abstract; w.text = w.base + " " + fold(t.abstract); }
      if (t.bibtex) w.e.bibtex = t.bibtex;
    });
    textState = "ready";
    flushWaiters();
    if (state.q) { refresh(false); return; }       // a search is on: its results now count the abstracts too
    fillText();
  }

  // Everything that was waiting for the abstracts and the BibTeX runs once, in order.
  function flushWaiters() {
    var waiting = textWaiters;
    textWaiters = [];
    waiting.forEach(function (cb) { try { cb(); } catch (err) { complain(err); } });
  }

  // The abstracts and the BibTeX entries sit in a separate file, several times the
  // size of the list itself. It is fetched the first time a visitor actually needs
  // it: a search (which looks inside abstracts), an "Abstract" button, or any
  // BibTeX. Someone who opens the Library, reads the list and leaves never
  // downloads it at all.
  function needText() {
    if (textState !== "idle") return;
    textState = "loading";
    fillText();
    getJSON(TEXT).then(attachText).catch(function (err) {
      complain(err);
      textState = "failed";
      flushWaiters();
      fillText();
    });
  }

  // Runs cb straight away if the text is settled; otherwise asks for the file and
  // runs cb once it has arrived (or once it is clear that it will not).
  function whenText(cb) {
    if (textState === "ready" || textState === "failed" || textState === "none") { cb(); return; }
    textWaiters.push(cb);
    needText();
  }

  // Whether a work has BibTeX at all, and whether its button should be live.
  function bibPossible(e) { return !!(e.bibtex || e.has_bibtex === true); }
  function bibLive(e) { return bibPossible(e) && textState !== "failed"; }

  function waitingText() {
    return textState === "failed" ? "The abstract could not be loaded. Reload the page in a moment."
                                  : "Loading the abstract\u2026";
  }

  // Fills in the abstracts and switches on the BibTeX buttons of the works that are on the page.
  function fillText() {
    if (!ui.list) return;
    Array.prototype.forEach.call(ui.list.querySelectorAll(".pv-lib-abstract"), function (p) {
      var w = byId[p.id.slice(4)];
      p.textContent = (w && w.e.abstract) || waitingText();
    });
    Array.prototype.forEach.call(ui.list.querySelectorAll("button[data-bib]"), function (b) {
      if (b.hasAttribute("data-busy")) return;     // it is fetching: leave it as it is
      var w = byId[b.getAttribute("data-bib")];
      b.disabled = !(w && bibLive(w.e));
    });
    if (ui.bib && !ui.bib.hasAttribute("data-busy")) {
      ui.bib.disabled = !current().some(function (w) { return bibLive(w.e); });
    }
  }

  // ---------------------------------------------------------------- the page address

  function emptySelection() {
    var sel = {};
    TAG_KEYS.concat(["journal"]).forEach(function (k) { sel[k] = new Set(); });
    return sel;
  }

  function readAddress() {
    var p = new URLSearchParams(window.location.search);
    var years = works.map(function (w) { return w.year; }).filter(Boolean);
    // The search travels as "search=": Quarto's own site search uses "q=" and removes it.
    state.q = (p.get("search") || "").trim();
    state.sort = SORTS.some(function (s) { return s[0] === p.get("sort"); }) ? p.get("sort") : "author";
    state.oa = p.get("oa") === "1";
    var from = parseInt(p.get("from"), 10), to = parseInt(p.get("to"), 10);
    state.from = years.indexOf(from) >= 0 || (from > 1000 && from < 3000) ? from : null;
    state.to = years.indexOf(to) >= 0 || (to > 1000 && to < 3000) ? to : null;
    state.sel = emptySelection();
    TAG_KEYS.forEach(function (k) {
      (p.get(k) || "").split(",").forEach(function (id) {
        var tag = k + ":" + id.trim();
        if (id && label[tag]) state.sel[k].add(tag);       // unknown tags in a link are ignored
      });
    });
    var journals = new Set(works.map(function (w) { return w.journal; }).filter(Boolean));
    p.getAll("journal").forEach(function (j) { if (journals.has(j)) state.sel.journal.add(j); });
  }

  function addressQuery() {
    var parts = [];
    if (state.q) parts.push("search=" + encodeURIComponent(state.q));
    TAG_KEYS.forEach(function (k) {
      if (state.sel[k].size) {
        parts.push(k + "=" + Array.from(state.sel[k]).map(function (t) { return encodeURIComponent(idOf(t)); }).join(","));
      }
    });
    Array.from(state.sel.journal).forEach(function (j) { parts.push("journal=" + encodeURIComponent(j)); });
    if (state.from) parts.push("from=" + state.from);
    if (state.to) parts.push("to=" + state.to);
    if (state.oa) parts.push("oa=1");
    if (state.sort !== "author") parts.push("sort=" + state.sort);
    return parts.join("&");
  }

  function writeAddress() {
    var q = addressQuery();
    var url = window.location.pathname + (q ? "?" + q : "") + window.location.hash;
    try { window.history.replaceState(null, "", url); } catch (err) { /* opened as a file: ignore */ }
  }

  function activeCount() {
    var n = 0;
    Object.keys(state.sel).forEach(function (k) { n += state.sel[k].size; });
    return n + (state.from ? 1 : 0) + (state.to ? 1 : 0) + (state.oa ? 1 : 0) + (state.q ? 1 : 0);
  }

  // ---------------------------------------------------------------- filtering

  // Does a work fit the search and the filters? "skip" leaves one group out:
  // that is how the count next to each choice is worked out.
  function fits(w, skip) {
    var k, set, vals, i, hit;
    if (state.q) {
      var terms = fold(state.q).split(/\s+/).filter(Boolean);
      for (i = 0; i < terms.length; i++) if (w.text.indexOf(terms[i]) < 0) return false;
    }
    for (k in state.sel) {
      set = state.sel[k];
      if (k === skip || !set.size) continue;
      vals = w.values[k]; hit = false;
      for (i = 0; i < vals.length; i++) if (set.has(vals[i])) { hit = true; break; }
      if (!hit) return false;
    }
    if (skip !== "year") {
      if (state.from && (!w.year || w.year < state.from)) return false;
      if (state.to && (!w.year || w.year > state.to)) return false;
    }
    if (skip !== "oa" && state.oa && !w.e.oa) return false;
    return true;
  }

  function sorted(list) {
    var by = {
      author: function (a, b) { return a.order - b.order; },
      newest: function (a, b) { return (b.year || 0) - (a.year || 0) || a.order - b.order; },
      oldest: function (a, b) { return (a.year || 9999) - (b.year || 9999) || a.order - b.order; },
      added:  function (a, b) { return (b.e.added || "").localeCompare(a.e.added || "") || a.order - b.order; }
    };
    return list.slice().sort(by[state.sort] || by.author);
  }

  // ---------------------------------------------------------------- one work

  // The formatted reference arrives as text with italics. Only italics, bold,
  // superscript and subscript are kept; web addresses become links.
  function citation(html) {
    var box = document.createElement("template");
    box.innerHTML = html || "";
    var out = document.createDocumentFragment();
    var keep = { I: "i", EM: "i", B: "b", STRONG: "b", SUP: "sup", SUB: "sub" };
    (function walk(from, to) {
      Array.prototype.forEach.call(from.childNodes, function (n) {
        if (n.nodeType === 3) {
          linkify(n.nodeValue, to);
        } else if (n.nodeType === 1) {
          if (keep[n.nodeName]) { var c = document.createElement(keep[n.nodeName]); walk(n, c); to.appendChild(c); }
          else if (n.nodeName !== "SCRIPT" && n.nodeName !== "STYLE") walk(n, to);
        }
      });
    })(box.content, out);
    return out;
  }

  // A work's web address comes from Zotero. Everything the page links to must be
  // an ordinary web address: anything else (a "javascript:" address, say) is shown
  // as plain text instead of as a link, so that a bad entry can never become a
  // link that does something when it is clicked.
  function webAddress(url) {
    if (typeof url !== "string") return null;
    var clean = url.trim();
    return /^https?:\/\//i.test(clean) ? clean : null;
  }

  function linkify(text, to) {
    var re = /https?:\/\/[^\s<>"]+/g, last = 0, m;
    while ((m = re.exec(text))) {
      var url = m[0].replace(/[.,;:)]+$/, "");
      var link = webAddress(url);
      to.appendChild(document.createTextNode(text.slice(last, m.index)));
      to.appendChild(link ? el("a", { href: link, target: "_blank", rel: "noopener", text: link })
                          : document.createTextNode(url));
      last = m.index + url.length;
    }
    to.appendChild(document.createTextNode(text.slice(last)));
  }

  function drawWork(w) {
    var e = w.e;
    var cite = el("p", { class: "pv-lib-cite" });
    cite.appendChild(citation(e.citation || e.title));
    if (!/https?:\/\//.test(e.citation || "") && e.url) {
      var link = webAddress(e.url);
      cite.appendChild(document.createTextNode(" "));
      cite.appendChild(link ? el("a", { href: link, target: "_blank", rel: "noopener", text: link })
                            : el("span", { class: "pv-lib-oa", text: String(e.url) }));
    }
    // a review of a book carries the book's title: the entry says that it is a review
    if (e.type === "type:book-review") { cite.appendChild(document.createTextNode(" ")); cite.appendChild(el("span", { class: "pv-lib-oa", text: nameOf(e.type) })); }
    if (e.oa) { cite.appendChild(document.createTextNode(" ")); cite.appendChild(el("span", { class: "pv-lib-oa", text: "Open Access" })); }

    var tags = el("p", { class: "pv-lib-tags" });
    ["approach", "topic", "region", "country", "method"].forEach(function (k) {
      var list = e[k] || [];
      if (!list.length) return;
      var group = el("span", { class: "pv-lib-taggroup" }, [el("span", { class: "pv-lib-tagkey", text: SHORT[k] })]);
      list.forEach(function (t, i) {
        if (i) group.appendChild(document.createTextNode(", "));
        group.appendChild(el("button", {
          type: "button", class: "pv-lib-tag", text: nameOf(t), "data-tag": t,
          "aria-pressed": state.sel[k].has(t) ? "true" : "false",
          title: (state.sel[k].has(t) ? "Remove this filter: " : "Show only: ") + nameOf(t),
          onclick: function () { toggle(k, t); }
        }));
      });
      tags.appendChild(group);
      tags.appendChild(document.createTextNode(" "));
    });

    var actions = el("p", { class: "pv-lib-actions" });
    var abstract = null;
    if (e.abstract || e.has_abstract === true) {
      abstract = el("p", { class: "pv-lib-abstract", id: "abs-" + e.id, hidden: true, text: e.abstract || waitingText() });
      actions.appendChild(el("button", {
        type: "button", class: "pv-lib-link", text: "Abstract", "aria-expanded": "false", "aria-controls": "abs-" + e.id,
        onclick: function (ev) {
          var open = abstract.hidden;
          abstract.hidden = !open;
          ev.currentTarget.setAttribute("aria-expanded", open ? "true" : "false");
          ev.currentTarget.textContent = open ? "Hide abstract" : "Abstract";
          if (!open) return;                         // it was just closed
          if (e.abstract) { abstract.textContent = e.abstract; return; }
          abstract.textContent = waitingText();
          whenText(function () { abstract.textContent = e.abstract || waitingText(); });
        }
      }));
    }
    if (e.bibtex || e.has_bibtex === true) {
      var bib = el("button", {
        type: "button", class: "pv-lib-link", text: "Copy BibTeX", "data-bib": e.id,
        onclick: function (ev) {
          var button = ev.currentTarget;
          if (e.bibtex) { copy(e.bibtex, button, "Copy BibTeX", "BibTeX copied"); return; }
          button.disabled = true;
          button.setAttribute("data-busy", "1");
          button.textContent = "Loading\u2026";
          whenText(function () {
            button.removeAttribute("data-busy");
            button.textContent = "Copy BibTeX";
            button.disabled = !bibLive(e);
            if (e.bibtex) copy(e.bibtex, button, "Copy BibTeX", "BibTeX copied");
          });
        }
      });
      bib.disabled = !bibLive(e);                   // off only once the BibTeX is known not to come
      actions.appendChild(bib);
    }
    return el("li", { class: "pv-lib-entry", id: "work-" + e.id }, [cite, tags.childNodes.length ? tags : null,
                                                                    actions.childNodes.length ? actions : null, abstract]);
  }

  // ---------------------------------------------------------------- copy and download

  function copy(text, button, idle, done) {
    function say(msg) {
      button.textContent = msg;
      ui.status.textContent = msg;
      window.setTimeout(function () { button.textContent = idle; }, 2200);
    }
    function oldWay() {
      var area = el("textarea", { class: "pv-lib-offscreen", readonly: true });
      area.value = text;
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      document.body.removeChild(area);
      say(ok ? done : "Copying is blocked by the browser");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { say(done); }, oldWay);
    } else {
      oldWay();
    }
  }

  function download(name, type, text) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: name, class: "pv-lib-offscreen" });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function today() {
    var d = new Date();
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
  }

  function plainCitation(html) {
    var box = document.createElement("template");
    box.innerHTML = html || "";
    return box.content.textContent.replace(/\s+/g, " ").trim();
  }

  function csv(list) {
    // The file holds the works and their citations. The Library's tags (approach, topic,
    // region, country, method) are the editor's own classification and are not in it.
    var cols = ["authors", "year", "title", "journal_or_book", "publisher", "volume", "issue", "pages", "doi", "url",
                "type", "open_access", "citation"];
    function cell(v) {
      v = String(v === null || v === undefined ? "" : v);
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }
    var rows = [cols.join(",")];
    list.forEach(function (w) {
      var e = w.e;
      var people = (e.authors && e.authors.length ? e.authors : e.editors || []).map(function (p) {
        return p.given ? p.family + ", " + p.given : p.family;
      }).join("; ");
      rows.push([people, e.year, e.title, e.container, e.publisher, e.volume, e.issue, e.pages, e.doi, e.url,
                 e.type ? nameOf(e.type) : "", e.oa ? "yes" : "", plainCitation(e.citation)].map(cell).join(","));
    });
    return "\ufeff" + rows.join("\r\n") + "\r\n";     // the first character lets Excel read accents
  }

  // ---------------------------------------------------------------- changing the filters

  function toggle(k, value) {
    if (state.sel[k].has(value)) state.sel[k].delete(value); else state.sel[k].add(value);
    refresh(true);
  }

  function clearAll() {
    state.q = ""; state.from = null; state.to = null; state.oa = false;
    state.sel = emptySelection();
    refresh(true);
  }

  // ---------------------------------------------------------------- drawing the frame (once)

  function optionRow(k, value, text) {
    var id = "f-" + k + "-" + String(value).replace(/[^A-Za-z0-9]+/g, "-");
    var box = el("input", { type: "checkbox", id: id, onchange: function () { toggle(k, value); } });
    var count = el("span", { class: "pv-lib-n" });
    var row = el("li", { class: "pv-lib-option" }, [el("label", { for: id }, [box, el("span", { class: "pv-lib-optname", text: text }), count])]);
    return { key: k, value: value, text: text, row: row, box: box, count: count };
  }

  function group(title, key, open, inner) {
    var g = el("details", { class: "pv-lib-group", "data-group": key }, [el("summary", null, [el("span", { text: title })]), inner]);
    g.open = open;
    return g;
  }

  // ---------------------------------------------------------------- the two long lists

  // Countries and journals run to hundreds of choices, the journals to well over a
  // thousand. Each of those two lists gets a box to type in, and until a word is typed
  // it shows only the choices with the most works, with "Show all" underneath.
  var NARROW_TOP = 20;

  function narrowed(key, noun, listEl, options) {
    var id = "pv-narrow-" + key;
    var input = el("input", { type: "search", id: id, autocomplete: "off", spellcheck: "false",
                              placeholder: "Type to narrow" });
    var more = el("button", { type: "button", class: "pv-lib-link pv-lib-showall" });
    var none = el("p", { class: "pv-lib-nomatch", text: "Nothing matches.", hidden: true });
    var n = ui.narrow[key] = { q: "", all: false, input: input, more: more, none: none, options: options, noun: noun };
    var timer = null;
    input.addEventListener("input", function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { n.q = fold(input.value.trim()); narrow(key); }, 150);
    });
    more.addEventListener("click", function () { n.all = !n.all; narrow(key); });
    return el("div", { class: "pv-lib-long" }, [
      el("div", { class: "pv-lib-narrow" }, [
        el("label", { for: id, class: "pv-lib-offscreen", text: "Narrow the list of " + noun }), input
      ]),
      listEl, more, none
    ]);
  }

  // How many works the NARROW_TOP-th commonest choice has: the line a choice has to
  // reach to be shown before "Show all" is clicked.
  function cutoff(options, k) {
    var counts = [], i, n;
    for (i = 0; i < options.length; i++) { n = options[i].shown || 0; if (n > 0) counts.push(n); }
    if (counts.length <= k) return 1;
    counts.sort(function (a, b) { return b - a; });
    return counts[k - 1];
  }

  // Decides which rows of one long list are seen. Called after the counts are written,
  // because with nothing typed the choices shown are the ones with the most works.
  function narrow(key) {
    var n = ui.narrow[key];
    if (!n) return;
    var seen = 0, i, o, show;
    if (n.q) {
      for (i = 0; i < n.options.length; i++) {
        o = n.options[i];
        show = fold(o.text).indexOf(n.q) >= 0;
        o.row.hidden = !show;
        if (show) seen++;
      }
      n.more.hidden = true;
    } else if (n.all) {
      for (i = 0; i < n.options.length; i++) n.options[i].row.hidden = false;
      seen = n.options.length;
      n.more.hidden = false;
      n.more.textContent = "Show fewer";
    } else {
      var line = cutoff(n.options, NARROW_TOP), room = NARROW_TOP;
      for (i = 0; i < n.options.length; i++) {
        o = n.options[i];
        // anything already ticked stays in sight, whatever its place in the order
        show = o.box.checked || (room > 0 && (o.shown || 0) >= line);
        if (show && !o.box.checked) room--;
        o.row.hidden = !show;
        if (show) seen++;
      }
      n.more.hidden = n.options.length <= NARROW_TOP;
      n.more.textContent = "Show all " + n.options.length + " " + n.noun;
    }
    n.none.hidden = seen > 0;
  }

  function build() {
    ui.options = [];
    ui.groups = {};
    ui.narrow = {};

    // search and order
    ui.search = el("input", { type: "search", id: "pv-lib-q", autocomplete: "off", spellcheck: "false",
                              placeholder: "Title, author, journal, abstract" });
    var timer = null;
    ui.search.addEventListener("input", function () {
      window.clearTimeout(timer);
      if (ui.search.value.trim()) needText();        // the search looks inside abstracts
      timer = window.setTimeout(function () { state.q = ui.search.value.trim(); refresh(true); }, 180);
    });
    ui.sort = el("select", { id: "pv-lib-sort", onchange: function () { state.sort = ui.sort.value; refresh(true); } },
                 SORTS.map(function (s) { return el("option", { value: s[0], text: s[1] }); }));
    var bar = el("div", { class: "pv-lib-bar" }, [
      el("div", { class: "pv-lib-field" }, [el("label", { for: "pv-lib-q", text: "Search the Library" }), ui.search]),
      el("div", { class: "pv-lib-field" }, [el("label", { for: "pv-lib-sort", text: "Order" }), ui.sort])
    ]);

    // the filter groups
    var groups = [];
    GROUPS.forEach(function (g) {
      var tags = (taxonomy[g.key] && taxonomy[g.key].tags) || [];
      if (!g.all) {
        var used = new Set();
        works.forEach(function (w) { w.values[g.key].forEach(function (t) { used.add(t); }); });
        tags = tags.filter(function (t) { return used.has(t.tag); })
                   .sort(function (a, b) { return a.label.localeCompare(b.label); });
      }
      if (!tags.length) return;
      var list = el("ul", { class: "pv-lib-options" });
      var rows = [];
      tags.forEach(function (t) { var o = optionRow(g.key, t.tag, t.label); ui.options.push(o); rows.push(o); list.appendChild(o.row); });
      var title = (taxonomy[g.key] && taxonomy[g.key].label) || g.key;
      var inner = g.key === "country" ? narrowed("country", "countries", list, rows) : list;
      ui.groups[g.key] = group(title, g.key, g.open || state.sel[g.key].size > 0, inner);
      groups.push(ui.groups[g.key]);
    });

    // year: from ... to ...
    var years = Array.from(new Set(works.map(function (w) { return w.year; }).filter(Boolean))).sort();
    if (years.length) {
      var choices = function () {
        return [el("option", { value: "", text: "Any" })].concat(years.map(function (y) { return el("option", { value: y, text: y }); }));
      };
      ui.from = el("select", { id: "pv-lib-from", onchange: function () { state.from = parseInt(ui.from.value, 10) || null; refresh(true); } }, choices());
      ui.to = el("select", { id: "pv-lib-to", onchange: function () { state.to = parseInt(ui.to.value, 10) || null; refresh(true); } }, choices());
      ui.groups.year = group("Year", "year", !!(state.from || state.to), el("div", { class: "pv-lib-years" }, [
        el("div", { class: "pv-lib-field" }, [el("label", { for: "pv-lib-from", text: "From" }), ui.from]),
        el("div", { class: "pv-lib-field" }, [el("label", { for: "pv-lib-to", text: "To" }), ui.to])
      ]));
      groups.push(ui.groups.year);
    }

    // journal: the journals that are in the Library
    var journals = Array.from(new Set(works.map(function (w) { return w.journal; }).filter(Boolean)))
      .sort(function (a, b) { return a.localeCompare(b); });
    if (journals.length) {
      var jl = el("ul", { class: "pv-lib-options" });
      var jrows = [];
      journals.forEach(function (j) { var o = optionRow("journal", j, j); ui.options.push(o); jrows.push(o); jl.appendChild(o.row); });
      ui.groups.journal = group("Journal", "journal", state.sel.journal.size > 0,
                                narrowed("journal", "journals", jl, jrows));
      groups.push(ui.groups.journal);
    }

    // open access: one box
    ui.oa = el("input", { type: "checkbox", id: "f-oa", onchange: function () { state.oa = ui.oa.checked; refresh(true); } });
    ui.oaCount = el("span", { class: "pv-lib-n" });
    ui.oaRow = el("li", { class: "pv-lib-option" }, [el("label", { for: "f-oa" }, [ui.oa, el("span", { class: "pv-lib-optname", text: "Free to read" }), ui.oaCount])]);
    ui.groups.oa = group("Open Access", "oa", state.oa, el("ul", { class: "pv-lib-options" }, [ui.oaRow]));
    groups.push(ui.groups.oa);

    // On phones the filters fold away behind one line; on wide screens they are always open.
    ui.filtersTitle = el("span", { text: "Filters" });
    ui.filters = el("details", { class: "pv-lib-filters" }, [el("summary", null, [ui.filtersTitle])].concat(groups));
    var wide = window.matchMedia("(min-width: 992px)");
    var fit = function () { ui.filters.open = wide.matches || ui.filters.dataset.user === "open"; };
    ui.filters.querySelector("summary").addEventListener("click", function () {
      ui.filters.dataset.user = ui.filters.open ? "closed" : "open";
    });
    if (wide.addEventListener) wide.addEventListener("change", fit); else if (wide.addListener) wide.addListener(fit);
    fit();

    // the line above the list: how many, and what can be done with them
    ui.count = el("p", { class: "pv-lib-count", role: "status", "aria-live": "polite" });
    // Shown only while someone searches before the abstracts have arrived, so that a
    // count that grows a moment later does not look like a fault.
    ui.pending = el("p", { class: "pv-lib-pending", hidden: true,
                           text: "Searching titles, authors, journals and tags. Abstracts are still loading\u2026" });
    ui.clear = el("button", { type: "button", class: "pv-lib-link", text: "Clear filters", onclick: clearAll });
    ui.bib = el("button", { type: "button", class: "pv-lib-link", text: "Download BibTeX", onclick: function (ev) {
      var button = ev.currentTarget;
      var give = function () {
        var list = current().filter(function (w) { return w.e.bibtex; });
        download("populiverse-library-" + today() + ".bib", "application/x-bibtex;charset=utf-8",
                 list.map(function (w) { return w.e.bibtex; }).join("\n\n") + "\n");
      };
      if (textState === "ready" || textState === "none") { give(); return; }
      button.disabled = true;
      button.setAttribute("data-busy", "1");
      button.textContent = "Loading\u2026";
      whenText(function () {
        button.removeAttribute("data-busy");
        button.textContent = "Download BibTeX";
        button.disabled = !current().some(function (w) { return bibLive(w.e); });
        if (textState !== "failed") give();
      });
    } });
    ui.csv = el("button", { type: "button", class: "pv-lib-link", text: "Download CSV", onclick: function () {
      download("populiverse-library-" + today() + ".csv", "text/csv;charset=utf-8", csv(current()));
    } });
    ui.share = el("button", { type: "button", class: "pv-lib-link", text: "Copy link to this view", onclick: function (ev) {
      copy(window.location.href, ev.currentTarget, "Copy link to this view", "Link copied");
    } });
    ui.tools = el("div", { class: "pv-lib-tools" }, [ui.bib, ui.csv, ui.share]);
    ui.status = el("span", { class: "pv-lib-offscreen", role: "status", "aria-live": "polite" });
    ui.list = el("ol", { class: "pv-lib-list" });
    ui.more = el("button", { type: "button", class: "pv-lib-more", onclick: function () { shown += PAGE_SIZE; refresh(false); } });
    ui.empty = el("div", { class: "pv-lib-message", hidden: true }, [
      el("p", { text: "No work fits this search and these filters. Remove a filter or change the search." }),
      el("p", null, [el("button", { type: "button", class: "pv-lib-link", text: "Clear filters", onclick: clearAll })])
    ]);

    var results = el("section", { class: "pv-lib-results", "aria-label": "Works in the Library" }, [
      el("div", { class: "pv-lib-head" }, [el("div", { class: "pv-lib-headleft" }, [ui.count, ui.clear]), ui.tools]),
      ui.pending,
      ui.status, ui.list, ui.empty, ui.more
    ]);

    root.textContent = "";
    root.appendChild(bar);
    root.appendChild(el("div", { class: "pv-lib-body" }, [ui.filters, results]));
  }

  // ---------------------------------------------------------------- drawing what changes

  function current() { return sorted(works.filter(function (w) { return fits(w); })); }

  function refresh(restart) {
    if (restart) shown = PAGE_SIZE;
    var list = current();

    // the controls show the state
    if (document.activeElement !== ui.search) ui.search.value = state.q;
    ui.sort.value = state.sort;
    if (ui.from) { ui.from.value = state.from || ""; ui.to.value = state.to || ""; }
    ui.oa.checked = state.oa;

    // the count next to each choice: works that fit everything else
    var pools = {};
    function pool(k) { return pools[k] || (pools[k] = works.filter(function (w) { return fits(w, k); })); }
    // The works are gone through once for each filter, and every choice of that filter
    // is counted on the way. (Going through them once for each choice took half a
    // second with thousands of journals in the list, at every click and every letter typed.)
    var tallies = {};
    function tally(k) {
      if (tallies[k]) return tallies[k];
      var t = Object.create(null), p = pool(k), i, j, v;
      for (i = 0; i < p.length; i++) {
        v = p[i].values[k];
        for (j = 0; j < v.length; j++) if (v.indexOf(v[j]) === j) t[v[j]] = (t[v[j]] || 0) + 1;
      }
      return (tallies[k] = t);
    }
    ui.options.forEach(function (o) {
      var n = tally(o.key)[o.value] || 0;
      var on = state.sel[o.key].has(o.value);
      o.box.checked = on;
      o.box.disabled = n === 0 && !on;
      if (o.shown !== n) { o.shown = n; o.count.textContent = n; }
      o.row.classList.toggle("is-empty", n === 0 && !on);
    });
    // the two long lists are narrowed after the counts, not before
    Object.keys(ui.narrow).forEach(narrow);
    var free = pool("oa").filter(function (w) { return w.e.oa; }).length;
    ui.oaCount.textContent = free;
    ui.oa.disabled = free === 0 && !state.oa;
    ui.oaRow.classList.toggle("is-empty", free === 0 && !state.oa);

    // the list
    ui.list.textContent = "";
    list.slice(0, shown).forEach(function (w) { ui.list.appendChild(drawWork(w)); });
    var left = list.length - Math.min(shown, list.length);
    ui.more.hidden = left <= 0;
    ui.more.textContent = "Show " + Math.min(PAGE_SIZE, left) + " more";
    ui.empty.hidden = list.length > 0;

    // the line above the list
    var active = activeCount();
    ui.count.textContent = list.length === works.length
      ? plural(works.length, "work", "works")
      : list.length + " of " + plural(works.length, "work", "works");
    ui.clear.hidden = active === 0;
    ui.tools.hidden = list.length === 0;
    ui.pending.hidden = !(state.q && (textState === "idle" || textState === "loading"));
    if (!ui.bib.hasAttribute("data-busy")) {
      ui.bib.disabled = !list.some(function (w) { return bibLive(w.e); });
    }
    ui.filtersTitle.textContent = active ? "Filters (" + active + " in use)" : "Filters";

    writeAddress();
  }

  // ---------------------------------------------------------------- start

  function fail() {
    root.textContent = "";
    var p = el("p", null, ["The Library could not be loaded. Reload the page in a moment."]);
    if (ZOTERO) {
      p.appendChild(document.createTextNode(" The full list is also in the "));
      p.appendChild(el("a", { href: ZOTERO, target: "_blank", rel: "noopener" }, ["Populi", el("em", { text: "Verse" }), " Library group on Zotero"]));
      p.appendChild(document.createTextNode("."));
    }
    root.appendChild(el("div", { class: "pv-lib-message" }, [p]));
  }

  root.appendChild(el("p", { class: "pv-lib-loading", text: "Loading the Library\u2026" }));

  function getJSON(url) {
    return fetch(url, { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " for " + url); return r.json(); });
  }

  function start(data) {
    prepare(data);
    readAddress();
    build();
    refresh(true);
    window.addEventListener("popstate", function () { readAddress(); refresh(true); });
  }

  function complain(err) { if (window.console) console.error("PopuliVerse Library:", err); }

  getJSON(SOURCE)
    .then(function (data) {
      if (TEXT) textState = "idle";                 // fetched when a visitor first needs it
      start(data);
      // A visitor who arrives on a search or filter link is about to search, so the
      // text is worth having right away; otherwise nothing is downloaded until asked.
      if (TEXT && state.q) needText();
    })
    .catch(function (err) {
      complain(err);
      if (!FULL || FULL === SOURCE) { fail(); return; }
      // the light list did not come: the complete file still holds everything
      textState = "none";
      root.textContent = "";
      root.appendChild(el("p", { class: "pv-lib-loading", text: "Loading the Library\u2026" }));
      getJSON(FULL).then(start).catch(function (err2) { complain(err2); fail(); });
    });
})();
