"""Place names, mountains, rivers, ponds, springs and slopes of DSIGHT_1.csv (ID series 6 and 7) as a
map layer, when two independent sources agree on where they are.

Run from the project folder (after fetch_osm_geography.py and audit_poi.py):
    python3 scripts/dsight_geography.py [--cached] [data/raw/dsight/DSIGHT_1.csv]
Network: the GSI place search and the Wikidata search are cached (data/cache/gsi_places.json,
wikidata_search_geo.json). With --cached nothing is requested: names not in the caches simply have
no second source and stay unverified. Without it, each failed request is retried a few times
(Retry-After is obeyed), never endlessly.

Rules (no coordinates are made up; a name alone never places a point)
  1. OpenStreetMap features inside Kyoto Prefecture with exactly that name, of a kind that fits the
     record: place=* or a named street for a place name (series 6); a peak, hill, water body, river,
     stream, spring, waterfall, pass, wood or viewpoint for series 7. Bus stops and stations are left out.
  2. Sources: OSM; Wikidata items whose Japanese label OR alias is the name (Kyoto box cache, and the
     Wikidata search API, which also matches aliases: 三年坂 is an alias of 産寧坂), with coordinates
     inside the prefecture's box; and, for a place name, the GSI place search (国土地理院) giving a
     place in Kyoto City with that name. Two different sources must agree: OSM + Wikidata, OSM + GSI
     or Wikidata + GSI. Tolerance: 600 m for points (peaks, springs, wells, falls, ponds), 1 km from
     any point of a river or street, 2 km for an area.
  3. Several same-name features: only those a second source agrees with; if they lie apart, not placed.
     A record whose name and place agree with an attraction already on the map is linked to it
     ("same place as A00138") instead of being drawn again.
  4. A record whose name starts with a site already on the map ("知恩院　紫雲水") belongs to that site
     instead (listed on its card, not drawn twice); so do records listed in poi_decisions.json
     "manual_geo_parents".
  A river or a street that OSM maps as a line is written as that line (the matched OSM way), with a
  label point on it (the vertex nearest its middle); everything else is a point.
Output: public/data/dsight_geography.geojson (placed records) and data/audit/geography_audit.json
(every series 6/7 record with its result).
"""
import csv
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_osm_geography import names_of  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "KyotoGIS-StudentProject/0.1 (university GIS prototype; non-commercial)"
GSI_CACHE = os.path.join(ROOT, "data", "cache", "gsi_places.json")
J = lambda p: json.load(open(p, encoding="utf-8"))


def norm(s):
    return re.sub(r"[\s・･()（）]", "", unicodedata.normalize("NFKC", s or "")).replace("ヶ", "ケ").replace("ッ", "ツ")


def dist(a, b):
    kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110574)


SERIES7_KIND = [("滝", "waterfall"), ("峠", "pass"), ("池", "pond"), ("井", "spring or well"), ("水", "spring or well"), ("川", "river"),
                ("峡", "gorge"), ("森", "wood"), ("眺望", "view"), ("展望", "view"), ("道", "path"), ("流域", "river basin"), ("峰", "mountains"),
                ("山", "mountain"), ("嶽", "mountain"), ("岳", "mountain"), ("ヶ岡", "hill"), ("坂", "slope")]


def kind_of(series, name):
    n = re.sub(r"[（(].*?[）)]", "", unicodedata.normalize("NFKC", name)).strip()
    if series == "6":
        return "street" if n.endswith(("坂", "新京極", "先斗町")) else "area"
    for end, k in SERIES7_KIND:
        if end in n[-3:] or n.endswith(end):
            return k
    return "landscape"


