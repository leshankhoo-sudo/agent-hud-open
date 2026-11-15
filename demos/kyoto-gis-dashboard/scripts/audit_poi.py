"""POI audit: the dashboard's attractions against DSIGHT_1.csv, OpenStreetMap and Wikidata.

Run from the project folder:
    python3 scripts/fetch_osm_reference.py            # once, needs network (OSM reference places)
    python3 scripts/audit_poi.py [path/to/DSIGHT_1.csv]

It only reads. It never changes public/data. It writes:
    data/audit/poi_audit.json            everything below, machine-readable
    data/audit/poi_audit_checklist.csv   one row per CSV record, per dashboard finding and per site
    data/audit/dsight_sites.geojson      sites that passed every check and are not on the map yet;
                                         scripts/prepare_data.py adds these to the attractions
What DSIGHT_1.csv is (found by reading it, there is no header or documentation with it):
    648 rows x 30 columns. [0] record ID, [1]-[6] codes, [7] ID of the site the record belongs
    to in ANOTHER table (it is not a row ID of this file: row 1000089 here is a gate of Nijo
    Castle, while 1000089 in column 7 groups the Ginkaku-ji records), [8] name, [9] reading,
    [10]/[11] other name, [12] description, [17] address (215 rows), [18] phone, [20]-[28]
    access, hours and fees, [29] an image path of the original system. No coordinates.
    The ID series: 1 cultural properties (buildings, statues, guardian figures, burial mounds),
    2 named trees, 3 performing arts, 4 literature, 5 food, 6 place names (areas),
    7 mountains and rivers, 8 townhouse terms and local history.

How a CSV site is located (no coordinates are made up; a name alone never places a point):
    1. The records of one site are grouped by column 7; the site name is the text before the
       full-width space ("南禅寺　三門" -> 南禅寺); names in brackets are aliases
       ("慈照寺（銀閣寺）" -> 慈照寺, 銀閣寺).
    2. OSM places of worship / historic / tourism features with exactly that name (or name:ja,
       alt_name, official_name) inside Kyoto Prefecture. If the CSV gives an address with a ward or
       city, the OSM place must lie in that ward or city (N03 polygons).
    3. A second, independent source must agree: the Wikidata item tagged on the OSM feature, or
       a Wikidata item with the same Japanese label, within 600 m.
    Only then is the location "verified". If there are several candidate places that cannot be
    told apart, or only one source, the site is "Unverified Location" and is not added.
Duplicates among the dashboard records are classed A-D as asked:
    A confirmed duplicate, B possible duplicate, C related POI (part of the same site),
    D distinct POI.
"""
import collections
import csv
import json
import math
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
OUT = os.path.join(ROOT, "data", "audit")
CSV_DEFAULT = os.path.join(ROOT, "data", "raw", "dsight", "DSIGHT_1.csv")

SERIES = {"1": "cultural property", "2": "named tree", "3": "performing art", "4": "literature", "5": "food",
          "6": "place name (area)", "7": "mountain or river", "8": "townhouse term or local history"}
# column 4 codes inside series 1, read from the records themselves
CODE_KIND = {"5020200": "building", "5020201": "building", "5020203": "building", "5020204": "object", "5020205": "object",
             "5080500": "guardian figure", "5080600": "burial mound"}


def nfkc(s):
    return unicodedata.normalize("NFKC", s or "")


def norm(s):
    return re.sub(r"[\s・･·\-‐ー()（）「」『』<>＜＞、,。.　]", "", nfkc(s)).lower()


def dist(a, b):
    kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110574)


