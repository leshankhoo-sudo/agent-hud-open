"""Every record of DSIGHT_1.csv with what was done with it, for the dashboard's record library.

Run from the project folder, last (after audit_poi.py, poi_reconcile.py and dsight_geography.py):
    python3 scripts/dsight_records.py [data/raw/dsight/DSIGHT_1.csv]

Source: 京都観光見もの情報 (DSIGHT_1.csv), Kyoto City Open Data, resource 7052,
https://data.city.kyoto.lg.jp/resource/?id=7052, © Kyoto City, CC BY 4.0, updated 2021-03-26.
The original Japanese name, reading, other name, description and address are kept as published;
nothing is translated or rewritten. The CSV record ID is kept.

Outcome of each record (one of five):
    attraction     the record is a place of its own on the map (a burial mound, a site named by it)
    sub            a building, named tree, guardian figure or landscape feature of a site on the map
    culture        an object kept at a site on the map (statue, painting, sutra), or performing arts,
                   literature, food and local history; listed in the library, and on a site's card
                   when it belongs to that site
    geography      a place name, mountain, river, pond or spring placed on the "Places and landscape"
                   layer, or the same place as an attraction already on the map
    unverified     its place or the site it belongs to could not be confirmed; kept, never placed
"mentions": map records whose full name appears in the record's description. It says only that the
text names the place; the record is not filed under it.
Output: public/data/dsight_records.json
"""
import csv
import json
import os
import re
import sys
import unicodedata
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda p: json.load(open(p, encoding="utf-8"))
SERIES = {"1": "cultural property", "2": "named tree", "3": "performing art", "4": "literature", "5": "food",
          "6": "place name", "7": "mountain, river or spring", "8": "townhouse term or local history"}


def nfkc(s):
    return unicodedata.normalize("NFKC", s or "")


def clean(s):
    """The CSV writes line breaks as a literal backslash-n."""
    return re.sub(r"(\\n)+", "\n", s or "").strip()


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "raw", "dsight", "DSIGHT_1.csv")
    rows = list(csv.reader(open(src, encoding="utf-8-sig")))
    audit = J(os.path.join(ROOT, "data", "audit", "poi_audit.json"))
    ids = J(os.path.join(ROOT, "data", "audit", "poi_ids.json"))
    geo = {x["csv_id"]: x for x in J(os.path.join(ROOT, "data", "audit", "geography_audit.json"))}
    A = J(os.path.join(ROOT, "public", "data", "attractions.geojson"))["features"]
    names = {f["properties"]["id"]: f["properties"]["name"] for f in A}
    rec = {x["csv_id"]: x for x in audit["records"]}
    site = {s["key"]: s for s in audit["sites"]}

    def site_id(s):
        return s.get("parent_id") or (ids.get(s.get("ref")) if s["status"] == "Verified" else None)

    # names that may be "mentioned": full names of map records, 3+ characters, that occur once on the map
    count = Counter(nfkc(n) for n in names.values() if n)
    mentionable = sorted({(nfkc(n), i) for i, n in names.items() if n and len(nfkc(n)) >= 3 and count[nfkc(n)] == 1 and not re.search(r"^[\x00-\x7f]+$", n)}, key=lambda x: -len(x[0]))

    out = []
    for r in rows:
        cid, series = r[0], r[0][0]
        x = rec.get(cid, {})
        d = {"id": cid, "name": r[8].strip(), "kana": r[9].strip(), "other_name": r[10].strip() or None, "series": SERIES[series],
             "kind": x.get("kind") or SERIES[series], "description": clean(r[12]), "address": nfkc(r[17]).strip() or None}
        if series in "12":
            s = site.get(x.get("site_key"))
            pid = site_id(s) if s else None
            if pid:
                d["site_id"] = pid
                if x.get("kind") == "burial mound" or (not x.get("part") and len(s["records"]) == 1 and pid in ids.values()):
                    d["outcome"] = "attraction"
                elif x.get("kind") == "object":
                    d["outcome"] = "culture"
                else:
                    d["outcome"] = "sub"
                d["part"] = x.get("part")
                d["evidence"] = x.get("parent_evidence") or s["reason"] if s["status"] == "Verified" else f"site already on the map as {pid}"
            else:
                d["outcome"], d["evidence"] = "unverified", (s or {}).get("reason", "site not found")
        elif series in "67":
            g = geo.get(cid, {})
            if g.get("result") == "placed":
                d.update(outcome="geography", geo=True, evidence=g["evidence"])
            elif g.get("result") in ("part of a site", "same place as an attraction on the map"):
                d.update(outcome="geography" if g["result"].startswith("same") else "sub", site_id=g["parent_id"], evidence=g["evidence"])
            else:
                d.update(outcome="unverified", evidence=g.get("reason", "not checked"))
        else:
            d["outcome"] = "culture"
        # places the text names (for every record; for a record filed under a site, other places only)
        text = nfkc(d["description"])
        found, used = [], text
        for n, i in mentionable:
            if n in used and i != d.get("site_id"):
                found.append(i)
                used = used.replace(n, "\0")
        if found:
            d["mentions"] = found[:8]
        out.append(d)
    doc = {"source": {"title": "京都観光見もの情報 (DSIGHT_1.csv)", "publisher": "Kyoto City (京都市 産業観光局 観光MICE推進室)",
                      "url": "https://data.city.kyoto.lg.jp/resource/?id=7052", "licence": "CC BY 4.0", "updated": "2021-03-26"},
           "outcomes": dict(Counter(x["outcome"] for x in out)), "records": out}
    json.dump(doc, open(os.path.join(ROOT, "public", "data", "dsight_records.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(out), "records", doc["outcomes"], "| with mentions:", sum(1 for x in out if x.get("mentions")))


if __name__ == "__main__":
    main()
