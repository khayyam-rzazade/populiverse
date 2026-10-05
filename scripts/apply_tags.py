# PopuliVerse Library: add the tags worked out by hand for the untagged works.
#
# 454 works carried an abstract but no tag at all, so they were invisible to
# every filter on the Library page. Each was read and coded by hand. This
# script writes those tags onto the Zotero items.
#
# It only ADDS. Existing tags on an item are kept, and a tag already there is
# not written twice. Works coded "X" - the ones that do not belong in the
# Library, or whose abstract field holds the wrong text - are left alone: they
# need your decision, not a tag.
#
#   python3 scripts/apply_tags.py                        # look only
#   ZOTERO_API_KEY=... python3 scripts/apply_tags.py --apply
#
# Check library/tag-additions-review.csv first. It has one line per work with
# the year, journal, title, how it was coded, and the tags proposed. Delete a
# line from library/tag-additions.json to skip that work.

import json, os, sys, time, urllib.error, urllib.request

GROUP = 6697881
API = f"https://api.zotero.org/groups/{GROUP}"
DATA = os.path.join(os.path.dirname(__file__), "..", "library", "tag-additions.json")


def fetch_all():
    out, start = {}, 0
    while True:
        req = urllib.request.Request(f"{API}/items?limit=100&start={start}",
                                     headers={"Zotero-API-Version": "3"})
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.load(r)
        if not batch:
            break
        for it in batch:
            out[it["key"]] = (it["version"], [t["tag"] for t in it["data"].get("tags", [])])
        start += 100
        sys.stderr.write(f"\r  read {start}")
        sys.stderr.flush()
    sys.stderr.write("\n")
    return out


def main():
    apply = "--apply" in sys.argv
    key = os.environ.get("ZOTERO_API_KEY")
    if apply and not key:
        sys.exit("--apply needs ZOTERO_API_KEY set. Nothing was changed.")

    plan = json.load(open(DATA, encoding="utf-8"))
    print(f"Reading group {GROUP}\u2026")
    live = fetch_all()

    jobs, gone, already, skipped = [], [], 0, 0
    for row in plan:
        if not row["tags"]:
            skipped += 1
            continue
        if row["id"] not in live:
            gone.append(row["id"])
            continue
        version, have = live[row["id"]]
        add = [t for t in row["tags"] if t not in have]
        if not add:
            already += 1
            continue
        jobs.append((row["id"], version, sorted(set(have) | set(add)), add))

    print(f"\n  works in the plan            {len(plan)}")
    print(f"  left alone (coded X)         {skipped}")
    print(f"  already carry their tags     {already}")
    print(f"  to be changed                {len(jobs)}")
    if gone:
        print(f"  no longer in the group       {len(gone)}  ({', '.join(gone[:5])}\u2026)")
    print(f"  tags to add in total         {sum(len(j[3]) for j in jobs)}")

    if not apply:
        print("\nLook only. Re-run with --apply, and ZOTERO_API_KEY set, to write them.")
        return

    print("\nWriting\u2026")
    ok = bad = 0
    for k, version, full, add in jobs:
        try:
            req = urllib.request.Request(
                f"{API}/items/{k}",
                data=json.dumps({"tags": [{"tag": t} for t in full]}).encode(),
                method="PATCH",
                headers={"Zotero-API-Version": "3", "Zotero-API-Key": key,
                         "If-Unmodified-Since-Version": str(version),
                         "Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=60).read()
            ok += 1
            if ok % 25 == 0:
                print(f"  {ok} done\u2026")
        except urllib.error.HTTPError as e:
            bad += 1
            why = "edited since it was read" if e.code == 412 else f"HTTP {e.code}"
            print(f"  FAILED  {k}  {why}")
        time.sleep(0.2)
    print(f"\n{ok} works tagged, {bad} failed.")
    if ok:
        print("Run Sync Library on GitHub to see them on the site.")


if __name__ == "__main__":
    main()