def fits(kind, t):
    if t.get("highway") in ("bus_stop",) or "railway" in t or t.get("public_transport") or t.get("amenity") in ("bus_station", "parking"):
        return False
    if kind in ("area",):
        return "place" in t or t.get("boundary") == "administrative"
    if kind == "street":
        return "highway" in t or "place" in t
    if kind in ("river", "river basin"):
        return "waterway" in t or t.get("natural") == "water"
    if kind == "pond":
        return t.get("natural") == "water" or "water" in t or t.get("landuse") == "reservoir"
    if kind == "waterfall":
        return t.get("waterway") == "waterfall" or t.get("natural") == "waterfall"
    if kind == "spring or well":
        return t.get("natural") == "spring" or t.get("man_made") == "water_well" or t.get("amenity") == "drinking_water" or "historic" in t or "tourism" in t
    if kind in ("mountain", "mountains", "hill"):
        return t.get("natural") in ("peak", "hill", "ridge", "mountain_range") or "place" in t or t.get("leisure") == "park"
    if kind == "pass":
        return t.get("mountain_pass") == "yes" or t.get("natural") == "saddle" or "highway" in t
    if kind == "gorge":
        return t.get("natural") in ("valley", "gorge") or "waterway" in t or "tourism" in t
    if kind == "wood":
        return t.get("natural") == "wood" or t.get("landuse") == "forest" or "leisure" in t
    return "tourism" in t or "natural" in t or "historic" in t or "highway" in t or "place" in t


def label_point(pts):
    if len(pts) == 1:
        return pts[0]
    mx, my = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    return min(pts, key=lambda p: (p[0] - mx) ** 2 + (p[1] - my) ** 2)


WARDS = ["北区", "上京区", "左京区", "中京区", "東山区", "下京区", "南区", "右京区", "伏見区", "山科区", "西京区"]


CACHED = "--cached" in sys.argv
# Wikidata items found through an alias that are a different thing from the record, checked by hand
REJECT_WD = {
    ("西院", "Q11560342"): "Q11560342 is 淳和院, the Junna-in palace site also called 西院, which gave the district its name; it is not the district",
}


def http_json(url, tries=3):
    for i in range(tries):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60).read())
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503):
                raise
            time.sleep(min(120, int(e.headers.get("Retry-After") or 15 * (i + 1))))
        except Exception:
            time.sleep(5 * (i + 1))
    return None


