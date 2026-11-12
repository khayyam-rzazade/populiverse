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
  data/countries.csv             the country codes the data pages use

It also writes two data files:
  data/monitor.json              the Monitor's part of the data pages: the actors,
                                 who of them is in power today, and every item
                                 with its countries
  data/events.csv                the whole events dataset, one row per item, for
                                 "Events in Monitor" (data/events.qmd)

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


# The 14 event types in their six families, and "Other". The same table stands
# on monitor/tagging.qmd and in data/events.js and data/monitor-pages.js.
FAMILIES = {
    "Election": "Votes", "Referendum": "Votes", "Campaign": "Votes",
    "Office": "Office and Party", "Party": "Office and Party",
    "Law": "Rules", "Measure": "Rules",
    "Court": "Justice", "Police and Prosecutors": "Justice",
    "Diplomacy": "Abroad", "Agreement": "Abroad", "Sanctions and Trade": "Abroad",
    "Armed Forces": "Abroad", "Protest": "Street",
}


def family(kind):
    return FAMILIES.get(kind, "Other")


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
    # A sentence ends at a full stop followed by a capital, by an opening bracket
    # (where the source credits of a one-line entry begin) or by the end of the text
    m = re.match(r"^(.+?[.!?])(?=\s+[A-ZÀ-ɏ(]|\s*$)", text)
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


