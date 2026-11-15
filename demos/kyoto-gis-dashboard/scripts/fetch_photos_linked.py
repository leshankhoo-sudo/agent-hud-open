"""More attraction photos, added to the ones from fetch_photos.py (run that first).

Run from the project folder:  python3 scripts/fetch_photos_linked.py [--refresh-osm] [--dry-run]
Needs: pip install pillow ; network access to api.openstreetmap.org, www.wikidata.org,
commons.wikimedia.org and upload.wikimedia.org.

Two ways, both stricter than a name search:

  A. The record's own OpenStreetMap node links to it  (match: osm-wikidata / osm-image / osm-commons)
     Every attraction keeps its osm_id (a node of the Geofabrik POI layer). The current node is read
     from the OSM API and must still be at the same place (within 30 m) with the same name. If the
     node itself carries wikidata=Q..., the photo is that item's image (P18); otherwise its
     wikipedia=, image= or wikimedia_commons= tag is used. This is the same record's own data, not
     a guess from a name, so it may also give a photo to a record whose name is blank (the UI then
     says which item the photo comes from). If the linked item has coordinates more than 1 km away,
     the link is not used, and so is an item with no coordinates at all (a company, a class of
     locomotive: not a place, so its picture would not show this one). Only JPEG/PNG photos are used,
     never logos or drawings.
     A link of the record's own node replaces an earlier "related place" photo, never an exact one.

  A2. Sites added by the POI audit  (match: site-wikidata)
     Records added from DSIGHT_1.csv (scripts/poi_reconcile.py) carry the Wikidata item that, with
     OpenStreetMap, confirmed their location. Their photo is that item's image (P18), under the same
     rules as A (item within 1 km, JPEG/PNG only).

  B. Commons photos taken right there  (match: commons-near)
     Only records with a name and still no photo. Commons files whose own coordinates are within
     150 m of the point, and whose file name or one of whose categories contains the record's full
     name. Names that do not say which place they are (展望台, 駐車場, ...) or that several records
     share are not used. The nearest such file is taken.

Only free licences are kept (CC0, public domain, CC BY, CC BY-SA), as in fetch_photos.py.
Output: public/photos/<id>.jpg and the same public/data/photos.json, with the new entries added.
Cache: data/cache/osm_attraction_nodes.json (the OSM nodes as read; --refresh-osm reads them again).
"""
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_photos import DATA, FREE, PHOTOS, ROOT, UA, commons, dist, http, norm, plain  # noqa: E402

LINK_MAX = 1000.0   # a linked item farther than this from the point is not trusted
NEAR = 150.0        # Commons photo taken within this distance
# photos checked by eye and turned down: right place and licence, but they do not show the place
REJECTED = {
    "A00041": "shows a lift button panel inside the building",
    "A00123": "shows a construction site and scaffolding",
    "A00138": "shows the entrance of one restaurant, not the street",
    "A00227": "shows the inside of one building, not the district",
}
NODE_CACHE = os.path.join(ROOT, "data", "cache", "osm_attraction_nodes.json")
# names that describe a kind of place, not one place
GENERIC = {norm(x) for x in ("展望台", "展望所", "展望広場", "見晴台", "見晴らし台", "展望スポット", "ビューポイント", "駐車場", "休憩所",
                             "東屋", "あずまや", "公園", "広場", "資料館", "記念館", "博物館", "美術館", "城跡", "城址", "滝", "碑", "記念碑")}


