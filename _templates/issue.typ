// ===========================================================================
// PopuliVerse Monitor: the look of an issue's PDF (the Edition look in print).
//
// scripts/make_issue.R pours the text of an issue into this file and makes
// the PDF from it. To change a colour, a size or a margin for every future
// issue, change it once here.
//
// Words between two dollar signs are filled in from the issue's header.
// ===========================================================================

// ---- colours (the same as in edition.scss)
#let ink = rgb("#111111")       // text and the strong rules
#let muted = rgb("#4A4A4A")     // secondary text
#let hairline = rgb("#D9D9D6")  // thin dividing lines
#let cover = rgb("#4A5F66")     // the Monitor's cover colour: slate

// ---- the facts of this issue
#let issue = (
  number: "$pv.number$",
  month: "$pv.month$",
  period: "$pv.period$",
  rules: "$pv.rules$",
  editor: "$pv.editor$",
  editor-inverted: "$pv.editor-inverted$",
  doi: "$pv.doi$",
  year: "$pv.year$",
  date-long: "$pv.date-long$",
  url: "$pv.url$",
  description: "$pv.description$",
  text-hash: "$pv.text-hash$",
)
#let published = issue.doi != "" and issue.date-long != ""
#let wordmark = [Populi#emph[Verse]]
#let site = "https://populiverse.com"

#set document(
  title: "PopuliVerse Monitor " + issue.number + ": " + issue.month,
  author: issue.editor,
$if(pv.date-y)$
  date: datetime(year: $pv.date-y$, month: $pv.date-m$, day: $pv.date-d$),
$else$
  date: none,
$endif$
)

// ---- the page and the text
#set page(
  paper: "a4",
  margin: (top: 30mm, bottom: 30mm, left: 35mm, right: 35mm),
  header-ascent: 11mm,
  footer-descent: 12mm,
  // the running head, from the first page of text on
  header: context {
    if here().page() > 2 {
      set text(size: 7.5pt, fill: muted)
      grid(
        columns: (1fr, auto),
        [#wordmark Monitor #issue.number],
        [#issue.month],
      )
      v(-5pt)
      line(length: 100%, stroke: 0.5pt + hairline)
    }
  },
  // the page number, on every page but the cover
  footer: context {
    if here().page() > 1 {
      align(center, text(size: 8pt, fill: muted, str(here().page())))
    }
  },
)

#set text(font: "Libre Baskerville", size: 9.4pt, fill: ink, lang: "en", region: "GB", hyphenate: true)
#set par(justify: true, leading: 0.74em, spacing: 1.05em, first-line-indent: 0pt)

// ---- small helpers that the text uses

// An invisible mark in front of every word. From these marks the PDF reports
// where each page begins (see the end of this file).
#let w(key, k) = [#metadata((key, k))<pvw>]

// An address may break at the end of a line, but only in front of a slash,
// a dot, a hyphen and the like: so a line never ends in a hyphen that a
// reader could take for a line-break hyphen. Nothing is added to the address.
#let breakable(u) = {
  let head = ""
  let rest = u
  if u.starts-with("https://") { head = "https://"; rest = u.slice(8) }
  if u.starts-with("http://") { head = "http://"; rest = u.slice(7) }
  let parts = ()
  let cur = head
  for c in rest.clusters() {
    if c in ("/", "?", "&", "=", ".", "-", "_", "%", "+", ",") and cur != head and cur != "" {
      parts.push(cur)
      cur = ""
    }
    cur += c
  }
  if cur != "" { parts.push(cur) }
  // each piece is kept whole; a line can only end between two pieces
  parts.map(p => box(text(p))).join(h(0pt))
}

// a printed address that is also a link
#let pvurl(u) = link(u, text(hyphenate: false, breakable(u)))

// a linked phrase in the text: a thin line under it shows that it is a link
#let pvlink(u, body) = link(u, underline(stroke: 0.45pt + rgb("#9A9A96"), offset: 1.7pt, body))

