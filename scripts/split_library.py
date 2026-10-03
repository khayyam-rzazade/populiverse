#!/usr/bin/env python3
"""PopuliVerse Library: makes the two lighter files that the Library page loads.

The nightly sync writes library/library.json: every work with everything about
it, about 21 MB. A reader should not wait for all of that before seeing the
list. So this script cuts the file in two:

  library/library-list.json   the list itself: titles, authors, journals, tags
                              and citations. The page loads it first.
  library/library-text.json   the abstracts and the BibTeX entries. The page
                              loads it second, in the background.

It also writes library/_figures.md: the row of figures shown on the Home page
(how many works, journals and countries, the share with an abstract and the
share that is free to read, and the day of the last update). The Home page
takes that file in when the site is built, so the figures are counted from the
Library itself and are never typed by hand.

library.json itself is not changed. The nightly job runs this script right
after the sync (see .github/workflows/sync.yml). To run it by hand, from the
folder of the repository:   python3 scripts/split_library.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(HERE, "library", "library.json")
LIST = os.path.join(HERE, "library", "library-list.json")
TEXT = os.path.join(HERE, "library", "library-text.json")
HEAVY = ("abstract", "bibtex")          # what moves to the second file


def write(path, data):
    # No spaces and no line breaks: the file is read by the page, not by people.
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(path + ".tmp", path)     # the old file is replaced only when the new one is complete
    return len(text.encode("utf-8"))


FIGURES = os.path.join(HERE, "library", "_figures.md")
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def figures_text(entries, meta):
    """The row of figures for the Home page, counted from the works themselves."""
    works = len(entries)
    journals = len({(e.get("container") or "").strip().lower() for e in entries
                    if e.get("type") == "type:article" and (e.get("container") or "").strip()})
    countries = len({c for e in entries for c in (e.get("country") or [])})
    with_abstract = sum(1 for e in entries if e.get("abstract"))
    free = sum(1 for e in entries if e.get("oa") is True)
    share = lambda n: "%d%%" % round(100.0 * n / works)
    day = ""
    stamp = str(meta.get("updated") or "")          # for example 2026-10-02T19:56:48Z
    if len(stamp) >= 10 and stamp[4] == "-" and stamp[7] == "-":
        day = "Updated %d %s %s. " % (int(stamp[8:10]), MONTHS[int(stamp[5:7]) - 1], stamp[0:4])
    return "\n".join([
        "<!-- Written by scripts/split_library.py after every sync of the Library.",
        "     Do not change it by hand: the next sync writes it again. -->",
        "::: {.pv-figures}",
        "%s works · %s journals · %d countries · %s with an abstract · %s free to read"
        % (format(works, ","), format(journals, ","), countries, share(with_abstract), share(free)),
        "",
        day + "New works are added every month.",
        ":::",
        "",
    ])


def main():
    with open(SOURCE, encoding="utf-8") as f:
        full = json.load(f)
    entries = full.get("entries", [])
    ids = [e.get("id") for e in entries]
    if not entries or any(not i for i in ids) or len(set(ids)) != len(ids):
        sys.exit("split_library: library.json has no works, or a work without an id, or an id twice. Nothing written.")

    light, heavy = [], {}
    for e in entries:
        item = {k: v for k, v in e.items() if k not in HEAVY}
        item["has_abstract"] = bool(e.get("abstract"))
        item["has_bibtex"] = bool(e.get("bibtex"))
        light.append(item)
        if item["has_abstract"] or item["has_bibtex"]:
            heavy[e["id"]] = {k: e.get(k) or "" for k in HEAVY}

    meta = full.get("meta", {})
    a = write(LIST, {"meta": meta, "taxonomy": full.get("taxonomy", {}), "entries": light})
    b = write(TEXT, {"meta": {"updated": meta.get("updated"), "count": len(heavy)}, "text": heavy})
    with open(FIGURES, "w", encoding="utf-8") as f:
        f.write(figures_text(entries, meta))
    print("split_library: %d works. library-list.json %.1f MB, library-text.json %.1f MB (library.json %.1f MB)."
          % (len(light), a / 1e6, b / 1e6, os.path.getsize(SOURCE) / 1e6))


if __name__ == "__main__":
    main()