def aliases(site):
    """'慈照寺（銀閣寺）' -> {'慈照寺（銀閣寺）', '慈照寺', '銀閣寺'}; also strips 総本山 and similar."""
    s = nfkc(site).strip()
    out = {s}
    for inner in re.findall(r"[（(<＜]([^）)>＞]+)[）)>＞]", s):
        out.add(inner)
    out.add(re.sub(r"[（(<＜][^）)>＞]+[）)>＞]", "", s))
    # '法輪寺＜西京区＞': the bracket names the ward, not another name of the temple
    return {x.strip() for x in out if len(norm(x)) >= 2 and not re.fullmatch(r"(京都市)?.{1,4}[区市町村]", x.strip())}


def split_name(name):
    """(site, part) for a record name: '南禅寺　三門' -> ('南禅寺', '三門')."""
    n = nfkc(name).strip()
    if " " in n:                                   # full-width space becomes a space under NFKC
        a, b = n.split(" ", 1)
        return a.strip(), b.strip()
    m = re.match(r"^(.+?[）)])(.+)$", n)           # '三十三間堂（蓮華王院）南大門'
    if m and len(m.group(2)) >= 2:
        return m.group(1), m.group(2)
    m = re.match(r"^(.+?)、(.+)$", n)               # '北野天満宮、梅苑の大むく'
    if m:
        return m.group(1), m.group(2)
    m = re.match(r"^(.+)の([^の]{1,8})$", n)         # '貴船神社の桂'
    if m:
        return m.group(1), m.group(2)
    return n, None


WARDS = ["北区", "上京区", "左京区", "中京区", "東山区", "下京区", "南区", "右京区", "伏見区", "山科区", "西京区"]


TOWNS = ["大山崎町", "久御山町", "井手町", "宇治田原町", "笠置町", "和束町", "精華町", "南山城村", "京丹波町", "伊根町", "与謝野町"]


def address_area(addr):
    """Ward (Kyoto City), city or town named in an address, or None ('南禅寺福地町' names none)."""
    a = nfkc(addr)
    for w in WARDS:
        if w in a:
            return "京都市 " + w
    for t in TOWNS:
        if t in a:
            return t
    m = re.search(r"([^\s都府県市区町村0-9]{1,4}市)", a)
    if m and m.group(1) != "京都市":
        return m.group(1)
    return None