// the address of a source, printed as a footnote: links die, paper does not
#let pvnote(u) = footnote(pvurl(u))

// the small print under an item: actor, sources, research
#let pvmeta(body) = block(above: 0.95em, below: 0pt, width: 100%)[
  #set text(size: 7.5pt, fill: muted, hyphenate: false)
  #set par(justify: false, leading: 0.62em, spacing: 0.5em)
  #body
]
#let pvline(body) = block(above: 0.5em, below: 0pt, width: 100%, body)

// "Also this month" and its short entries
#let pvalsolabel(body) = block(above: 2em, below: 0.9em, sticky: true)[
  #text(size: 7.3pt, tracking: 0.12em, fill: muted, upper(body))
]
#let pvalso(body) = {
  set list(marker: [], indent: 0pt, body-indent: 0pt, spacing: 0.95em)
  set text(size: 8.7pt)
  set par(leading: 0.7em)
  body
}

// a list of references, set like a printed bibliography
#let pvrefs(body) = {
  set text(size: 8.7pt, hyphenate: false)
  // every entry is a paragraph whose second and later lines are set in
  show list: it => {
    for item in it.children {
      block(above: 1em, below: 0pt, width: 100%,
        par(justify: false, hanging-indent: 1.5em, leading: 0.7em, item.body))
    }
  }
  body
}

// what pandoc's own output expects to find
#let horizontalrule = line(length: 100%, stroke: 0.5pt + hairline)

// ---- headings
#let double-rule = stack(
  spacing: 1.7pt,
  line(length: 100%, stroke: 0.6pt + ink),
  line(length: 100%, stroke: 0.6pt + ink),
)

// a part: "The month in brief", "Around the world", "New research"
#show heading.where(level: 1): it => block(above: 2.9em, below: 1.25em, sticky: true, breakable: false, width: 100%)[
  #double-rule
  #v(0.55em)
  #set par(justify: false)
  #text(size: 16pt, weight: "regular", hyphenate: false, it.body)
]

// a region: "Europe", "North America" and so on
#show heading.where(level: 2): it => block(above: 2.3em, below: 0.2em, sticky: true, breakable: false, width: 100%)[
  #set par(justify: false)
  #text(size: 12.5pt, style: "italic", weight: "regular", hyphenate: false, it.body)
  #v(-0.35em)
  #line(length: 100%, stroke: 0.5pt + hairline)
]

// an item
#show heading.where(level: 3): it => block(above: 1.9em, below: 0.8em, sticky: true, breakable: false, width: 100%)[
  #set par(justify: false, leading: 0.6em)
  #text(size: 9.8pt, weight: "bold", hyphenate: false, it.body)
]

// ---- footnotes: the addresses of the sources
#set footnote.entry(
  separator: line(length: 18%, stroke: 0.5pt + hairline),
  gap: 0.45em,
  clearance: 1.2em,
  indent: 0em,
)
#show footnote.entry: set text(size: 6.8pt, fill: muted)
#show footnote.entry: set par(justify: false, leading: 0.5em)

$for(header-includes)$
$header-includes$

$endfor$
// ===========================================================================
// Page 1: the cover. One muted colour with a thin frame set in from the
// edge, as on the Home page of the site.
// ===========================================================================
#page(margin: 0pt, fill: cover, header: none, footer: none)[
  #set text(fill: white)
  #set par(justify: false, leading: 0.5em)
  #place(top + left, dx: 9mm, dy: 9mm,
    rect(width: 100% - 18mm, height: 100% - 18mm, stroke: 0.6pt + white.transparentize(25%)))
  #place(top + left, dx: 25mm, dy: 27mm)[
    #text(size: 11pt, tracking: 0.14em, upper(wordmark))
    #v(2mm)
    #text(size: 58pt, style: "italic")[Monitor]
  ]
  #place(bottom + left, dx: 25mm, dy: -27mm)[
    #text(size: 42pt)[#issue.number]
    #v(-1mm)
    #text(size: 14pt)[#issue.month]
  ]
  #if not published {
    place(bottom + right, dx: -25mm, dy: -27mm,
      text(size: 9pt, tracking: 0.12em, upper[Draft, not published]))
  }
]

