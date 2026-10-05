# East European Politics and Societies: put the right name on each item.
#
# This journal is not a spelling problem, it is a renaming, so the right name
# depends on the year the article came out:
#
#     up to 2011   East European Politics and Societies
#     2012-2024    East European Politics and Societies and Cultures
#     2025 on      East European Politics and Societies
#
# Many items also carry "East European Politics and Societies: and Cultures",
# with a colon, which is not a name the journal ever used. It comes from the
# publisher's metadata.
#
# tidy_journals.py cannot do this, because it gives one name to a whole journal.
#
#   python3 scripts/fix_eeps.py                      # look only
#   ZOTERO_API_KEY=... python3 scripts/fix_eeps.py --apply
#
# "East European Politics", a different journal, is left alone.

import json, os, re, sys, time, urllib.error, urllib.request

GROUP = 6697881
API = f"https://api.zotero.org/groups/{GROUP}"
PLAIN = "East European Politics and Societies"
CULTURES = "East European Politics and Societies and Cultures"


def right_name(year):
    return CULTURES if year and 2012 <= year <= 2024 else PLAIN


def main():
    apply = "--apply" in sys.argv
    key = os.environ.get("ZOTERO_API_KEY")
    if apply and not key:
        sys.exit("--apply needs ZOTERO_API_KEY set. Nothing was changed.")

    print("Reading group\u2026")
    rows, start = [], 0
    while True:
        req = urllib.request.Request(
            f"{API}/items?itemType=journalArticle&limit=100&start={start}",
            headers={"Zotero-API-Version": "3"})
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.load(r)
        if not batch:
            break
        for it in batch:
            name = (it["data"].get("publicationTitle") or "").strip()
            low = name.lower()
            # the journal, in any of its spellings; not "East European Politics"
            if low.startswith("east european politics and societies") or \
               low.startswith("east european politics & societies"):
                m = re.search(r"\b(1[89]|20)\d{2}\b", it["data"].get("date", "") or "")
                rows.append((it["key"], it["version"], name,
                             int(m.group(0)) if m else None))
        start += 100
        sys.stderr.write(f"\r  read {start}")
        sys.stderr.flush()
    sys.stderr.write("\n")

    jobs = [(k, v, n, right_name(y), y) for k, v, n, y in rows if n != right_name(y)]
    noyear = [r for r in rows if r[3] is None]

    print(f"\n{len(rows)} item(s) in this journal. {len(jobs)} to change.\n")
    for k, v, n, want, y in sorted(jobs, key=lambda x: (x[4] or 0)):
        print(f"  {y}  {k}  {n}\n            -> {want}")
    if noyear:
        print(f"\n{len(noyear)} item(s) have no year in Zotero and were treated as "
              f"pre-2012. Check them: " + ", ".join(r[0] for r in noyear))

    if not jobs:
        print("Nothing to do.")
        return
    if not apply:
        print("\nLook only. Re-run with --apply, and ZOTERO_API_KEY set, to change them.")
        return

    print("\nWriting\u2026")
    ok = bad = 0
    for k, v, n, want, y in jobs:
        try:
            req = urllib.request.Request(
                f"{API}/items/{k}", data=json.dumps({"publicationTitle": want}).encode(),
                method="PATCH",
                headers={"Zotero-API-Version": "3", "Zotero-API-Key": key,
                         "If-Unmodified-Since-Version": str(v),
                         "Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=60).read()
            ok += 1
            print(f"  ok      {k}  {y}  -> {want}")
        except urllib.error.HTTPError as e:
            bad += 1
            why = "edited since it was read" if e.code == 412 else f"HTTP {e.code}"
            print(f"  FAILED  {k}  {why}")
        time.sleep(0.2)
    print(f"\n{ok} changed, {bad} failed.")


if __name__ == "__main__":
    main()