def page(title, description, body, wide=False):
    return "\n".join([
        "---",
        "title: " + yaml_text(title),
        "description: " + yaml_text(description),
        "google-scholar: false",
        "citation: false",
        "toc: false",
    ] + (["page-layout: full", "body-classes: pv-data"] if wide else []) + [
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


def app(kind, key="", world=False):
    """The box that data/monitor-pages.js fills: on a list, the cards with search,
    filters and views; on one actor's or one country's page, the datasets, the
    items over time and the tools. Without JavaScript the plain page stays."""
    out = ["```{=html}"]
    if key:
        out += ['<div class="pv-ma-one" data-%s="%s" data-monitor="../data/monitor.json"></div>' % (kind, key)]
    else:
        out += ['<div id="ma-app" class="pv-wc pv-ma" data-kind="%s" data-monitor="../data/monitor.json"%s>' % (
            kind, ' data-map="../data/world.json"' if world else ""),
            '  <p class="pv-lib-loading">Loading…</p>', "</div>"]
    if world:
        out += ['<script src="../data/vendor/d3.min.js" defer></script>',
                '<script src="../data/vendor/topojson-client.min.js" defer></script>']
    out += ['<script src="../data/pv-data.js" defer></script>',
            '<script src="../data/monitor-pages.js" defer></script>', "```", ""]
    return out


POWER_WORDS = {
    "leads": "Leads the government today.",
    "partner": "In the government today, as a partner.",
    "supports": "Supports the government from outside today.",
}


def dataset_words(actors):
    """What the datasets say about each actor, in short, for the cards: read from
    data/who-counts.json (written by scripts/make_data.py). Every verdict is the
    dataset's own. Without that file the cards show none."""
    import json
    path = os.path.join(ROOT, "data", "who-counts.json")
    if not os.path.exists(path):
        return {}
    by = {r["id"]: r for r in json.loads(read(path))["rows"]}
    out = {}
    for a in actors:
        r = by.get(a.get("data_id", ""))
        if not r:
            continue
        party = r
        if r["k"] == "leader":
            party = by.get(r["parties"][-1]) if r.get("parties") else None
        d = {}
        if party and party.get("pl"):
            best = "Not populist"
            for e in party["pl"]:
                p = e["sets"].get("p")
                if not (p and p["y"]):
                    continue
                if p["y"][1] < 2026:
                    word = "Populist until %d" % p["y"][1]
                else:
                    nb = p.get("nb")
                    word = "Populist" if nb and nb[0] <= 2026 <= nb[1] else "Borderline"
                if best == "Not populist" or word == "Populist" or (word == "Borderline" and best != "Populist"):
                    best = word
            d["pl"] = best
        if r["k"] == "leader" and r.get("gd"):
            t = r["gd"][-1]
            d["gd"] = [t[3][:4] if t[3] else t[1], t[4][:4] if t[4] else None, t[5], t[6], t[10]]
        last = None
        for v in (party or {}).get("vp", []):
            for e in v["el"]:
                if e[1] is not None and (not last or e[0] >= last[0]):
                    last = e
        if last:
            d["vp"] = [last[0], last[1]]
        out[a["id"]] = d
    return out


def write_monitor_json(issues, items, actors, iso_of, country=None, places=None):
    """The Monitor's part of the data pages. Written again at every build."""
    import json
    last = issues[-1] if issues else None
    words = dataset_words(actors)
    country = country or {}
    data = {
        "issue": last["number"] if last else "",
        "folder": last["folder"] if last else "",
        "actors": [{
            "id": a["id"], "name": a["name"], "kind": a["kind"], "iso": iso_of.get(a["country"], ""),
            "data": a.get("data_id", ""), "power": a.get("in_power", ""), "why": a.get("in_power_source", ""),
            # The source that classes the actor, shown beside "in power today" on the data pages
            "src": a.get("source", ""), "bl": 1 if a.get("borderline", "") == "yes" else 0,
            # For the cards of "Actors in Monitor": the country in words, and the datasets in short
            "tag": a["country"], "c": country.get(a["country"], a["country"]), "ds": words.get(a["id"], {}),
            "items": sum(1 for it in items if a["id"] in it["actors"]),
        } for a in actors],
        # An item: its issue and number, title, type, date (and end date where the
        # tags give one), countries, actors, and whether it is a full item or a
        # one-line entry
        "items": [dict({
            "issue": it["issue"], "folder": it["folder"], "n": it["n"], "title": it["title"],
            "type": it["type"], "date": it["date"], "iso": [iso_of[c] for c in it["countries"] if c in iso_of],
            "actors": it["actors"], "k": it["kind"],
        }, **({"de": it["date_end"]} if it["date_end"] else {}),
            **({"s": it["sentence"]} if it.get("sentence") else {})) for it in items],
        # The countries of the Monitor, for the map and the cards: name, number on the map,
        # region, place, whether it is too small for the map, and the name of its page
        "places": {r["iso3"]: [r["label"], r["num"], r["region"], float(r["lon"]) if r["lon"] else None,
                               float(r["lat"]) if r["lat"] else None, 1 if r["dot"] == "1" else 0, r["tag"]]
                   for r in (places or [])},
    }
    write_data("monitor.json", json.dumps(data, ensure_ascii=False, separators=(",", ":")))


def write_data(name, text):
    """A file in data/, written again at every build, and its copy in a built site.

    In a preview Quarto does not copy such a file into the built site again, so
    the pages there would read the copy of the last full build. Where a built
    site exists, its copy is brought up to date here."""
    path = os.path.join(ROOT, "data", name)
    if not os.path.exists(path) or read(path) != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    built = os.path.join(ROOT, "_site", "data", name)
    if os.path.isdir(os.path.dirname(built)) and (not os.path.exists(built) or read(built) != text):
        with open(built, "w", encoding="utf-8") as f:
            f.write(text)


def write_events_csv(items, by_id, country, iso_of):
    """The whole events dataset, one row per item of the Monitor.

    Nothing but its rows, so that it opens straight in R, Python, Stata or a
    spreadsheet. The date is the day of the action that gives the type; where an
    item carries a month and no day, date_precision says so."""
    import io
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(["issue", "item", "date", "date_end", "date_precision", "type", "family",
                "countries", "country_codes", "actors", "item_kind", "heading", "link"])
    for it in sorted(items, key=sort_key):
        # A full item's heading is its title. A one-line entry's title is only the
        # place, so its own sentence stands with it.
        heading = it["title"]
        if it["kind"] == "entry" and it.get("sentence"):
            heading += ". " + it["sentence"]
        w.writerow([
            it["issue"], it["n"], it["date"], it["date_end"],
            "month" if len(it["date"]) == 7 else "day",
            it["type"], family(it["type"]),
            "; ".join(country.get(c, c) for c in it["countries"]),
            "; ".join(iso_of[c] for c in it["countries"] if c in iso_of),
            "; ".join(by_id[a]["name"] if a in by_id else a for a in it["actors"]),
            "one-line entry" if it["kind"] == "entry" else "full item",
            heading,
            "https://populiverse.com/monitor/%s/#item-%d" % (it["folder"], it["n"]),
        ])
    write_data("events.csv", out.getvalue())


def main():
    country, region_of, region = taxonomy_names()
    actors = rows(os.path.join(ROOT, "monitor", "actors.csv"))
    by_id = {a["id"]: a for a in actors}
    issues = published_issues()
    items = [it for iss in issues for it in iss["items"]]
    places = os.path.join(ROOT, "data", "countries.csv")
    iso_of = {r["tag"]: r["iso3"] for r in rows(places)} if os.path.exists(places) else {}
    latest = "PopuliVerse Monitor " + issues[-1]["number"] if issues else "the Monitor"

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
        ]
        if a.get("in_power") in POWER_WORDS:
            body += [POWER_WORDS[a["in_power"]] + " As of " + latest + ".", ""]
        body += app("actor", a["id"])
        body += ["## In the Monitor", ""] + items_part(mine) + [
            "",
            "## In the Library",
            "",
            lib,
            "",
            "## In the Data",
            "",
        ]
        if a.get("data_id"):
            body += ["- [What the datasets say](../data/who-counts.html#%s)" % a["data_id"]]
        else:
            body += ["- No dataset holds this actor yet. See [Who Counts as Populist?](../data/who-counts.qmd)"]
        if a["country"] in iso_of:
            body += ["- [%s in Populists in Power](../data/in-power.html#%s)" % (land, iso_of[a["country"]])]
        files[a["id"] + ".qmd"] = page(a["name"], "What PopuliVerse Monitor reported on %s." % a["name"], body)
        listing.append("- [%s](%s.qmd), %s. %d %s." % (a["name"], a["id"], land, len(mine), "item" if len(mine) == 1 else "items"))
    files["index.qmd"] = page("Actors in Monitor", "The populist actors in PopuliVerse Monitor: why each is on the list, what the datasets say and what the Monitor reported.", [
        "::: {.pv-prose .pv-data-lede}",
        "Every actor that has stood in an issue of Populi*Verse* Monitor, with why it is on the list, what the datasets say about it and what the Monitor reported. "
        "The Monitor covers an actor when a dataset or a publication classifies it as populist. "
        "See [the rules](../monitor/rules.qmd#who).",
        ":::",
        "",
    ] + app("actors") + ["## All Actors, A to Z {#all}", ""] + listing, wide=True)
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
        if c in iso_of:
            body += app("country", iso_of[c])
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
    files["index.qmd"] = page("Countries in Monitor", "The countries in PopuliVerse Monitor: the actors followed in each, who holds power today and what the Monitor reported.", [
        "::: {.pv-prose .pv-data-lede}",
        "Every country that has stood in an issue of Populi*Verse* Monitor, with the actors followed there, who of them holds power today and what the Monitor reported.",
        ":::",
        "",
    ] + app("countries", world=True) + ["## All Countries, A to Z {#all}", ""] + listing, wide=True)
    write_all(written, os.path.join(ROOT, "countries"), files)

    remove_old(os.path.join(ROOT, "actors"), written)
    remove_old(os.path.join(ROOT, "countries"), written)
    place_rows = [r for r in (rows(os.path.join(ROOT, "data", "countries.csv")) if iso_of else []) if r["tag"] in places]
    write_monitor_json(issues, items, actors, iso_of, country, place_rows)
    write_events_csv(items, by_id, country, iso_of)
    note("%d issues, %d items, %d actor pages, %d country pages." % (len(issues), len(items), len(actors), len(places)))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # the site is still built; the note says what went wrong
        note("the actor and country pages could not be written: %s" % e)
        sys.exit(0)
