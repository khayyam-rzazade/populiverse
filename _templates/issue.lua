-- PopuliVerse: turns the text of an issue into its web page and its PDF.
--
-- An issue is one text file (index.qmd) in its own folder. This filter reads
-- that text twice: once when Quarto builds the web page, and once when
-- scripts/make_issue.R builds the PDF. Both times it does the same things:
--
--   1. The three lines under an item (Actor, Sources, Research on this) are
--      set apart as small print.
--   2. "Also this month" and the lists of references get their own look.
--   3. In the PDF, the address of every source is printed as a footnote,
--      because links die.
--   4. Every word gets an invisible mark. From these marks the PDF reports
--      on which page each word stands (pages.json), and the web page shows
--      the PDF's page numbers in its margin at exactly those places.
--   5. The web page gets the facts of the issue at the top (period, rules,
--      editor, DOI, PDF), a "How to cite" box at the end, and the data that
--      Google Scholar reads.
--   6. "New research": the issue's text holds a short account only. The full
--      list of the month's works is a file next to the text
--      (populiverse-monitor-2026-1-new-research.csv). On the web page the
--      list is shown under the account, folded shut. The PDF prints where the
--      list is.
--
-- It only acts on a page whose header has the line "issue:". Every other
-- page of the site passes through untouched.

local stringify = pandoc.utils.stringify
local List = pandoc.List

local TYPST = (FORMAT == "typst")
local HTML = (FORMAT:match("html") ~= nil)

local SITE = "https://populiverse.com"
local MONTHS = { "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December" }

-- The words that open the three lines under an item.
local LABELS = {
  ["Actor:"] = "actor", ["Actors:"] = "actor",
  ["Source:"] = "sources", ["Sources:"] = "sources",
  ["Research on this:"] = "research",
}

-- ------------------------------------------------------------------ helpers