def gsi_places(names):
    """For a place name, the towns of Kyoto City whose names begin with it (京都市西京区 + 嵐山 -> 嵐山宮ノ前町,
    嵐山山田町, ...), per ward. The centre of a ward's towns stands for the area there."""
    cache = J(GSI_CACHE) if os.path.exists(GSI_CACHE) else {}
    for n in names:
        if n in cache or CACHED:
            continue
        per = {}
        for w in WARDS:
            res = http_json("https://msearch.gsi.go.jp/address-search/AddressSearch?" + urllib.parse.urlencode({"q": f"京都市{w}{n}"})) or []
            hits = [f for f in res if (f["properties"].get("title") or "").startswith(f"京都府京都市{w}{n}")]
            if hits:
                per[w] = {"towns": [f["properties"]["title"] for f in hits][:30],
                          "lon": sum(f["geometry"]["coordinates"][0] for f in hits) / len(hits), "lat": sum(f["geometry"]["coordinates"][1] for f in hits) / len(hits)}
            time.sleep(0.5)
        cache[n] = per
        json.dump(cache, open(GSI_CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    return cache


def wikidata_search(names):
    """Wikidata items found by the search API (labels and aliases, Japanese), with coordinates."""
    path = os.path.join(ROOT, "data", "cache", "wikidata_search_geo.json")
    cache = J(path) if os.path.exists(path) else {}
    todo = [] if CACHED else [n for n in names if cache.get(n) is None]   # None: the earlier search failed
    for n in todo:
        url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({"action": "wbsearchentities", "search": n, "language": "ja", "uselang": "ja", "limit": 10, "format": "json"})
        res = http_json(url)
        cache[n] = None if res is None else [{"q": x["id"], "label": x.get("label"), "match": (x.get("match") or {}).get("text")} for x in res.get("search", [])
                                             if norm((x.get("match") or {}).get("text") or "") == norm(n)]
        time.sleep(1.0)
        json.dump(cache, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=0)   # saved after every search, so a stop loses nothing
        print("  Wikidata search:", n, "->", "failed" if cache[n] is None else len(cache[n]), flush=True)
    json.dump(cache, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=0)   # keep the searches even if the next step stops

    def get(url):
        for i in range(6):
            try:
                return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60).read())
            except urllib.error.HTTPError as e:
                if e.code not in (429, 503):
                    raise
                time.sleep(min(90, int(e.headers.get("Retry-After") or 10 * (i + 1))))
        raise RuntimeError("Wikidata kept answering 429")
    qids = sorted({x["q"] for v in cache.values() if v for x in v if "xy" not in x})
    coords = {}
    for k in range(0, len(qids), 50):
        url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(qids[k:k + 50]), "props": "claims", "format": "json"})
        ents = get(url).get("entities", {})
        for q, e in ents.items():
            c = [x["mainsnak"].get("datavalue", {}).get("value") for x in e.get("claims", {}).get("P625", []) if x["mainsnak"].get("datavalue")]
            coords[q] = (c[0]["longitude"], c[0]["latitude"]) if c else None
        time.sleep(0.5)
    for v in cache.values():
        for x in v or []:
            if x["q"] in coords:
                x["xy"] = coords[x["q"]]
    json.dump(cache, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    return cache


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src = args[0] if args else os.path.join(ROOT, "data", "raw", "dsight", "DSIGHT_1.csv")
    rows = [r for r in csv.reader(open(src, encoding="utf-8-sig")) if r[0][0] in "67"]
    geo = J(os.path.join(ROOT, "data", "cache", "osm_geography_kyoto.json"))["elements"]
    wdc = J(os.path.join(ROOT, "data", "cache", "wikidata_ja_en_kyoto_box.json"))
    wd = {}
    for w in wdc:
        if w.get("ja") and w.get("xy"):
            wd.setdefault(norm(w["ja"]), []).append(w)
    audit = J(os.path.join(ROOT, "data", "audit", "poi_audit.json"))
    ids = J(os.path.join(ROOT, "data", "audit", "poi_ids.json"))
    dec = J(os.path.join(ROOT, "data", "audit", "poi_decisions.json"))
    # sites on the map, by every name: added sites and the original records with names
    site_id = {}
    for s in audit["sites"]:
        pid = s.get("parent_id") or (ids.get(s.get("ref")) if s["status"] == "Verified" else None)
        if pid:
            for a in s["aliases"] + [s["site"]]:
                site_id[norm(a)] = pid
    manual_parent = {r: m for m in dec.get("manual_geo_parents", []) for r in m["records"]}
    by_name = {}
    for e in geo:
        for k in ("name", "name:ja", "alt_name", "old_name", "official_name", "loc_name", "short_name"):
            for v in (e["tags"].get(k) or "").split(";"):
                if v:
                    by_name.setdefault(norm(v), []).append(e)
    gsi = gsi_places(sorted({unicodedata.normalize("NFKC", r[8]).strip() for r in rows if r[0][0] == "6"}))
    wds = wikidata_search(sorted(set().union(*(names_of(r[8]) for r in rows))))
    BOX = (134.84, 34.70, 136.06, 35.79)
    inbox = lambda xy: xy and BOX[0] <= xy[0] <= BOX[2] and BOX[1] <= xy[1] <= BOX[3]
    A = [f for f in J(os.path.join(ROOT, "public", "data", "attractions.geojson"))["features"] if f["properties"].get("name")]

    feats, results = [], []
    for r in rows:
        cid, name, series = r[0], r[8].strip(), r[0][0]
        kind = kind_of(series, name)
        res = {"csv_id": cid, "name": name, "kana": r[9].strip(), "series": series, "kind": kind}
        results.append(res)
        n0 = unicodedata.normalize("NFKC", name)
        # part of a site already on the map
        if cid in manual_parent:
            res.update(result="part of a site", parent_id=manual_parent[cid]["site_id"], evidence=manual_parent[cid]["evidence"])
            continue
        if " " in n0 and norm(n0.split(" ")[0]) in site_id:
            res.update(result="part of a site", parent_id=site_id[norm(n0.split(" ")[0])], evidence=f"the name begins with the site {n0.split(' ')[0]}")
            continue
        names = names_of(name)
        tol = 600 if kind in ("mountain", "hill", "waterfall", "spring or well", "pass", "pond") else (1000 if kind in ("river", "river basin", "street", "path", "wood") else 2000)
        # each source: a list of (label, points); OSM features carry all their points
        osm = [e for e in {e["osm"]: e for n in names for e in by_name.get(norm(n), []) if fits(kind, e["tags"])}.values()]
        wdi = {}
        for n in names:
            for w in wd.get(norm(n), []):
                wdi[(w["q"], tuple(w["xy"]))] = (f"Wikidata {w['q']} ({w['ja']})", tuple(w["xy"]))   # an item may have several coordinates (a river's source and mouth)
            for w in wds.get(n) or []:
                if (n0.strip(), w["q"]) in REJECT_WD:
                    res.setdefault("rejected", []).append(REJECT_WD[(n0.strip(), w["q"])])
                    continue
                if inbox(w.get("xy")):
                    if not any(k[0] == w["q"] for k in wdi):
                        wdi[(w["q"], tuple(w["xy"]))] = (f"Wikidata {w['q']} ({w['label']}; matched '{w['match']}')", tuple(w["xy"]))
        gs = [(f"GSI: the towns of 京都市{w} beginning with {n0.strip()} ({len(g['towns'])}, e.g. {g['towns'][0]})", (g["lon"], g["lat"]))
              for w, g in (gsi.get(n0.strip()) or {}).items()] if series == "6" else []
        pairs = []
        for e in osm:
            for how, pt in list(wdi.values()) + gs:
                d = min(dist(tuple(p), pt) for p in e["points"])
                if d <= tol:
                    pairs.append((d, label_point(e["points"]), f"OSM {e['osm']} and {how} agree within {round(d)} m", e["osm"], e["tags"].get("name:en"), e))
        if not pairs:
            for how, pt in wdi.values():
                for how2, pt2 in gs:
                    d = dist(pt, pt2)
                    if d <= tol:
                        pairs.append((d, list(pt), f"{how} and {how2} agree within {round(d)} m", None, None, None))
        if not pairs:
            srcs = [x for x, ok in (("OSM", osm), ("Wikidata", wdi), ("GSI", gs)) if ok]
            res.update(result="not placed", reason=("only one source (" + srcs[0] + ")" if len(srcs) == 1 else "the sources do not agree within %d m" % tol) if srcs else "no OSM feature, Wikidata item or GSI place with this name")
            continue
        pts = [x[1] for x in pairs]
        # sections of one river lie far apart by nature; for everything else, far apart means different places
        if kind not in ("river", "river basin") and max(dist(tuple(p), tuple(pts[0])) for p in pts) > tol * 2:
            res.update(result="not placed", reason="several same-name places agree with a second source and lie apart")
            continue
        d, pt, ev, osm_ref, en, el = min(pairs, key=lambda x: x[0])
        # an attraction on the map with this name, at this place: link to it instead of drawing again
        same = [f for f in A if norm(f["properties"]["name"]) in {norm(n) for n in names} and dist(tuple(f["geometry"]["coordinates"]), tuple(pt)) <= tol]
        if same:
            res.update(result="same place as an attraction on the map", parent_id=same[0]["properties"]["id"], evidence=ev)
            continue
        res.update(result="placed", osm=osm_ref, evidence=ev, point_is="feature point" if not osm_ref else "OSM feature (vertex nearest its middle for a line or area)")
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(pt[0], 7), round(pt[1], 7)]},
                      "properties": {"csv_id": cid, "name": name, "kana": r[9].strip(), "kind": kind, "series": series, "osm": osm_ref,
                                     "name_en": en, "evidence": ev, "point_is": res["point_is"]}})
        if el and el["osm"].startswith("way/") and len(el["points"]) > 1 and kind in ("river", "street", "path", "pass", "slope"):
            feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[round(x, 6), round(y, 6)] for x, y in el["points"]]},
                          "properties": {"csv_id": cid, "name": name, "kind": kind, "osm": el["osm"], "line_of": "the matched OSM way (one section of the feature)"}})
    json.dump({"type": "FeatureCollection", "features": feats}, open(os.path.join(ROOT, "public", "data", "dsight_geography.geojson"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(results, open(os.path.join(ROOT, "data", "audit", "geography_audit.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    from collections import Counter
    print(len(rows), "records;", dict(Counter(x["result"] for x in results)))


if __name__ == "__main__":
    main()
