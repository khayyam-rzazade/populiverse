#!/usr/bin/env python3
"""The actor pages and the country pages, written before every build.

Quarto runs this script before it builds the site (see "pre-render" in
_quarto.yml). It reads what the Monitor already holds and writes one page for
each actor and one for each country, plus a list of each:

  actors/index.qmd, actors/<actor>.qmd
  countries/index.qmd, countries/<country>.qmd

What it reads:
  monitor/actors.csv             the covered actors, with the dataset behind each
  monitor/<issue>/index.qmd      the text of each published issue
  monitor/<issue>/...-items.csv  the tags of its items (written by Claude)
  library/taxonomy.yml           the names of countries and regions

Nothing has to be done by hand. When a new issue is published with its file
of tags, its items appear on these pages at the next build. The pages are not
kept in the repository (see .gitignore): they are written again every time.

An issue whose file of tags does not fit its text (another number of items, or
another title) is left out, with a note, as on the issue's own page. An issue
in preparation (a folder ending in "-draft") is never read.

Nothing else is touched. Only Python's own parts are used, nothing to install.
"""

import csv
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARK = "<!-- Written by scripts/make_pages.py at every build. Do not edit: changes are lost. -->"
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
EDITOR = "editor@populiverse.com"


def note(msg):
    print("make_pages: " + msg)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def rows(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------- names

def taxonomy_names():
    """The labels of countries and regions in library/taxonomy.yml."""
    text = read(os.path.join(ROOT, "library", "taxonomy.yml"))
    country, region_of = {}, {}
    for m in re.finditer(r'\{tag:\s*"country:([^"]+)",\s*label:\s*"([^"]+)",\s*region:\s*"region:([^"]+)"\}', text):
        country[m.group(1)] = m.group(2)
        region_of[m.group(1)] = m.group(3)
    region = {}
    for m in re.finditer(r'tag:\s*"region:([^"]+)"\s*\n\s*label:\s*"([^"]+)"', text):
        region[m.group(1)] = m.group(2)
    return country, region_of, region


# ---------------------------------------------------------------- the issues

def header_field(lines, name):
    for line in lines:
        m = re.match(r"^" + name + r":\s*(.*)$", line)
        if m:
            value = m.group(1).strip()
            q = re.match(r'^"([^"]*)"', value)
            return q.group(1) if q else re.sub(r"\s+#.*$", "", value).strip()
    return ""


def plain(md):
    """Markdown to plain words: links keep their words, emphasis marks go."""
    md = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", md)
    md = re.sub(r"[*_]{1,2}", "", md)
    return re.sub(r"\s+", " ", md).strip()


def first_sentence(text):
    m = re.match(r"^(.+?[.!?])(?=\s+[A-ZÀ-ɏ]|\s*$)", text)
    return m.group(1) if m else text


def issue_items(lines):
    """The items of an issue in the order of its text, as the template counts them."""
    items = []
    in_region = in_also = False
    for line in lines:
        if line.startswith("### "):
            in_region, in_also = True, False
        elif line.startswith("## "):
            in_region = in_also = False
        elif line.startswith("#### "):
            items.append({"kind": "full", "title": line[5:].strip()})
            in_also = False
        elif in_region and line.strip().lower() == "**also this month**":
            in_also = True
        elif in_also and line.startswith("- "):
            m = re.match(r"^- \*\*(.+?)\.?\*\*\s*(.*)$", line)
            if m:
                body = plain(m.group(2))
                items.append({"kind": "entry", "title": m.group(1).strip(), "sentence": first_sentence(body)})
            else:
                items.append({"kind": "entry", "title": plain(line[2:]), "sentence": ""})
        elif in_also and line.strip():
            in_also = False
    return items


def title_key(s):
    """A title as it is compared with the file of tags: no signs, small letters."""
    s = re.sub("[‐-‟]", "", s or "")
    s = re.sub(r"[!-/:-@\[-`{-~]", "", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def published_issues():
    base = os.path.join(ROOT, "monitor")
    out = []
    for name in sorted(os.listdir(base)):
        folder = os.path.join(base, name)
        if not (re.match(r"^\d{4}-\d+$", name) and os.path.isdir(folder)):
            continue
        text_file = os.path.join(folder, "index.qmd")
        tags_file = os.path.join(folder, "populiverse-monitor-" + name + "-items.csv")
        if not (os.path.exists(text_file) and os.path.exists(tags_file)):
            continue
        lines = read(text_file).split("\n")
        dashes = [i for i, l in enumerate(lines) if l.strip() == "---"]
        if len(dashes) < 2:
            continue
        header, body = lines[dashes[0] + 1:dashes[1]], lines[dashes[1] + 1:]
        items = issue_items(body)
        tags = rows(tags_file)
        problem = None
        if len(tags) != len(items):
            problem = "%d lines in the file of tags, %d items in the text" % (len(tags), len(items))
        else:
            for i, (it, t) in enumerate(zip(items, tags), 1):
                if title_key(t.get("title")) != title_key(it["title"]):
                    problem = 'item %d is "%s" in the text and "%s" in the file' % (i, it["title"], t.get("title"))
                    break
        if problem:
            note("issue %s left out: the file of tags does not fit the text (%s)." % (name, problem))
            continue
        number = header_field(header, "issue") or name.replace("-", "/")
        for i, (it, t) in enumerate(zip(items, tags), 1):
            it.update({
                "n": i, "issue": number, "folder": name,
                "type": t["type"].strip(), "date": t["date"].strip(), "date_end": (t.get("date_end") or "").strip(),
                "countries": [c.strip() for c in (t.get("countries") or "").split(";") if c.strip()],
                "actors": [a.strip() for a in (t.get("actors") or "").split(";") if a.strip()],
            })
        out.append({"folder": name, "number": number, "items": items})
    return out


# ---------------------------------------------------------------- writing

def when(first, last):
    m = re.match(r"^(\d{4})-(\d{2})(?:-(\d{2}))?$", first or "")
    if not m:
        return ""
    y, mo, d = int(m.group(1)), int(m.group(2)), m.group(3)
    if not d:
        return "%s %d" % (MONTHS[mo - 1], y)
    d = int(d)
    m2 = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", last or "")
    if not m2:
        return "%d %s %d" % (d, MONTHS[mo - 1], y)
    y2, mo2, d2 = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
    if (y2, mo2) == (y, mo):
        return "%d to %d %s %d" % (d, d2, MONTHS[mo - 1], y)
    if y2 == y:
        return "%d %s to %d %s %d" % (d, MONTHS[mo - 1], d2, MONTHS[mo2 - 1], y)
    return "%d %s %d to %d %s %d" % (d, MONTHS[mo - 1], y, d2, MONTHS[mo2 - 1], y2)


def sort_key(it):
    d = it["date"] if len(it["date"]) == 10 else it["date"] + "-00"
    return (d, it["issue"], it["n"])


def yaml_text(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def md_text(s):
    return s.replace("[", "\\[").replace("]", "\\]")


def item_line(it):
    link = "../monitor/%s/index.qmd#item-%d" % (it["folder"], it["n"])
    if it["kind"] == "full":
        what = "[%s](%s)" % (md_text(it["title"]), link)
    else:
        what = "[%s](%s). %s" % (md_text(it["title"]), link, md_text(it["sentence"]))
    return "- %s · %s · %s *(%s, item %d)*" % (when(it["date"], it["date_end"]), it["type"], what, it["issue"], it["n"])


def page(title, description, body):
    return "\n".join([
        "---",
        "title: " + yaml_text(title),
        "description: " + yaml_text(description),
        "google-scholar: false",
        "citation: false",
        "toc: false",
        "---",
        "",
        MARK,
        "",
    ] + body + ["", "::: {.pv-page-report}", "Found an error? Write to " + EDITOR + ".", ":::", ""])


def items_part(items):
    if not items:
        return ["No item yet."]
    n = len(items)
    out = ["%d %s, newest first." % (n, "item" if n == 1 else "items"), ""]
    out += [item_line(it) for it in sorted(items, key=sort_key, reverse=True)]
    return out


def write_all(written, folder, files):
    os.makedirs(folder, exist_ok=True)
    for name, text in files.items():
        path = os.path.join(folder, name)
        old = read(path) if os.path.exists(path) else None
        if old != text:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
        written.add(path)


def remove_old(folder, written):
    """Takes away a page this script wrote earlier and no longer writes. Only its own pages."""
    if not os.path.isdir(folder):
        return
    for name in os.listdir(folder):
        path = os.path.join(folder, name)
        if name.endswith(".qmd") and path not in written and MARK in read(path):
            os.remove(path)


def main():
    country, region_of, region = taxonomy_names()
    actors = rows(os.path.join(ROOT, "monitor", "actors.csv"))
    by_id = {a["id"]: a for a in actors}
    issues = published_issues()
    items = [it for iss in issues for it in iss["items"]]

    unknown = sorted({a for it in items for a in it["actors"] if a not in by_id})
    if unknown:
        note("actors in the tags that are not in monitor/actors.csv, left out: " + ", ".join(unknown))
    bad = sorted({c for it in items for c in it["countries"] if c not in country})
    if bad:
        note("countries in the tags that the Library does not know, left out: " + ", ".join(bad))

    written = set()

    # ---- the actors
    files = {}
    listing = []
    for a in sorted(actors, key=lambda a: a["name"].lower()):
        mine = [it for it in items if a["id"] in it["actors"]]
        land = country.get(a["country"], a["country"])
        source = a["source"]
        if a.get("reference"):
            source = "[%s](%s)" % (md_text(source), a["reference"])
        elif source.startswith("The PopuList"):
            source = "[%s](https://popu-list.org)" % source
        elif source.startswith("Global Populism Database"):
            source = "[%s](https://doi.org/10.7910/DVN/LFTQEZ)" % source
        if a.get("borderline") == "yes":
            source += ", borderline"
        if a.get("library_search"):
            lib = "[Works that name %s](../library/index.html?search=%s)" % (
                a["library_search"], a["library_search"].replace(" ", "%20"))
        else:
            lib = "[Research on parties in %s](../library/index.html?topic=parties&country=%s)" % (land, a["country"])
        body = [
            "::: {.pv-label}",
            "[%s](../countries/%s.qmd) · %s" % (land, a["country"], source),
            ":::",
            "",
            "## In the Monitor",
            "",
        ] + items_part(mine) + [
            "",
            "## In the Library",
            "",
            lib,
        ]
        files[a["id"] + ".qmd"] = page(a["name"], "What PopuliVerse Monitor reported on %s." % a["name"], body)
        listing.append("- [%s](%s.qmd), %s. %d %s." % (a["name"], a["id"], land, len(mine), "item" if len(mine) == 1 else "items"))
    files["index.qmd"] = page("Actors", "The populist actors in PopuliVerse Monitor.", [
        "Every actor that has stood in an issue, with what the Monitor reported on it. "
        "The Monitor covers an actor when a dataset or a publication classifies it as populist. "
        "See [the rules](../monitor/rules.qmd#who).",
        "",
    ] + listing)
    write_all(written, os.path.join(ROOT, "actors"), files)

    # ---- the countries
    files = {}
    listing = []
    places = sorted({c for it in items for c in it["countries"] if c in country} |
                    {a["country"] for a in actors if a["country"] in country}, key=lambda c: country[c])
    for c in places:
        mine = [it for it in items if c in it["countries"]]
        here = [a for a in actors if a["country"] == c]
        body = ["::: {.pv-label}", region.get(region_of.get(c, ""), ""), ":::", ""]
        if here:
            body += ["## Covered Actors", ""]
            body += ["- [%s](../actors/%s.qmd)" % (a["name"], a["id"]) for a in sorted(here, key=lambda a: a["name"].lower())]
            body += [""]
        body += ["## In the Monitor", ""] + items_part(mine) + [
            "",
            "## In the Library",
            "",
            "[Works on %s](../library/index.html?country=%s)" % (country[c], c),
        ]
        files[c + ".qmd"] = page(country[c], "What PopuliVerse Monitor reported on %s." % country[c], body)
        listing.append("- [%s](%s.qmd). %d %s." % (country[c], c, len(mine), "item" if len(mine) == 1 else "items"))
    files["index.qmd"] = page("Countries", "The countries in PopuliVerse Monitor.", [
        "Every country that has stood in an issue, with what the Monitor reported on it.",
        "",
    ] + listing)
    write_all(written, os.path.join(ROOT, "countries"), files)

    remove_old(os.path.join(ROOT, "actors"), written)
    remove_old(os.path.join(ROOT, "countries"), written)
    note("%d issues, %d items, %d actor pages, %d country pages." % (len(issues), len(items), len(actors), len(places)))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # the site is still built; the note says what went wrong
        note("the actor and country pages could not be written: %s" % e)
        sys.exit(0)
