#!/usr/bin/env python3
"""The data behind "Who Counts as Populist?" and "Populists in Power".

Run by hand, only when one of the datasets below comes out in a new version
(about once a year), or when data/links.csv changes. It is not run at every
build: GitHub never sees the datasets, which stay in the drafts folder. It
writes three files that the site uses as they are:

  data/who-counts.json   every party and leader the datasets hold, with each
                         dataset's own verdict, years and scores
  data/in-power.json     governments and heads of government by country and year
  data/sources.txt       the datasets, how to cite them, their licences

What it reads (all in drafts/, none of it public):
  The PopuList 4.0.csv            The PopuList, from its GitHub repository
  vparty-v2.csv                   V-Party (V-Dem), the columns used here, taken
                                  from the R package vdemdata version 16 with
                                  base R: write.csv(vparty[, columns], ...)
  GPD_v2.1_20251120_Wide.csv      Global Populism Database 2.1 (Dataverse)
  ppeg_gov_2025v1.csv             PPEG 2025v1, governments (Dataverse)
  external-parties.csv            Party Facts, Version 2023 (Dataverse)
and from the repository:
  data/countries.csv              country codes, the Library's names and regions
  data/links.csv                  the checked list of links (see below)
  scripts/partyfacts-gpd.csv      Party Facts' list of the parties of the Global
                                  Populism Database (from Party Facts' GitHub)

The rules (master plan, section 18, rows of 2026-11-12):
  * Every verdict is the dataset's own, in its own words. For the Global
    Populism Database these are the four bands of its authors' paper (Hawkins
    et al. 2019) for the average of a term: not populist below 0.5, somewhat
    populist 0.5 to 0.99, populist 1.0 to 1.49, very populist from 1.5.
  * Datasets are linked through Party Facts IDs. Where The PopuList and another
    dataset give one party two IDs or none, or an ID in a source is wrong, the
    checked list data/links.csv says so, one line for each case with its
    reason. The list is used only where The PopuList itself holds the party.
    It is never used to call a party "not populist". Every use is marked on
    the pages and in the downloads.
  * "Not covered" is never "not populist".
  * A borderline year of The PopuList is shown as borderline. On the map it is
    a state of its own.
  * A leader counts as leading the government only where he or she heads it:
    the president where PPEG marks a presidential cabinet, the prime minister
    elsewhere. Outside PPEG's countries every leader of the database counts.
  * V-Party gives a score and no category, so it is shown and never counted.
  * The Global Party Survey 2019 is taken as V-Party carries it.

Only Python's own parts are used, nothing to install.
"""

import csv
import datetime
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRAFTS = os.path.join(ROOT, "drafts")
OUT = os.path.join(ROOT, "data")

FIRST_YEAR = 1990            # the first year on the map
PPEG_END = "2025-10-31"      # PPEG 2025v1 holds governments to this day
GPD_END = "2025-11-20"       # the date of the Global Populism Database 2.1 files
POPULIST_FROM = 1989         # The PopuList covers elections from 1989
POPULIST_TO = 2026           # The PopuList 4.0 runs to 1 June 2026


# Names that stand for no party: independents, non-partisans, "others"
NO_PARTY = re.compile(r"^\s*(alliance:\s*)?(independents?|independent candidates|non-?partisans?|others?|none)\s*(\(.*\))?\s*$", re.I)


def note(msg):
    print("make_data: " + msg)


def table(path, delimiter=",", encoding="utf-8"):
    with open(path, encoding=encoding, newline="") as f:
        return list(csv.DictReader(f, delimiter=delimiter))