local function meta_text(meta, key)
  local v = meta[key]
  if v == nil then return "" end
  if type(v) == "boolean" then return "" end
  return (stringify(v):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- The day of publication -> year, month, day (numbers), or nil.
-- In the header it is written "2026-10-05". When Quarto builds the web page it
-- hands the date on already written out ("5 October 2026"), so both are read.
local function parse_date(s)
  local y, m, d = s:match("^(%d%d%d%d)-(%d%d)-(%d%d)")
  if not y then
    local name
    d, name, y = s:match("^(%d%d?) (%a+) (%d%d%d%d)$")          -- 5 October 2026
    if not d then name, d, y = s:match("^(%a+) (%d%d?), (%d%d%d%d)$") end   -- October 5, 2026
    if not d then return nil end
    for i, month in ipairs(MONTHS) do
      if month:lower() == name:lower() then m = i end
    end
    if not m then return nil end
  end
  y, m, d = tonumber(y), tonumber(m), tonumber(d)
  if m < 1 or m > 12 or d < 1 or d > 31 then return nil end
  return y, m, d
end

local function html_escape(s)
  return (s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"))
end

-- a piece of text that goes between quotation marks in Typst code
local function typst_string(s)
  return (s:gsub("\\", "\\\\"):gsub('"', '\\"'))
end

-- a piece of text that goes between quotation marks in JavaScript
local function js_string(s)
  return (s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("</", "<\\/"))
end

local function file_exists(path)
  local f = io.open(path, "rb")
  if f then f:close() return true end
  return false
end

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local s = f:read("a")
  f:close()
  return s
end

-- the folder of the issue's text file
local function input_dir()
  local file
  if quarto and quarto.doc and quarto.doc.input_file then
    file = quarto.doc.input_file
  elseif PANDOC_STATE and PANDOC_STATE.input_files and PANDOC_STATE.input_files[1] then
    file = PANDOC_STATE.input_files[1]
  end
  if not file then return "." end
  local dir = pandoc.path.directory(file)
  if dir == "" then dir = "." end
  return dir
end

-- ------------------------------------------------- 6: the list of new research

-- Reads a file of comma-separated values: the first line holds the names of
-- the columns. Returns one table per line, with the column names as keys.
local function read_csv(text)
  text = text:gsub("^\239\187\191", "")
  local lines, line, field = {}, {}, {}
  local quoted = false
  local i, n = 1, #text
  while i <= n do
    local c = text:sub(i, i)
    if quoted then
      if c == '"' then
        if text:sub(i + 1, i + 1) == '"' then
          field[#field + 1] = '"'
          i = i + 1
        else
          quoted = false
        end
      else
        field[#field + 1] = c
      end
    elseif c == '"' then
      quoted = true
    elseif c == "," then
      line[#line + 1] = table.concat(field)
      field = {}
    elseif c == "\n" then
      line[#line + 1] = table.concat(field)
      field = {}
      lines[#lines + 1] = line
      line = {}
    elseif c ~= "\r" then
      field[#field + 1] = c
    end
    i = i + 1
  end
  if #field > 0 or #line > 0 then
    line[#line + 1] = table.concat(field)
    lines[#lines + 1] = line
  end
  local out = {}
  local head = lines[1] or {}
  for r = 2, #lines do
    local rec = {}
    for c, name in ipairs(head) do rec[name] = lines[r][c] or "" end
    if (rec.reference or "") ~= "" and (rec.doi or "") ~= "" then out[#out + 1] = rec end
  end
  return out
end

local RESEARCH_HEADING = "new research"
local RESEARCH_KINDS = {
  { "journal article", "Journal articles" },
  { "book", "Books" },
  { "book review", "Book reviews" },
}

-- Where the list goes: at the end of the part "New research". Gives the
-- place in the list of blocks, or nil if the issue has no such part.
local function research_place(blocks, is_foreign)
  local start, level = nil, nil
  for i, b in ipairs(blocks) do
    if b.t == "Header" and stringify(b):lower() == RESEARCH_HEADING then
      start, level = i, b.level
      break
    end
  end
  if not start then return nil end
  for i = start + 1, #blocks do
    local b = blocks[i]
    if (b.t == "Header" and b.level <= level) or is_foreign(b) then return i end
  end
  return #blocks + 1
end

-- ------------------------------------------------- 1 and 2: the structure

local function label_kind(el)
  if el and el.t == "Emph" then return LABELS[stringify(el)] end
  return nil
end

-- A paragraph that opens with "Actor:", "Sources:" or "Research on this:" is
-- cut into its lines. Any other paragraph gives nil.
local function meta_lines(para)
  local inl = para.content
  local kind = label_kind(inl[1])
  if not kind then return nil end
  local lines = {}
  local cur = { kind = kind, inlines = List() }
  for i = 1, #inl do
    local el = inl[i]
    local next_kind = label_kind(inl[i + 1])
    if (el.t == "SoftBreak" or el.t == "LineBreak") and next_kind then
      lines[#lines + 1] = cur
      cur = { kind = next_kind, inlines = List() }
    else
      cur.inlines:insert(el)
    end
  end
  lines[#lines + 1] = cur
  return lines
end

-- a list in which every entry carries a DOI link is a list of references
local function is_reference_list(list)
  if #list.content == 0 then return false end
  for _, item in ipairs(list.content) do
    local found = false
    pandoc.Blocks(item):walk({
      Link = function(l)
        if l.target:match("^https?://doi%.org/") or l.target:match("^https?://dx%.doi%.org/") then found = true end
      end
    })
    if not found then return false end
  end
  return true
end

local function restructure(blocks)
  local out = List()
  local i = 1
  while i <= #blocks do
    local b = blocks[i]
    if b.t == "Para" then
      local lines = meta_lines(b)
      if lines then
        local group = List()
        while lines do
          for _, ln in ipairs(lines) do
            group:insert(pandoc.Div({ pandoc.Plain(ln.inlines) },
              pandoc.Attr("", { "pv-meta-line", "pv-meta-" .. ln.kind })))
          end
          local nxt = blocks[i + 1]
          lines = nil
          if nxt and nxt.t == "Para" then
            lines = meta_lines(nxt)
            if lines then i = i + 1 end
          end
        end
        out:insert(pandoc.Div(group, pandoc.Attr("", { "pv-item-meta" })))
      elseif #b.content == 1 and b.content[1].t == "Strong"
          and stringify(b.content[1]):lower() == "also this month" then
        out:insert(pandoc.Div({ pandoc.Plain(b.content[1].content) },
          pandoc.Attr("", { "pv-also-label" })))
        local nxt = blocks[i + 1]
        if nxt and nxt.t == "BulletList" then
          out:insert(pandoc.Div({ nxt }, pandoc.Attr("", { "pv-also" })))
          i = i + 1
        end
      else
        out:insert(b)
      end
    elseif b.t == "BulletList" and is_reference_list(b) then
      out:insert(pandoc.Div({ b }, pandoc.Attr("", { "pv-refs" })))
    elseif b.t == "Div" and not (b.identifier:match("^quarto%-") or b.classes:includes("hidden")) then
      b.content = restructure(b.content)
      out:insert(b)
    else
      out:insert(b)
    end
    i = i + 1
  end
  return out
end

-- ------------------------------------------------- 4: words and page marks

local CONTAINERS = {
  Emph = true, Strong = true, Underline = true, Strikeout = true,
  Superscript = true, Subscript = true, SmallCaps = true, Span = true,
  Link = true, Quoted = true, Cite = true,
}

-- Goes through the words of one block in reading order. A word starts at the
-- first piece of text after a space. on_word(k) may return something to put
-- next to word number k, and says where: in front of the word, or (second
-- value true) right behind its first piece of text.
local function scan(inlines, st, on_word)
  local out = List()
  for _, el in ipairs(inlines) do
    local t = el.t
    if t == "Str" or t == "Code" or t == "Math" then
      local ins, behind = nil, false
      if st.at_start then
        st.k = st.k + 1
        st.at_start = false
        st.words[st.k] = ""
        if on_word then ins, behind = on_word(st.k) end
      end
      if st.k > 0 then st.words[st.k] = st.words[st.k] .. (el.text or "") end
      if ins and not behind then out:insert(ins) end
      out:insert(el)
      if ins and behind then out:insert(ins) end
    elseif t == "Space" or t == "SoftBreak" or t == "LineBreak" then
      st.at_start = true
      out:insert(el)
    elseif CONTAINERS[t] then
      el.content = scan(el.content, st, on_word)
      out:insert(el)
    else
      out:insert(el)
    end
  end
  return out
end

-- The same words give the same fingerprint, however the quotation marks,
-- dashes and other signs were typed or converted.
local function fingerprint(words)
  local clean = {}
  for _, w in ipairs(words) do
    w = w:gsub("%p", "")
    w = w:gsub("\226\128[\144-\191]", "")   -- dashes, curly quotation marks, the ellipsis
    w = w:gsub("\194\160", "")              -- the no-break space
    if w ~= "" then clean[#clean + 1] = w end
  end
  return pandoc.utils.sha1(table.concat(clean, " ")):sub(1, 10)
end

-- When Quarto builds a web page it adds hidden parts of its own to the end of
-- the text (the words of the menu and of the footer). They are not text of
-- the issue.
local function is_quarto_part(b)
  return b.t == "Div" and (b.identifier:match("^quarto%-") ~= nil or b.classes:includes("hidden"))
end

-- Calls fn on every block of text (heading, paragraph, list entry), in
-- reading order, and puts back what fn returns.
local function each_text_block(blocks, fn)
  for i = 1, #blocks do
    local b = blocks[i]
    local t = b.t
    if is_quarto_part(b) then
      -- not text of the issue
    elseif t == "Para" or t == "Plain" or t == "Header" then
      blocks[i] = fn(b) or b
    elseif t == "Div" or t == "BlockQuote" then
      local c = b.content
      each_text_block(c, fn)
      b.content = c
      blocks[i] = b
    elseif t == "BulletList" or t == "OrderedList" then
      local items = b.content
      for j = 1, #items do
        local item = items[j]
        each_text_block(item, fn)
        items[j] = item
      end
      b.content = items
      blocks[i] = b
    end
  end
end

-- Gives every block of text its key (a fingerprint and a counter, for blocks
-- with the same words) and returns the fingerprint of the whole text.
local function number_blocks(blocks, with_key)
  local seen = {}
  local all = {}
  each_text_block(blocks, function(b)
    local st = { k = 0, at_start = true, words = {} }
    scan(b.content, st, nil)
    local fp = fingerprint(st.words)
    seen[fp] = (seen[fp] or 0) + 1
    local key = fp .. ":" .. seen[fp]
    all[#all + 1] = key
    if with_key then return with_key(b, key, st.k) end
    return nil
  end)
  return pandoc.utils.sha1(table.concat(all, " ")):sub(1, 16)
end

-- ------------------------------------------------- the facts of the issue

local function issue_info(meta)
  local info = {}
  info.number = meta_text(meta, "issue")                 -- "2026/1"
  info.slug = info.number:gsub("/", "-")                 -- "2026-1"
  info.month = meta_text(meta, "subtitle")               -- "September 2026"
  info.period = meta_text(meta, "period")
  info.rules = meta_text(meta, "rules-version")
  info.editor = meta_text(meta, "author")
  if info.editor == "" then info.editor = "Khayyam Rzazade" end
  info.doi = meta_text(meta, "doi"):gsub("^https?://doi%.org/", "")
  info.description = meta_text(meta, "description")
  -- the day of publication: the line "published" if there is one, else "date"
  local raw = meta_text(meta, "published")
  if raw == "" then raw = meta_text(meta, "date") end
  local y, m, d = parse_date(raw)
  if y then
    info.date_iso = string.format("%04d-%02d-%02d", y, m, d)
    info.date_long = string.format("%d %s %d", d, MONTHS[m], y)
    info.year = tostring(y)
    info.y, info.m, info.d = y, m, d
  else
    info.date_iso, info.date_long = "", ""
    info.year = info.number:match("^(%d%d%d%d)") or ""
  end
  info.published = (info.doi ~= "" and info.date_iso ~= "")
  info.url = SITE .. "/monitor/" .. info.slug .. "/"
  info.pdf = "populiverse-monitor-" .. info.slug .. ".pdf"
  info.pdf_url = info.url .. info.pdf
  info.research = "populiverse-monitor-" .. info.slug .. "-new-research.csv"
  info.title = "PopuliVerse Monitor " .. info.number
  -- the family name first, as reference lists print it: "Rzazade, Khayyam"
  local first, last = info.editor:match("^(.-)%s+(%S+)$")
  if first then info.editor_inverted = last .. ", " .. first else info.editor_inverted = info.editor end
  return info
end

-- ------------------------------------------------------------- the PDF

local function raw_typst(s) return pandoc.RawInline("typst", s) end
local function raw_typst_block(s) return pandoc.RawBlock("typst", s) end

local function wrap_typst(name, blocks)
  local out = List({ raw_typst_block("#" .. name .. "[") })
  out:extend(blocks)
  out:insert(raw_typst_block("]"))
  return out
end

local function make_typst(doc, info)
  -- The invisible marks: one at every word. A mark stands right behind its
  -- word, glued to it, so that it turns the page together with the word (a
  -- mark in front of a word stays behind on the old page when the page turns
  -- exactly there). Only the last word of a block carries its mark in front:
  -- a mark at the very end of a block would slip to the block that follows.
  local text_hash = number_blocks(doc.blocks, function(b, key, n)
    local st = { k = 0, at_start = true, words = {} }
    b.content = scan(b.content, st, function(k)
      return raw_typst(string.format('#w("%s",%d);', key, k)), (k < n)
    end)
    return b
  end)

  -- "New research": the PDF prints where the full list is
  if info.research_list and info.research_place then
    local line = "#pvlistnote[The full list of the " .. #info.research_list
      .. " works, with the Library's tags for each, is on the web page of this issue: "
      .. '#pvurl("' .. typst_string(info.url .. "#new-research") .. '");.'
    if info.doi ~= "" then
      line = line .. " It is also a file in the record of this issue at Zenodo: "
        .. '#pvurl("https://doi.org/' .. typst_string(info.doi) .. '");.'
    end
    doc.blocks:insert(info.research_place, raw_typst_block(line .. "]"))
  end

  doc = doc:walk({
    -- the headings start one step down in the text ("##"); in the PDF the
    -- three parts are the first level
    Header = function(h)
      h.level = math.max(1, h.level - 1)
      return h
    end,
    Link = function(l)
      local shown = stringify(l.content)
      if shown == l.target then
        -- an address printed in full (a DOI): let it break at the end of a line
        local keep = List()
        for _, el in ipairs(l.content) do
          if el.t == "RawInline" then keep:insert(el) end
        end
        keep:insert(raw_typst('#pvurl("' .. typst_string(l.target) .. '");'))
        return keep
      elseif not l.target:match("^https?://") then
        return nil
      else
        -- a linked phrase: a thin line under it shows that it is a link
        local out = List({ raw_typst('#pvlink("' .. typst_string(l.target) .. '")[') })
        out:extend(l.content)
        out:insert(raw_typst("]"))
        -- a source outside the site: its address is also printed as a footnote
        if l.target:sub(1, #SITE) ~= SITE then
          out:insert(raw_typst('#pvnote("' .. typst_string(l.target) .. '");'))
        end
        return out
      end
    end,
    Div = function(d)
      if d.classes:includes("pv-meta-line") then
        return wrap_typst("pvline", d.content)
      elseif d.classes:includes("pv-item-meta") then
        return wrap_typst("pvmeta", d.content)
      elseif d.classes:includes("pv-also-label") then
        return wrap_typst("pvalsolabel", d.content)
      elseif d.classes:includes("pv-also") then
        return wrap_typst("pvalso", d.content)
      elseif d.classes:includes("pv-refs") then
        return wrap_typst("pvrefs", d.content)
      end
      return nil
    end,
  })

  -- what the template (issue.typ) needs to know
  local function v(s) return pandoc.MetaInlines({ raw_typst(typst_string(s)) }) end
  doc.meta["pv"] = pandoc.MetaMap({
    number = v(info.number), month = v(info.month), period = v(info.period),
    rules = v(info.rules), editor = v(info.editor), ["editor-inverted"] = v(info.editor_inverted),
    doi = v(info.doi), year = v(info.year), ["date-long"] = v(info.date_long),
    url = v(info.url), description = v(info.description), ["text-hash"] = v(text_hash),
  })
  if info.y then
    doc.meta["pv"]["date-y"] = v(tostring(info.y))
    doc.meta["pv"]["date-m"] = v(tostring(info.m))
    doc.meta["pv"]["date-d"] = v(tostring(info.d))
  end
  return doc
end

-- ------------------------------------------------------------- the web page

local function raw_html(s) return pandoc.RawInline("html", s) end
local function raw_html_block(s) return pandoc.RawBlock("html", s) end

local function page_mark(page)
  return raw_html(string.format(
    '<span class="pv-page" role="doc-pagebreak" aria-label="Page %d of the PDF" data-page="%d"></span>',
    page, page))
end

local function scholar_tags(info, pages)
  local t = {}
  local function add(name, content)
    if content and content ~= "" then
      t[#t + 1] = string.format('<meta name="%s" content="%s">', name, html_escape(content))
    end
  end
  add("citation_title", info.title .. ": " .. info.month)
  add("citation_author", info.editor)
  add("citation_publication_date", (info.date_iso:gsub("-", "/")))
  add("citation_journal_title", "PopuliVerse Monitor")
  add("citation_volume", info.number:match("^(%d+)/") or "")
  add("citation_issue", info.number:match("/(%d+)$") or "")
  if pages then
    add("citation_firstpage", "1")
    add("citation_lastpage", string.format("%d", pages))
  end
  add("citation_doi", info.doi)
  add("citation_language", "en")
  add("citation_publisher", "PopuliVerse")
  add("citation_fulltext_html_url", info.url)
  add("citation_pdf_url", info.pdf_url)
  return table.concat(t, "\n")
end

local function facts_block(info, has_pdf, state)
  local rows = {}
  local function row(term, value) rows[#rows + 1] = "<div><dt>" .. term .. "</dt><dd>" .. value .. "</dd></div>" end
  row("Period covered", html_escape(info.period))
  if info.rules ~= "" then
    row("Rules", '<a href="../rules.html">Version ' .. html_escape(info.rules) .. "</a>")
  end
  row("Founder and editor", '<a href="../../about/editor.html">' .. html_escape(info.editor) .. "</a>")
  row("Published", info.date_long ~= "" and html_escape(info.date_long) or "<em>not yet</em>")
  if info.doi ~= "" then
    row("DOI", '<a href="https://doi.org/' .. html_escape(info.doi) .. '">' .. html_escape(info.doi) .. "</a>")
  else
    row("DOI", "<em>not yet</em>")
  end
  row("Licence", '<a href="../../legal/licence.html">CC BY 4.0</a>')

  local h = { '<div class="pv-issue-facts">' }
  if not info.published then
    h[#h + 1] = '<div class="pv-pending"><p>Draft. This issue is not published yet: '
      .. 'it has no publication date or no DOI.</p></div>'
  end
  h[#h + 1] = "<dl>" .. table.concat(rows, "") .. "</dl>"
  local actions = {}
  if has_pdf then
    actions[#actions + 1] = '<a class="pv-button" href="' .. info.pdf .. '">Download the PDF</a>'
  end
  actions[#actions + 1] = '<a href="#how-to-cite">How to cite this issue</a>'
  h[#h + 1] = '<p class="pv-issue-actions">' .. table.concat(actions, " ") .. "</p>"
  if state == "ok" then
    h[#h + 1] = '<p class="pv-issue-note">The PDF is the version of record. The small numbers at the edge of '
      .. 'the text show where each page of the PDF begins, so a passage can be cited by page from this page too.</p>'
  elseif state == "stale" then
    h[#h + 1] = '<div class="pv-pending"><p>The text has changed since the PDF was made, so the page numbers '
      .. 'are not shown. Run <code>scripts/make_issue.R</code> to make the PDF again.</p></div>'
  else
    h[#h + 1] = '<div class="pv-pending"><p>The PDF of this issue has not been made yet. '
      .. 'Run <code>scripts/make_issue.R</code>.</p></div>'
  end
  h[#h + 1] = "</div>"
  return raw_html_block(table.concat(h, "\n"))
end

local function cite_block(info, pages)
  local where = info.doi ~= "" and ("https://doi.org/" .. info.doi) or info.url
  local year = info.year
  local ref_html = html_escape(info.editor_inverted) .. ", ed. " .. year .. ". <em>PopuliVerse Monitor</em> "
    .. html_escape(info.number) .. " (" .. html_escape(info.month) .. "). " .. html_escape(where) .. "."
  local ref_plain = info.editor_inverted .. ", ed. " .. year .. ". PopuliVerse Monitor " .. info.number
    .. " (" .. info.month .. "). " .. where .. "."
  local key = "populiverse_monitor_" .. info.slug:gsub("-", "_")
  local bib = "@misc{" .. key .. ",\n"
    .. "  editor = {" .. info.editor_inverted .. "},\n"
    .. "  title = {{PopuliVerse} Monitor " .. info.number .. ": " .. info.month .. "},\n"
    .. "  year = {" .. year .. "},\n"
    .. "  howpublished = {{PopuliVerse} Monitor, no. " .. info.number .. "},\n"
    .. (pages and ("  pagetotal = {" .. string.format("%d", pages) .. "},\n") or "")
    .. (info.doi ~= "" and ("  doi = {" .. info.doi .. "},\n") or "")
    .. "  url = {" .. info.url .. "}\n"
    .. "}\n"
  local h = {
    '<section id="how-to-cite" class="level2 pv-issue-cite">',
    '<h2 class="anchored" data-anchor-id="how-to-cite">How to cite this issue</h2>',
    '<div class="pv-cite" id="pv-cite">',
    '<p id="pv-cite-text">' .. ref_html .. "</p>",
    '<p class="pv-lib-tools">',
    '<button type="button" class="pv-lib-link" id="pv-cite-copy" hidden>Copy citation</button>',
    '<button type="button" class="pv-lib-link" id="pv-cite-bib" hidden>Copy BibTeX</button>',
    "</p>",
    "</div>",
    '<p class="pv-issue-note">To cite one item, add its title and the page of the PDF on which it stands.</p>',
    "<script>",
    "// Makes the two \"copy\" buttons work. Without JavaScript the citation stays readable and the buttons stay hidden.",
    "(function () {",
    '  var plain = "' .. js_string(ref_plain) .. '";',
    '  var bibtex = "' .. js_string(bib) .. '";',
    "  function copy(text, button) {",
    "    var label = button.textContent;",
    "    function done(ok) {",
    '      button.textContent = ok ? "Copied" : "Could not copy";',
    "      window.setTimeout(function () { button.textContent = label; }, 2000);",
    "    }",
    "    if (navigator.clipboard && navigator.clipboard.writeText) {",
    "      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });",
    "      return;",
    "    }",
    "    try {",
    '      var area = document.createElement("textarea");',
    '      area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";',
    "      document.body.appendChild(area); area.select();",
    '      var ok = document.execCommand("copy");',
    "      document.body.removeChild(area); done(ok);",
    "    } catch (e) { done(false); }",
    "  }",
    '  [["pv-cite-copy", plain], ["pv-cite-bib", bibtex]].forEach(function (pair) {',
    "    var button = document.getElementById(pair[0]);",
    "    if (!button) return;",
    "    button.hidden = false;",
    '    button.addEventListener("click", function () { copy(pair[1], button); });',
    "  });",
    "})();",
    "</script>",
    "</section>",
  }
  return raw_html_block(table.concat(h, "\n"))
end

-- The full list of the month's works, folded shut under the short account.
local function research_block(info)
  local list = info.research_list
  local h = {
    '<details class="pv-research">',
    "<summary>The full list: " .. #list .. " works published in " .. html_escape(info.month) .. "</summary>",
  }
  local shown = {}
  local function group(kind, heading)
    local items = {}
    for i, r in ipairs(list) do
      if not shown[i] and (kind == nil or r.kind == kind) then
        shown[i] = true
        local title = html_escape(r.title)
        local where = html_escape(r.journal_or_publisher)
        local body
        if r.kind == "book" then
          body = "<em>" .. title .. "</em>." .. (where ~= "" and (" " .. where .. ".") or "")
        else
          body = "\226\128\156" .. title .. (title:match("[%?%!%.]$") and "" or ".") .. "\226\128\157"
            .. (where ~= "" and (" <em>" .. where .. "</em>.") or "")
        end
        items[#items + 1] = "<li>" .. html_escape(r.reference) .. ". " .. body
          .. ' <a href="https://doi.org/' .. html_escape(r.doi) .. '">https://doi.org/' .. html_escape(r.doi) .. "</a></li>"
      end
    end
    if #items > 0 then
      h[#h + 1] = '<p class="pv-research-kind">' .. heading .. " (" .. #items .. ")</p>"
      h[#h + 1] = '<ul class="pv-research-list">\n' .. table.concat(items, "\n") .. "\n</ul>"
    end
  end
  for _, k in ipairs(RESEARCH_KINDS) do group(k[1], k[2]) end
  group(nil, "Other works")
  h[#h + 1] = '<p class="pv-issue-note">The same list as a file, with the Library\226\128\153s tags for each work: '
    .. '<a href="' .. info.research .. '">' .. info.research .. "</a>. "
    .. "The file is also part of the record of this issue at Zenodo.</p>"
  h[#h + 1] = "</details>"
  return raw_html_block(table.concat(h, "\n"))
end

local function make_html(doc, info)
  local dir = input_dir()
  local has_pdf = file_exists(pandoc.path.join({ dir, info.pdf }))

  -- where the pages of the PDF begin (written by scripts/make_issue.R)
  local map, starts = nil, {}
  local raw = read_file(pandoc.path.join({ dir, "pages.json" }))
  if raw then
    local ok, decoded = pcall(pandoc.json.decode, raw, false)
    if ok and type(decoded) == "table" and type(decoded.starts) == "table" then
      map = decoded
      map.pages = math.floor(tonumber(map.pages) or 0)
    end
  end
  local text_hash = number_blocks(doc.blocks, nil)
  local state = "none"
  if map and has_pdf then
    if map.text == text_hash then state = "ok" else state = "stale" end
  end

  if state == "ok" then
    for _, s in ipairs(map.starts) do
      starts[s.key] = starts[s.key] or {}
      starts[s.key][tonumber(s.word)] = tonumber(s.page)
    end
    number_blocks(doc.blocks, function(b, key)
      local here = starts[key]
      if not here then return nil end
      if b.t == "Header" then
        -- A page that begins with a heading: the number goes on the heading
        -- itself, not into its words (Quarto copies the words of a heading
        -- into the "On this page" list).
        local page = nil
        for _, p in pairs(here) do
          if page == nil or p < page then page = p end
        end
        b.classes:insert("pv-page-here")
        b.attributes["data-page"] = string.format("%d", page)
        return b
      end
      local st = { k = 0, at_start = true, words = {} }
      b.content = scan(b.content, st, function(k)
        if here[k] then return page_mark(here[k]) end
        return nil
      end)
      return b
    end)
  elseif state == "stale" then
    io.stderr:write("\n[PopuliVerse] " .. info.title .. ": the text has changed since the PDF was made. "
      .. "The page numbers are left out. Run scripts/make_issue.R.\n\n")
  end

  doc = doc:walk({
    Link = function(l)
      -- a link into the site's own Library works on any copy of the site
      local rest = l.target:match("^https://populiverse%.com/library/(.*)$")
      if rest then
        l.target = "../../library/index.html" .. rest
        return l
      end
      return nil
    end,
  })

  -- "New research": the full list, folded shut, under the short account
  if info.research_list and info.research_place then
    doc.blocks:insert(info.research_place, research_block(info))
  end

  local last = #doc.blocks
  while last > 0 and is_quarto_part(doc.blocks[last]) do last = last - 1 end
  doc.blocks:insert(last + 1, cite_block(info, state == "ok" and map.pages or nil))
  doc.blocks:insert(1, facts_block(info, has_pdf, state))

  -- what Google Scholar reads; only once the issue is published
  if info.published then
    local tags = scholar_tags(info, state == "ok" and map.pages or nil)
    if quarto and quarto.doc and quarto.doc.include_text then
      quarto.doc.include_text("in-header", tags)
    else
      local hi = doc.meta["header-includes"]
      local block = pandoc.MetaBlocks({ raw_html_block(tags) })
      if hi == nil then
        doc.meta["header-includes"] = pandoc.MetaList({ block })
      elseif hi.t == "MetaList" or (type(hi) == "table" and hi[1] ~= nil) then
        hi[#hi + 1] = block
        doc.meta["header-includes"] = hi
      else
        doc.meta["header-includes"] = pandoc.MetaList({ hi, block })
      end
    end
  end
  return doc
end

-- ------------------------------------------------------------- the start

function Pandoc(doc)
  if meta_text(doc.meta, "issue") == "" then return nil end
  if not (TYPST or HTML) then return nil end
  local info = issue_info(doc.meta)
  doc.blocks = restructure(doc.blocks)

  -- the list of the month's research, if the issue has one
  local raw = read_file(pandoc.path.join({ input_dir(), info.research }))
  if raw then
    local list = read_csv(raw)
    if #list > 0 then
      info.research_list = list
      info.research_place = research_place(doc.blocks, is_quarto_part)
    end
  end
  if TYPST then return make_typst(doc, info) end
  return make_html(doc, info)
end
