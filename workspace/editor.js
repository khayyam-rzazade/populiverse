/* The one editor of the Workspace, used by the Notebook and by Write
 * (master plan, section 18, stage 2, batch 3).
 *
 * The editor itself is Quill 2.0.3, an established open library kept in this
 * site's own folder (workspace/vendor/quill.js, BSD-3-Clause). We wrote none of
 * it. Quill keeps a page as its own document, a plain list of pieces, and never
 * as HTML: nothing a person writes or pastes is ever stored as HTML or written
 * into the screen as HTML.
 *
 * Only five formats exist here: bold, italic, heading, quote and list. The
 * library is told that list and nothing else, so text pasted from anywhere
 * else arrives with everything but those five taken off. Two pieces of our own
 * stand beside them: a cite, which is a link to a work or a Monitor item, and
 * a figure, which is a chart or a table sent from a Data page.
 */
(function () {
  "use strict";

  var Quill = window.Quill;
  if (!Quill) return;

  var FORMATS = ["bold", "italic", "header", "blockquote", "list", "pvcite", "pvfigure"];
  var KINDS = { work: 1, item: 1, actor: 1, country: 1, chart: 1 };

  // A figure's foot carries one date: the day its data was taken. The source
  // line's own "Data as built on" sentence is not repeated there (Fable's check
  // of batches 2 and 3, point 13). Shared with the Word file (write.js).
  function figureFoot(f) {
    var source = String(f.source || "").replace(/\s*Data as built on [^.]*\.\s*/g, " ").replace(/\s+/g, " ").trim();
    return [source, f.day ? "Data as of " + f.day + "." : "", f.url].filter(Boolean).join(" ");
  }

  // Every web address a page shows must be a plain one: anything else — a
  // "javascript:" address, say — is shown without a link, so that nothing a
  // person writes can become a link that does something when it is clicked.
  function webAddress(url) {
    if (typeof url !== "string") return "";
    var clean = url.trim();
    return /^https?:\/\//i.test(clean) ? clean : "";
  }

  function textOf(v) {
    return String(v === null || v === undefined ? "" : v).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  }

  // The figures of the draft being written, by their own name. A figure's
  // picture is not part of the draft: the draft names it, and Write hands the
  // pictures over before it opens.
  var figures = {};

  var registered = false;
  function register() {
    if (registered) return;
    registered = true;

    var Embed = Quill.import("blots/embed");
    var BlockEmbed = Quill.import("blots/block/embed");

    // A cite: the short form in the text, and a link to the thing itself.
    var Cite = class extends Embed {
      static create(value) {
        var node = super.create(value);
        var v = value && typeof value === "object" ? value : {};
        var url = webAddress(v.url);
        node.setAttribute("data-kind", textOf(v.kind).slice(0, 20));
        node.setAttribute("data-ref", textOf(v.ref).slice(0, 200));
        node.setAttribute("data-text", textOf(v.text).slice(0, 300));
        if (url) {
          node.setAttribute("href", url);
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener");
        }
        node.textContent = textOf(v.text).slice(0, 300);
        return node;
      }
      // Only our own cite, with a kind and a name, is a cite. Any other link,
      // pasted from anywhere, is not: the editor then keeps its words, with
      // their bold and italic, and no link (Fable's check of batches 2 and 3,
      // point 4).
      static value(node) {
        if (!KINDS[node.getAttribute("data-kind")] || !node.getAttribute("data-ref")) return null;
        return {
          kind: node.getAttribute("data-kind") || "",
          ref: node.getAttribute("data-ref") || "",
          text: node.getAttribute("data-text") || "",
          url: node.getAttribute("href") || ""
        };
      }
    };
    Cite.blotName = "pvcite";
    Cite.tagName = "A";
    Cite.className = "pv-cite";
    Quill.register(Cite, true);

    // A figure: the picture a Data page drew, with the page's own source line.
    var Figure = class extends BlockEmbed {
      static create(value) {
        var node = super.create(value);
        var id = value && typeof value === "object" ? textOf(value.id).slice(0, 64) : "";
        node.setAttribute("data-fig", id);
        var f = figures[id];
        var caption = document.createElement("figcaption");
        caption.className = "pv-figure-cap";
        caption.textContent = f ? f.title : "";
        node.appendChild(caption);
        if (f && f.picture) {
          var img = document.createElement("img");
          img.setAttribute("src", f.picture);
          img.setAttribute("alt", f.title || "");
          node.appendChild(img);
        }
        var line = document.createElement("p");
        line.className = "pv-figure-src";
        line.textContent = f ? figureFoot(f) : "This figure is no longer in your Workspace.";
        node.appendChild(line);
        return node;
      }
      static value(node) {
        return { id: node.getAttribute("data-fig") || "" };
      }
    };
    Figure.blotName = "pvfigure";
    Figure.tagName = "FIGURE";
    Figure.className = "pv-figure";
    Quill.register(Figure, true);
  }

  // ------------------------------------------------------------ small helpers

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "text") el.textContent = v;
        else if (k === "class") el.className = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // A page written before this batch holds plain words. It opens unchanged: its
  // lines become the lines of the editor, with no format on any of them.
  function fromPlain(words) {
    return { ops: [{ insert: String(words || "") }] };
  }

  function isDelta(stored) {
    return typeof stored === "string" && /^\s*\{\s*"ops"\s*:/.test(stored);
  }

  // A page opens with only the pieces the editor knows. Anything else is left
  // out before the page opens, so that one unknown piece never cuts the page
  // off (Fable's check of batches 2 and 3, point 8).
  var LINE_FORMATS = { header: 1, blockquote: 1, list: 1 };
  function known(op) {
    if (!op || typeof op !== "object") return null;
    var attrs = null;
    if (op.attributes && typeof op.attributes === "object") {
      Object.keys(op.attributes).forEach(function (k) {
        if (FORMATS.indexOf(k) < 0 || k === "pvcite" || k === "pvfigure") return;
        (attrs = attrs || {})[k] = op.attributes[k];
      });
    }
    if (typeof op.insert === "string") return attrs ? { insert: op.insert, attributes: attrs } : { insert: op.insert };
    var e = op.insert;
    if (!e || typeof e !== "object") return null;
    var keys = Object.keys(e);
    if (keys.length !== 1) return null;
    if (keys[0] === "pvcite" && e.pvcite && KINDS[e.pvcite.kind] && e.pvcite.ref) return { insert: { pvcite: e.pvcite } };
    if (keys[0] === "pvfigure" && e.pvfigure && e.pvfigure.id) return { insert: { pvfigure: { id: e.pvfigure.id } } };
    return null;
  }
  function readStored(stored) {
    if (!isDelta(stored)) return fromPlain(stored);
    try {
      var d = JSON.parse(stored);
      if (!d || !Array.isArray(d.ops)) return fromPlain("");
      var ops = [];
      d.ops.forEach(function (op) { var k = known(op); if (k) ops.push(k); });
      return { ops: ops };
    } catch (e) {
      return fromPlain(stored);
    }
  }

  // ------------------------------------------------------------ the editor

  // opts: host, placeholder, search (words -> Promise of groups), onChange,
  // onCiteCaret (value or null), withFigure (a function that opens the picker),
  // label.
  function make(opts) {
    register();
    var host = opts.host;
    clear(host);

    var toolbar = h("div", { class: "pv-ed-bar", role: "toolbar", "aria-label": "Formatting" });
    var paper = h("div", { class: "pv-ed-paper" });
    var hint = h("span", { class: "pv-ed-hint", text: "Type @ to cite a work or a Monitor item" });
    var caretBar = h("p", { class: "pv-ed-cite", hidden: true, "aria-live": "polite" });
    var shell = h("div", { class: "pv-ed" }, toolbar, caretBar, paper);
    host.appendChild(shell);

    var quill = new Quill(paper, {
      formats: FORMATS,
      placeholder: opts.placeholder || "",
      modules: { toolbar: false },
      theme: "default"
    });
    quill.root.setAttribute("aria-label", opts.label || "Text");

    // ---------------------------------------------------------- the buttons

    var buttons = [];
    function button(label, name, value, aria) {
      var b = h("button", {
        class: "pv-ed-b",
        type: "button",
        "aria-label": aria || null,
        "aria-pressed": "false",
        text: label,
        onclick: function () {
          var on = quill.getFormat();
          var want = name === "header" ? (on.header === value ? false : value) : name === "list" ? (on.list === value ? false : value) : !on[name];
          quill.focus();
          quill.format(name, want, "user");
          marks();
        }
      });
      b.__pv = { name: name, value: value };
      buttons.push(b);
      toolbar.appendChild(b);
      return b;
    }
    button("B", "bold", true, "Bold").style.fontWeight = "700";
    button("I", "italic", true, "Italic").style.fontStyle = "italic";
    button("Heading", "header", 3);
    button("Quote", "blockquote", true);
    button("List", "list", "bullet");

    if (opts.withFigure) {
      toolbar.appendChild(
        h("button", { class: "pv-ed-b pv-ed-wide", type: "button", text: "Insert a Chart or Table", onclick: function () { opts.withFigure(api); } })
      );
    }
    toolbar.appendChild(hint);

    // The buttons show the format where the caret stands in the text. With the
    // caret outside the text there is nothing to show. Quill, asked for a format
    // with no place given, would take the caret back into the text, so a click
    // in the title or a search box would be undone at once (Fable's second run,
    // serious point 1).
    function marks() {
      var sel = quill.getSelection();
      var on = sel ? quill.getFormat(sel) : {};
      buttons.forEach(function (b) {
        var k = b.__pv;
        var live = k.name === "header" ? on.header === k.value : k.name === "list" ? on.list === k.value : !!on[k.name];
        b.setAttribute("aria-pressed", live ? "true" : "false");
        b.classList.toggle("is-on", live);
      });
    }

    // ------------------------------------------------- the cite under the caret

    function citeAtCaret() {
      var sel = quill.getSelection();
      if (!sel) return null;
      var at = sel.index - (sel.length ? 0 : 1);
      if (at < 0) return null;
      var piece = quill.getContents(at, 1);
      var op = piece && piece.ops && piece.ops[0];
      if (op && op.insert && op.insert.pvcite) return { at: at, value: op.insert.pvcite };
      return null;
    }

    function drawCaretBar() {
      var found = citeAtCaret();
      clear(caretBar);
      if (!found) { caretBar.hidden = true; return; }
      caretBar.hidden = false;
      caretBar.appendChild(h("span", { class: "pv-ed-cite-t", text: found.value.text }));
      if (webAddress(found.value.url)) {
        caretBar.appendChild(
          h("a", { class: "pv-ws-x", href: found.value.url, target: "_blank", rel: "noopener", text: "Open the work" })
        );
      }
      if (opts.onCiteCaret) opts.onCiteCaret(found.value, caretBar, api);
    }

    // ------------------------------------------------------------- the picker

    var picker = null;
    var pickerState = { groups: [], flat: [], at: 0, from: 0, length: 0, token: 0, active: false };

    // The "@" the reader closed with Esc, by its place in the text. That "@"
    // opens no list again, whatever is typed after it, until it is gone; a new
    // "@" opens one (Fable's second run, serious point 2).
    var shut = -1;

    // Closing the list also ends the answers still on their way, so a slow
    // answer never opens it again (Fable's check of batches 2 and 3, point 4).
    function closePicker() {
      pickerState.token++;
      pickerState.active = false;
      if (picker && picker.parentNode) picker.parentNode.removeChild(picker);
      picker = null;
      pickerState.flat = [];
    }

    function openPicker(from, length, words) {
      if (!opts.search) return;
      var token = ++pickerState.token;
      pickerState.active = true;
      pickerState.from = from;
      pickerState.length = length;
      opts.search(words).then(function (groups) {
        if (token !== pickerState.token) return;
        drawPicker(groups || []);
      });
    }

    // Esc, before or after the answer came: the list closes, and this "@" is shut.
    function shutPicker() {
      if (pickerState.active) shut = pickerState.from;
      closePicker();
    }

    // The shut "@" moves with the text, and is forgotten once it is gone.
    function follow(delta) {
      if (shut < 0 || !delta || !delta.transformPosition) return;
      var at = delta.transformPosition(shut);
      var next = delta.transformPosition(shut + 1);
      shut = next > at && quill.getText(at, 1) === "@" ? at : -1;
    }

    // A change that makes a new line: the Enter that makes it is not a search.
    function breaksLine(delta) {
      return !!(delta && delta.ops && delta.ops.some(function (op) {
        return typeof op.insert === "string" && op.insert.indexOf("\n") >= 0;
      }));
    }

    function drawPicker(groups) {
      if (picker && picker.parentNode) picker.parentNode.removeChild(picker);
      picker = null;
      picker = h("div", { class: "pv-ed-pick", role: "listbox", "aria-label": "Cite" });
      pickerState.flat = [];
      groups.forEach(function (g) {
        picker.appendChild(h("span", { class: "pv-ed-pick-h", text: g.group }));
        if (g.note) picker.appendChild(h("span", { class: "pv-ed-pick-n", text: g.note }));
        (g.items || []).forEach(function (it) {
          var i = pickerState.flat.length;
          var b = h(
            "button",
            {
              class: "pv-ed-pick-o",
              type: "button",
              role: "option",
              "aria-selected": "false",
              onmousedown: function (e) { e.preventDefault(); },
              onclick: function () { choose(i); }
            },
            h("span", { text: it.label }),
            it.sub ? h("small", { text: it.sub }) : null
          );
          pickerState.flat.push({ el: b, item: it });
          picker.appendChild(b);
        });
      });
      // One sentence when nothing is found (Fable's second run, point g).
      if (!pickerState.flat.length) {
        if (!groups.some(function (g) { return g.note; })) {
          picker.appendChild(h("span", { class: "pv-ed-pick-n", text: "Nothing under those letters." }));
        }
      } else {
        picker.appendChild(h("span", { class: "pv-ed-pick-k", text: "↑ ↓ to move · Enter to cite · Esc to close" }));
      }
      shell.appendChild(picker);
      pickerState.at = 0;
      mark(0);
    }

    function mark(i) {
      pickerState.flat.forEach(function (f, n) {
        f.el.setAttribute("aria-selected", n === i ? "true" : "false");
        f.el.classList.toggle("is-on", n === i);
      });
      var one = pickerState.flat[i];
      if (one && one.el.scrollIntoView) one.el.scrollIntoView({ block: "nearest" });
    }

    function choose(i) {
      var one = pickerState.flat[i];
      if (!one) return;
      var from = pickerState.from;
      var length = pickerState.length;
      closePicker();
      var ready = one.item.pick ? one.item.pick() : Promise.resolve(one.item.value);
      Promise.resolve(ready).then(function (value) {
        if (!value) return;
        quill.deleteText(from, length, "user");
        quill.insertEmbed(from, "pvcite", value, "user");
        quill.setSelection(from + 1, 0, "user");
        if (opts.onCite) opts.onCite(value, api);
        drawCaretBar();
        if (opts.onChange) opts.onChange();
      });
    }

    // What stands just before the caret: "@" and the letters typed after it.
    // The "@" counts only at the start of a line or after a space, so an email
    // address or a word with "@" inside it opens nothing. A cite or a figure
    // stands in the text as one sign that is not a space.
    function atBefore() {
      var sel = quill.getSelection();
      if (!sel || sel.length) return null;
      var start = Math.max(0, sel.index - 42);
      var before = "";
      quill.getContents(start, sel.index - start).ops.forEach(function (op) {
        before += typeof op.insert === "string" ? op.insert : "\uFFFC";
      });
      var m = before.match(/(^|\s)@([^\s@]{0,40})$/);
      if (!m) return null;
      var from = sel.index - m[0].length + m[1].length;
      return { from: from, length: sel.index - from, words: m[2] };
    }

    function look() {
      var at = atBefore();
      if (!at || at.from === shut) { closePicker(); return; }
      openPicker(at.from, at.length, at.words);
    }

    quill.on("text-change", function (delta, old, source) {
      follow(delta);
      if (opts.onChange) opts.onChange();
      if (source === "user") {
        // When Enter makes a new line the caret has not moved yet, so the words
        // before it still end in "@ant": the list is closed, not looked for.
        if (breaksLine(delta)) closePicker();
        else look();
      }
      marks();
    });
    quill.on("selection-change", function () {
      marks();
      drawCaretBar();
      if (picker) { look(); return; }
      // An answer still on its way is dropped once the caret has left its "@",
      // by an arrow key, a click elsewhere or a click outside the text, so it
      // never opens a list there (Fable's short run on the nine fixes).
      if (pickerState.active) {
        var at = atBefore();
        if (!at || at.from !== pickerState.from) closePicker();
      }
    });

    quill.root.addEventListener("keydown", function (e) {
      // Esc closes the list even before its answer has come, so that a late
      // answer never opens it and Enter never puts in a cite nobody chose.
      if (!picker) {
        if (e.key === "Escape") shutPicker();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var n = pickerState.flat.length;
        if (!n) return;
        pickerState.at = (pickerState.at + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
        mark(pickerState.at);
        return;
      }
      if (e.key === "Enter") {
        // A list with nothing in it closes, and Enter makes the new line.
        if (!pickerState.flat.length) { closePicker(); return; }
        e.preventDefault();
        choose(pickerState.at);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); shutPicker(); }
    }, true);

    // --------------------------------------------------------------- the api

    var api = {
      quill: quill,
      shell: shell,
      // The page as the editor's own document, ready to be stored as it is.
      delta: function () { return quill.getContents(); },
      stored: function () { return JSON.stringify({ ops: quill.getContents().ops }); },
      words: function () { return quill.getText(); },
      // Words are counted as the server counts them, the words of each cite
      // with them, so a draft shows one count everywhere (Fable's second run,
      // point e).
      count: function () {
        var t = "";
        quill.getContents().ops.forEach(function (op) {
          if (typeof op.insert === "string") t += op.insert;
          else if (op.insert && op.insert.pvcite) t += textOf(op.insert.pvcite.text).slice(0, 300);
          else t += "\n";
        });
        t = t.trim();
        return t ? t.split(/\s+/).length : 0;
      },
      open: function (stored) {
        quill.setContents(readStored(stored), "silent");
        marks();
        drawCaretBar();
      },
      focus: function () { quill.focus(); },
      insertFigure: function (id) {
        var sel = quill.getSelection(true);
        var at = sel ? sel.index : quill.getLength();
        quill.insertEmbed(at, "pvfigure", { id: id }, "user");
        quill.setSelection(at + 1, 0, "user");
        if (opts.onChange) opts.onChange();
      },
      // The reader's note comes in as a quote on lines of its own, after the
      // paragraph that holds the cite, and takes none of the writer's own words
      // with it (Fable's check of batches 2 and 3, point 7).
      insertQuote: function (lines) {
        var sel = quill.getSelection(true);
        var at = sel ? sel.index : Math.max(0, quill.getLength() - 1);
        var found = quill.getLine(at);
        var line = found && found[0];
        var after = line ? quill.getIndex(line) + line.length() : quill.getLength();
        var Delta = Quill.import("delta");
        var add = new Delta().retain(after);
        var parts = String(lines || "").replace(/\s+$/, "").split("\n");
        parts.forEach(function (part) {
          if (part) add = add.insert(part);
          add = add.insert("\n", { blockquote: true });
        });
        quill.updateContents(add, "user");
        var end = after;
        parts.forEach(function (part) { end += part.length + 1; });
        quill.setSelection(Math.min(end, quill.getLength() - 1), 0, "user");
        if (opts.onChange) opts.onChange();
      },
      // Every cite in the page, in the order it stands.
      cites: function () {
        var out = [];
        var seen = {};
        quill.getContents().ops.forEach(function (op) {
          if (!op.insert || !op.insert.pvcite) return;
          var c = op.insert.pvcite;
          var k = c.kind + "\u0000" + c.ref;
          if (seen[k]) return;
          seen[k] = true;
          out.push(c);
        });
        return out;
      },
      figures: function () {
        var out = [];
        quill.getContents().ops.forEach(function (op) {
          if (op.insert && op.insert.pvfigure) out.push(op.insert.pvfigure.id);
        });
        return out;
      },
      caretBar: caretBar,
      redrawCaret: drawCaretBar
    };
    return api;
  }

  window.PVEditor = {
    make: make,
    // Write hands the pictures over before a draft opens, so that a figure can
    // be drawn without the draft ever carrying a picture inside it.
    setFigures: function (list) {
      figures = {};
      (list || []).forEach(function (f) { figures[f.id] = f; });
    },
    addFigure: function (f) { if (f && f.id) figures[f.id] = f; },
    figure: function (id) { return figures[id] || null; },
    isDelta: isDelta,
    readStored: readStored,
    figureFoot: figureFoot,
    webAddress: webAddress
  };
})();
