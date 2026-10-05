# PopuliVerse Library: tidy the journal names in the Zotero group.
#
# The same journal sometimes arrives under more than one spelling, because the
# name comes from whatever the publisher sent to Crossref: a leading "The", an
# ampersand instead of "and", a stray ALL-CAPS, a "JCMS:" prefix. On the Library
# page each spelling then shows as a separate choice in the Journal filter, and
# the works are split between them.
#
# The script does the finding and the typing. It does not decide which spelling
# is right: that is the journal's real name, which no rule can work out from the
# library itself. So it works in two steps.
#
#   python3 scripts/tidy_journals.py                     # 1. find them, write the list
#   (open library/journal-names.yml and set each "keep")
#   ZOTERO_API_KEY=... python3 scripts/tidy_journals.py --apply   # 2. make the changes
#
# Reading the group needs no key. Writing does: make one at zotero.org/settings/keys
# with write access to the group, and pass it on the command line as above so it
# stays on your own machine and out of the repository.
#
# Run step 1 again whenever you like. Journals already settled in the file keep
# their decision; only new ones come up blank.

import collections, json, os, re, sys, time
import urllib.error, urllib.request

GROUP = 6697881
API = f"https://api.zotero.org/groups/{GROUP}"
LIST = os.path.join(os.path.dirname(__file__), "..", "library", "journal-names.yml")

# Journals that share a stem but are not the same journal.
KEEP_APART = {"east european politics"}


def canon(s):
    s = s.lower().strip()
    s = re.sub(r"^[a-z]{3,6}\s*:\s*", "", s)
    s = s.replace("&", " and ")
    s = re.sub(r"^the\s+", "", s)
    s = re.sub(r"\s*[:\-\u2013]\s*(and\s+)?cultures?$", "", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def fetch_all():
    out, start = [], 0
    while True:
        req = urllib.request.Request(
            f"{API}/items?itemType=journalArticle&limit=100&start={start}",
            headers={"Zotero-API-Version": "3"})
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.load(r)
        if not batch:
            break
        out.extend(batch)
        start += 100
        sys.stderr.write(f"\r  read {len(out)} items")
        sys.stderr.flush()
    sys.stderr.write("\n")
    return out


def read_list():
    """The decisions already made. Plain parsing: no yaml package needed."""
    done = {}
    if not os.path.exists(LIST):
        return done
    key = None
    for line in open(LIST, encoding="utf-8"):
        m = re.match(r"^- group:\s*(.+?)\s*$", line)
        if m:
            key = m.group(1)
            continue
        m = re.match(r"^\s+keep:\s*(.*?)\s*$", line)
        if m and key:
            v = m.group(1).strip().strip('"')
            done[key] = v if v and v != "?" else None
    return done


def write_list(groups, done):
    lines = [
        "# Journal names that arrived in more than one spelling.",
        "#",
        "# Set \"keep\" to the journal's real name, as the journal itself writes it.",
        "# Do not go by whichever spelling is commoner here: that only shows how the",
        "# metadata happened to land. Leave keep as ? to pass a journal over for now.",
        "#",
        "# Then: ZOTERO_API_KEY=... python3 scripts/tidy_journals.py --apply",
        "",
    ]
    todo = 0
    for c in sorted(groups):
        names = collections.Counter(r[2] for r in groups[c])
        if len(names) < 2:
            continue
        keep = done.get(c)
        if keep is None:
            todo += 1
        lines.append(f"- group: {c}")
        lines.append(f"  keep: {keep if keep else '?'}")
        for n, ct in names.most_common():
            lines.append(f"  # {ct:>3}x  {n}")
        lines.append("")
    with open(LIST, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return todo


def patch(k, version, name, api_key):
    req = urllib.request.Request(
        f"{API}/items/{k}", data=json.dumps({"publicationTitle": name}).encode(),
        method="PATCH",
        headers={"Zotero-API-Version": "3", "Zotero-API-Key": api_key,
                 "If-Unmodified-Since-Version": str(version),
                 "Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=60).read()


def main():
    apply = "--apply" in sys.argv
    api_key = os.environ.get("ZOTERO_API_KEY")
    if apply and not api_key:
        sys.exit("--apply needs ZOTERO_API_KEY set. Nothing was changed.")

    print(f"Reading group {GROUP}\u2026")
    groups = collections.defaultdict(list)
    for it in fetch_all():
        name = (it["data"].get("publicationTitle") or "").strip()
        c = canon(name)
        if name and c not in KEEP_APART:
            groups[c].append((it["key"], it["version"], name))
    groups = {c: r for c, r in groups.items() if len({x[2] for x in r}) > 1}

    done = read_list()

    if not apply:
        todo = write_list(groups, done)
        path = os.path.normpath(LIST)
        print(f"\n{len(groups)} journal(s) with more than one spelling.")
        print(f"Written to {path}")
        if todo:
            print(f"{todo} still need a decision: open the file and set each \"keep\".")
        else:
            print("All decided. Re-run with --apply to make the changes.")
        return

    jobs, odd = [], []
    for c, rows in groups.items():
        keep = done.get(c)
        if not keep:
            continue
        if keep not in {n for _, _, n in rows}:
            # Not a typo as such: it may be a name you are correcting to. But a
            # slip here would write a wrong name onto every item in the group,
            # so it is said out loud first.
            odd.append((c, keep, sorted({n for _, _, n in rows})))
        jobs += [(k, v, n, keep) for k, v, n in rows if n != keep]

    if odd:
        print("\nCheck these: the name you chose is not one of the spellings found.")
        for c, keep, seen in odd:
            print(f"   {c}\n     you wrote: {keep}")
            for s in seen:
                print(f"     found:     {s}")
        if "--force" not in sys.argv:
            sys.exit("\nNothing was changed. Re-run with --force if those are right.")
    if not jobs:
        sys.exit("No decisions set yet. Run without --apply first, then fill in the file.")

    print(f"\n{len(jobs)} item(s) to change.\n")
    ok = bad = 0
    for k, v, name, keep in jobs:
        try:
            patch(k, v, keep, api_key)
            ok += 1
            print(f"  ok      {k}  {name}  ->  {keep}")
        except urllib.error.HTTPError as e:
            bad += 1
            why = "edited since it was read" if e.code == 412 else f"HTTP {e.code}"
            print(f"  FAILED  {k}  {why}")
        time.sleep(0.2)
    print(f"\n{ok} changed, {bad} failed.")
    if ok:
        print("The site shows it after tonight's sync, or run Sync Library on GitHub now.")


if __name__ == "__main__":
    main()