def num(s):
    s = (s or "").strip()
    if s in ("", "NA", "NaN"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def whole(s):
    v = num(s)
    return None if v is None else int(round(v))


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def r3(v):
    return None if v is None else round(v, 3)


# ---------------------------------------------------------------- countries

def countries():
    rows = table(os.path.join(OUT, "countries.csv"))
    by3 = {r["iso3"]: r for r in rows}
    byname = {slug(r["label"]): r["iso3"] for r in rows}
    # The names the datasets use where they differ from the Library's
    for name, code in {
        "czechia": "CZE", "uk": "GBR", "usa": "USA", "the-bahamas": "BHS",
    }.items():
        byname[name] = code
    return by3, byname


def iso3_of(name, byname):
    return byname.get(slug(name or ""))


# ---------------------------------------------------------------- the checked list of links

def read_links():
    """data/links.csv, one line for each case. The kinds:
      id         The PopuList's entry stands under this Party Facts ID (the ID in
                 its file is wrong or missing)
      also       the entry stands under this ID too (the same party under an
                 earlier or later name)
      ppeg       this party in PPEG is this entry of The PopuList (PPEG gives it
                 no code that leads there)
      ppeg_none  this party in PPEG is not the entry that its ID would lead to
      gpd        the party of a leader in the Global Populism Database stands
                 under this Party Facts ID (Party Facts' own link is wrong)
    """
    rows = table(os.path.join(OUT, "links.csv"))
    kinds = {"id", "also", "ppeg", "ppeg_none", "gpd"}
    for i, r in enumerate(rows):
        if r["kind"] not in kinds:
            sys.exit("make_data: data/links.csv, line %d: the kind '%s' is not known." % (i + 2, r["kind"]))
        r["n"] = i + 1                       # its number in the list, as the pages show it
        r["used"] = False
    return rows


# ---------------------------------------------------------------- The PopuList

def span(start, end):
    """The PopuList writes 1900 for "from the start" and 2100 for "until now" (and
    2100 for both when a mark never applies); years are kept as given."""
    s, e = whole(start), whole(end)
    if s is None or e is None:
        return None
    return [s, e]


def popu_list(byname, links):
    rows = table(os.path.join(DRAFTS, "The PopuList 4.0.csv"), delimiter=";", encoding="utf-8-sig")
    out = []
    seen = set()
    for r in rows:
        iso = iso3_of(r["country_name"], byname)
        sets = {}
        for key, name in (("populist", "p"), ("farright", "fr"), ("farleft", "fl"), ("eurosceptic", "eu")):
            if r.get(key, "").strip() == "1":
                sets[name] = {
                    "y": span(r[key + "_start"], r[key + "_end"]),
                    "nb": span(r[key + "_startnobl"], r[key + "_endnobl"]),
                    "bl": 1 if r.get(key + "_bl", "").strip() == "1" else 0,
                }
        short = r["party_name_short"].strip()
        if (iso, short) in seen:
            sys.exit("make_data: The PopuList has two entries '%s' in %s; data/links.csv could not tell them apart." % (short, iso))
        seen.add((iso, short))
        e = {
            "name": r["party_name"].strip(),
            "en": r["party_name_english"].strip(),
            "short": short,
            "iso": iso,
            "country": r["country_name"].strip(),
            "pf": whole(r["partyfacts_id"]),
            "ids": [],                       # every Party Facts ID the entry stands under
            "parl": 1 if r.get("in_parliament", "").strip() == "1" else 0,
            "sets": sets,
            "lk": {},                        # ID -> the number of the line in links.csv that gives it
        }
        for L in links:
            if L["kind"] in ("id", "also") and L["country"] == iso and L["popu_list"] == short:
                L["used"] = True
                pf = int(L["party_facts_id"])
                if L["kind"] == "id":
                    L["was"] = e["pf"]
                    e["pf"] = pf
                e["lk"][pf] = L["n"]
                if L["kind"] == "also":
                    e["ids"].append(pf)
        if e["pf"]:
            e["ids"].insert(0, e["pf"])
        out.append(e)
    return out


def popu_state(entries, year):
    """The PopuList's own verdict for a year: 2 populist, 1 borderline populist,
    0 not populist, None not covered. A party can have more than one entry under
    one Party Facts ID; the strongest of them counts."""
    if year < POPULIST_FROM or year > POPULIST_TO:
        return None
    best = 0
    for e in entries:
        p = e["sets"].get("p")
        if not (p and p["y"] and p["y"][0] <= year <= p["y"][1]):
            continue
        nb = p.get("nb")
        full = bool(nb) and nb[0] < 2100 and nb[0] <= year <= nb[1]
        best = max(best, 2 if full else 1)
    return best


def popu_verdict(entries, year):
    """Yes (1) or no (0) for the mark: a borderline year counts as populist, as its label says."""
    s = popu_state(entries, year)
    return None if s is None else (1 if s >= 1 else 0)


# ---------------------------------------------------------------- V-Party, with the Global Party Survey

def v_party():
    rows = table(os.path.join(DRAFTS, "vparty-v2.csv"))
    parties = {}
    for r in rows:
        pid = r["v2paid"]
        p = parties.setdefault(pid, {
            "id": pid, "pf": whole(r["pf_party_id"]), "iso": r["country_text_id"],
            "country": r["country_name"], "en": r["v2paenname"].strip(),
            "short": r["v2pashname"].strip(), "name": (r.get("v2paorname") or "").strip(),
            "el": [], "gps": None,
        })
        score = num(r["v2xpa_popul"])
        year = whole(r["year"])
        if score is not None:
            p["el"].append([year, r3(score), r3(num(r["v2xpa_popul_codelow"])),
                            r3(num(r["v2xpa_popul_codehigh"])), r3(num(r["v2pavote"])),
                            whole(r["v2pagovsup"])])
        t = whole(r["ep_type_populism"])
        if t is not None:
            # The survey asked in 2019; V-Party sets its answer on the party's last election before it.
            p["gps"] = {"t": t, "rh": r3(num(r["ep_v8_popul_rhetoric"])),
                        "sal": r3(num(r["ep_v9_popul_saliency"])), "at": year}
    for p in parties.values():
        p["el"].sort()
    return parties


def gps_verdict(g, year):
    if not g or year != 2019:
        return None
    return 1 if g["t"] >= 3 else 0


# ---------------------------------------------------------------- Global Populism Database

def date_of(s):
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", (s or "").strip())
    if not m:
        return None
    return "%04d-%02d-%02d" % (int(m.group(3)), int(m.group(1)), int(m.group(2)))


def band(avg):
    """The four bands of Hawkins et al. 2019 for the average of a term:
    0 not populist (below 0.5), 1 somewhat populist (0.5 to 0.99),
    2 populist (1.0 to 1.49), 3 very populist (1.5 and higher)."""
    if avg is None:
        return None
    return 3 if avg >= 1.5 else (2 if avg >= 1.0 else (1 if avg >= 0.5 else 0))


def gpd(byname, gpd_links):
    rows = table(os.path.join(DRAFTS, "GPD_v2.1_20251120_Wide.csv"))
    leaders = {}
    for r in rows:
        iso = iso3_of(r["country"], byname)
        key = (r["country"], r["leader"])
        L = leaders.setdefault(key, {
            "name": r["leader"].strip(), "country": r["country"].strip(), "iso": iso, "terms": [],
        })
        avg = num(r["totalaverage"])
        start, end = date_of(r["startofterm"]), date_of(r["endofterm"])
        current = r["yearend"].strip().lower() == "current"
        yb = whole(r["yearbegin"])
        ye = 2025 if current else whole(r["yearend"])
        speeches = [r3(num(r[k + "_average"])) for k in ("campaign", "famous", "international", "ribbon")]
        # Party Facts' entries for independents are technical; a leader without a party is not linked
        link = None if NO_PARTY.search(r["party"]) else gpd_links.get((iso, slug(r["party"])))
        L["terms"].append({
            "n": whole(r["term"]), "yb": yb, "ye": ye, "start": start,
            "end": None if current else end, "current": current,
            "avg": r3(avg), "g": band(avg), "sp": speeches, "party": r["party"].strip(),
            "pf": link[0] if link else None, "lk": link[1] if link else 0,
            "pres": 1 if r["president"].strip() == "1" else 0,
        })
    for L in leaders.values():
        L["terms"].sort(key=lambda t: (t["yb"] or 0, t["n"] or 0))
        L["president"] = any(t["pres"] for t in L["terms"])
    return leaders


def gpd_party_links(byname, links):
    """Party Facts links the parties of the Global Populism Database by its own list
    (country, party, years) and an ID made of them. Both files come from Party Facts.
    A line of the kind "gpd" in data/links.csv puts a wrong link right.
    Gives (country, party) -> (Party Facts ID, the number of the line in links.csv or 0)."""
    ext = {}
    for r in table(os.path.join(DRAFTS, "external-parties.csv")):
        if r["dataset_key"] == "gpd" and (r["partyfacts_id"] or "").strip():
            ext[r["dataset_party_id"]] = int(r["partyfacts_id"])
    out = {}
    for r in table(os.path.join(ROOT, "scripts", "partyfacts-gpd.csv")):
        pf = ext.get(r["party_id"])
        if pf:
            out[(r["country"], slug(r["party"]))] = (pf, 0)
    for L in links:
        if L["kind"] == "gpd":
            key = (L["country"], slug(L["gpd_party"]))
            if key not in out:
                sys.exit("make_data: data/links.csv, line %d: the Global Populism Database has no party '%s' in %s." % (L["n"] + 1, L["gpd_party"], L["country"]))
            L["used"] = True
            L["was"] = out[key][0]
            out[key] = (int(L["party_facts_id"]), L["n"])
    return out


# ---------------------------------------------------------------- PPEG, linked through the Manifesto Project codes

def ppeg(byname):
    ext = {}
    for r in table(os.path.join(DRAFTS, "external-parties.csv")):
        if r["dataset_key"] == "manifesto" and (r["partyfacts_id"] or "").strip():
            ext[r["dataset_party_id"].strip()] = int(r["partyfacts_id"])
    rows = table(os.path.join(DRAFTS, "ppeg_gov_2025v1.csv"))
    cabinets = {}
    for r in rows:
        key = (r["iso3c"], r["idate"], r["pm"])
        c = cabinets.setdefault(key, {"iso": r["iso3c"], "start": r["idate"], "pm": r["pm"].strip(),
                                      "type": r["tog"].strip(), "end_reason": r["rft"].strip(), "parties": []})
        role = "L" if r["pm_party"] == "yes" else ("P" if r["gov_party"] == "yes" else ("S" if r["support_party"] == "yes" else None))
        if not role:
            continue
        cmp_code = (r["cmp"] or "").strip()
        name = r["pname_en"].strip()
        # PPEG writes no initials for independents and "others" (and only for them)
        no_party = r["pinitials"].strip() in ("NA", "")
        c["parties"].append({
            "role": role, "en": name, "short": r["pinitials"].strip(),
            "pf": ext.get(cmp_code) if cmp_code not in ("", "NA") else None,
            "none": no_party,
        })
    out = {}
    for c in cabinets.values():
        out.setdefault(c["iso"], []).append(c)
    for iso, cs in out.items():
        cs.sort(key=lambda c: c["start"])
        for i, c in enumerate(cs):
            c["end"] = cs[i + 1]["start"] if i + 1 < len(cs) else PPEG_END
        # Is the president the head of government? PPEG marks a presidential cabinet.
        # An expert or caretaker cabinet takes the kind of the cabinet before it.
        last = None
        for c in cs:
            if c["type"] == "Pres":
                last = True
            elif c["type"] not in ("EC", "Other", ""):
                last = False
            c["pres"] = last
    return out


def same_person(leader, pm):
    """Is a leader of the Global Populism Database the person PPEG names for a
    cabinet? The two files spell names differently (Schroeder and Schröder, Tspiras
    and Tsipras), so two words of the name must be alike, or the only word, or
    one word the same and another with the same first letter."""
    import difflib
    def words(s):
        s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
        return [w for w in re.split(r"[^a-z]+", s) if len(w) > 1]
    a, b = words(leader), words(pm)
    if not a or not b:
        return False
    used, hits, exact = set(), 0, False
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            if j not in used and difflib.SequenceMatcher(None, x, y).ratio() >= 0.8:
                used.add(j)
                hits += 1
                if x == y and len(x) >= 5:
                    exact = (i, j)
                break
    if hits >= 2 or hits == min(len(a), len(b)) == 1:
        return True
    # One word is the same and another begins with the same letter
    # (Benjamin and Binyamin Netanyahu, Vlad and Vladimir Filat)
    if exact:
        rest_a = [x for i, x in enumerate(a) if i != exact[0]]
        rest_b = [y for j, y in enumerate(b) if j != exact[1]]
        return any(x[0] == y[0] for x in rest_a for y in rest_b)
    return False


# ---------------------------------------------------------------- years

def july_years(start, end):
    """The years whose 1 July falls inside a period. One rule for every view: a
    government or a term counts for the year it held on 1 July."""
    if not start or not end:
        return []
    return [y for y in range(int(start[:4]), int(end[:4]) + 1) if start <= "%d-07-01" % y <= end]


def term_years(t):
    """A term of the Global Populism Database: its dates, or its years when a date is missing."""
    if t[3]:
        return july_years(t[3], t[4] or GPD_END)
    return list(range(t[1], t[2] + 1)) if t[1] and t[2] else []


def ranges(years):
    """Years as a list of first and last: [2001, 2002, 2005] -> [[2001, 2002], [2005, 2005]]."""
    out = []
    for y in sorted(years):
        if out and y == out[-1][1] + 1:
            out[-1][1] = y
        else:
            out.append([y, y])
    return out


# ---------------------------------------------------------------- Who counts

def build_who(by3, byname, links):
    pl = popu_list(byname, links)
    vp = v_party()
    gpd_links = gpd_party_links(byname, links)
    leaders = gpd(byname, gpd_links)
    rows = {}

    def country_label(iso, fallback):
        return by3[iso]["label"] if iso in by3 else fallback

    # Parties: one row per Party Facts ID; without an ID, one row per dataset entry
    def party_row(pf, iso, fallback_id):
        rid = ("pf%d" % pf) if pf else fallback_id
        return rows.setdefault(rid, {"id": rid, "k": "party", "pf": pf, "c": iso, "names": {}})

    for p in vp.values():
        if not p["el"] and not p["gps"]:
            continue          # V-Party holds no score for this party
        if NO_PARTY.search(p["en"]):
            continue          # independents and "others" are not a party
        iso = p["iso"] if p["iso"] in by3 else None
        row = party_row(p["pf"], iso, "vp" + p["id"])
        row["names"].setdefault("vp", [p["en"], p["short"], p["name"]])
        if not row.get("c"):
            row["c"] = iso
        row.setdefault("cl", country_label(iso, p["country"]))
        # Two V-Party parties can share one Party Facts ID (a party and its alliance)
        row.setdefault("vp", []).append({"id": int(p["id"]), "n": p["en"], "s": p["short"], "el": p["el"]})
        if p["gps"] and not row.get("gs"):
            row["gs"] = dict(p["gps"], vp=int(p["id"]))

    for p in pl:
        own = "pl-" + slug(p["country"] + "-" + (p["short"] or p["en"]))
        p["rows"] = []
        for pf in (p["ids"] or [None]):
            row = party_row(pf, p["iso"], own)
            row["names"].setdefault("pl", [p["en"], p["short"], p["name"]])
            row["c"] = p["iso"]
            row["cl"] = country_label(p["iso"], p["country"])
            entry = {"n": p["en"], "s": p["short"], "o": p["name"], "sets": p["sets"], "parl": p["parl"]}
            if pf in p["lk"]:
                entry["lk"] = p["lk"][pf]        # the line of links.csv that puts the entry on this row
            row.setdefault("pl", []).append(entry)
            p["rows"].append(row["id"])

    # Leaders: one row per leader of the Global Populism Database
    for (country, name), L in leaders.items():
        rid = "gpd-" + slug(country + "-" + name)
        parties = []
        for t in L["terms"]:
            if t["pf"] and ("pf%d" % t["pf"]) in rows and ("pf%d" % t["pf"]) not in parties:
                parties.append("pf%d" % t["pf"])
        rows[rid] = {
            "id": rid, "k": "leader", "c": L["iso"], "cl": country_label(L["iso"], country),
            "names": {"gd": [name, "", ""]}, "pres": 1 if L["president"] else 0,
            "gd": [[t["n"], t["yb"], t["ye"], t["start"], t["end"], t["avg"], t["g"], t["sp"],
                    t["party"], ("pf%d" % t["pf"]) if t["pf"] else None, 1 if t["current"] else 0,
                    t["pres"], t["lk"]]
                   for t in L["terms"]],
            "parties": parties,
        }
        for pid in parties:
            rows[pid].setdefault("leaders", []).append(rid)

    # Names: The PopuList first, then V-Party, then the Global Populism Database
    for row in rows.values():
        n = row.pop("names")
        best = n.get("pl") or n.get("vp") or n.get("gd")
        row["n"], row["s"], row["o"] = best[0], best[1], best[2]
        other = set()
        for v in n.values():
            for x in v:
                if x and x not in (row["n"], row["s"], row["o"]):
                    other.add(x)
        if other:
            row["aka"] = sorted(other)

    # The verdicts by year and the mark
    def verdicts(row):
        """Year by year, each dataset's own yes (1) or no (0)."""
        by = {}
        def put(src, year, v):
            if v is not None:
                by.setdefault(year, {})[src] = v
        def party_part(prow, years):
            if not prow:
                return
            if "pl" in prow:
                for y in years:
                    put("pl", y, popu_verdict(prow["pl"], y))
            if "gs" in prow:
                put("gs", 2019, gps_verdict(prow["gs"], 2019) if 2019 in years else None)
        if row["k"] == "party":
            years = set()
            years |= {2019} | set(range(POPULIST_FROM, POPULIST_TO + 1))
            party_part(row, years)
            for lid in row.get("leaders", []):
                for t in rows[lid]["gd"]:
                    if t[9] == row["id"] and t[6] is not None:
                        for y in term_years(t):
                            put("gd", y, 1 if t[6] >= 1 else 0)
        else:
            for t in row["gd"]:
                if t[6] is None:
                    continue
                yrs = set(term_years(t))
                for y in yrs:
                    put("gd", y, 1 if t[6] >= 1 else 0)
                party_part(rows.get(t[9]) if t[9] else None, yrs)
        return by

    for row in rows.values():
        by = verdicts(row)
        shared = {y: v for y, v in by.items() if len(v) >= 2}
        if not shared:
            row["m"] = "one"
        else:
            differ = sorted(y for y, v in shared.items() if len(set(v.values())) > 1)
            row["m"] = "differ" if differ else "agree"
            if differ:
                row["md"] = differ
        # Classed populist by at least one dataset, in its own words. Only the row's
        # own verdicts count: a party's own (The PopuList, the survey), a leader's
        # own (the speeches). A verdict on the party is not one on its leader.
        if row["k"] == "party":
            own = any(e["sets"].get("p") for e in row.get("pl", [])) or bool(row.get("gs") and row["gs"]["t"] >= 3)
        else:
            own = any(t[6] is not None and t[6] >= 1 for t in row["gd"])
        row["pop"] = 1 if own else 0

    out = sorted(rows.values(), key=lambda r: (r.get("cl") or "", r["n"].lower()))
    return out, pl, vp, leaders


# ---------------------------------------------------------------- In power

# The order in which two states are weighed when a year has more than one:
# not covered, none, not known, supports, partner, leads
ORDER = {None: -2, 0: -1, -1: 0, 1: 1, 2: 2, 3: 3}


def stronger(a, b):
    return b if ORDER[b] > ORDER[a] else a


def build_power(by3, who, pl, leaders, links):
    cabinets = ppeg(by3)
    pf_rows = {r["pf"]: r for r in who if r.get("pf")}
    by_pf = {}
    for e in pl:
        for pf in e["ids"]:
            by_pf.setdefault(pf, []).append(e)
    by_key = {(e["iso"], e["short"]): e for e in pl}
    popu_countries = {e["iso"] for e in pl}
    ppeg_links = {}
    for L in links:
        if L["kind"] in ("ppeg", "ppeg_none"):
            entry = None
            if L["kind"] == "ppeg":
                entry = by_key.get((L["country"], L["popu_list"]))
                if not entry:
                    sys.exit("make_data: data/links.csv, line %d: The PopuList has no entry '%s' in %s." % (L["n"] + 1, L["popu_list"], L["country"]))
            ppeg_links[(L["country"], L["ppeg"])] = (entry, L)
    rank = {"L": 3, "P": 2, "S": 1}
    out = {}
    guard = []

    def country(iso):
        return out.setdefault(iso, {"cab": [], "lead": [], "yp": {}, "yb": {}, "yl": {}})

    # The party view: cabinets of PPEG in the countries of The PopuList
    for iso, cs in cabinets.items():
        if iso not in popu_countries:
            continue
        C = country(iso)
        names = {}
        for e in pl:
            if e["iso"] == iso:
                for x in (e["short"], e["en"], e["name"]):
                    if x:
                        names[slug(x)] = e["short"]
        for c in cs:
            if c["end"] < "%d-01-01" % FIRST_YEAR:
                continue
            years = range(int(c["start"][:4]), int(c["end"][:4]) + 1)
            parties = []
            unlinked = False
            for p in c["parties"]:
                entries, lk, rid = None, 0, None
                key = (iso, p["short"])
                if key in ppeg_links and not p["none"]:
                    entry, L = ppeg_links[key]
                    L["used"] = True
                    lk = L["n"]
                    entries = [entry] if entry else []
                    rid = entry["rows"][0] if entry else None
                elif p["pf"]:
                    entries = by_pf.get(p["pf"], [])
                    row = pf_rows.get(p["pf"])
                    rid = row["id"] if row else None
                    marks = [e["lk"][p["pf"]] for e in entries if p["pf"] in e["lk"]]
                    lk = marks[0] if marks else 0
                if entries is None:
                    # No ID and no line in the list: the party cannot be checked
                    full = bl = None
                    if not p["none"] and p["role"] in ("L", "P"):
                        unlinked = True
                else:
                    full = ranges(y for y in years if popu_state(entries, y) == 2)
                    bl = ranges(y for y in years if popu_state(entries, y) == 1)
                    if not entries and not p["none"]:
                        # A guard for the next version: a party read as "not in The PopuList"
                        # that bears the name of one of its entries
                        for x in (p["short"], p["en"]):
                            if slug(x) in names and (iso, p["short"]) not in ppeg_links:
                                guard.append("%s: %s (%s) in PPEG looks like The PopuList's %s" % (iso, p["en"], p["short"], names[slug(x)]))
                parties.append([p["role"], p["en"], p["short"], rid, full, bl, lk])
            C["cab"].append([c["start"], c["end"], c["pm"], c["type"], parties, 1 if unlinked else 0])
            for y in july_years(c["start"], c["end"]):
                if y < FIRST_YEAR:
                    continue
                best_any = best_full = 0
                for role, en, short, rid, full, bl, lk in parties:
                    if full and any(a <= y <= b for a, b in full):
                        best_full = max(best_full, rank[role])
                        best_any = max(best_any, rank[role])
                    if bl and any(a <= y <= b for a, b in bl):
                        best_any = max(best_any, rank[role])
                state = best_any if best_any else (-1 if unlinked else 0)
                # A cabinet with a party that cannot be checked may hide a populist one,
                # so "not known" outranks "none".
                first = y not in C["yp"]
                before = C["yp"].get(y)
                if first or ORDER[state] > ORDER[before]:
                    C["yp"][y] = state
                    # Does the place rest on a borderline case alone?
                    if best_any > best_full:
                        C["yb"][y] = 1
                    else:
                        C["yb"].pop(y, None)

    # The leader view: presidents and prime ministers in the Global Populism Database
    for (country_name, name), L in leaders.items():
        if not L["iso"]:
            continue
        iso = L["iso"]
        C = country(iso)
        rid = "gpd-" + slug(country_name + "-" + name)
        cs = cabinets.get(iso)
        for t in L["terms"]:
            if not t["start"] or t["g"] is None:
                continue
            end = t["end"] or GPD_END
            if end < "%d-01-01" % FIRST_YEAR:
                continue
            years = [y for y in july_years(t["start"], end) if y >= FIRST_YEAR]
            counted = []
            for y in years:
                cab = None
                if cs:
                    d = "%d-07-01" % y
                    for c in cs:
                        if c["start"] <= d <= c["end"]:
                            cab = c
                # The leader heads the government when PPEG holds no cabinet for the day,
                # when the cabinet is presidential and the leader is the president, or
                # when PPEG names the leader as the head of the cabinet.
                if cab is None or (cab["pres"] and t["pres"]) or same_person(name, cab["pm"]):
                    counted.append(y)
                    C["yl"][y] = stronger(C["yl"].get(y), 3 if t["g"] >= 1 else 0)
            # 0 counted in every year, 1 in none, 2 in some
            hog = 0 if len(counted) == len(years) else (1 if not counted else 2)
            C["lead"].append([t["start"], end, name, t["avg"], t["g"], rid, 1 if t["current"] else 0, t["pres"], hog, ranges(counted)])
    for C in out.values():
        C["lead"].sort()
    return out, sorted(set(guard))


# ---------------------------------------------------------------- writing

def write_json(path, data):
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != text:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    return len(text.encode("utf-8"))


SOURCES = {
    "pl": {
        "name": "The PopuList 4.0",
        "cite": [
            "Rooduijn, M., Pirro, A. L. P., Halikiopoulou, D., Froio, C., Van Kessel, S., De Lange, S. L., Mudde, C., and Taggart, P. 2024. “The PopuList: A Database of Populist, Far-Left, and Far-Right Parties Using Expert-Informed Qualitative Comparative Classification (EiQCC).” British Journal of Political Science 54 (3): 969–978. https://doi.org/10.1017/S0007123423000431",
            "The PopuList, version 4.0, 2026. https://popu-list.org. For the dataset itself its site still gives the reference of version 3.0: Rooduijn, M., Pirro, A. L. P., Halikiopoulou, D., Froio, C., Van Kessel, S., De Lange, S. L., Mudde, C., and Taggart, P. 2023. The PopuList 3.0: An Overview of Populist, Far-left and Far-right Parties in Europe. https://doi.org/10.17605/OSF.IO/2EWKQ",
        ],
        "url": "https://popu-list.org",
        "licence": "No open licence. Its authors ask for both references",
        "scope": "Populist, far-left and far-right parties in 31 European countries that won at least one seat or 2 per cent of the vote in a national parliamentary election since 1989",
    },
    "gd": {
        "name": "Global Populism Database 2.1",
        "cite": [
            "Hawkins, K. A., Aguilar, R., Castanho Silva, B., Jenne, E. K., Kocijan, B., and Rovira Kaltwasser, C. 2019. “Measuring Populist Discourse: The Global Populism Database.” Paper presented at the 2019 EPSA Annual Conference, Belfast, 20–22 June",
            "Hawkins, K. A., Aguilar, R., Castanho Silva, B., Jenne, E. K., Kocijan, B., and Rovira Kaltwasser, C. 2019. Global Populism Database. Harvard Dataverse, V3 (files of version 2.1, 20 November 2025). https://doi.org/10.7910/DVN/LFTQEZ",
        ],
        "url": "https://doi.org/10.7910/DVN/LFTQEZ",
        "licence": "CC0 1.0",
        "scope": "Speeches of presidents and prime ministers, up to four for each term, graded from 0 to 2. The four bands for a term's average are those of the paper",
    },
    "gs": {
        "name": "Global Party Survey 2019",
        "cite": [
            "Norris, P. 2020. Global Party Survey, 2019. Harvard Dataverse, V3. https://doi.org/10.7910/DVN/WMGTNS. Here as V-Party, version 2, carries it",
        ],
        "url": "https://doi.org/10.7910/DVN/WMGTNS",
        "licence": "CC0 1.0",
        "scope": "Experts on 1,043 parties in 163 countries in 2019. Here only the parties that V-Party carries, about half of them, without independents",
    },
    "vp": {
        "name": "V-Party, version 2",
        "cite": [
            "Lindberg, S. I., Düpont, N., Higashijima, M., Kavasoglu, Y. B., Marquardt, K. L., Bernhard, M., Döring, H., Hicken, A., Laebens, M., Medzihorsky, J., Neundorf, A., Reuter, O. J., Ruth-Lovell, S., Weghorst, K. R., Wiesehomeier, N., Wright, J., Alizada, N., Bederke, P., Gastaldi, L., Grahn, S., Hindle, G., Ilchenko, N., von Römer, J., Wilson, S., Pemstein, D., and Seim, B. 2022. Varieties of Party Identity and Organization (V-Party) Dataset V2. Varieties of Democracy (V-Dem) Project. https://doi.org/10.23696/vpartydsv2",
        ],
        "url": "https://doi.org/10.23696/vpartydsv2",
        "licence": "V-Dem publishes its dataset under CC BY-SA 4.0 (its FAQ). V-Party's own page names no licence. Treated here as CC BY-SA 4.0",
        "scope": "Expert scores for parties in 169 countries, at national elections from 1970 to 2019",
    },
    "pp": {
        "name": "PPEG 2025v1",
        "cite": [
            "Krause, W., Döring, R., Stoppe, J., and WZB Berlin. 2025. PPEG: Political Parties, Presidents, Elections and Governments, Version 2025v1. Harvard Dataverse, V1. https://doi.org/10.7910/DVN/5OAH7P",
        ],
        "url": "https://doi.org/10.7910/DVN/5OAH7P",
        "licence": "CC0 1.0",
        "scope": "Governments in 73 democracies to 31 October 2025",
    },
    "pf": {
        "name": "Party Facts, Version 2023",
        "cite": [
            "Döring, H., and Regel, S. 2019. “Party Facts: A Database of Political Parties Worldwide.” Party Politics 25 (2): 97–109. https://doi.org/10.1177/1354068818820671",
            "Bederke, P., Döring, H., and Regel, S. 2023. Party Facts – Version 2023. Harvard Dataverse, V1. https://doi.org/10.7910/DVN/TJINLQ",
        ],
        "url": "https://doi.org/10.7910/DVN/TJINLQ",
        "licence": "CC0 1.0",
        "scope": "The IDs that link a party across datasets",
    },
}


def write_sources(path, built, links):
    lines = [
        "PopuliVerse: the datasets behind \"Who Counts as Populist?\" and \"Populists in Power\"",
        "https://populiverse.com/data/",
        "Data files written on " + built + " by scripts/make_data.py.",
        "",
        "Each verdict is the dataset's own, in its own words. PopuliVerse adds none. Cite the datasets you use.",
        "",
    ]
    for key in ("pl", "gd", "gs", "vp", "pp", "pf"):
        s = SOURCES[key]
        lines += [s["name"], "  " + s["scope"]]
        lines += ["  Cite: " + c for c in s["cite"]]
        lines += ["  Licence: " + s["licence"], ""]
    lines += [
        "A file that carries the scores of V-Party is passed on under CC BY-SA 4.0.",
        "",
        "Links by PopuliVerse",
        "  The datasets are linked through Party Facts IDs. Where The PopuList and another dataset give",
        "  one party two IDs or none, or an ID in a source is wrong, a checked list says so:",
        "  https://populiverse.com/data/links.csv (%d lines, each with its reason). It is used only where" % len(links),
        "  The PopuList itself holds the party, and never to call a party \"not populist\".",
        "",
        "To cite these pages:",
        "Rzazade, Khayyam, ed. 2026. \"Who Counts as Populist?\" PopuliVerse. https://populiverse.com/data/who-counts.html",
        "Rzazade, Khayyam, ed. 2026. \"Populists in Power.\" PopuliVerse. https://populiverse.com/data/in-power.html",
        "",
    ]
    text = "\n".join(lines)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def main():
    by3, byname = countries()
    links = read_links()
    who, pl, vp, leaders = build_who(by3, byname, links)
    power, guard = build_power(by3, who, pl, leaders, links)
    unused = [L for L in links if not L["used"]]
    if unused:
        sys.exit("make_data: data/links.csv: nothing in the datasets fits line %s. Check the names." % ", ".join(str(L["n"] + 1) for L in unused))
    built = datetime.date.today().isoformat()
    os.makedirs(OUT, exist_ok=True)
    regions = {r["iso3"]: r["region"] for r in by3.values()}
    shown = [{"n": L["n"], "k": L["kind"], "c": L["country"], "pl": L["popu_list"],
              "pf": int(L["party_facts_id"]) if L["party_facts_id"] else None, "was": L.get("was"),
              "pp": L["ppeg"], "gd": L["gpd_party"], "b": L["basis"]} for L in links]
    size1 = write_json(os.path.join(OUT, "who-counts.json"), {
        "built": built, "gpd_end": GPD_END, "sources": SOURCES, "regions": regions, "links": shown, "rows": who})
    places = {r["iso3"]: [r["label"], r["num"], r["region"], num(r["lon"]), num(r["lat"]), int(r["dot"]), r["tag"]]
              for r in by3.values()}
    size2 = write_json(os.path.join(OUT, "in-power.json"), {
        "built": built, "from": FIRST_YEAR, "ppeg_end": PPEG_END, "gpd_end": GPD_END,
        "sources": {k: SOURCES[k] for k in ("pl", "gd", "pp", "pf")},
        "links": shown, "places": places, "countries": power})
    write_sources(os.path.join(OUT, "sources.txt"), built, links)
    n = {k: sum(1 for r in who if k in r) for k in ("pl", "vp", "gs", "gd")}
    marks = {m: sum(1 for r in who if r["m"] == m) for m in ("agree", "differ", "one")}
    note("%d rows (%d parties, %d leaders); The PopuList %d, V-Party %d, Global Party Survey %d, "
         "Global Populism Database %d; marks %s; classed populist by at least one dataset %d." % (
             len(who), sum(r["k"] == "party" for r in who), sum(r["k"] == "leader" for r in who),
             n["pl"], n["vp"], n["gs"], n["gd"], marks, sum(r["pop"] for r in who)))
    note("in power: %d countries; %d lines in the list of links, all used; files of %d and %d bytes." % (
        len(power), len(links), size1, size2))
    for g in guard:
        note("to check: " + g)


if __name__ == "__main__":
    main()
