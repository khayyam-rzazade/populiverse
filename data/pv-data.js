/* PopuliVerse: what the two data pages share ("Who Counts as Populist?" and
   "Populists in Power"). Plain JavaScript, no outside service. The charts use
   D3, which is kept in this folder (vendor/), as is the map.

   PVData.el        builds a piece of the page
   PVData.state     reads and writes the address, so every view has a link
   PVData.panel     the side panel that opens on a click
   PVData.tip       the small box on hover
   PVData.save      downloads: a table (CSV), a text, a picture (SVG or PNG)
   PVData.figure    a chart made into a picture that can stand alone in an
                    article: title, the filters in use, legend, sources, citation
   PVData.verdict   the words and colours of each dataset's own verdicts
   PVData.linksBox  the checked list of links (data/links.csv), shown on the page */

(function () {
  "use strict";

  var PV = (window.PVData = {});

  // ------------------------------------------------------------ small helpers

  PV.el = function (tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v;
        else if (k === "class") n.className = v;
        else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? "" : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  };

  PV.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  PV.fold = function (s) {
    // For search: no accents, small letters
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  };

  PV.num = function (v, d) {
    return v === null || v === undefined ? "" : Number(v).toFixed(d === undefined ? 2 : d);
  };

  PV.thousands = function (n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];

  PV.date = function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    if (!m) return iso || "";
    return +m[3] + " " + MONTHS[+m[2] - 1] + " " + m[1];
  };

  PV.month = function (iso) {
    var m = /^(\d{4})-(\d{2})/.exec(iso || "");
    return m ? MONTHS[+m[2] - 1] + " " + m[1] : iso || "";
  };

  PV.span = function (a, b, now) {
    // Years as people write them; The PopuList writes 1900 and 2100 for "always"
    if (a === null || a === undefined) return "";
    var from = a <= 1900 ? null : a;
    var to = b >= 2100 ? null : b;
    if (from === null && to === null) return "all years";
    if (from === null) return "until " + to;
    if (to === null) return (now || "since") + " " + from;
    if (from === to) return String(from);
    return from + " to " + to;
  };

  PV.load = function (url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  };

  PV.copy = function (text, button) {
    var label = button.textContent;
    function done(ok) {
      button.textContent = ok ? "Copied" : "Could not copy";
      window.setTimeout(function () { button.textContent = label; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else done(false);
  };

  PV.today = function () {
    var d = new Date();
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  };

  // ------------------------------------------------------------ the address

  PV.state = {
    get: function () {
      var p = new URLSearchParams(window.location.search), o = {};
      p.forEach(function (v, k) { o[k] = v; });
      return o;
    },
    set: function (o, keepHash) {
      var p = new URLSearchParams();
      Object.keys(o).forEach(function (k) {
        if (o[k] !== "" && o[k] !== null && o[k] !== undefined && o[k] !== false) p.set(k, o[k]);
      });
      var q = p.toString();
      var url = window.location.pathname + (q ? "?" + q : "") + (keepHash === false ? "" : window.location.hash);
      try { window.history.replaceState(null, "", url); } catch (e) { /* a page opened from a file */ }
      try { document.dispatchEvent(new CustomEvent("pv:view")); } catch (e) {}
    },
    hash: function (h) {
      var url = window.location.pathname + window.location.search + (h ? "#" + h : "");
      try { window.history.replaceState(null, "", url); } catch (e) { /* ignore */ }
    }
  };

  // ------------------------------------------------------------ the panel

  var panel = null;
  var lastFocus = null;

  PV.panel = {
    open: function (title, sub, build, id, onClose) {
      PV.panel.close(true);
      lastFocus = document.activeElement;
      var body = PV.el("div", { class: "pv-dp-body" });
      var closeBtn = PV.el("button", { type: "button", class: "pv-dp-close", "aria-label": "Close", text: "×" });
      var head = PV.el("div", { class: "pv-dp-head" }, [
        PV.el("div", {}, [
          sub ? PV.el("p", { class: "pv-dp-sub", text: sub }) : null,
          PV.el("h2", { class: "pv-dp-title", id: "pv-dp-title", text: title })
        ]),
        closeBtn
      ]);
      var box = PV.el("div", { class: "pv-dp", role: "dialog", "aria-modal": "false", "aria-labelledby": "pv-dp-title", tabindex: "-1" }, [head, body]);
      var veil = PV.el("div", { class: "pv-dp-veil" });
      document.body.appendChild(veil);
      document.body.appendChild(box);
      document.body.classList.add("pv-dp-open");
      panel = { box: box, veil: veil, onClose: onClose };
      closeBtn.addEventListener("click", function () { PV.panel.close(); });
      veil.addEventListener("click", function () { PV.panel.close(); });
      build(body);
      if (id) PV.state.hash(id);
      window.requestAnimationFrame(function () { box.classList.add("is-in"); box.focus(); });
      return body;
    },
    close: function (quiet) {
      if (!panel) return;
      var p = panel;
      panel = null;
      p.box.remove();
      p.veil.remove();
      document.body.classList.remove("pv-dp-open");
      if (!quiet) {
        PV.state.hash("");
        if (p.onClose) p.onClose();
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      }
    },
    isOpen: function () { return !!panel; }
  };

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel) PV.panel.close();
  });

  // Marks a row of a chart's own tools as a thing that can be saved and noted:
  // the Data page, the chart's own name and the filters standing in the address
  // (master plan, section 18, stage 2, batch 2; keep.js draws the buttons).
  // `counts` names the parts of the address that change what the chart shows,
  // so that the order of a list, or a year a chart does not show, never makes
  // one same view two rows on the shelf (batch 5, E2). PV.keepCounts changes
  // them when they depend on the view.
  PV.keepChart = function (tools, name, title, counts) {
    if (!tools) return tools;
    var page = (window.location.pathname.split("/").pop() || "index").replace(/\.html$/, "");
    tools.setAttribute("data-keep-kind", "chart");
    tools.setAttribute("data-keep-ref", page + "#" + name);
    tools.setAttribute("data-keep-query", (counts || []).join(","));
    tools.setAttribute("data-keep-title", title);
    // The reference of the chart is this page's own "How to cite" line, so that
    // a draft in Write cites it exactly as the page does (batch 3).
    tools.setAttribute("data-keep-cite", PV.citation(title, window.location.href.split("#")[0]));
    tools.setAttribute("data-keep-tools", "");
    return tools;
  };

  PV.keepCounts = function (tools, counts) {
    if (tools) tools.setAttribute("data-keep-query", (counts || []).join(","));
    return tools;
  };

  // Tells keep.js that this chart can be sent to Write. `make` is the same
  // description of the picture that the page already hands to PV.save.picture,
  // so what reaches a draft is the picture the page itself draws (batch 3).
  // Called with nothing, it forgets the picture the page drew before, so that a
  // view with no picture of its own never sends an older one under the title of
  // the filters now on screen (Fable's re-check of the trial fixes, point 3).
  PV.figureMaker = function (tools, make) {
    if (!tools) return tools;
    if (typeof make !== "function") {
      delete tools.__pvFigure;
      tools.removeAttribute("data-keep-figure");
      return tools;
    }
    tools.__pvFigure = make;
    tools.setAttribute("data-keep-figure", "");
    return tools;
  };

  PV.section = function (body, title, kids, note) {
    var s = PV.el("section", { class: "pv-dp-sec" }, [PV.el("h3", { text: title })].concat(kids || []));
    if (note) s.appendChild(PV.el("p", { class: "pv-dp-note", text: note }));
    body.appendChild(s);
    return s;
  };

  // ------------------------------------------------------------ the hover box

  var tipEl = null;
  PV.tip = {
    show: function (evt, html) {
      if (!tipEl) {
        tipEl = PV.el("div", { class: "pv-tip", role: "tooltip" });
        document.body.appendChild(tipEl);
      }
      tipEl.innerHTML = html;
      tipEl.style.display = "block";
      PV.tip.move(evt);
    },
    move: function (evt) {
      if (!tipEl) return;
      var x = evt.clientX, y = evt.clientY, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      var left = x + 14, top = y + 14;
      if (left + w > window.innerWidth - 8) left = x - w - 14;
      if (top + h > window.innerHeight - 8) top = y - h - 14;
      tipEl.style.left = Math.max(8, left) + "px";
      tipEl.style.top = Math.max(8, top) + "px";
    },
    hide: function () { if (tipEl) tipEl.style.display = "none"; }
  };

  // ------------------------------------------------------------ downloads

  function blobSave(blob, name) {
    var a = PV.el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    window.setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function csvCell(v) {
    v = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  PV.save = {
    csv: function (name, rows) {
      var text = rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
      blobSave(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }), name);
    },
    text: function (name, text) {
      blobSave(new Blob([text], { type: "text/plain;charset=utf-8" }), name);
    },
    blob: blobSave
  };

  // ------------------------------------------------------------ pictures

  // A chart on the page takes its colours and sizes from the style sheet. A
  // picture that leaves the page has no style sheet, so every piece is given
  // its own style first. This is done on the copy before anything is added to
  // it, piece by piece in the same order as on the page.
  var STYLE = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity",
    "stroke-linecap", "opacity", "font-size", "font-style", "font-weight", "text-anchor",
    "dominant-baseline", "letter-spacing"];

  function styledCopy(svg) {
    var clone = svg.cloneNode(true);
    var a = svg.querySelectorAll("*"), b = clone.querySelectorAll("*");
    for (var i = 0; i < a.length && i < b.length; i++) {
      var tag = a[i].tagName.toLowerCase();
      if (tag === "defs" || tag === "pattern" || tag === "title" || a[i].closest("defs")) continue;
      var cs = window.getComputedStyle(a[i]);
      var css = STYLE.map(function (k) {
        // A pattern is named by its place in this picture, not in the page
        var v = cs.getPropertyValue(k).replace(/url\(["']?[^#)"']*#([^"')]+)["']?\)/, "url(#$1)");
        return k + ":" + v;
      }).join(";");
      b[i].setAttribute("style", css);
      b[i].removeAttribute("class");
      b[i].removeAttribute("tabindex");
      b[i].removeAttribute("role");
    }
    return clone;
  }

  // The typeface, put inside the picture, so that it looks the same wherever it
  // is opened. Read once from this site's own fonts folder.
  var FONT = "Libre Baskerville, Georgia, 'Times New Roman', serif";
  var fontCss = null;
  var FACES = [
    ["latin-400-normal", "normal", 400, "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212"],
    ["latin-ext-400-normal", "normal", 400, "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0"],
    ["latin-400-italic", "italic", 400, "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212"],
    ["latin-700-normal", "normal", 700, "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212"]
  ];

  function base64(buf) {
    var bytes = new Uint8Array(buf), out = "", step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return window.btoa(out);
  }

  function fonts() {
    if (fontCss !== null) return Promise.resolve(fontCss);
    return Promise.all(FACES.map(function (f) {
      var url = new URL("../fonts/libre-baskerville-" + f[0] + ".woff2", document.baseURI).href;
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error("font");
        return r.arrayBuffer();
      }).then(function (buf) {
        return "@font-face{font-family:'Libre Baskerville';font-style:" + f[1] + ";font-weight:" + f[2] +
          ";src:url(data:font/woff2;base64," + base64(buf) + ") format('woff2');unicode-range:" + f[3] + "}";
      });
    })).then(function (faces) { fontCss = faces.join(""); return fontCss; })
      .catch(function () { fontCss = ""; return fontCss; });
  }

  var measurer = null;
  function textWidth(text, size, style, weight) {
    if (!measurer) measurer = document.createElement("canvas").getContext("2d");
    measurer.font = (style || "normal") + " " + (weight || 400) + " " + size + "px " + FONT;
    return measurer.measureText(text).width;
  }
  PV.textWidth = textWidth;

  function wrap(text, size, max, style, weight) {
    var words = String(text).split(/\s+/), lines = [], line = "";
    words.forEach(function (w) {
      var t = line ? line + " " + w : w;
      if (line && textWidth(t, size, style, weight) > max) { lines.push(line); line = w; }
      else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }

  var NS = "http://www.w3.org/2000/svg";
  function node(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // The patterns for "not covered", "not known" and "borderline", for a picture
  function figureDefs(defs) {
    function pat(id, size, bg, lines) {
      var p = node("pattern", { id: id, patternUnits: "userSpaceOnUse", width: size, height: size, patternTransform: "rotate(45)" });
      p.appendChild(node("rect", { width: size, height: size, fill: bg }));
      lines.forEach(function (l) { p.appendChild(node("line", l)); });
      defs.appendChild(p);
    }
    pat("pvf-hatch", 6, PV.colour.paper, [{ x1: 0, y1: 0, x2: 0, y2: 6, stroke: "#CFCDC6", "stroke-width": 1.2 }]);
    pat("pvf-cross", 6, "#F1EFEA", [{ x1: 0, y1: 0, x2: 0, y2: 6, stroke: "#8E8B83", "stroke-width": 1.1 }, { x1: 0, y1: 3, x2: 6, y2: 3, stroke: "#8E8B83", "stroke-width": 1.1 }]);
    [["3", PV.colour.p3], ["2", PV.colour.p2], ["1", PV.colour.p1]].forEach(function (c) {
      pat("pvf-bl" + c[0], 6, PV.colour.paper, [{ x1: 1.5, y1: 0, x2: 1.5, y2: 6, stroke: c[1], "stroke-width": 3 }]);
    });
  }

  /* A picture that can stand alone.
     o.chart    the chart as it stands on the page (an SVG element), or a function that
                draws one at the picture's width into a box it is given and returns it
     o.title    the title
     o.lines    what is shown: the filters in use, the numbers
     o.legend   [{ fill, label, stroke, dot }]: what the colours mean
     o.lists    [{ head, text }]: lists under the chart (the countries of each state)
     o.notes    how to read it
     o.sources  the datasets
     o.cite     the citation of the page
     o.host     the page's own box, where a chart is drawn out of sight */
  // The words of a picture are measured before they are placed, so the typeface
  // must be in the page first: all three cuts, also the ones the page has not used yet
  function ready() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(["400 12px 'Libre Baskerville'", "italic 400 12px 'Libre Baskerville'", "700 12px 'Libre Baskerville'"]
      .map(function (f) { return document.fonts.load(f); })).catch(function () { /* measured in the next typeface */ });
  }

  PV.figure = function (o) {
    return ready().then(fonts).then(function (css) {
      var W = 1200, pad = 40, inner = W - 2 * pad;
      var holder = null, live = o.chart;
      if (typeof o.chart === "function") {
        // Drawn out of sight, inside the page's own box so that its styles hold
        holder = PV.el("div", { style: "position:absolute;left:-20000px;top:0;width:" + inner + "px", "aria-hidden": "true" });
        (o.host || document.body).appendChild(holder);
        live = o.chart(holder, inner);
      }
      var cw = +live.getAttribute("width") || live.getBoundingClientRect().width;
      var ch = +live.getAttribute("height") || live.getBoundingClientRect().height;
      var copy = styledCopy(live);
      if (holder) holder.remove();

      var root = node("svg", { xmlns: NS, width: W, "font-family": FONT });
      var defs = node("defs");
      if (css) defs.appendChild(node("style", {}, css));
      figureDefs(defs);
      root.appendChild(defs);
      var bg = node("rect", { x: 0, y: 0, width: W, fill: "#FFFFFF" });
      root.appendChild(bg);
      var y = pad;

      function para(text, size, opts) {
        opts = opts || {};
        wrap(text, size, opts.max || inner, opts.style, opts.weight).forEach(function (line) {
          y += size * 1.45;
          root.appendChild(node("text", { x: opts.x || pad, y: y - size * 0.35, "font-size": size, fill: opts.fill || "#111111",
            "font-style": opts.style || "normal", "font-weight": opts.weight || 400 }, line));
        });
      }

      para(o.title, 24);
      y += 4;
      (o.lines || []).forEach(function (l) { para(l, 13.5, { fill: "#4A4A4A", style: "italic" }); });
      y += 10;

      // The legend: boxes with their words, as many in a row as fit
      if (o.legend && o.legend.length) {
        var x = pad, size = 12.5;
        y += 6;
        o.legend.forEach(function (k) {
          var w = 22 + textWidth(k.label, size) + 22;
          if (x + w > W - pad && x > pad) { x = pad; y += 22; }
          if (k.dot) root.appendChild(node("circle", { cx: x + 7, cy: y + 7, r: 5.5, fill: k.fill, stroke: k.stroke || "#FFFFFF", "stroke-width": 1.2 }));
          else if (k.line) root.appendChild(node("line", { x1: x + 7, x2: x + 7, y1: y - 1, y2: y + 15, stroke: k.fill, "stroke-width": 2.2 }));
          else root.appendChild(node("rect", { x: x, y: y, width: 14, height: 14, fill: String(k.fill).replace("url(#pv-", "url(#pvf-"), stroke: k.stroke || "#BDBBB4", "stroke-width": 0.6 }));
          root.appendChild(node("text", { x: x + 21, y: y + 11.5, "font-size": size, fill: "#111111" }, k.label));
          x += w;
        });
        y += 30;
      }

      // The chart itself
      copy.setAttribute("x", pad + Math.max(0, (inner - cw) / 2));
      copy.setAttribute("y", y);
      copy.setAttribute("width", cw);
      copy.setAttribute("height", ch);
      copy.setAttribute("viewBox", "0 0 " + cw + " " + ch);
      copy.removeAttribute("class");
      copy.removeAttribute("style");
      copy.setAttribute("overflow", "visible");
      root.appendChild(copy);
      y += ch + 14;

      (o.lists || []).forEach(function (l) {
        if (!l.text) return;
        y += 6;
        var hw = textWidth(l.head, 12.5, "normal", 700) + 10;
        var lines = wrap(l.text, 12.5, inner - hw);
        root.appendChild(node("text", { x: pad, y: y + 12.5, "font-size": 12.5, "font-weight": 700, fill: "#111111" }, l.head));
        lines.forEach(function (line, i) {
          root.appendChild(node("text", { x: pad + hw, y: y + 12.5 + i * 18, "font-size": 12.5, fill: "#111111" }, line));
        });
        y += lines.length * 18 + 2;
      });

      if (o.notes && o.notes.length) {
        y += 8;
        o.notes.forEach(function (n) { para(n, 12, { fill: "#4A4A4A", style: "italic" }); });
      }
      y += 12;
      root.appendChild(node("line", { x1: pad, x2: W - pad, y1: y, y2: y, stroke: "#111111", "stroke-width": 0.8 }));
      y += 6;
      (o.sources || []).forEach(function (s) { para(s, 11, { fill: "#4A4A4A" }); });
      if (o.cite) para(o.cite, 11, { fill: "#4A4A4A" });
      y += pad - 12;

      root.setAttribute("height", y);
      root.setAttribute("viewBox", "0 0 " + W + " " + y);
      bg.setAttribute("height", y);
      return { text: new XMLSerializer().serializeToString(root), width: W, height: y };
    });
  };

  // Saves a picture. kind is "svg" or "png"; make gives what PV.figure needs.
  PV.save.picture = function (button, name, kind, make) {
    var label = button.textContent;
    button.disabled = true;
    button.textContent = "Drawing the picture…";
    function done() { button.disabled = false; button.textContent = label; }
    return PV.figure(make()).then(function (fig) {
      if (kind === "svg") {
        blobSave(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + fig.text], { type: "image/svg+xml" }), name + ".svg");
        done();
        return;
      }
      var url = URL.createObjectURL(new Blob([fig.text], { type: "image/svg+xml" }));
      var img = new Image();
      img.onload = function () {
        // A short wait lets the browser take up the typeface inside the picture
        window.setTimeout(function () {
          var scale = Math.min(2, Math.sqrt(15000000 / (fig.width * fig.height)));
          var c = document.createElement("canvas");
          c.width = Math.round(fig.width * scale); c.height = Math.round(fig.height * scale);
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob(function (b) { blobSave(b, name + ".png"); done(); }, "image/png");
        }, 300);
      };
      img.onerror = function () { URL.revokeObjectURL(url); done(); button.textContent = "Could not draw the picture"; };
      img.src = url;
    }).catch(function () { done(); button.textContent = "Could not draw the picture"; });
  };

  // The same picture, as a PNG the page can hand on (to Write, batch 3). The
  // description comes from the page, so the picture, its source lines and its
  // "How to cite" line are the page's own, and the numbers in it are those of
  // today.
  PV.figurePng = function (make) {
    var o = make();
    return PV.figure(o).then(function (fig) {
      return new Promise(function (done, fail) {
        var url = URL.createObjectURL(new Blob([fig.text], { type: "image/svg+xml" }));
        var img = new Image();
        img.onload = function () {
          // A short wait lets the browser take up the typeface inside the picture
          window.setTimeout(function () {
            // Whole numbers on both halves: a canvas and the server take no
            // other (Fable's check of batches 2 and 3, point 7).
            var wide = Math.max(1, Math.round(fig.width));
            var tall = Math.max(1, Math.round(fig.height));
            var c = document.createElement("canvas");
            c.width = wide;
            c.height = tall;
            var ctx = c.getContext("2d");
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            done({
              picture: c.toDataURL("image/png"),
              width: wide,
              height: tall,
              title: o.title || "",
              source: (o.sources || []).join(" "),
              cite: o.cite || "",
              day: PV.today()
            });
          }, 300);
        };
        img.onerror = function () { URL.revokeObjectURL(url); fail(new Error("picture")); };
        img.src = url;
      });
    });
  };

  // The lines under every picture and in every download
  PV.sourceLine = function (keys, sources) {
    return "Sources: " + keys.map(function (k) { return sources[k].name; }).join("; ") + ".";
  };

  // ------------------------------------------------------------ verdicts

  // One hue for "populist", from light to dark; grey for "not populist";
  // slate for the Global Party Survey's two pluralist categories.
  PV.colour = {
    p3: "#5E1A37", p2: "#9C4E6E", p1: "#D29BB1", none: "#E4E2DC",
    s2: "#7E9198", s1: "#B9C4C8", ink: "#111111", muted: "#4A4A4A", hair: "#D9D9D6", paper: "#FCFCFB"
  };

  PV.verdict = {
    // The Global Populism Database: the four bands of its paper for a term's average
    gpd: function (b) {
      return [
        { label: "Not populist", long: "an average below 0.5", cls: "is-no", fill: PV.colour.none },
        { label: "Somewhat populist", long: "an average from 0.5 to 0.99", cls: "is-p1", fill: PV.colour.p1 },
        { label: "Populist", long: "an average from 1.0 to 1.49", cls: "is-p2", fill: PV.colour.p2 },
        { label: "Very populist", long: "an average of 1.5 or more", cls: "is-p3", fill: PV.colour.p3 }
      ][b];
    },
    gps: function (t) {
      return {
        1: { label: "Strongly pluralist", cls: "is-s2", fill: PV.colour.s2 },
        2: { label: "Moderately pluralist", cls: "is-s1", fill: PV.colour.s1 },
        3: { label: "Moderately populist", cls: "is-p2", fill: PV.colour.p2 },
        4: { label: "Strongly populist", cls: "is-p3", fill: PV.colour.p3 }
      }[t];
    }
  };

  PV.pill = function (label, cls, title) {
    return PV.el("span", { class: "pv-pill " + (cls || ""), title: title || null, text: label });
  };

  // Hatching for "not covered" and "not known", used by the charts and the map
  PV.defs = function (svg) {
    var defs = svg.append("defs");
    defs.append("pattern").attr("id", "pv-hatch").attr("patternUnits", "userSpaceOnUse")
      .attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)")
      .call(function (p) {
        p.append("rect").attr("width", 6).attr("height", 6).attr("fill", PV.colour.paper);
        p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke", "#CFCDC6").attr("stroke-width", 1.2);
      });
    defs.append("pattern").attr("id", "pv-cross").attr("patternUnits", "userSpaceOnUse")
      .attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)")
      .call(function (p) {
        p.append("rect").attr("width", 6).attr("height", 6).attr("fill", "#F1EFEA");
        p.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke", "#8E8B83").attr("stroke-width", 1.1);
        p.append("line").attr("x1", 0).attr("y1", 3).attr("x2", 6).attr("y2", 3).attr("stroke", "#8E8B83").attr("stroke-width", 1.1);
      });
    // Stripes in the colour of the place: it rests on a borderline case of The PopuList
    [["3", PV.colour.p3], ["2", PV.colour.p2], ["1", PV.colour.p1]].forEach(function (c) {
      defs.append("pattern").attr("id", "pv-bl" + c[0]).attr("patternUnits", "userSpaceOnUse")
        .attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)")
        .call(function (p) {
          p.append("rect").attr("width", 6).attr("height", 6).attr("fill", PV.colour.paper);
          p.append("line").attr("x1", 1.5).attr("y1", 0).attr("x2", 1.5).attr("y2", 6).attr("stroke", c[1]).attr("stroke-width", 3);
        });
    });
    return defs;
  };

  // The same patterns as text, for the small charts in the panel
  PV.defsText = function (tag) {
    function pat(id, bg, lines) {
      return '<pattern id="' + id + tag + '" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="' + bg + '"/>' + lines + "</pattern>";
    }
    return "<defs>" +
      pat("pv-hatch", PV.colour.paper, '<line x1="0" y1="0" x2="0" y2="6" stroke="#CFCDC6" stroke-width="1.2"/>') +
      pat("pv-cross", "#F1EFEA", '<line x1="0" y1="0" x2="0" y2="6" stroke="#8E8B83" stroke-width="1.1"/><line x1="0" y1="3" x2="6" y2="3" stroke="#8E8B83" stroke-width="1.1"/>') +
      [["3", PV.colour.p3], ["2", PV.colour.p2], ["1", PV.colour.p1]].map(function (c) {
        return pat("pv-bl" + c[0], PV.colour.paper, '<line x1="1.5" y1="0" x2="1.5" y2="6" stroke="' + c[1] + '" stroke-width="3"/>');
      }).join("") + "</defs>";
  };

  // A citation for the page, with today's date
  PV.citation = function (title, url) {
    var stop = /[?!.]$/.test(title) ? "" : ".";
    return "Rzazade, Khayyam, ed. 2026. “" + title + stop + "” PopuliVerse. " + url + ". Accessed " + PV.today() + ".";
  };

  // The references of the datasets, as their authors ask, each with its licence
  PV.citeItems = function (sources) {
    var out = [];
    sources.forEach(function (s) {
      s.cite.forEach(function (c, i) {
        var text = c + (/[.]$/.test(c) ? "" : ".");
        if (i === s.cite.length - 1) text += " Licence: " + s.licence + ".";
        out.push(PV.el("li", { text: text }));
      });
    });
    return out;
  };

  // ------------------------------------------------------------ the list of links

  // Where the IDs of Party Facts do not carry a link, or carry a wrong one,
  // PopuliVerse made the link itself and wrote down why (data/links.csv).
  PV.link = function (n, links) {
    for (var i = 0; i < (links || []).length; i++) if (links[i].n === n) return links[i];
    return null;
  };

  PV.linkText = function (n, links) {
    var L = PV.link(n, links);
    return L ? "Linked by PopuliVerse (line " + n + " of its list of links). " + L.b : "";
  };

  PV.linkMark = function (n, links, word) {
    var L = PV.link(n, links);
    if (!L) return null;
    return PV.el("span", { class: "pv-linked", title: PV.linkText(n, links), text: word || "linked by PopuliVerse" });
  };

  PV.linksBox = function (links, countryName) {
    var KIND = {
      id: "An entry of The PopuList, given another Party Facts ID",
      also: "An entry of The PopuList, given a second Party Facts ID",
      ppeg: "A party in PPEG, linked to an entry of The PopuList",
      ppeg_none: "A party in PPEG, kept apart from an entry of The PopuList",
      gpd: "A leader's party in the Global Populism Database, given another Party Facts ID"
    };
    function what(L) {
      if (L.k === "id") return "The PopuList's " + L.pl + ": Party Facts " + L.pf + (L.was ? ", where its file has " + L.was : ", where its file has none");
      if (L.k === "also") return "The PopuList's " + L.pl + ": Party Facts " + L.pf + " as well";
      if (L.k === "ppeg") return "PPEG's " + L.pp + ": The PopuList's " + L.pl;
      if (L.k === "ppeg_none") return "PPEG's " + L.pp + ": no entry of The PopuList";
      return L.gd + ": Party Facts " + L.pf + (L.was ? ", where Party Facts has " + L.was : "");
    }
    var tb = PV.el("tbody");
    links.forEach(function (L) {
      tb.appendChild(PV.el("tr", {}, [
        PV.el("td", { text: String(L.n) }),
        PV.el("td", { text: countryName ? countryName(L.c) : L.c }),
        PV.el("td", {}, [PV.el("strong", { text: what(L) }), PV.el("br"), PV.el("span", { class: "pv-links-kind", text: KIND[L.k] || "" })]),
        PV.el("td", { text: L.b })
      ]));
    });
    var box = PV.el("details", { class: "pv-links", id: "links" }, [
      PV.el("summary", { text: "The " + links.length + " links PopuliVerse made itself" }),
      PV.el("p", { text: "The datasets are linked through the IDs of Party Facts. In " + links.length + " places an ID was missing or pointed to another party, so the link was made by hand and the reason written down. Each is used only to find a party in The PopuList, never to call a party not populist, and each is marked wherever it is used." }),
      PV.el("div", { class: "pv-wc-scroll" }, [PV.el("table", { class: "pv-dp-table pv-links-table" }, [
        PV.el("thead", {}, [PV.el("tr", {}, [PV.el("th", { text: "Line" }), PV.el("th", { text: "Country" }), PV.el("th", { text: "The link" }), PV.el("th", { text: "Why" })])]),
        tb
      ])]),
      PV.el("p", { class: "pv-lib-tools" }, [PV.el("a", { class: "pv-lib-link", href: "links.csv", download: "populiverse-data-links.csv", text: "Download the list of links (CSV)" })])
    ]);
    function show() { if (window.location.hash === "#links") { box.open = true; box.scrollIntoView(); } }
    window.addEventListener("hashchange", show);
    window.setTimeout(show, 0);
    return box;
  };

  PV.citeBox = function (title, url) {
    var text = PV.citation(title, url);
    var b1 = PV.el("button", { type: "button", class: "pv-lib-link", text: "Copy citation" });
    b1.addEventListener("click", function () { PV.copy(PV.citation(title, url), b1); });
    return PV.el("div", { class: "pv-cite pv-dp-cite" }, [
      PV.el("p", { class: "pv-cite-label", text: "How to cite this page" }),
      PV.el("p", { text: text }),
      PV.el("p", { class: "pv-lib-tools" }, [b1])
    ]);
  };
})();