// ===========================================================================
// Page 2: what is in the issue, and the facts about it.
// ===========================================================================
#page(header: none)[
  #set par(justify: false)
  #text(size: 21pt)[#wordmark Monitor #issue.number]
  #v(-0.55em)
  #text(size: 11.5pt, style: "italic", fill: muted)[#issue.month]

  #v(1.1em)
  #double-rule
  #v(0.9em)

  // ---- contents
  #context {
    let first-text-page = 3
    for h in query(heading) {
      let p = counter(page).at(h.location()).first()
      // the marks in front of the words belong to the text, not to this list
      let title = {
        show metadata: none
        h.body
      }
      if h.level == 1 {
        block(above: 1.15em, below: 0.5em, link(h.location(), grid(
          columns: (1fr, 2em), column-gutter: 1em,
          text(size: 10.5pt, title), align(right, text(size: 9pt, str(p))),
        )))
      } else if h.level == 2 {
        block(above: 0.75em, below: 0.35em, inset: (left: 1.2em), link(h.location(), grid(
          columns: (1fr, 2em), column-gutter: 1em,
          text(size: 9.4pt, style: "italic", title), align(right, text(size: 8.5pt, fill: muted, str(p))),
        )))
      } else if h.level == 3 {
        block(above: 0.42em, below: 0.42em, inset: (left: 2.4em), link(h.location(), grid(
          columns: (1fr, 2em), column-gutter: 1em,
          text(size: 8pt, fill: muted, title), align(right, text(size: 8pt, fill: muted, str(p))),
        )))
      }
    }
  }

  #v(1fr)

  // ---- the imprint
  #line(length: 100%, stroke: 0.5pt + hairline)
  #v(0.2em)
  #set text(size: 7.4pt, fill: muted, hyphenate: false)
  #set par(leading: 0.6em, spacing: 0.75em)
  #grid(
    columns: (1fr, 1fr), column-gutter: 2.2em,
    [
      #wordmark Monitor is a monthly digest of what populist actors did around the world. It describes what happened. It does not analyse or judge.

      *Period covered:* #issue.period. \
      *Rules:* version #issue.rules, #link(site + "/monitor/rules.html")[populiverse.com/monitor/rules.html]. \
      *Editor:* #issue.editor. \
      *Published:* #if issue.date-long != "" [#issue.date-long.] else [not yet.] \
      *DOI:* #if issue.doi != "" [#link("https://doi.org/" + issue.doi)[#issue.doi].] else [not yet.] \
      *Web page:* #link(issue.url)[#issue.url.replace("https://", "")]
    ],
    [
      *How it is made.* An AI assistant, Claude, searches the listed sources and drafts the text. The editor chooses the items, edits every word and checks every link.

      *How to cite.* #issue.editor-inverted, ed. #issue.year. #emph[PopuliVerse Monitor] #issue.number (#issue.month). #if issue.doi != "" [#link("https://doi.org/" + issue.doi)[https:\/\/doi.org\/#issue.doi].] else [#issue.url.]

      This PDF is the version of record. It is published under the Creative Commons Attribution 4.0 International licence (CC BY 4.0).
    ],
  )
]

// ===========================================================================
// From page 3: the text of the issue.
// ===========================================================================
$body$

// ===========================================================================
// For scripts/make_issue.R: on which page each page's first word stands.
// Nothing here is printed.
// ===========================================================================
#context {
  let starts = ()
  let last = 2
  for m in query(<pvw>) {
    let p = m.location().page()
    if p > last {
      starts.push((page: p, key: m.value.at(0), word: m.value.at(1)))
      last = p
    }
  }
  [#metadata((
    pages: counter(page).final().first(),
    starts: starts,
    text: issue.text-hash,
    issue: issue.number,
  ))<pvmap>]
}