def osm_nodes(ids):
    if os.path.exists(NODE_CACHE) and "--refresh-osm" not in sys.argv:
        return json.load(open(NODE_CACHE, encoding="utf-8"))
    got = {}
    for k in range(0, len(ids), 100):
        chunk = ids[k:k + 100]
        try:
            data = json.loads(http("https://api.openstreetmap.org/api/0.6/nodes.json", {"nodes": ",".join(chunk)}))
        except Exception:  # a deleted node fails the whole request: read them one by one
            data = {"elements": []}
            for i in chunk:
                try:
                    data["elements"] += json.loads(http(f"https://api.openstreetmap.org/api/0.6/node/{i}.json", tries=2))["elements"]
                except Exception as e:
                    got[i] = {"missing": str(e)[:80]}
        for e in data["elements"]:
            got[str(e["id"])] = {"lon": e.get("lon"), "lat": e.get("lat"), "version": e.get("version"), "timestamp": e.get("timestamp"), "tags": e.get("tags", {})}
        time.sleep(1)
    doc = {"retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": "https://api.openstreetmap.org/api/0.6/nodes", "nodes": got}
    json.dump(doc, open(NODE_CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    return doc


def wd_entities(qids):
    out = {}
    qids = sorted(set(qids))
    for k in range(0, len(qids), 50):
        r = json.loads(http("https://www.wikidata.org/w/api.php", {"action": "wbgetentities", "ids": "|".join(qids[k:k + 50]), "props": "claims|labels|sitelinks", "languages": "ja|en", "format": "json"}))
        for q, e in r.get("entities", {}).items():
            c = e.get("claims", {})
            val = lambda p: [x["mainsnak"].get("datavalue", {}).get("value") for x in c.get(p, []) if x["mainsnak"].get("datavalue")]
            co = val("P625")
            out[q] = {"p18": val("P18"), "coord": (co[0]["longitude"], co[0]["latitude"]) if co else None, "p373": val("P373"),
                      "label": (e.get("labels", {}).get("ja") or e.get("labels", {}).get("en") or {}).get("value")}
        time.sleep(1)
    return out


def wikipedia_qid(tag):
    m = re.match(r"^([a-z\-]+):(.+)$", tag.strip())
    if not m:
        return None
    lang, title = m.groups()
    r = json.loads(http(f"https://{lang}.wikipedia.org/w/api.php", {"action": "query", "titles": title, "prop": "pageprops", "ppprop": "wikibase_item", "redirects": 1, "format": "json"}))
    for pg in r.get("query", {}).get("pages", {}).values():
        q = pg.get("pageprops", {}).get("wikibase_item")
        if q:
            return q
    return None


def commons_file(tag):
    """File: title from an image= or wikimedia_commons= value, if it points at a Commons file."""
    t = urllib.parse.unquote(tag.strip())
    m = re.search(r"(?:commons\.wikimedia\.org/wiki/|upload\.wikimedia\.org/.+/)(File:[^?#]+|[^/?#]+\.(?:jpe?g|png))$", t, re.I)
    if m:
        t = m.group(1)
    if re.match(r"^(File|Image):", t, re.I):
        return "File:" + t.split(":", 1)[1].replace("_", " ")
    return None


def category_file(cat, point):
    """The Commons file in a category whose own coordinates are nearest the point (within 300 m)."""
    r = commons({"action": "query", "generator": "categorymembers", "gcmtitle": cat if cat.startswith("Category:") else "Category:" + cat, "gcmtype": "file", "gcmlimit": 100,
                 "prop": "coordinates|imageinfo", "iiprop": "size|mime", "colimit": "max"})
    best = None
    for pg in (r.get("query") or {}).get("pages", []):
        co, ii = pg.get("coordinates"), (pg.get("imageinfo") or [{}])[0]
        if not co or ii.get("mime") not in ("image/jpeg", "image/png") or ii.get("width", 0) < 800:
            continue
        d = dist(point, (co[0]["lon"], co[0]["lat"]))
        if d <= 300 and (best is None or d < best[1]):
            best = (pg["title"], d)
    return best


def main():
    dry = "--dry-run" in sys.argv
    A = json.load(open(os.path.join(DATA, "attractions.geojson"), encoding="utf-8"))["features"]
    doc = json.load(open(os.path.join(DATA, "photos.json"), encoding="utf-8"))
    have = doc["photos"]
    nodes = osm_nodes([f["properties"]["osm_id"] for f in A])["nodes"]
    pick, notes = {}, []

    # ---------- A. links on the record's own OSM node ----------
    linked = []
    for f in A:
        p = f["properties"]
        if p.get("osm_element") and not p["osm_element"].startswith("node/"):
            continue   # an added site: its OSM feature is a way or relation, handled in A2
        n = nodes.get(p["osm_id"]) if not p.get("dsight_ids") else None
        if not n or "missing" in n:
            continue
        if dist(f["geometry"]["coordinates"], (n["lon"], n["lat"])) > 30 or (n["tags"].get("name") or "") != (p["name"] or ""):
            notes.append((p["id"], "OSM node has moved or been renamed since the snapshot; its links are not used"))
            continue
        t = n["tags"]
        if any(k in t for k in ("wikidata", "wikipedia", "image", "wikimedia_commons")):
            linked.append((f, t))
    qid_of = {}
    for f, t in linked:
        q = t.get("wikidata", "").split(";")[0].strip()
        if not q and t.get("wikipedia"):
            q = wikipedia_qid(t["wikipedia"]) or ""
            time.sleep(0.5)
        if re.match(r"^Q\d+$", q):
            qid_of[f["properties"]["id"]] = q
    site_q = {f["properties"]["id"]: f["properties"]["wikidata"] for f in A if f["properties"].get("dsight_ids") and f["properties"].get("wikidata") and f["properties"]["id"] not in have}
    ents = wd_entities(list(qid_of.values()) + list(site_q.values()))
    for f, t in linked:
        p, pt = f["properties"], f["geometry"]["coordinates"]
        old = have.get(p["id"])
        if old and old["match"] != "wikidata-related":
            continue   # already an exact or own-link photo
        q = qid_of.get(p["id"])
        e = ents.get(q) if q else None
        d = dist(pt, e["coord"]) if e and e["coord"] else None
        if e and d is not None and d > LINK_MAX:
            notes.append((p["id"], f"OSM wikidata={q} has coordinates {round(d)} m away; not used"))
            e = None
        if e and d is None:
            notes.append((p["id"], f"OSM wikidata={q} ({e['label']}) has no coordinates, so it is not a place; not used"))
            e = None
        cand = None
        photo18 = next((x for x in (e["p18"] if e else []) if re.search(r"\.(jpe?g|png)$", x, re.I)), None)
        if photo18:
            cand = {"match": "osm-wikidata", "file": "File:" + photo18, "wikidata": q, "matched_label": e["label"], "distance_m": round(d) if d is not None else None}
        for key in ("image", "wikimedia_commons"):
            if cand or key not in t:
                continue
            fl = commons_file(t[key])
            if fl and re.search(r"\.(jpe?g|png)$", fl, re.I):
                cand = {"match": "osm-image" if key == "image" else "osm-commons", "file": fl, "wikidata": q, "matched_label": e["label"] if e else None, "distance_m": None}
            elif key == "wikimedia_commons" and t[key].startswith("Category:"):
                best = category_file(t[key], pt)
                if best:
                    cand = {"match": "osm-commons", "file": best[0], "wikidata": q, "matched_label": t[key][9:], "distance_m": round(best[1])}
        if not cand and e and e["p373"]:   # the item's own Commons category, nearest photo within 300 m
            best = category_file(e["p373"][0], pt)
            if best:
                cand = {"match": "osm-wikidata", "file": best[0], "wikidata": q, "matched_label": e["label"], "distance_m": round(best[1])}
        if cand:
            cand["osm_tags"] = {k: t[k] for k in ("wikidata", "wikipedia", "image", "wikimedia_commons") if k in t}
            pick[p["id"]] = cand
        else:
            notes.append((p["id"], f"OSM links ({', '.join(k for k in ('wikidata', 'wikipedia', 'image', 'wikimedia_commons') if k in t)}) lead to no usable photo"))
    print("A. records whose own node links somewhere:", len(linked), "| new or upgraded photos:", len(pick), flush=True)
    na2 = 0
    for f in A:
        p = f["properties"]
        q = site_q.get(p["id"])
        e = ents.get(q) if q else None
        if not e:
            continue
        d = dist(f["geometry"]["coordinates"], e["coord"]) if e["coord"] else None
        photo18 = next((x for x in e["p18"] if re.search(r"\.(jpe?g|png)$", x, re.I)), None)
        if d is None or d > LINK_MAX or not photo18:
            notes.append((p["id"], f"added site: Wikidata {q} gives no usable photo" + (f" ({round(d)} m away)" if d and d > LINK_MAX else "")))
            continue
        pick[p["id"]] = {"match": "site-wikidata", "file": "File:" + photo18, "wikidata": q, "matched_label": e["label"], "distance_m": round(d)}
        na2 += 1
    print("A2. added sites with a photo of their Wikidata item:", na2, flush=True)

    # ---------- B. Commons photos taken within 150 m whose file name or category names the place ----------
    names = Counter(norm(f["properties"]["name"]) for f in A if (f["properties"]["name"] or "").strip())
    rest = [f for f in A if (f["properties"]["name"] or "").strip() and f["properties"]["id"] not in have and f["properties"]["id"] not in pick]
    nb = 0
    for i, f in enumerate(rest):
        p, pt = f["properties"], f["geometry"]["coordinates"]
        n = norm(p["name"])
        if len(n) < 3 or n in GENERIC or names[n] > 1:
            continue
        r = commons({"action": "query", "generator": "geosearch", "ggscoord": f"{pt[1]}|{pt[0]}", "ggsradius": int(NEAR), "ggsnamespace": 6, "ggslimit": 100,
                     "prop": "coordinates|categories|imageinfo", "iiprop": "size|mime", "cllimit": "max", "colimit": "max", "clshow": "!hidden"})
        best = None
        for pg in (r.get("query") or {}).get("pages", []):
            co, ii = pg.get("coordinates"), (pg.get("imageinfo") or [{}])[0]
            if not co or ii.get("mime") not in ("image/jpeg", "image/png") or ii.get("width", 0) < 800:
                continue
            d = dist(pt, (co[0]["lon"], co[0]["lat"]))
            if d > NEAR:
                continue
            cats = [c["title"][9:] for c in pg.get("categories", [])]
            where = "file name" if n in norm(pg["title"][5:]) else next((c for c in cats if n in norm(c)), None)
            if where and (best is None or d < best["distance_m"]):
                best = {"match": "commons-near", "file": pg["title"], "wikidata": None, "matched_label": None if where == "file name" else "Category:" + where, "distance_m": round(d)}
        if best and p["id"] in REJECTED:
            notes.append((p["id"], f"nearby Commons photo {best['file']} turned down: {REJECTED[p['id']]}"))
        elif best:
            pick[p["id"]] = best
            nb += 1
        if i % 25 == 0:
            print(f"  B. {i}/{len(rest)} checked, {nb} found", flush=True)
    print("B. Commons photos taken nearby that name the place:", nb, flush=True)

    # ---------- credits, licences, thumbnails ----------
    files = sorted({p["file"] for p in pick.values()})
    info = {}
    for k in range(0, len(files), 40):
        r = commons({"action": "query", "titles": "|".join(files[k:k + 40]), "prop": "imageinfo", "iiprop": "url|extmetadata|size", "iiurlwidth": 960})
        back = {x["to"]: x["from"] for x in (r.get("query") or {}).get("normalized", [])}
        for pg in (r.get("query") or {}).get("pages", []):
            if "imageinfo" not in pg:
                continue
            ii, m = pg["imageinfo"][0], pg["imageinfo"][0].get("extmetadata", {})
            g = lambda key: plain(m.get(key, {}).get("value", ""))
            info[back.get(pg["title"], pg["title"])] = info[pg["title"]] = {
                "thumb": ii.get("thumburl"), "page": ii.get("descriptionurl"), "artist": g("Artist") or "Unknown author",
                "license": g("LicenseShortName"), "license_url": g("LicenseUrl") or None, "description": g("ImageDescription")[:200],
                "date": g("DateTimeOriginal")[:10] or None}
    from PIL import Image
    added, skipped = {}, []
    for aid, p in sorted(pick.items()):
        meta = info.get(p["file"])
        if not meta or not meta["thumb"]:
            skipped.append((aid, "no image info"))
            continue
        lic = meta["license"]
        if not FREE.match(lic.strip()) or re.search(r"\b(nc|nd)\b", lic, re.I):
            skipped.append((aid, f"licence not free: {lic or 'none'}"))
            continue
        entry = {**p, "src": f"photos/{aid}.jpg", "title": p["file"][5:], "artist": meta["artist"], "license": lic,
                 "license_url": meta["license_url"], "page": meta["page"], "date": meta["date"], "description": meta["description"]}
        if not dry:
            im = Image.open(io.BytesIO(http(meta["thumb"], accept="image/*"))).convert("RGB")
            if im.width > 720:
                im = im.resize((720, round(im.height * 720 / im.width)), Image.LANCZOS)
            im.save(os.path.join(PHOTOS, f"{aid}.jpg"), "JPEG", quality=72, optimize=True, progressive=True)
            entry.update(width=im.width, height=im.height)
            time.sleep(0.3)
        added[aid] = entry
    if dry:
        json.dump({"added": added, "skipped": skipped, "notes": notes}, open(os.path.join(ROOT, "data", "cache", "photos_linked_dryrun.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("dry run:", len(added), "would be added;", len(skipped), "skipped")
        return
    have.update(added)
    kinds = ("wikidata-exact", "wikidata-related", "commons-geo", "osm-wikidata", "osm-image", "osm-commons", "commons-near", "site-wikidata")
    named = sum(1 for f in A if (f["properties"]["name"] or "").strip())
    doc.update({
        "source": "Wikidata (P18), Wikimedia Commons and the records' own OpenStreetMap links",
        "linked_retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rules": {**doc["rules"], "named_records_only": False, "unnamed_records": "only through a link on the record's own OSM node",
                  "osm_link_max_distance_m": LINK_MAX, "commons_near_m": NEAR},
        "with_photo": len(have), "with_photo_named": sum(1 for f in A if f["properties"]["id"] in have and (f["properties"]["name"] or "").strip()),
        "named_records": named, "records": len(A),
        "by_match": {k: sum(1 for v in have.values() if v["match"] == k) for k in kinds},
        "skipped": doc.get("skipped", []) + [{"id": a, "reason": r} for a, r in skipped],
        "linked_notes": [{"id": a, "note": r} for a, r in notes],
    })
    json.dump(doc, open(os.path.join(DATA, "photos.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: doc[k] for k in ("with_photo", "with_photo_named", "by_match")}, ensure_ascii=False), "| skipped:", len(skipped))


if __name__ == "__main__":
    main()
