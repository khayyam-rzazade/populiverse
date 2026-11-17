/* Write, Projects, Tools and the Annotated Bibliography: the three tabs that
 * arrive with batch 3 (master plan, section 18, stage 2, batch 3).
 *
 * The editor is the shared one (editor.js, Quill). A draft is stored as the
 * editor's own document, never as HTML, and nothing a person writes is ever
 * written into the screen as HTML.
 *
 * The reference list is built from what the site itself gives: the reference
 * the Library holds for a work, the issue's own "Cite This Item" line for a
 * Monitor item, and a Data page's own "How to cite" line for a figure. Nothing
 * is formatted by hand, and there is no choice of style.
 *
 * The Word file comes from docx 9.15.3, an established open library kept in
 * this site's own folder (workspace/vendor/docx.js, MIT). We wrote none of it,
 * and it is fetched only when a reader asks for a Word file.
 */
(function () {
  "use strict";

  var W = window.PVW;
  if (!W) return;
  var api = W.api, h = W.h, add = W.add, clear = W.clear, show = W.show, message = W.message;
  var debounce = W.debounce, when = W.when, plural = W.plural, cut = W.cut, site = W.site;
  var head = W.head, PAGES = W.PAGES, BASE = W.BASE, DATE_LONG = W.DATE_LONG, frame = W.frame;
  var KINDS = W.KINDS, crossLinks = W.crossLinks, params = W.params;

  // ------------------------------------------------------------ small things

  // A reference arrives from the site with the marks that set a journal or a
  // book title in italics. It is never put into the page as HTML: it is cut
  // into pieces here, and each piece is set as text (Fable's check of batches 2
  // and 3, point 6). First the escaped letters are read once, as the Library's
  // own page shows them ("&amp;" is "&"); then an italic mark, in any case, is
  // italics; every other mark is dropped and its words are kept.
  var NAMED = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
  function unescape(text) {
    return String(text || "").replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, function (all, name) {
      if (name.charAt(0) === "#") {
        var n = name.charAt(1).toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        if (!n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return all;
        if (n < 32 && n !== 9 && n !== 10) return " ";
        return String.fromCodePoint(n);
      }
      var v = NAMED[name.toLowerCase()];
      return v === undefined ? all : v;
    });
  }
  function pieces(reference) {
    var out = [];
    var rest = unescape(reference);
    var re = /<\/?([a-z][a-z0-9]*)\b[^<>]*>/i;
    var italic = false;
    while (rest) {
      var m = rest.match(re);
      if (!m) { out.push({ text: rest, italic: italic }); break; }
      if (m.index) out.push({ text: rest.slice(0, m.index), italic: italic });
      var tag = m[1].toLowerCase();
      if (tag === "i" || tag === "em") italic = m[0].charAt(1) !== "/";
      rest = rest.slice(m.index + m[0].length);
    }
    // Pieces side by side in the same style become one.
    var joined = [];
    out.forEach(function (p) {
      if (!p.text) return;
      var last = joined[joined.length - 1];
      if (last && last.italic === p.italic) last.text += p.text;
      else joined.push({ text: p.text, italic: p.italic });
    });
    return joined;
  }

  function reference(el, text) {
    pieces(text).forEach(function (p) {
      add(el, p.italic ? h("em", { text: p.text }) : document.createTextNode(p.text));
    });
    return el;
  }

  function plainOf(text) {
    return pieces(text).map(function (p) { return p.text; }).join("").replace(/\s+/g, " ").trim();
  }

  var DATE_SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

  function fold(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  // ------------------------------------------------- the Library, for the "@"

  var libraryFile = null;
  function library() {
    if (libraryFile) return libraryFile;
    libraryFile = fetch(BASE + "../library/library-cite.json", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        return (d && d.works ? d.works : []).map(function (w) {
          return { id: w[0], byline: w[1], year: w[2], citation: w[3], url: w[4] || "", find: fold(w[3]) };
        });
      }, function () { return []; });
    return libraryFile;
  }

  // One issue of the Monitor, read from its own page, so that an item's
  // reference is the one the issue itself gives under "Cite This Item". A page
  // that could not be fetched is asked for again the next time; an issue that
  // is not on the site is remembered as not there.
  var issues = {};
  function issuePage(folder) {
    if (!issues[folder]) {
      issues[folder] = fetch(BASE + "../monitor/" + encodeURIComponent(folder) + "/index.html", { cache: "force-cache" })
        .then(function (r) {
          if (r.status === 404) return null;
          if (!r.ok) throw new Error("issue");
          return r.text().then(function (html) {
            // Read in a page of its own, which runs nothing and shows nothing.
            return new DOMParser().parseFromString(html, "text/html");
          });
        });
      issues[folder].catch(function () { delete issues[folder]; });
    }
    return issues[folder];
  }

  // { card } when the issue holds the item, { missing: true } when it does not,
  // { failed: true } when its page could not be fetched just now.
  function issueCard(folder, n) {
    return issuePage(folder).then(function (doc) {
      var ref = folder + ":" + n;
      var el = doc && doc.querySelector('[data-keep-kind="item"][data-keep-ref="' + CSS.escape(ref) + '"]');
      if (!el) return { missing: true };
      return {
        card: {
          kind: "item",
          ref: ref,
          title: el.getAttribute("data-keep-title") || "",
          extra: el.getAttribute("data-keep-extra") || "",
          url: el.getAttribute("data-keep-url") || "",
          cite: el.getAttribute("data-keep-cite") || "",
          bibtex: el.getAttribute("data-keep-bib") || ""
        }
      };
    }, function () { return { failed: true }; });
  }

  function issueItem(folder, n) {
    return issueCard(folder, n).then(function (x) { return x.card || null; });
  }

  // The short form of a thing, "Mudde 2004", and the cite in the text,
  // "(Mudde 2004)". A work carries its short form from the Library. A work kept
  // before it did takes the first author's name from its reference, so a cite
  // never shows a year alone (Fable's check of batches 2 and 3, point 5).
  function shortName(kind, card) {
    if (kind === "work") {
      if (card.extra && /\p{L}/u.test(card.extra)) return card.extra;
      var who = plainOf(card.cite || card.title || "").split(/[,.]/)[0].trim();
      return [who, card.year || ""].join(" ").trim() || card.ref || "";
    }
    if (kind === "item") {
      var where = String(card.extra || "").split(" · ")[0];
      // An item saved from Events in Monitor before 2026-11-15 carries
      // "2026/2, item 8": it is cited as its issue cites it.
      if (/^\d{4}\/\d+, item /.test(where)) where = "Monitor " + where;
      return "PopuliVerse " + where;
    }
    return card.title || card.ref || "";
  }
  function shortOf(kind, card) {
    return "(" + shortName(kind, card) + ")";
  }

  // ------------------------------------------------------------ the Word file

  var docxJob = null;
  function withDocx() {
    if (window.docx) return Promise.resolve(window.docx);
    if (docxJob) return docxJob;
    docxJob = new Promise(function (done, fail) {
      var s = document.createElement("script");
      s.src = BASE + "vendor/docx.js";
      s.onload = function () { window.docx ? done(window.docx) : fail(new Error("docx")); };
      s.onerror = function () { fail(new Error("docx")); };
      document.head.appendChild(s);
    });
    return docxJob;
  }

  function pngBytes(dataUrl) {
    var comma = String(dataUrl || "").indexOf(",");
    if (comma < 0) return null;
    try {
      var raw = atob(dataUrl.slice(comma + 1));
      var out = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }

  function saveFile(blob, name) {
    var a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    window.setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // A draft, cut into paragraphs. The editor keeps a page as a list of pieces,
  // where the format of a paragraph sits on its line break.
  function paragraphs(delta, letters) {
    var out = [];
    var runs = [];
    letters = letters || {};
    (delta.ops || []).forEach(function (op) {
      if (op.insert && op.insert.pvfigure) {
        if (runs.length) { out.push({ runs: runs, block: {} }); runs = []; }
        out.push({ figure: op.insert.pvfigure.id });
        return;
      }
      if (op.insert && op.insert.pvcite) {
        var c = op.insert.pvcite;
        runs.push({ text: window.PVEditor.citeWithLetter(c.text, letters[c.kind + "\u0000" + c.ref]), cite: c });
        return;
      }
      if (typeof op.insert !== "string") return;
      var parts = op.insert.split("\n");
      parts.forEach(function (part, i) {
        if (i) {
          out.push({ runs: runs, block: op.attributes || {} });
          runs = [];
        }
        if (part) runs.push({ text: part, bold: !!(op.attributes && op.attributes.bold), italic: !!(op.attributes && op.attributes.italic) });
      });
    });
    if (runs.length) out.push({ runs: runs, block: {} });
    return out;
  }

  // One sentence for a reference that is gone, on screen and in the Word file.
  function goneLine(label) {
    return label + " is no longer on your shelf, so its reference is not listed.";
  }

  // The references of a draft, in one alphabetical list: the works and Monitor
  // items it cites, and the Data pages of the figures in it. A cite is in one of
  // three states: answered (its card is here), on its way (asked, no answer
  // yet), or gone (the server answered that it is not on the shelf). Only a cite
  // that is gone says so; one on its way shows nothing until it is answered
  // (Fable's second run, serious point 3).
  function referencesOf(editor, cards, figures, gone) {
    var out = [];
    editor.cites().forEach(function (c) {
      var k = c.kind + "\u0000" + c.ref;
      var card = cards[k];
      if (!card && !gone[k]) return;
      if (card && !card.cite) return;
      out.push({
        kind: c.kind,
        ref: c.ref,
        text: card ? card.cite : "",
        missing: !card,
        label: c.text,
        url: card ? card.url : c.url,
        bibtex: card ? card.bibtex : "",
        short: card && c.kind === "work" ? shortName("work", card) : ""
      });
    });
    var seen = {};
    editor.figures().forEach(function (id) {
      var f = figures[id];
      if (!f || !f.cite || seen[f.cite]) return;
      seen[f.cite] = true;
      out.push({ kind: "chart", ref: id, text: f.cite, missing: false, label: f.title, url: f.url, bibtex: "" });
    });
    out.sort(function (a, b) { return plainOf(a.text || a.label).localeCompare(plainOf(b.text || b.label), "en"); });
    letter(out);
    return out;
  }

  // Two works of one author and one year in one draft are told apart as
  // Chicago author-date tells them: 2019a and 2019b, in the order of the
  // reference list, in the cites in the text, in the reference list and in the
  // Word file (the wrap-up before the opening, Part F). The letter is worked
  // out each time the draft is drawn and is never stored, so a work has no
  // letter where it stands alone. In the reference it goes after the year that
  // follows the authors; where that one place cannot be found safely, or the
  // cite in the text does not end in its year, the work keeps no letter. All
  // 625 works of the Library that share author and year with another have
  // that place (checked on 17 November 2026).
  function yearEnd(ref, year) {
    var m = /^([^“”"<>]*?\.) (\d{4})\.(?=\s|$)/.exec(ref || "");
    if (!m || m[2] !== year) return -1;
    var all = (String(ref).match(new RegExp("\\. " + year + "\\.(?=\\s|$)", "g")) || []).length;
    return all === 1 ? m[1].length + 1 + year.length : -1;
  }
  function letter(refs) {
    var groups = {};
    refs.forEach(function (r) {
      if (r.kind !== "work" || r.missing || !r.short) return;
      (groups[r.short] = groups[r.short] || []).push(r);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.length < 2 || g.length > 26) return;
      var year = (/(\d{4})$/.exec(k) || [])[1];
      g.forEach(function (r, i) {
        var at = year ? yearEnd(r.text, year) : -1;
        var l = String.fromCharCode(97 + i);
        if (at < 0 || window.PVEditor.citeWithLetter(r.label, l) === r.label) return;
        r.letter = l;
        r.text = r.text.slice(0, at) + l + r.text.slice(at);
      });
    });
  }
  // The letters of a draft, by cite, for the text on screen and in Word.
  function lettersOf(refs) {
    var out = {};
    refs.forEach(function (r) { if (r.letter) out[r.kind + "\u0000" + r.ref] = r.letter; });
    return out;
  }

  // The size a picture has in itself, read from the picture: a PNG names its
  // width and height in its first lines.
  function pngSize(bytes) {
    if (!bytes || bytes.length < 24) return null;
    var w = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    var t = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    return w > 0 && t > 0 ? { width: w, height: t } : null;
  }

  // The Word file (Fable's check of batches 2 and 3, point 7). A figure keeps
  // its own proportions, at most the width of the page. Headings are black and
  // in the file's own typeface. A numbered list stays numbered, and counts from
  // 1 each time. The line spacing is named with its rule, so that no program
  // sets two lines on top of each other.
  var FONT = "Georgia";
  var PAGE_WIDE = 600;
  // The options of a piece of text in the Word file: bold and italic are named
  // only when they are on, so a "no" never overrides the style around it.
  function face(o, bold, italic) {
    if (bold) o.bold = true;
    if (italic) o.italics = true;
    return o;
  }
  // A note's own lines stay lines in the Word file (Fable's second run, point i).
  function lines(T, words) {
    return String(words || "").split("\n").map(function (line, i) {
      return new T(i ? { text: line, break: 1 } : { text: line });
    });
  }
  function wordDoc(docx, opts) {
    var kids = [];
    var P = docx.Paragraph, T = docx.TextRun;
    var AUTO = docx.LineRuleType ? docx.LineRuleType.AUTO : "auto";
    kids.push(new P({ text: opts.title || "Untitled", heading: docx.HeadingLevel.TITLE }));
    var figureNo = 0;
    var lists = 0, inList = null;
    (opts.blocks || []).forEach(function (b) {
      var block = (b && b.block) || {};
      if (!block.list) inList = null;
      if (b.figure) {
        var f = opts.figures[b.figure];
        if (!f) return;
        var bytes = pngBytes(f.picture);
        if (bytes) {
          var own = pngSize(bytes) || { width: f.width || 1200, height: f.height || 800 };
          var wide = Math.min(PAGE_WIDE, own.width);
          var tall = Math.max(1, Math.round(own.height * (wide / own.width)));
          kids.push(
            new P({
              children: [new docx.ImageRun({ data: bytes, type: "png", transformation: { width: wide, height: tall } })],
              spacing: { before: 240, after: 80 }
            })
          );
        }
        figureNo++;
        kids.push(new P({
          children: [new T({ text: "Figure " + figureNo + ". ", bold: true }), new T({ text: f.title })],
          spacing: { after: 40 }
        }));
        kids.push(
          new P({
            children: [new T({ text: window.PVEditor.figureFoot(f), size: 18, color: "4A4A4A" })],
            spacing: { after: 240 }
          })
        );
        return;
      }
      // A run says bold or italic only when it is. Inside a heading it says
      // nothing about bold, so the heading's own style makes it bold (Fable's
      // second run, point c). Italics the writer set stay, such as a book title.
      var runs = (b.runs || []).map(function (r) {
        return new T(face({ text: r.text }, !block.header && r.bold, r.italic));
      });
      if (!runs.length) runs = [new T({ text: "" })];
      if (block.header) {
        kids.push(new P({ children: runs, heading: block.header === 1 ? docx.HeadingLevel.HEADING_1 : block.header === 2 ? docx.HeadingLevel.HEADING_2 : docx.HeadingLevel.HEADING_3 }));
      } else if (block.blockquote) {
        kids.push(new P({ children: runs, indent: { left: 720 }, spacing: { after: 120 } }));
      } else if (block.list === "ordered") {
        if (inList !== "ordered") { lists++; inList = "ordered"; }
        kids.push(new P({ children: runs, numbering: { reference: "pv-numbers", level: 0, instance: lists } }));
      } else if (block.list) {
        inList = "bullet";
        kids.push(new P({ children: runs, bullet: { level: 0 } }));
      } else {
        kids.push(new P({ children: runs, spacing: { after: 120 } }));
      }
    });
    if ((opts.references || []).length) {
      kids.push(new P({ text: "References", heading: docx.HeadingLevel.HEADING_2, spacing: { before: 360 } }));
      opts.references.forEach(function (r) {
        var runs = r.missing
          ? [new T({ text: goneLine(r.label), italics: true })]
          : pieces(r.text).map(function (p) { return new T(face({ text: p.text }, false, p.italic)); });
        kids.push(new P({ children: runs, indent: { left: 720, hanging: 720 }, spacing: { after: 80 } }));
      });
    }
    (opts.entries || []).forEach(function (e) {
      kids.push(
        new P({
          children: pieces(e.cite).map(function (p) { return new T(face({ text: p.text }, false, p.italic)); }),
          indent: { left: 720, hanging: 720 },
          spacing: { before: 160, after: 40 }
        })
      );
      if (e.note) {
        kids.push(new P({ children: lines(T, e.note), indent: { left: 720 }, spacing: { after: 80 } }));
      }
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
          document: { run: { font: FONT, size: 23, color: "000000" }, paragraph: { spacing: { line: 320, lineRule: AUTO } } },
          title: { run: { font: FONT, color: "000000", size: 40 }, paragraph: { spacing: { after: 240, line: 276, lineRule: AUTO } } },
          heading1: heading(32),
          heading2: heading(27),
          heading3: heading(24)
        }
      },
      numbering: {
        config: [{
          reference: "pv-numbers",
          levels: [{
            level: 0,
            format: docx.LevelFormat.DECIMAL,
            text: "%1.",
            alignment: docx.AlignmentType.START,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
          }]
        }]
      },
      sections: [{ children: kids }]
    });
  }

  function fileName(title, ending) {
    var slug = String(title || "untitled")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60)
      .toLowerCase();
    return (slug || "untitled") + "-" + today() + ending;
  }

  // ------------------------------------------------- the Annotated Bibliography

  // The works of the shelf, or of one project, each with the reference the
  // Library holds and the reader's own note under it, as a Word file.
  // A button says what is happening on itself, and comes back to its own
  // label after a few seconds.
  function annotated(button, project) {
    var label = button.textContent;
    button.disabled = true;
    button.textContent = "Making the Word file…";
    bibliographyFile(project).then(function (words) {
      button.disabled = false;
      button.textContent = words;
      window.setTimeout(function () { button.textContent = label; }, 3000);
    });
  }

  // Makes the file and saves it. Always answers with the words to show:
  // "Downloaded", or why it could not be made. It never leaves anything behind
  // on the page (the live check before the trial, point 2b).
  function bibliographyFile(project) {
    return new Promise(function (answer) {
      makeBibliography(project, answer);
    });
  }

  function makeBibliography(project, back) {
    api("/api/write/bibliography" + (project ? "?project=" + encodeURIComponent(project) : "")).then(function (r) {
      if (!r.ok) return back(r.data.error || "Could not be made");
      var works = r.data.works || [];
      if (!works.length) return back("No works yet");
      return withDocx().then(function (docx) {
        var noted = works.filter(function (w) { return w.note; }).length;
        var doc = wordDoc(docx, {
          title: "Annotated Bibliography",
          blocks: [
            {
              runs: [
                {
                  text:
                    r.data.from +
                    ". " +
                    plural(works.length, "work", "works") +
                    ", " +
                    (noted ? plural(noted, "with a note of yours", "with a note of yours") : "none with a note of yours") +
                    ". Made on " +
                    DATE_LONG.format(new Date()) +
                    "."
                }
              ],
              block: {}
            }
          ],
          entries: works.map(function (w) {
            return { cite: w.cite || w.title, note: w.note || "" };
          }),
          figures: {},
          foot: "The references are those the PopuliVerse Library holds, in Chicago author-date. populiverse.com"
        });
        return docx.Packer.toBlob(doc).then(function (blob) {
          saveFile(blob, fileName("annotated-bibliography", ".docx"));
          back("Downloaded");
        });
      });
    }, function () { back("Could not be made"); }).catch(function () { back("Could not be made"); });
  }

  // ------------------------------------- the "@" picker, shared with the Notebook

  function pickCites(words) {
    var find = fold(words);
    var groups = [];
    var shelf = Promise.all([
      api("/api/keep?kind=work&order=author" + (words ? "&q=" + encodeURIComponent(words) : "")),
      api("/api/keep?kind=item&order=new" + (words ? "&q=" + encodeURIComponent(words) : ""))
    ]).then(function (two) {
      var items = [];
      ((two[0].data && two[0].data.things) || []).slice(0, 6).forEach(function (t) {
        items.push({
          label: t.title || t.ref,
          sub: [t.status ? ({ "to-read": "To Read", reading: "Reading", read: "Read" })[t.status] : "", t.note ? "Your note: " + cut(t.note.body, 60) : ""].filter(Boolean).join(" · "),
          value: { kind: "work", ref: t.ref, text: shortOf("work", t), url: t.url }
        });
      });
      ((two[1].data && two[1].data.things) || []).slice(0, 4).forEach(function (t) {
        items.push({
          label: t.title || t.ref,
          sub: [t.extra, t.note ? "Your note: " + cut(t.note.body, 60) : ""].filter(Boolean).join(" · "),
          value: { kind: "item", ref: t.ref, text: shortOf("item", t), url: t.url }
        });
      });
      return items.length ? { group: "From Your Shelf", items: items } : null;
    });

    var fromLibrary = !find
      ? Promise.resolve({ group: "Library", note: "Type a few letters of an author or a title." })
      : library().then(function (all) {
          var hits = [];
          for (var i = 0; i < all.length && hits.length < 6; i++) {
            if (all[i].find.indexOf(find) >= 0) hits.push(all[i]);
          }
          // Nothing found: the list says so once (Fable's second run, point g).
          if (!hits.length) return null;
          return {
            group: "Library",
            note: "Citing a work from the Library keeps it on your shelf.",
            items: hits.map(function (w) {
              return {
                label: plainOf(w.citation),
                sub: String(w.year || ""),
                pick: function () {
                  return api("/api/keep", {
                    method: "POST",
                    body: {
                      kind: "work",
                      ref: w.id,
                      title: plainOf(w.citation).slice(0, 600),
                      extra: [w.byline || "", w.year || ""].join(" ").trim(),
                      url: w.url,
                      year: String(w.year || ""),
                      cite: w.citation
                    }
                  }).then(function (r) {
                    if (!r.ok) { window.alert(r.data.error || "That work could not be kept."); return null; }
                    return { kind: "work", ref: w.id, text: shortOf("work", { extra: [w.byline || "", w.year || ""].join(" ").trim(), cite: w.citation, year: String(w.year || ""), ref: w.id }), url: w.url };
                  });
                }
              };
            })
          };
        });

    var fromMonitor = !find
      ? Promise.resolve(null)
      : site().then(function (data) {
          var hits = [];
          Object.keys(data.items).forEach(function (k) {
            if (hits.length >= 4) return;
            var it = data.items[k];
            if (fold(it.title).indexOf(find) >= 0) hits.push(it);
          });
          if (!hits.length) return null;
          return {
            group: "Monitor",
            items: hits.map(function (it) {
              return {
                label: it.title,
                sub: "Monitor " + it.issue + ", item " + it.n,
                pick: function () {
                  return issueItem(it.folder, it.n).then(function (card) {
                    if (!card) {
                      return { kind: "item", ref: it.folder + ":" + it.n, text: "(PopuliVerse Monitor " + it.issue + ", item " + it.n + ")", url: "" };
                    }
                    return api("/api/keep", { method: "POST", body: card }).then(function () {
                      return { kind: "item", ref: card.ref, text: shortOf("item", card), url: card.url };
                    });
                  });
                }
              };
            })
          };
        });

    return Promise.all([shelf, fromLibrary, fromMonitor]).then(function (all) {
      return all.filter(Boolean);
    });
  }


  // ------------------------------------------------------------------- Write

  function write(me) {
    var state = { drafts: [], open: null, base: null, dirty: false, saving: false, cards: {}, figures: {}, projects: [] };
    var listEl = h("ul", { class: "pv-ws-list" });
    var paper = h("div", { class: "pv-ws-editor" });
    var shell = h("div", { class: "pv-ws-notebook pv-ws-write" },
      h("div", { class: "pv-ws-side" },
        h("div", { class: "pv-ws-side-head" },
          h("h2", { class: "pv-ws-h", text: "Drafts" }),
          h("button", { class: "pv-button", type: "button", onclick: function () { newDraft(null); } }, "New Draft")),
        listEl),
      paper);
    show(head(me, "write"), shell);

    Promise.all([api("/api/projects"), api("/api/figures")]).then(function (both) {
      state.projects = (both[0].data && both[0].data.projects) || [];
      state.figures = {};
      ((both[1].data && both[1].data.figures) || []).forEach(function (f) { state.figures[f.id] = f; });
    });
    load().then(function () {
      var want = params.get("draft");
      if (want) return openDraft(want);
      // "Start the Draft" in a project: its draft opens, and is started if
      // there is none yet (Fable's check of batches 2 and 3, point 10).
      var project = params.get("project");
      if (project) {
        var has = state.drafts.filter(function (d) { return d.project_id === project; })[0];
        return has ? openDraft(has.id) : newDraft(project);
      }
      if (state.drafts.length) return openDraft(state.drafts[0].id);
      blank();
    });

    window.addEventListener("beforeunload", function (e) {
      if (state.dirty || state.saving) { e.preventDefault(); e.returnValue = ""; }
    });

    function load() {
      return api("/api/drafts").then(function (r) {
        if (r.status === 401 || r.status === 403) { location.href = PAGES.home; return; }
        if (!r.ok) { clear(listEl); add(listEl, h("li", { class: "pv-ws-empty", text: r.data.error || "Your drafts could not be loaded." })); return; }
        state.drafts = r.data.drafts || [];
        drawList();
      });
    }

    function drawList() {
      clear(listEl);
      if (!state.drafts.length) add(listEl, h("li", { class: "pv-ws-empty", text: "No drafts yet." }));
      state.drafts.forEach(function (d) {
        add(listEl, h("li", null, h("button", {
          type: "button",
          class: "pv-ws-item" + (state.open && state.open.id === d.id ? " is-open" : ""),
          "aria-current": state.open && state.open.id === d.id ? "true" : null,
          onclick: function () { openDraft(d.id); }
        },
          h("span", { class: "pv-ws-item-t", text: d.title || "Untitled" }),
          h("span", { class: "pv-ws-item-d", text: plural(d.words, "word", "words") + " · " + when(d.updated_at) }),
          d.project_title ? h("span", { class: "pv-ws-item-d", text: "in " + d.project_title }) : null)));
      });
    }

    function blank() {
      shell.classList.remove("is-open");
      clear(paper);
      add(paper, h("div", { class: "pv-ws-blank" },
        h("p", { class: "pv-ws-blank-t", text: state.drafts.length ? "Pick a draft, or start a new one." : "Nothing written yet." }),
        h("p", { text: "A draft cites a work or a Monitor item with @, takes in a chart you sent from a Data page, and builds its own reference list." }),
        h("button", { class: "pv-button", type: "button", onclick: function () { newDraft(null); } }, "Start a Draft")));
    }

    // "New Draft" opens a loose draft that nobody has written in yet, if there
    // is one, rather than make one more, so that empty drafts never pile up
    // (the live check before the trial, point 3).
    function newDraft(projectId) {
      flush().then(function () {
        state.open = null;
        clear(paper);
        add(paper, h("p", { class: "pv-lib-loading", text: "Starting a draft…" }));
        var spare = projectId ? null : state.drafts.filter(function (d) { return d.blank && !d.project_id; })[0];
        if (spare) return { reuse: spare.id };
        return api("/api/drafts", { method: "POST", body: { title: "", project_id: projectId || null } });
      }).then(function (r) {
        if (r.reuse) return openDraft(r.reuse, true);
        // The project has its draft already: that one opens.
        if (r.status === 409 && r.data.draft) return load().then(function () { return openDraft(r.data.draft); });
        if (!r.ok) { clear(paper); add(paper, message(r.data.error || "A draft could not be made.", "error")); return; }
        return load().then(function () { return openDraft(r.data.draft.id, true); });
      });
    }

    function openDraft(id, fresh) {
      return flush().then(function () { return api("/api/drafts/" + encodeURIComponent(id)); }).then(function (r) {
        if (!r.ok) { return load().then(blank); }
        draw(r.data, !!fresh);
      });
    }

    var editor = null, titleEl = null, statusEl = null, refsEl = null, countEl = null;

    function draw(data, fresh) {
      var d = data.draft;
      state.open = d;
      if (params.get("project") || params.get("draft") !== d.id) {
        try { history.replaceState(null, "", PAGES.write + "?draft=" + encodeURIComponent(d.id)); } catch (e) {}
      }
      state.base = d.updated_at;
      state.dirty = false;
      shell.classList.add("is-open");
      drawList();
      clear(paper);

      (data.figures || []).forEach(function (f) { state.figures[f.id] = f; });
      window.PVEditor.setFigures(Object.keys(state.figures).map(function (k) { return state.figures[k]; }));

      titleEl = h("input", { type: "text", class: "pv-ws-title", maxlength: "200", placeholder: "Title", "aria-label": "Title of the draft", value: d.title });
      statusEl = h("span", { class: "pv-ws-status", "aria-live": "polite", text: "Saved" });
      countEl = h("span", { class: "pv-ws-dates" });
      refsEl = h("div", { class: "pv-ws-refs" });

      var toWord = h("button", { class: "pv-button pv-ws-ghost", type: "button", onclick: function () { toWordFile(toWord); } }, "Export to Word");
      var where = data.project
        ? h("a", { class: "pv-ws-small", href: PAGES.projects + "?p=" + encodeURIComponent(data.project.id), text: "In " + data.project.title })
        : projectPicker();

      add(paper,
        h("div", { class: "pv-ws-editor-head" },
          h("button", { class: "pv-lib-link pv-ws-backlist", type: "button", onclick: function () { flush().then(function () { state.open = null; drawList(); blank(); }); } }, "← All Drafts"),
          where,
          h("span", { class: "pv-ws-head-end" }, statusEl, toWord)),
        titleEl);

      var slot = h("div");
      add(paper, slot);
      editor = window.PVEditor.make({
        host: slot,
        label: "Text of the draft",
        placeholder: "Write here. Type @ to cite.",
        search: pickCites,
        withFigure: insertFigure,
        onCite: afterCite,
        onCiteCaret: caretCite,
        onChange: function () { changed(); }
      });
      editor.open(d.body);
      add(paper, refsEl,
        h("div", { class: "pv-ws-editor-foot" }, countEl,
          h("span", { class: "pv-ws-foot-end" },
            h("button", { class: "pv-lib-link", type: "button", onclick: function () { askDelete(); } }, "Delete this draft"))));
      drawRefs();
      (fresh ? titleEl : editor).focus();
      titleEl.addEventListener("input", changed);
    }

    function projectPicker() {
      var box = h("select", { class: "pv-ws-pick-s", "aria-label": "Project" });
      add(box, h("option", { value: "", text: "No project" }));
      state.projects.forEach(function (p) {
        if (p.counts.draft && (!state.open || state.open.project_id !== p.id)) return;
        add(box, h("option", { value: p.id, text: p.title, selected: state.open && state.open.project_id === p.id }));
      });
      box.addEventListener("change", function () {
        api("/api/drafts/" + encodeURIComponent(state.open.id), { method: "PATCH", body: { project_id: box.value || null } }).then(function (r) {
          if (!r.ok) { statusEl.textContent = "Not saved: " + (r.data.error || "the project could not be set."); return; }
          state.open.project_id = box.value || null;
          state.base = r.data.updated_at;
          load();
        });
      });
      return h("span", { class: "pv-ws-pick-in" }, h("span", { class: "pv-ws-small", text: "Project" }), box);
    }

    function changed() {
      state.dirty = true;
      statusEl.textContent = "Not saved yet";
      drawRefs();
      save();
    }

    var save = debounce(function () { flush(); }, 900);

    function flush() {
      if (!state.open || !state.dirty || !editor) return Promise.resolve();
      if (state.saving) return state.saving;
      var d = state.open;
      var sent = { title: titleEl.value, body: JSON.parse(editor.stored()), base: state.base };
      state.dirty = false;
      statusEl.textContent = "Saving…";
      state.saving = api("/api/drafts/" + encodeURIComponent(d.id), { method: "PATCH", body: sent }).then(function (r) {
        state.saving = false;
        if (r.ok) {
          state.base = r.data.updated_at;
          d.title = sent.title;
          d.words = r.data.words;
          var item = state.drafts.filter(function (x) { return x.id === d.id; })[0];
          if (item) {
            item.title = sent.title; item.words = r.data.words; item.updated_at = r.data.updated_at;
            item.blank = !sent.title && !r.data.words && !editor.figures().length;
          }
          state.drafts.sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; });
          drawList();
          if (state.dirty) return flush();
          statusEl.textContent = "Saved";
          drawRefs();
          return;
        }
        state.dirty = true;
        if (r.status === 409) {
          statusEl.textContent = "";
          paper.insertBefore(h("div", { class: "pv-ws-note is-error", role: "alert" },
            "This draft was changed in another window. Copy what you wrote here if you need it, then ",
            h("button", { class: "pv-lib-link", type: "button", onclick: function () { state.dirty = false; openDraft(d.id); } }, "load the newest text"), "."), paper.firstChild);
          return;
        }
        statusEl.textContent = r.status === 401 ? "Not saved: you are signed out." : r.data.error ? "Not saved: " + r.data.error : "Not saved. Trying again…";
        if (r.status === 0 || r.status >= 500) window.setTimeout(function () { flush(); }, 5000);
      });
      return state.saving;
    }

    // ---------------------------------------------------------- what is cited

    // The references of what the draft cites, asked of the server, which holds
    // the lines the site itself gave when each thing was saved. A cite asked
    // for and not yet answered is on its way; only the server's answer that it
    // is not on the shelf makes it gone. An answer that fails frees the cites to
    // be asked again, a few seconds later (Fable's second run, serious point 3).
    var onTheWay = {};
    var gone = {};
    function keyOf(c) { return c.kind + "\u0000" + c.ref; }
    var again = null;
    function fetchCards(want) {
      var waits = [];
      var fresh = [];
      want.forEach(function (c) {
        var k = keyOf(c);
        if (state.cards[k] || gone[k]) return;
        if (onTheWay[k]) { waits.push(onTheWay[k]); return; }
        fresh.push(c);
      });
      if (fresh.length) {
        var ed = editor;
        var later = function () {
          if (again) return;
          again = window.setTimeout(function () {
            again = null;
            if (editor && editor === ed) fetchCards(editor.cites());
          }, 4000);
        };
        var job = api("/api/write/cites", { method: "POST", body: { refs: fresh.map(function (c) { return { kind: c.kind, ref: c.ref }; }) } })
          .then(function (r) {
            if (!r.ok) {
              fresh.forEach(function (c) { delete onTheWay[keyOf(c)]; });
              later();
              return;
            }
            var got = r.data.things || [];
            return Promise.all(got.map(withIssueCite)).then(function (things) {
              fresh.forEach(function (c) { delete onTheWay[keyOf(c)]; });
              var answered = {};
              got.forEach(function (t) { answered[keyOf(t)] = true; });
              things.forEach(function (t) {
                if (!t) return;
                state.cards[keyOf(t)] = t;
                delete gone[keyOf(t)];
              });
              // Only what the server says is not on the shelf is gone; an item
              // whose issue could not be read just now is asked for again.
              fresh.forEach(function (c) { if (!answered[keyOf(c)]) gone[keyOf(c)] = true; });
              if (things.some(function (t) { return !t; })) later();
              drawRefs(true);
              // The line under the buttons can now say whether there is a note.
              if (editor) editor.redrawCaret();
            });
          })
          .catch(function () {
            // Anything unforeseen: these cites are simply asked for again.
            fresh.forEach(function (c) { delete onTheWay[keyOf(c)]; });
            later();
          });
        fresh.forEach(function (c) { onTheWay[keyOf(c)] = job; });
        waits.push(job);
      }
      return Promise.all(waits);
    }

    // A Monitor item saved where its reference was not given (Events in
    // Monitor) takes the reference its own issue gives under "Cite This Item",
    // and the shelf keeps it from then on, so that no item a draft cites is
    // ever left out of the reference list. Gives back the card, or null when
    // the issue could not be read just now.
    function withIssueCite(t) {
      if (t.kind !== "item" || t.cite) return Promise.resolve(t);
      var m = /^(\d{4}-\d+):(\d+)$/.exec(t.ref || "");
      if (!m) return Promise.resolve(t);
      return issueCard(m[1], m[2]).then(function (x) {
        if (x.failed) return null;
        if (!x.card || !x.card.cite) return t;
        // The reference, the line and the full address come from the issue. The
        // title the reader saved the item under is left alone: a one-line entry
        // saved on Events in Monitor keeps its own words instead of taking the
        // sub-heading of the issue. The save sends no title, and the server
        // keeps the title it already has (Fable's re-check of the trial fixes,
        // point 4b).
        var card = Object.assign({}, x.card);
        delete card.title;
        api("/api/keep", { method: "POST", body: card });
        return Object.assign({}, t, {
          extra: x.card.extra || t.extra,
          url: x.card.url || t.url,
          cite: x.card.cite,
          bibtex: x.card.bibtex || t.bibtex
        });
      });
    }

    // True when every cite of the draft is answered or gone.
    function allAnswered() {
      return editor.cites().every(function (c) { return state.cards[keyOf(c)] || gone[keyOf(c)]; });
    }

    function drawRefs(quiet) {
      if (!editor || !refsEl) return;
      var cites = editor.cites();
      if (!quiet) fetchCards(cites);
      var refs = referencesOf(editor, state.cards, state.figures, gone);
      editor.setLetters(lettersOf(refs));
      clear(refsEl);
      countEl.textContent =
        plural(editor.count(), "word", "words") +
        " · " + plural(cites.filter(function (c) { return c.kind === "work"; }).length, "work cited", "works cited") +
        " · " + plural(cites.filter(function (c) { return c.kind === "item"; }).length, "Monitor item", "Monitor items") +
        " · " + plural(editor.figures().length, "figure", "figures");
      if (!refs.length) return;
      add(refsEl, h("h3", { class: "pv-ws-refs-h", text: "References" }));
      refs.forEach(function (r) {
        if (r.missing) {
          add(refsEl, h("p", { class: "pv-ws-ref is-gone" }, h("em", { text: goneLine(r.label) })));
          return;
        }
        add(refsEl, reference(h("p", { class: "pv-ws-ref" }), r.text));
      });
      add(refsEl, h("p", { class: "pv-ws-refs-foot" },
        h("em", { text: "Built from what you cite, in Chicago author-date." }),
        h("button", { class: "pv-lib-link", type: "button", onclick: function (e) { bibtex(e.currentTarget, refs); } }, "Download BibTeX of the Works Cited")));
    }

    // The BibTeX of the works cited: the Monitor's own entries, and for the
    // works the Library's own file of BibTeX, fetched only when it is asked for.
    function bibtex(button, refs) {
      var label = button.textContent;
      button.disabled = true;
      button.textContent = "Fetching the references…";
      function back(words) {
        button.disabled = false;
        button.textContent = words || label;
        if (words) window.setTimeout(function () { button.textContent = label; }, 3000);
      }
      var works = refs.filter(function (r) { return r.kind === "work"; });
      var out = [];
      refs.forEach(function (r) { if (r.kind !== "work" && r.bibtex) out.push(r.bibtex); });
      if (!works.length) {
        if (!out.length) return back("Nothing cited yet");
        saveFile(new Blob([out.join("\n") + "\n"], { type: "application/x-bibtex;charset=utf-8" }), fileName(state.open.title || "works-cited", ".bib"));
        return back("Downloaded");
      }
      fetch(BASE + "../library/library-text.json", { cache: "force-cache" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          var map = (data && data.text) || {};
          var missing = 0;
          works.forEach(function (w) {
            var t = map[w.ref];
            if (t && t.bibtex) out.push(t.bibtex); else missing++;
          });
          if (!out.length) return back("Could not be fetched");
          saveFile(new Blob([out.join("\n") + "\n"], { type: "application/x-bibtex;charset=utf-8" }), fileName(state.open.title || "works-cited", ".bib"));
          back(missing ? missing + " without BibTeX" : "Downloaded");
        }, function () { back("Could not be fetched"); });
    }

    // ------------------------------------------------------------- the picker

    function afterCite(value) {
      // A cite just chosen is on the shelf now, even if it was gone before.
      delete gone[keyOf(value)];
      fetchCards([value]);
    }

    // The bar under the buttons, when the caret stands at a cite: the work, a
    // link to it, and the reader's own note on it, ready to be put in.
    function caretCite(value, bar) {
      var card = state.cards[value.kind + "\u0000" + value.ref];
      if (!card) { fetchCards([value]); return; }
      if (!card.note) return;
      add(bar, h("em", { class: "pv-ws-small", text: "You have a note on this." }));
      add(bar, h("button", { class: "pv-lib-link", type: "button", onclick: function () {
        editor.insertQuote(card.note + "\nMy note on " + shortName(value.kind, card));
      } }, "Insert My Note"));
    }

    // ---------------------------------------------------------- a chart or table

    // The list opens right under the row of buttons, where the reader pressed
    // "Insert a Chart or Table", and is brought into view; on a long draft it
    // used to open at the very foot of the page (the live check before the
    // trial, point 3). The chart goes in where the caret was.
    function insertFigure(ed) {
      var open = paper.querySelector(".pv-ws-figbox");
      if (open) { open.parentNode.removeChild(open); return; }
      var list = Object.keys(state.figures).map(function (k) { return state.figures[k]; });
      var box = h("div", { class: "pv-keep-box pv-ws-figbox", role: "dialog", "aria-label": "Insert a Chart or Table" });
      box.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && box.parentNode) { box.parentNode.removeChild(box); ed.focus(); }
      });
      add(box, h("p", { class: "pv-keep-lede", text: "Insert a Chart or Table" }));
      if (!list.length) {
        add(box, h("p", { text: "Nothing sent yet. On a Data page, under a chart, press Send to Write. The picture and its numbers are then fixed at that day." }),
          h("p", { class: "pv-ws-blank-links" },
            h("a", { href: BASE + "../data/who-counts.html", text: "Who Counts as Populist?" }),
            h("a", { href: BASE + "../data/in-power.html", text: "Populists in Power" }),
            h("a", { href: BASE + "../data/events.html", text: "Events in Monitor" })));
      } else {
        var ul = h("ul", { class: "pv-ws-figlist" });
        list.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
        list.forEach(function (f) {
          add(ul, h("li", null,
            h("button", { class: "pv-ws-item", type: "button", onclick: function () {
              box.parentNode.removeChild(box);
              window.PVEditor.addFigure(f);
              if (!f.picture) {
                api("/api/figures/" + encodeURIComponent(f.id)).then(function (r) {
                  if (r.ok) { state.figures[f.id] = r.data.figure; window.PVEditor.addFigure(r.data.figure); }
                  ed.insertFigure(f.id);
                });
                return;
              }
              ed.insertFigure(f.id);
            } },
              h("span", { class: "pv-ws-item-t", text: f.title }),
              h("span", { class: "pv-ws-item-d", text: "Data as of " + (f.day || "") })),
            h("button", { class: "pv-lib-link", type: "button", onclick: function (e) {
              var btn = e.currentTarget;
              api("/api/figures/" + encodeURIComponent(f.id), { method: "DELETE" }).then(function () {
                delete state.figures[f.id];
                btn.parentNode.parentNode.removeChild(btn.parentNode);
              });
            } }, "Remove")));
        });
        add(box, ul);
      }
      add(box, h("p", { class: "pv-keep-row" }, h("button", { class: "pv-keep-b", type: "button", onclick: function () { box.parentNode.removeChild(box); } }, "Close")));
      var bar = ed.shell && ed.shell.querySelector(".pv-ed-bar");
      if (bar && bar.parentNode) bar.parentNode.insertBefore(box, bar.nextSibling);
      else paper.appendChild(box);
      if (box.scrollIntoView) box.scrollIntoView({ block: "nearest" });
      var first = box.querySelector("button, a");
      if (first && first.focus) first.focus({ preventScroll: true });
    }

    // ------------------------------------------------------------- to Word

    function toWordFile(button) {
      var label = button.textContent;
      button.disabled = true;
      button.textContent = "Making the Word file…";
      function back(words) {
        button.disabled = false;
        button.textContent = words || label;
        if (words) window.setTimeout(function () { button.textContent = label; }, 3000);
      }
      // The file waits for every reference to be answered. An answer that
      // fails is asked again, three times; if it still fails, no file is made,
      // so no reference is ever written as gone when it was only late.
      function answered(tries) {
        return fetchCards(editor.cites()).then(function () {
          if (allAnswered()) return true;
          if (!tries) return false;
          return new Promise(function (done) { window.setTimeout(done, 1500); }).then(function () { return answered(tries - 1); });
        });
      }
      flush().then(function () {
        return answered(3);
      }).then(function (ready) {
        if (!ready) throw new Error("references");
        return withDocx();
      }).then(function (docx) {
        var refs = referencesOf(editor, state.cards, state.figures, gone);
        var doc = wordDoc(docx, {
          title: titleEl.value || "Untitled",
          blocks: paragraphs(editor.delta(), lettersOf(refs)),
          references: refs,
          figures: state.figures,
          foot: "Written in the PopuliVerse Workspace. populiverse.com"
        });
        return docx.Packer.toBlob(doc);
      }).then(function (blob) {
        saveFile(blob, fileName(titleEl.value || "draft", ".docx"));
        back("Downloaded");
      }, function () { back("Could not be made"); });
    }

    function askDelete() {
      var foot = paper.querySelector(".pv-ws-editor-foot .pv-ws-foot-end");
      clear(foot);
      add(foot, h("span", { class: "pv-ws-ask" }, h("span", { text: "Delete this draft for good?" }),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () {
          api("/api/drafts/" + encodeURIComponent(state.open.id), { method: "DELETE" }).then(function () {
            state.open = null; state.dirty = false;
            load().then(blank);
          });
        } }, "Yes, delete"),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () {
          clear(foot);
          add(foot, h("button", { class: "pv-lib-link", type: "button", onclick: function () { askDelete(); } }, "Delete this draft"));
        } }, "Keep it")));
    }
  }

  // ---------------------------------------------------------------- Projects

  function projectList(me) {
    var body = h("div");
    show(head(me, "projects"), body);
    draw();

    function draw() {
      api("/api/projects").then(function (r) {
        if (r.status === 401 || r.status === 403) { location.href = PAGES.home; return; }
        clear(body);
        if (!r.ok) { add(body, message(r.data.error || "Your projects could not be loaded.", "error")); return; }
        var list = r.data.projects || [];
        add(body, h("div", { class: "pv-ws-head-row pv-ws-projects-head" },
          h("p", { class: "pv-ws-count-line", text: plural(list.length, "project", "projects") }),
          h("button", { class: "pv-button", type: "button", onclick: function () { startForm(true); } }, "New Project")));
        if (list.length) {
          var ul = h("ul", { class: "pv-ws-projects" });
          list.forEach(function (p) {
            var c = p.counts;
            add(ul, h("li", null, h("a", { class: "pv-ws-project", href: PAGES.projects + "?p=" + encodeURIComponent(p.id) },
              h("span", { class: "pv-ws-project-top" },
                h("span", { class: "pv-ws-project-t", text: p.title }),
                h("span", { class: "pv-ws-small", text: "Edited " + when(p.updated_at) })),
              p.question ? h("span", { class: "pv-ws-project-q", text: p.question }) : null,
              h("span", { class: "pv-ws-small pv-ws-project-n", text: [
                plural(c.cases, "case", "cases"),
                plural(c.works, "work", "works"),
                plural(c.items, "Monitor item", "Monitor items"),
                c.charts ? plural(c.charts, "chart", "charts") : null,
                plural(c.notes, "note", "notes"),
                plural(c.pages, "page", "pages"),
                c.draft ? plural(c.draft.words, "word in the draft", "words in the draft") : "no draft"
              ].filter(Boolean).join(" · ") }))));
          });
          add(body, ul);
        }
        startForm(!list.length);
      });
    }

    function startForm(open) {
      var old = body.querySelector(".pv-ws-start");
      if (old) old.parentNode.removeChild(old);
      if (!open) return;
      var title = h("input", { class: "pv-ws-in", type: "text", id: "pj-t", maxlength: "200", placeholder: "Title" });
      var question = h("input", { class: "pv-ws-in", type: "text", id: "pj-q", maxlength: "600", placeholder: "Your research question" });
      var err = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
      var box = h("div", { class: "pv-ws-start" },
        h("p", { class: "pv-ws-lede", text: "A project keeps your question, cases, literature, events, notes and draft in one view." }),
        h("label", { class: "pv-ws-fl", for: "pj-t", text: "Title" }), title,
        h("label", { class: "pv-ws-fl", for: "pj-q", text: "Your research question" }), question,
        h("p", { class: "pv-ws-small", text: "You can change both later." }),
        err,
        h("button", { class: "pv-button", type: "button", onclick: function () {
          api("/api/projects", { method: "POST", body: { title: title.value, question: question.value } }).then(function (r) {
            if (!r.ok) { err.textContent = r.data.error || "That project could not be started."; return; }
            location.href = PAGES.projects + "?p=" + encodeURIComponent(r.data.project.id);
          });
        } }, "Start the Project"));
      add(body, box);
    }
  }

  // A project as one view: question, cases, literature, events, notes, pages
  // and one draft.
  function oneProject(me, id) {
    var body = h("div");
    show(head(me, "projects"), body);
    Promise.all([api("/api/projects/" + encodeURIComponent(id)), site()]).then(function (both) {
      var r = both[0], data = both[1];
      clear(body);
      if (r.status === 404) { add(body, message("That project is not there.", "error"), h("p", null, h("a", { href: PAGES.projects }, "All Projects"))); return; }
      if (!r.ok) { add(body, message(r.data.error || "That project could not be loaded.", "error")); return; }
      draw(r.data, data);
    });

    function draw(d, data) {
      var p = d.project;
      var things = d.things || [];
      var cases = things.filter(function (t) { return t.kind === "actor" || t.kind === "country"; });
      var works = things.filter(function (t) { return t.kind === "work"; });
      var items = things.filter(function (t) { return t.kind === "item"; });
      var charts = things.filter(function (t) { return t.kind === "chart"; });
      var notes = things.filter(function (t) { return t.note; });

      add(body,
        h("p", { class: "pv-ws-crumb" }, h("a", { href: PAGES.projects, text: "All Projects" }),
          h("span", { class: "pv-ws-dot", "aria-hidden": "true", text: "/" }), h("span", { text: p.title })),
        h("h2", { class: "pv-ws-project-h", text: p.title }),
        question(p));

      var grid = h("div", { class: "pv-ws-panels" });
      add(body, grid);

      // Cases
      var casePanel = panel("Cases", String(cases.length));
      if (!cases.length) add(casePanel.body, h("p", { class: "pv-ws-small", text: "Save an actor or a country, then add it here." }));
      cases.forEach(function (t) {
        var row = h("div", { class: "pv-ws-prow" },
          h("span", { class: "pv-ws-prow-top" },
            t.url ? h("a", { href: t.url, text: t.title }) : h("span", { text: t.title }),
            h("span", { class: "pv-ws-small", text: t.kind === "country" ? "Country" : t.extra || "Actor" })));
        var links = crossLinks(t, data);
        if (links.length) {
          var line = h("span", { class: "pv-ws-small" });
          links.forEach(function (l, i) { if (i) add(line, h("span", { class: "pv-ws-dot", "aria-hidden": "true", text: "·" })); add(line, l); });
          add(row, line);
        }
        add(casePanel.body, row);
      });
      // The whole shelf, on its actors, ready to add to this project (Fable's
      // check of batches 2 and 3, point 10).
      add(casePanel.foot, h("a", { class: "pv-lib-link", href: PAGES.home + "?kind=actor&addto=" + encodeURIComponent(p.id), text: "Add a Case from Your Shelf" }));
      add(grid, casePanel.el);

      // Literature: one short line a work, so that the panel stays short; the
      // whole references are on the shelf and in the Annotated Bibliography
      // (the live check before the trial, point 4).
      var litPanel = panel("Literature", plural(works.length, "work", "works"));
      add(litPanel.body, readingBar(d.reading || {}));
      works.slice(0, 5).forEach(function (t) {
        var whole = plainOf(t.cite || t.title);
        add(litPanel.body, h("p", { class: "pv-ws-prow pv-ws-lit", title: whole, text: cut(whole, 110) }));
      });
      if (works.length > 5) add(litPanel.body, h("p", { class: "pv-ws-small", text: "and " + (works.length - 5) + " more" }));
      add(litPanel.foot,
        h("a", { class: "pv-lib-link", href: PAGES.home + "?project=" + encodeURIComponent(p.id), text: "Open on Your Shelf" }),
        h("button", { class: "pv-lib-link", type: "button", onclick: function (e) { annotated(e.currentTarget, p.id); } }, "Annotated Bibliography"));
      add(grid, litPanel.el);

      // Events: the Monitor's items of the cases, the saved ones filled
      add(grid, eventsPanel(cases, items, data, p).el);

      // The tools, from inside the project (batch 4, Part B). The Chronology
      // Maker opens on this project's own cases.
      if (window.PVTools) {
        var toolPanel = panel("Tools", String(1 + window.PVTools.count));
        add(toolPanel.body,
          h("p", { class: "pv-ws-small", text: "Every tool of the Tools tab also opens from here, on this project." }),
          window.PVTools.fromProject(p.id),
          h("p", { class: "pv-ws-tool-row" },
            h("button", { class: "pv-lib-link", type: "button", onclick: function (e) { annotated(e.currentTarget, p.id); } }, "Annotated Bibliography")));
        add(grid, toolPanel.el);
      }

      // Every Monitor item and chart put into the project, also those that
      // name none of its cases (the live check before the trial, point 4).
      var saved = items.concat(charts);
      var savedPanel = panel("Monitor Items and Charts", String(saved.length));
      if (!saved.length) {
        add(savedPanel.body, h("p", { class: "pv-ws-small", text: "Add a Monitor item or a chart from your shelf, and it shows here." }));
      }
      saved.slice(0, 6).forEach(function (t) {
        var name = cut(t.title || t.ref, 110);
        var where = t.kind === "chart" ? "Chart" : String(t.extra || "").split(" \u00b7 ")[0] || "Monitor item";
        add(savedPanel.body, h("div", { class: "pv-ws-prow" },
          t.url ? h("a", { class: "pv-ws-prow-l", href: t.url, text: name }) : h("span", { class: "pv-ws-prow-l", text: name }),
          h("span", { class: "pv-ws-small pv-ws-prow-l", text: where })));
      });
      if (saved.length > 6) add(savedPanel.body, h("p", { class: "pv-ws-small", text: "and " + (saved.length - 6) + " more" }));
      add(savedPanel.foot, h("a", { class: "pv-lib-link",
        href: PAGES.home + "?kind=" + (items.length || !charts.length ? "item" : "chart") + "&project=" + encodeURIComponent(p.id),
        text: "Open on Your Shelf" }));
      add(grid, savedPanel.el);

      // Notes
      var notePanel = panel("Notes", String(notes.length));
      if (!notes.length) add(notePanel.body, h("p", { class: "pv-ws-small", text: "Your notes on what is in this project show here." }));
      notes.slice(0, 5).forEach(function (t) {
        add(notePanel.body, h("div", { class: "pv-ws-prow" },
          h("span", { class: "pv-ws-small pv-ws-prow-l", text: "On " + cut(t.title || t.ref, 70) }),
          h("span", { class: "pv-ws-prow-note", text: cut(t.note, 120) })));
      });
      add(notePanel.foot, h("a", { class: "pv-lib-link", href: PAGES.notes + "?project=" + encodeURIComponent(p.id), text: "All Notes in This Project" }));
      add(grid, notePanel.el);

      // Notebook
      var pagePanel = panel("Notebook", plural((d.pages || []).length, "page", "pages"));
      if (!(d.pages || []).length) add(pagePanel.body, h("p", { class: "pv-ws-small", text: "Pages of your Notebook can go in this project." }));
      (d.pages || []).slice(0, 5).forEach(function (pg) {
        add(pagePanel.body, h("div", { class: "pv-ws-prow" },
          h("span", { class: "pv-ws-prow-top" },
            h("a", { href: PAGES.notebook + "?page=" + encodeURIComponent(pg.id), text: pg.title || "Untitled" }),
            h("span", { class: "pv-ws-small", text: when(pg.updated_at) }))));
      });
      add(pagePanel.foot, h("a", { class: "pv-lib-link", href: PAGES.notebook + "?project=" + encodeURIComponent(p.id) + "&new=1", text: "New Page" }));
      add(grid, pagePanel.el);

      // Draft
      var draftPanel = panel("Draft", d.draft ? "Edited " + when(d.draft.updated_at) : "");
      if (d.draft) {
        add(draftPanel.body,
          h("p", { class: "pv-ws-prow-t", text: d.draft.title || "Untitled" }),
          h("p", { class: "pv-ws-small", text: plural(d.draft.words, "word", "words") }));
        add(draftPanel.foot, h("a", { class: "pv-button", href: PAGES.write + "?draft=" + encodeURIComponent(d.draft.id), text: "Open in Write" }));
      } else {
        add(draftPanel.body, h("p", { class: "pv-ws-small", text: "One project holds one draft." }));
        add(draftPanel.foot, h("a", { class: "pv-button", href: PAGES.write + "?project=" + encodeURIComponent(p.id), text: "Start the Draft" }));
      }
      add(grid, draftPanel.el);

      add(body, h("p", { class: "pv-ws-project-foot" },
        h("em", { class: "pv-ws-small", text: "Everything in it stays in your Workspace." }),
        h("button", { class: "pv-lib-link", type: "button", onclick: function (e) { askDelete(e.currentTarget); } }, "Delete this project")));
    }

    function question(p) {
      var line = h("p", { class: "pv-ws-q", text: p.question || "No question yet." });
      var box = h("div", { class: "pv-ws-qbox" },
        h("p", { class: "pv-ws-label-s", text: "Question" }), line,
        h("button", { class: "pv-lib-link", type: "button", onclick: edit }, "Edit"));
      return box;

      function edit() {
        var title = h("input", { class: "pv-ws-in", type: "text", maxlength: "200", value: p.title, "aria-label": "Title" });
        var words = h("input", { class: "pv-ws-in", type: "text", maxlength: "600", value: p.question, "aria-label": "Your research question" });
        var err = h("p", { class: "pv-ws-field-error", "aria-live": "polite" });
        clear(box);
        add(box, h("p", { class: "pv-ws-label-s", text: "Title" }), title,
          h("p", { class: "pv-ws-label-s", text: "Question" }), words, err,
          h("p", { class: "pv-ws-notebox-row" },
            h("button", { class: "pv-button", type: "button", onclick: function () {
              api("/api/projects/" + encodeURIComponent(p.id), { method: "PATCH", body: { title: title.value, question: words.value } })
                .then(function (r) {
                  if (!r.ok) { err.textContent = r.data.error || "That could not be saved."; return; }
                  location.reload();
                });
            } }, "Save"),
            h("button", { class: "pv-lib-link", type: "button", onclick: function () { location.reload(); } }, "Cancel")));
      }
    }

    function askDelete(button) {
      var row = button.parentNode;
      var ask = h("span", { class: "pv-ws-ask" },
        h("span", { text: "Delete this project? Its works, notes, pages and draft stay in your Workspace." }),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () {
          api("/api/projects/" + encodeURIComponent(id), { method: "DELETE" }).then(function () { location.href = PAGES.projects; });
        } }, "Yes, delete"),
        h("button", { class: "pv-lib-link", type: "button", onclick: function () { row.replaceChild(button, ask); } }, "Keep it"));
      row.replaceChild(ask, button);
    }
  }

  function panel(name, right) {
    var body = h("div", { class: "pv-ws-pbody" });
    var foot = h("p", { class: "pv-ws-pfoot" });
    var el = h("section", { class: "pv-ws-panel", "aria-label": name },
      h("div", { class: "pv-ws-phead" }, h("h3", { text: name }), right ? h("span", { text: right }) : null),
      body, foot);
    return { el: el, body: body, foot: foot };
  }

  function readingBar(bars) {
    var names = [["to-read", "To Read"], ["reading", "Reading"], ["read", "Read"]];
    var total = names.reduce(function (s, r) { return s + (bars[r[0]] || 0); }, 0) || 1;
    var strip = h("div", { class: "pv-ws-read", role: "img",
      "aria-label": "Reading: " + names.map(function (r) { return r[1] + " " + (bars[r[0]] || 0); }).join(", ") });
    names.forEach(function (r) {
      var w = Math.round(1000 * (bars[r[0]] || 0) / total) / 10;
      if (w) add(strip, h("span", { class: "pv-ws-read-part is-" + r[0], style: "width:" + w + "%" }));
    });
    var keys = h("p", { class: "pv-ws-small pv-ws-read-line" });
    names.forEach(function (r) { add(keys, h("span", { text: r[1] + " " + (bars[r[0]] || 0) })); });
    return h("div", { class: "pv-ws-reading" }, strip, keys);
  }

  // The events of a project fill by themselves from the Monitor: every item of
  // the Monitor that names one of the cases. The ones the reader has saved are
  // drawn filled, the others hollow.
  function eventsPanel(cases, saved, data, project) {
    var actors = {}, places = {};
    cases.forEach(function (c) { if (c.kind === "actor") actors[c.ref] = c.title; else places[c.ref] = c.title; });
    var mine = {};
    saved.forEach(function (s) { mine[s.ref] = true; });
    var rows = [];
    Object.keys(actors).concat(Object.keys(places)).forEach(function (key) {
      var name = actors[key] || places[key];
      var hits = [];
      Object.keys(data.items).forEach(function (k) {
        var it = data.items[k];
        var here = actors[key] ? (it.actors || []).indexOf(key) >= 0 : (it.iso || []).indexOf(key) >= 0;
        if (here) hits.push(it);
      });
      rows.push({ name: name, items: hits });
    });
    var all = [];
    rows.forEach(function (r) { r.items.forEach(function (it) { if (it.date) all.push(it.date); }); });
    all.sort();
    var from = all[0], to = all[all.length - 1];
    // An item that names two of the cases is still one item.
    var once = {};
    rows.forEach(function (r) { r.items.forEach(function (it) { once[it.folder + ":" + it.n] = true; }); });
    var count = Object.keys(once).length;
    var p = panel("Events", plural(count, "Monitor item", "Monitor items"));
    if (!count) {
      add(p.body, h("p", { class: "pv-ws-small", text: cases.length ? "The Monitor holds no item on these cases yet." : "Add a case, and its Monitor items fill in here." }));
      return p;
    }
    var span = Math.max(1, new Date(to) - new Date(from));
    var grid = h("div", { class: "pv-ws-dots", role: "img",
      "aria-label": "Monitor items of the cases over time; the ones you saved are filled" });
    rows.forEach(function (r) {
      add(grid, h("span", { class: "pv-ws-small pv-ws-dots-n", text: cut(r.name, 24) }));
      var lane = h("span", { class: "pv-ws-lane" });
      r.items.forEach(function (it) {
        var at = it.date ? (new Date(it.date) - new Date(from)) / span : 0;
        add(lane, h("a", {
          class: "pv-ws-dot-m" + (mine[it.folder + ":" + it.n] ? " is-mine" : ""),
          href: BASE + "../monitor/" + it.folder + "/index.html#item-" + it.n,
          title: it.title,
          style: "left:" + Math.round(at * 1000) / 10 + "%",
          "aria-label": it.title
        }));
      });
      add(grid, lane);
    });
    var day = function (iso) { var d = new Date(iso); return isNaN(d) ? "" : DATE_SHORT.format(d); };
    add(grid, h("span", { "aria-hidden": "true" }),
      h("span", { class: "pv-ws-small pv-ws-dots-dates" }, h("span", { text: from ? day(from) : "" }), h("span", { text: to && to !== from ? day(to) : "" })));
    add(p.body, grid,
      h("p", { class: "pv-ws-small pv-ws-dots-key" },
        h("span", null, h("span", { class: "pv-ws-key is-mine", "aria-hidden": "true" }), "Saved by you"),
        h("span", null, h("span", { class: "pv-ws-key", "aria-hidden": "true" }), "In the Monitor")));
    add(p.foot, h("a", { class: "pv-lib-link", href: BASE + "../data/events.html", text: "See the Items" }));
    return p;
  }

  // ------------------------------------------------------------------- Tools

  function tools(me) {
    var body = h("div", { class: "pv-ws-tools" });
    show(head(me, "tools"), body);
    api("/api/projects").then(function (r) {
      var list = (r.data && r.data.projects) || [];
      var more = window.PVTools ? window.PVTools.board(list) : [];
      var n = 1 + more.length;
      add(body,
        h("p", { class: "pv-ws-count-line", text: n === 1 ? "One tool so far." : plural(n, "tool", "tools") + " so far." }),
        h("div", { class: "pv-ws-tool" },
          h("h3", { class: "pv-ws-tool-h", text: "Annotated Bibliography" }),
          h("p", { text: "Your works as a Word file, each with the reference the Library holds and your own note under it." }),
          h("p", { class: "pv-ws-tool-row" },
            h("button", { class: "pv-lib-link", type: "button", onclick: function (e) { annotated(e.currentTarget, null); } }, "From Your Shelf"),
            list.length ? projectButton(list) : null)),
        more,
        h("p", { class: "pv-ws-small pv-ws-tools-foot", text: "More tools will come here. Each one also opens from inside a project." }));
    });

    // Picking a project makes its file at once. One quiet line beside the
    // picker says what is happening and then clears; the picker goes back to
    // its first line, ready for the next pick (the live check before the
    // trial, point 2b).
    function projectButton(list) {
      var box = h("select", { class: "pv-ws-pick-s", "aria-label": "From a project" });
      add(box, h("option", { value: "", text: "From a project…" }));
      list.forEach(function (p) { add(box, h("option", { value: p.id, text: p.title })); });
      var said = h("span", { class: "pv-ws-small pv-ws-tool-said", "aria-live": "polite" });
      box.addEventListener("change", function () {
        if (!box.value) return;
        var id = box.value;
        box.disabled = true;
        said.textContent = "Making the Word file…";
        bibliographyFile(id).then(function (words) {
          box.disabled = false;
          box.selectedIndex = 0;
          said.textContent = words;
          window.setTimeout(function () { if (said.textContent === words) said.textContent = ""; }, 3000);
        });
      });
      return h("span", { class: "pv-ws-pick-in" }, box, said);
    }
  }

  window.PVWrite = function (me, view) {
    if (view === "write") return write(me);
    if (view === "projects") {
      var id = params.get("p");
      return id ? oneProject(me, id) : projectList(me);
    }
    if (view === "tools") {
      // A tool names itself in the address, and carries its whole view there,
      // so that a link opens exactly what was seen (batch 4, Part B).
      if (window.PVTools && window.PVTools.openFromAddress(me)) return;
      return tools(me);
    }
  };
  window.PVCite = { pick: pickCites };
  window.PVWriteTools = { annotated: annotated, reference: reference, pieces: pieces, plainOf: plainOf };
})();
