"""Reference places from OpenStreetMap for the POI audit (scripts/audit_poi.py).

Run from the project folder:  python3 scripts/fetch_osm_reference.py
Needs network access to overpass-api.de.

Reads every named feature inside Kyoto Prefecture (OSM boundary 京都府, admin_level 4) that is a
place of worship, a historic feature, a tourism feature, a named tree or a named peak, with its
centre point and its wikidata / wikipedia / name:en / alt_name tags. Polygons and buildings are
included as their centre, which the audit treats as "site centre", not an entrance.

Output: data/cache/osm_reference_kyoto.json  (raw Overpass elements, with the query and the time)
"""
import json
import os
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "cache", "osm_reference_kyoto.json")
UA = "KyotoGIS-StudentProject/0.1 (university GIS prototype; non-commercial)"
QUERY = """[out:json][timeout:300];
area["boundary"="administrative"]["admin_level"="4"]["name"="京都府"]->.kyoto;
(
  nwr["amenity"="place_of_worship"]["name"](area.kyoto);
  nwr["historic"]["name"](area.kyoto);
  nwr["tourism"]["name"](area.kyoto);
  nwr["natural"="tree"]["name"](area.kyoto);
  nwr["natural"="peak"]["name"](area.kyoto);
  nwr["building"~"temple|shrine"]["name"](area.kyoto);
);
out center tags;"""


def main():
    data = urllib.parse.urlencode({"data": QUERY}).encode()
    req = urllib.request.Request("https://overpass-api.de/api/interpreter", data=data, headers={"User-Agent": UA})
    raw = json.loads(urllib.request.urlopen(req, timeout=400).read())
    els = []
    for e in raw["elements"]:
        c = (e.get("lon"), e.get("lat")) if e["type"] == "node" else ((e.get("center") or {}).get("lon"), (e.get("center") or {}).get("lat"))
        if c[0] is None:
            continue
        els.append({"osm": f"{e['type']}/{e['id']}", "lon": c[0], "lat": c[1], "tags": e.get("tags", {})})
    doc = {"retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": "https://overpass-api.de (OpenStreetMap contributors, ODbL)",
           "osm_base": raw.get("osm3s", {}).get("timestamp_osm_base"), "query": QUERY, "elements": els}
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(len(els), "elements; OSM data as of", doc["osm_base"])


if __name__ == "__main__":
    main()