def in_area(muni_name, area):
    return bool(muni_name) and area.split()[-1] in muni_name


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else CSV_DEFAULT
    os.makedirs(OUT, exist_ok=True)
    rows = list(csv.reader(open(src, encoding="utf-8-sig")))
    # the original records, never the map layer (which already holds the result of an earlier audit)
    A = json.load(open(os.path.join(ROOT, "data", "raw", "attractions.geojson"), encoding="utf-8"))["features"]
    en = json.load(open(os.path.join(DATA, "names_en.json"), encoding="utf-8"))["attractions"]
    ref = json.load(open(os.path.join(ROOT, "data", "cache", "osm_reference_kyoto.json"), encoding="utf-8"))
    wdc = json.load(open(os.path.join(ROOT, "data", "cache", "wikidata_ja_en_kyoto_box.json"), encoding="utf-8"))
    nodes = json.load(open(os.path.join(ROOT, "data", "cache", "osm_attraction_nodes.json"), encoding="utf-8"))["nodes"]
    wd_xy = {w["q"]: tuple(w["xy"]) for w in wdc if w.get("xy")}
    wd_by_label = collections.defaultdict(list)
    for w in wdc:
        if w.get("ja") and w.get("xy"):
            wd_by_label[norm(w["ja"])].append(w)

    # municipality of any point, from the N03 polygons
    from shapely.geometry import Point, shape
    from shapely.strtree import STRtree
    bf = json.load(open(os.path.join(ROOT, "data", "raw", "kyoto_boundary.geojson"), encoding="utf-8"))["features"]
    geoms = [shape(f["geometry"]) for f in bf]
    tree = STRtree(geoms)

    def muni(pt):
        for i in tree.query(Point(pt)):
            if geoms[i].contains(Point(pt)):
                p = bf[i]["properties"]
                return " ".join(x for x in (p["N03_004"], p["N03_005"]) if x)
        return None

    # ---------------- 1. dashboard records ----------------
    dash = []
    for f in A:
        p = f["properties"]
        dash.append({"id": p["id"], "osm_id": p["osm_id"], "name": p["name"] or "", "category": p["category"],
                     "xy": tuple(f["geometry"]["coordinates"]), "muni": muni(tuple(f["geometry"]["coordinates"])),
                     "en": (en.get(p["id"]) or {}).get("en"), "wikidata": (nodes.get(p["osm_id"]) or {}).get("tags", {}).get("wikidata")})
    dfind = []   # dashboard findings
    # 1a. coordinates
    for d in dash:
        lon, lat = d["xy"]
        if not (134.8 < lon < 136.1 and 34.7 < lat < 35.8):
            dfind.append((d["id"], "coordinates", "outside the prefecture's bounding box", "Unverified Location"))
        elif not d["muni"]:
            dfind.append((d["id"], "coordinates", "not inside any N03 municipality polygon", "Unverified Location"))
        n = nodes.get(d["osm_id"])
        if not n or "missing" in n:
            dfind.append((d["id"], "source", "OSM node no longer exists", "check"))
        elif dist(d["xy"], (n["lon"], n["lat"])) > 30:
            dfind.append((d["id"], "source", f"OSM node has moved {round(dist(d['xy'], (n['lon'], n['lat'])))} m since the snapshot", "check"))
    shared = collections.defaultdict(list)
    for d in dash:
        shared[(round(d["xy"][0], 6), round(d["xy"][1], 6))].append(d["id"])
    shared = {k: v for k, v in shared.items() if len(v) > 1}
    # 1b. duplicates among dashboard records
    pairs = []
    for i, a in enumerate(dash):
        for b in dash[i + 1:]:
            dd = dist(a["xy"], b["xy"])
            if dd > 500:
                continue
            na, nb = norm(a["name"]), norm(b["name"])
            same_wd = a["wikidata"] and a["wikidata"] == b["wikidata"]
            if not (na and nb) and not same_wd and dd > 1:
                continue
            if na and na == nb:
                cls = "A" if dd <= 50 and a["category"] == b["category"] else "B"
                why = f"same name, {round(dd)} m apart" + ("" if a["category"] == b["category"] else f", categories {a['category']} / {b['category']}")
            elif same_wd:
                cls = "A" if dd <= 50 else "B"
                why = f"both OSM nodes tag {a['wikidata']}, {round(dd)} m apart"
            elif dd <= 1:
                cls = "B"
                why = "identical coordinates"
            elif na and nb and min(len(na), len(nb)) >= 2 and (na in nb or nb in na):
                cls = "C"
                why = f"one name contains the other ({a['name']} / {b['name']}), {round(dd)} m apart: part of the same place"
            else:
                continue
            pairs.append({"a": a["id"], "b": b["id"], "a_name": a["name"], "b_name": b["name"], "distance_m": round(dd), "class": cls, "why": why})

    # ---------------- 2. DSIGHT_1.csv ----------------
    recs = []
    for r in rows:
        series = r[0][0]
        kind = CODE_KIND.get(r[4], SERIES.get(series)) if series == "1" else SERIES.get(series)
        # the building code also holds statues, paintings and sutras: the description says which
        if kind == "building" and re.search(r"美術工芸品|彫刻|絵画|書跡|典籍|工芸品|木造.{0,12}像|坐像|立像", r[12] + r[8]):
            kind = "object"
        site, part = split_name(r[8]) if series in "12" else (nfkc(r[8]).strip(), None)
        recs.append({"csv_id": r[0], "series": series, "code": r[4], "group": r[7].strip() or None, "name": r[8].strip(), "kana": r[9].strip(),
                     "alt_name": r[10].strip() or None, "address": r[17].strip() or None, "kind": kind, "site_from_name": site, "part": part,
                     })   # the description text is not copied: the file's source and licence are not stated
    # a named tree belongs to the site its name starts with ('北野天満宮しらがしの森' -> 北野天満宮,
    # '慈照寺の千代の槙' -> 慈照寺), when that site is known from the cultural-property records
    known = set()
    for x in recs:
        if x["series"] == "1" and x["kind"] != "burial mound":
            known |= {nfkc(k) for k in aliases(x["site_from_name"])}
    for x in recs:
        if x["series"] == "2":
            n = nfkc(x["name"])
            hit = max((k for k in known if n.startswith(k) and len(k) >= 2), key=len, default=None)
            if hit:
                x["site_from_name"], x["part"] = hit, n[len(hit):].lstrip("のの、 ") or None

    # a site per name: records whose site names share an alias are one site (column 7 is not used to
    # group: one column-7 value holds both 法金剛院 and 地蔵院 records); burial mounds are each their own site
    parent = {}

    def find(k):
        while parent.setdefault(k, k) != k:
            k = parent[k]
        return k
    keyed = [x for x in recs if x["series"] in "12"]
    first_with = {}
    for x in keyed:
        x["aliases"] = aliases(x["site_from_name"]) | (aliases(x["alt_name"]) if x["alt_name"] and x["part"] is None else set())
        k = "r" + x["csv_id"]
        find(k)
        if x["kind"] == "burial mound":
            continue
        for al in x["aliases"]:
            na = norm(al)
            if na in first_with:
                parent[find(k)] = find(first_with[na])
            else:
                first_with[na] = k
    groups = collections.defaultdict(list)
    for x in keyed:
        groups[find("r" + x["csv_id"])].append(x)
    sites = []
    for key, xs in groups.items():
        names = collections.Counter(x["site_from_name"] for x in xs)
        site = names.most_common(1)[0][0]
        al = set().union(*(x["aliases"] for x in xs))
        areas = {address_area(x["address"]) for x in xs if x["address"]} - {None}
        sites.append({"key": key, "site": site, "aliases": sorted(al), "records": [x["csv_id"] for x in xs], "areas": sorted(areas),
                      "addresses": sorted({x["address"] for x in xs if x["address"]}), "column7": sorted({x["group"] for x in xs if x["group"]})})
        for x in xs:
            x["site_key"] = key
            del x["aliases"]

    # ---------------- 3. locate each site ----------------
    els = ref["elements"]
    by_name = collections.defaultdict(list)
    for e in els:
        t = e["tags"]
        for k in ("name", "name:ja", "alt_name", "official_name", "old_name"):
            for v in (t.get(k) or "").split(";"):
                if v.strip():
                    by_name[norm(v)].append(e)

    by_qid = collections.defaultdict(list)
    for e in els:
        if e["tags"].get("wikidata"):
            by_qid[e["tags"]["wikidata"]].append(e)

    def kind_rank(e):
        t = e["tags"]
        return (t.get("amenity") == "place_of_worship" or t.get("historic") in ("castle", "tomb", "archaeological_site", "memorial", "monument") or t.get("tourism") in ("attraction", "museum"),
                not e["osm"].startswith("node"), "wikidata" in t)

    for s in sites:
        cands = {}
        for a in s["aliases"]:
            for e in by_name.get(norm(a), []):
                t = e["tags"]
                if t.get("natural") == "tree" and not s["key"].startswith("n"):
                    continue
                cands[e["osm"]] = e
            # the OSM name may differ (永観堂 is mapped as 禅林寺): a Wikidata item with this Japanese
            # label, and the OSM features that tag that item
            for w in wd_by_label.get(norm(a), []):
                for e in by_qid.get(w["q"], []):
                    cands.setdefault(e["osm"], e)
        cands = list(cands.values())
        s["osm_candidates"] = len(cands)
        if s["areas"]:
            inarea = [e for e in cands if any(in_area(muni((e["lon"], e["lat"])), ar) for ar in s["areas"])]
            if cands and not inarea:
                s["status"], s["reason"] = "Unverified Location", f"OSM places named {s['site']} lie outside the address area ({', '.join(s['areas'])})"
                continue
            cands = inarea
        # cluster candidates that are one place (within 400 m)
        clusters = []
        for e in sorted(cands, key=kind_rank, reverse=True):
            for c in clusters:
                if dist((e["lon"], e["lat"]), (c[0]["lon"], c[0]["lat"])) <= 400:
                    c.append(e)
                    break
            else:
                clusters.append([e])
        if not clusters:
            s["status"], s["reason"] = "Unverified Location", "no OpenStreetMap place with this name in Kyoto Prefecture"
            continue
        # a large temple or shrine: its precinct polygon plus same-name signs or attraction points
        # elsewhere in the precinct are one place (same ward, within 1.2 km, and either the same
        # Wikidata item or the other feature is not a place of worship itself)
        def worship(e):
            return e["tags"].get("amenity") == "place_of_worship"
        merged = True
        while merged and len(clusters) > 1:
            merged = False
            for i in range(len(clusters)):
                for j in range(i + 1, len(clusters)):
                    a0, b0 = clusters[i][0], clusters[j][0]
                    pa, pb = (a0["lon"], a0["lat"]), (b0["lon"], b0["lat"])
                    wa = {e["tags"].get("wikidata") for e in clusters[i]} - {None}
                    wb = {e["tags"].get("wikidata") for e in clusters[j]} - {None}
                    if dist(pa, pb) <= 1200 and muni(pa) == muni(pb) and (wa & wb or not all(worship(e) for e in clusters[i]) or not all(worship(e) for e in clusters[j])):
                        clusters[i] += clusters.pop(j)
                        clusters[i].sort(key=kind_rank, reverse=True)
                        merged = True
                        break
                if merged:
                    break
        if len(clusters) > 1:
            s["status"] = "Unverified Location"
            s["reason"] = f"{len(clusters)} different OSM places share this name" + (f" inside the address area ({', '.join(s['areas'])})" if s["areas"] else " and the CSV gives no address to tell them apart")
            s["candidates"] = [{"osm": c[0]["osm"], "muni": muni((c[0]["lon"], c[0]["lat"]))} for c in clusters[:6]]
            continue
        c = clusters[0]
        best = max(c, key=kind_rank)
        pt = (best["lon"], best["lat"])
        qid = next((e["tags"]["wikidata"] for e in c if e["tags"].get("wikidata")), None)
        wd_pt, wd_how = None, None
        if qid and qid in wd_xy:
            wd_pt, wd_how = wd_xy[qid], f"Wikidata {qid} tagged on the OSM feature"
        else:
            for a in s["aliases"]:
                near = [w for w in wd_by_label.get(norm(a), []) if dist(pt, tuple(w["xy"])) <= 600]
                if near:
                    w = min(near, key=lambda w: dist(pt, tuple(w["xy"])))
                    wd_pt, wd_how, qid = tuple(w["xy"]), f"Wikidata {w['q']} with the same Japanese label", qid or w["q"]
                    break
        s.update(osm=best["osm"], osm_name=best["tags"].get("name"), xy=[round(pt[0], 7), round(pt[1], 7)], muni=muni(pt), wikidata=qid,
                 name_en=best["tags"].get("name:en") or next((w["en"] for w in wdc if w["q"] == qid and w.get("en")), None),
                 name_en_source="OSM name:en" if best["tags"].get("name:en") else ("Wikidata label" if any(w["q"] == qid and w.get("en") for w in wdc) else None),
                 osm_tags={k: best["tags"][k] for k in ("amenity", "historic", "tourism", "religion", "denomination", "building", "natural") if k in best["tags"]},
                 point_is="site centre (polygon centre)" if not best["osm"].startswith("node") else "OSM point")
        if wd_pt is None:
            s["status"], s["reason"] = "Unverified Location", "found in OpenStreetMap only; no independent second source within 600 m"
        elif dist(pt, wd_pt) > 600:
            s["status"], s["reason"] = "Unverified Location", f"OSM and {wd_how} are {round(dist(pt, wd_pt))} m apart"
        else:
            s["status"] = "Verified"
            s["reason"] = f"OSM {best['osm']} and {wd_how} agree within {round(dist(pt, wd_pt))} m" + (f"; inside the address area {', '.join(s['areas'])}" if s["areas"] else "")

    # sites located at the same OSM feature are one site
    by_osm = {}
    for s in list(sites):
        if s.get("osm") and s["status"] == "Verified":
            if s["osm"] in by_osm:
                t = by_osm[s["osm"]]
                t["records"] += s["records"]; t["aliases"] = sorted(set(t["aliases"]) | set(s["aliases"]))
                t["addresses"] = sorted(set(t["addresses"]) | set(s["addresses"])); t["column7"] = sorted(set(t["column7"]) | set(s["column7"]))
                for x in recs:
                    if x.get("site_key") == s["key"]:
                        x["site_key"] = t["key"]
                sites.remove(s)
            else:
                by_osm[s["osm"]] = s

    # ---------------- 4. CSV sites against the dashboard ----------------
    for s in sites:
        al = {norm(a) for a in s["aliases"]}
        hits = []
        for d in dash:
            nd = norm(d["name"])
            if not nd:
                continue
            same = nd in al
            contains = any(len(a) >= 2 and (a in nd) for a in al)
            near = s.get("xy") and dist(d["xy"], s["xy"]) <= 700
            ward_ok = not s.get("xy") and s["areas"] and any(in_area(d["muni"], ar) for ar in s["areas"])
            if same and not (near or ward_ok):
                if not s.get("xy"):   # same name, but nothing to say it is the same place
                    hits.append({"id": d["id"], "name": d["name"], "category": d["category"], "distance_m": None, "relation": "same name only (not confirmed)"})
                continue
            if same or (contains and near):
                hits.append({"id": d["id"], "name": d["name"], "category": d["category"], "distance_m": round(dist(d["xy"], s["xy"])) if s.get("xy") else None,
                             "relation": "same site" if same else "part of the site"})
        # unnamed dashboard records whose own OSM node tags this site's Wikidata item
        for d in dash:
            if s.get("wikidata") and d["wikidata"] == s["wikidata"] and d["id"] not in {h["id"] for h in hits}:
                hits.append({"id": d["id"], "name": d["name"] or "(no name)", "category": d["category"], "distance_m": round(dist(d["xy"], s["xy"])), "relation": "same site (same Wikidata)"})
        s["dashboard"] = hits
        same = [h for h in hits if h["relation"].startswith("same site")]
        if same:
            s["action"] = f"already on the map as {', '.join(h['id'] for h in same)}: attach the CSV records to it"
            s["parent_id"] = same[0]["id"]
        elif s["status"] == "Verified":
            s["action"] = "add as a new site; attach the CSV records to it"
        else:
            s["action"] = "not added (location not verified); kept in this list"

    # ---------------- 5. per-record result ----------------
    site_of = {s["key"]: s for s in sites}
    for x in recs:
        if x["series"] in "12":
            s = site_of[x["site_key"]]
            x["site"] = s["site"]
            x["result"] = ("related POI of " + (s.get("parent_id") or ("new site " + s["site"])) if s["status"] == "Verified" or s.get("parent_id")
                           else "not placed: site location unverified")
        elif x["series"] in "345":
            x["result"] = "not a location (performing art, literature or food)"
        elif x["series"] == "6":
            hit = [d["id"] for d in dash if norm(d["name"]) == norm(x["name"])]
            x["result"] = "area name, not a point POI" + (f"; dashboard records with the same name: {', '.join(hit)}" if hit else "")
        elif x["series"] == "7":
            hit = [d["id"] for d in dash if norm(d["name"]) and norm(x["name"]) in norm(d["name"])]
            x["result"] = "natural feature, outside the dashboard's categories" + (f"; related dashboard records: {', '.join(hit)}" if hit else "")
        else:
            x["result"] = "local history or townhouse term, not a POI" if not x["address"] else "possible place; not located (no coordinates, single source)"

    # dashboard records that the CSV knows about
    matched_dash = sorted({h["id"] for s in sites for h in s["dashboard"]})

    summary = {
        "csv": {"file": os.path.basename(src), "rows": len(recs), "by_series": {SERIES[k]: v for k, v in sorted(collections.Counter(x["series"] for x in recs).items())},
                "sites": len(sites), "sites_verified": sum(1 for s in sites if s["status"] == "Verified"),
                "sites_already_on_map": sum(1 for s in sites if s.get("parent_id")),
                "sites_to_add": sum(1 for s in sites if s["status"] == "Verified" and not s.get("parent_id")),
                "sites_unverified": sum(1 for s in sites if s["status"] != "Verified" and not s.get("parent_id"))},
        "dashboard": {"records": len(dash), "named": sum(1 for d in dash if d["name"]), "with_csv_counterpart": len(matched_dash),
                      "coordinate_findings": len(dfind), "shared_coordinates": len(shared),
                      "pairs": dict(collections.Counter(p["class"] for p in pairs))},
    }
    doc = {"summary": summary, "dashboard_findings": [{"id": a, "topic": b, "finding": c, "status": d} for a, b, c, d in dfind],
           "dashboard_shared_coordinates": [{"xy": list(k), "ids": v} for k, v in shared.items()], "dashboard_pairs": pairs,
           "sites": sites, "records": recs, "dashboard_with_csv_counterpart": matched_dash}
    json.dump(doc, open(os.path.join(OUT, "poi_audit.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # checklist
    with open(os.path.join(OUT, "poi_audit_checklist.csv"), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["subject", "original_id", "name", "matched_to", "decision", "location_evidence", "final_result"])
        for s in sorted(sites, key=lambda s: s["site"]):
            w.writerow(["CSV site", " ".join(s["records"]), s["site"], "; ".join(f"{h['id']} {h['name']} ({h['relation']}, {h['distance_m']} m)" for h in s["dashboard"]) or (s.get("osm") or ""),
                        s["action"], f"{s['status']}: {s['reason']}", "parent " + s["parent_id"] if s.get("parent_id") else ("new POI" if s["status"] == "Verified" else "not added")])
        for x in recs:
            w.writerow(["CSV record", x["csv_id"], x["name"], x.get("site") or "", x["kind"], "", x["result"]])
        for p in pairs:
            w.writerow(["dashboard pair", f"{p['a']} {p['b']}", f"{p['a_name']} / {p['b_name']}", "", f"class {p['class']}", p["why"], "kept both" if p["class"] != "A" else "duplicate"])
        for f in doc["dashboard_findings"]:
            w.writerow(["dashboard record", f["id"], next(d["name"] for d in dash if d["id"] == f["id"]), "", f["topic"], f["finding"], f["status"]])

    # verified sites not on the map yet
    feats = []
    for s in sites:
        if s["status"] == "Verified" and not s.get("parent_id"):
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": s["xy"]},
                          "properties": {"site": s["site"], "aliases": s["aliases"], "osm": s["osm"], "osm_name": s["osm_name"], "wikidata": s["wikidata"],
                                         "name_en": s["name_en"], "name_en_source": s["name_en_source"], "osm_tags": s["osm_tags"], "point_is": s["point_is"], "muni": s["muni"],
                                         "dsight_ids": s["records"], "location_evidence": s["reason"]}})
    json.dump({"type": "FeatureCollection", "features": feats}, open(os.path.join(OUT, "dsight_sites.geojson"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
