"""OpenStreetMap features named like the place names, mountains, rivers, ponds, springs and slopes of
DSIGHT_1.csv (ID series 6 and 7), for scripts/dsight_geography.py.

Run from the project folder:  python3 scripts/fetch_osm_geography.py [data/raw/dsight/DSIGHT_1.csv]
Needs network access to overpass-api.de.

Every element inside Kyoto Prefecture whose name (or name:ja / alt_name) is exactly one of the names
(also old_name, official_name, loc_name, short_name) is read with its geometry: a point for nodes, all vertices for ways and relations (so a river or a
street can be labelled ON the line, not at the centre of its bounding box).
Output: data/cache/osm_geography_kyoto.json
"""
import csv
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "cache", "osm_geography_kyoto.json")
UA = "KyotoGIS-StudentProject/0.1 (university GIS prototype; non-commercial)"


def names_of(n):
    """The names to look for: '名勝　大沢池' -> 大沢池; '鴨川（賀茂川）' -> 鴨川, 賀茂川; 'ヶ' and 'ケ' both."""
    n = unicodedata.normalize("NFKC", n).strip()
    n = re.sub(r"^(名勝|史跡)\s*", "", n)
    out = {n, re.sub(r"[（(].*?[）)]", "", n).strip()}
    out |= set(re.findall(r"[（(](.*?)[）)]", n))
    out |= {x.split(" ")[-1] for x in list(out) if " " in x}
    out |= {x.replace("ヶ", "ケ") for x in out} | {x.replace("ケ", "ヶ") for x in out}
    return {x for x in out if len(x) >= 2}


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "raw", "dsight", "DSIGHT_1.csv")
    rows = [r for r in csv.reader(open(src, encoding="utf-8-sig")) if r[0][0] in "67"]
    want = sorted(set().union(*(names_of(r[8]) for r in rows)))
    rx = "^(" + "|".join(re.escape(x) for x in want) + ")$"
    q = f"""[out:json][timeout:600];
area["boundary"="administrative"]["admin_level"="4"]["name"="京都府"]->.kyoto;
(
  nwr["name"~"{rx}"](area.kyoto);
  nwr["name:ja"~"{rx}"](area.kyoto);
  nwr["alt_name"~"{rx}"](area.kyoto);
  nwr["old_name"~"{rx}"](area.kyoto);
  nwr["official_name"~"{rx}"](area.kyoto);
  nwr["loc_name"~"{rx}"](area.kyoto);
  nwr["short_name"~"{rx}"](area.kyoto);
);
out geom tags;"""
    data = urllib.parse.urlencode({"data": q}).encode()
    raw = json.loads(urllib.request.urlopen(urllib.request.Request("https://overpass-api.de/api/interpreter", data=data, headers={"User-Agent": UA}), timeout=700).read())
    els = []
    for e in raw["elements"]:
        if e["type"] == "node":
            pts = [[e["lon"], e["lat"]]]
        elif e["type"] == "way":
            pts = [[g["lon"], g["lat"]] for g in e.get("geometry", [])]
        else:
            pts = [[g["lon"], g["lat"]] for m in e.get("members", []) for g in (m.get("geometry") or []) if m.get("type") == "way"]
            if not pts and e.get("center"):
                pts = [[e["center"]["lon"], e["center"]["lat"]]]
        if not pts:
            continue
        els.append({"osm": f"{e['type']}/{e['id']}", "tags": e.get("tags", {}), "points": pts[::max(1, len(pts) // 400)]})
    json.dump({"retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": "https://overpass-api.de (OpenStreetMap contributors, ODbL)",
               "osm_base": raw.get("osm3s", {}).get("timestamp_osm_base"), "names": want, "elements": els},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(want), "names;", len(els), "elements")


if __name__ == "__main__":
    main()
