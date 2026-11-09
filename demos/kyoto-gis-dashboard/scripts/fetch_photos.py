"""Attraction photos from Wikidata / Wikimedia Commons, with credits and licences.

Run from the project folder:  python3 scripts/fetch_photos.py
Needs: pip install pillow ; network access to query.wikidata.org, commons.wikimedia.org,
thumb.wikimedia.org (and upload.wikimedia.org).

How a photo is chosen (no photo is better than a wrong one):
  1. wikidata-exact   A Wikidata item inside Kyoto Prefecture with a P18 image whose Japanese
                      label equals the attraction's name (after Unicode/space normalisation)
                      and whose coordinates are within 300 m of the attraction point.
  2. wikidata-related Same, but one name contains the other (at least 3 characters). The photo
                      shows the related place (for example the temple a museum belongs to);
                      the UI says so and names that place.
  3. commons-geo      A Commons file found by searching the exact name, whose own camera/object
                      coordinates lie within 300 m of the attraction point.
Records without a name are never matched. Only free licences are kept: CC0, public domain,
CC BY and CC BY-SA. Files marked NC/ND or with no licence are skipped.

Output
  public/photos/<attraction_id>.jpg   960 px wide JPEG thumbnail
  public/data/photos.json             credits, licence, source page and how it was matched
"""
import io
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from html import unescape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
PHOTOS = os.path.join(ROOT, "public", "photos")
UA = "KyotoGIS-StudentProject/0.1 (university GIS prototype; non-commercial)"
MAX_DIST = 300.0
BOX = (134.84, 34.70, 136.06, 35.79)
MAX_WAIT = 120  # seconds; a longer Retry-After stops that step instead of hanging


class RateLimited(Exception):
    pass


FREE = re.compile(r"^(cc0|public domain|pd|cc by(-sa)? [\d.]+( [a-z]+)?|cc by(-sa)?)$", re.I)


def http(url, params=None, accept="application/json", tries=6):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                wait = int(e.headers.get("Retry-After") or 0) or 5 * (i + 1)
                if wait > MAX_WAIT:
                    raise RateLimited(f"server asked to wait {wait}s")
                print(f"  rate limited, waiting {wait}s", file=sys.stderr, flush=True)
                time.sleep(wait + 1)
                continue
            raise
        except Exception:
            time.sleep(3 * (i + 1))
    raise RuntimeError("giving up on " + url[:120])


def commons(params):
    params = {**params, "format": "json", "formatversion": "2"}
    out = json.loads(http("https://commons.wikimedia.org/w/api.php", params))
    time.sleep(1.0)
    return out


norm = lambda s: re.sub(r"[\s・･·\-‐()（）「」『』]", "", unicodedata.normalize("NFKC", s or "")).lower()


def dist(a, b):
    kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110574)


def plain(html):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", html or ""))).strip()


def main():
    os.makedirs(PHOTOS, exist_ok=True)
    A = json.load(open(os.path.join(DATA, "attractions.geojson"), encoding="utf-8"))["features"]
    named = [f for f in A if (f["properties"]["name"] or "").strip()]

    # 1-2. Wikidata items with an image inside the prefecture box
    q = f"""SELECT ?item ?label ?coord ?image WHERE {{
      SERVICE wikibase:box {{ ?item wdt:P625 ?coord .
        bd:serviceParam wikibase:cornerSouthWest "Point({BOX[0]} {BOX[1]})"^^geo:wktLiteral .
        bd:serviceParam wikibase:cornerNorthEast "Point({BOX[2]} {BOX[3]})"^^geo:wktLiteral . }}
      ?item wdt:P18 ?image . ?item rdfs:label ?label . FILTER(LANG(?label) = "ja") }}"""
    cache = os.path.join(ROOT, "data", "cache", "wikidata_p18_kyoto_box.json")
    try:
        raw = http("https://query.wikidata.org/sparql", {"query": q}, accept="application/sparql-results+json")
        open(cache, "wb").write(raw)
        wd_source = "live query"
    except (RateLimited, RuntimeError) as e:
        if not os.path.exists(cache):
            raise
        raw = open(cache, "rb").read()
        wd_source = f"cached query result data/cache/wikidata_p18_kyoto_box.json (live query failed: {e})"
        print("Using " + wd_source, file=sys.stderr, flush=True)
    wd = json.loads(raw)["results"]["bindings"]
    items = []
    for b in wd:
        lon, lat = map(float, re.findall(r"[-\d.]+", b["coord"]["value"]))
        items.append({"qid": b["item"]["value"].rsplit("/", 1)[-1], "label": b["label"]["value"], "lon": lon, "lat": lat,
                      "file": "File:" + urllib.parse.unquote(b["image"]["value"].rsplit("/", 1)[-1])})
    print("Wikidata items with images in the box:", len(items), flush=True)

    pick = {}
    for f in named:
        n = norm(f["properties"]["name"])
        c = f["geometry"]["coordinates"]
        best = None
        for it in items:
            d = dist(c, (it["lon"], it["lat"]))
            if d > MAX_DIST:
                continue
            nl = norm(it["label"])
            kind = "wikidata-exact" if nl == n else ("wikidata-related" if len(min(nl, n, key=len)) >= 3 and (nl in n or n in nl) else None)
            if not kind:
                continue
            rank = (kind == "wikidata-exact", -d)
            if best is None or rank > best[0]:
                best = (rank, {"match": kind, "file": it["file"], "wikidata": it["qid"], "matched_label": it["label"], "distance_m": round(d)})
        if best:
            pick[f["properties"]["id"]] = best[1]
    print("Wikidata matches:", len(pick), flush=True)

    # 3. Commons search fallback with a distance check on the file's own coordinates
    rest = [f for f in named if f["properties"]["id"] not in pick and len(f["properties"]["name"].strip()) >= 2]
    if "--no-commons-search" in sys.argv:
        rest = []
    commons_search_note = "completed"
    for i, f in enumerate(rest):
        n = f["properties"]["name"].strip()
        try:
            r = commons({"action": "query", "generator": "search", "gsrsearch": f'"{n}" filetype:bitmap', "gsrnamespace": 6, "gsrlimit": 15,
                     "prop": "coordinates|imageinfo", "iiprop": "size|mime", "colimit": "max"})
        except RateLimited as e:
            commons_search_note = f"stopped after {i} of {len(rest)} names: Commons rate limit ({e})"
            print("  " + commons_search_note, file=sys.stderr, flush=True)
            break
        best = None
        for pg in (r.get("query") or {}).get("pages", []):
            co = pg.get("coordinates")
            ii = (pg.get("imageinfo") or [{}])[0]
            if not co or ii.get("mime") not in ("image/jpeg", "image/png") or ii.get("width", 0) < 800:
                continue
            d = dist(f["geometry"]["coordinates"], (co[0]["lon"], co[0]["lat"]))
            if d <= MAX_DIST and (best is None or d < best["distance_m"]):
                best = {"match": "commons-geo", "file": pg["title"], "wikidata": None, "matched_label": None, "distance_m": round(d)}
        if best:
            pick[f["properties"]["id"]] = best
        if i % 25 == 0:
            print(f"  commons search {i}/{len(rest)}; total picks {len(pick)}", file=sys.stderr)
    print("After Commons search:", len(pick))

    # Credits, licence and thumbnail URL, 40 files per request
    files = sorted({p["file"] for p in pick.values()})
    info = {}
    for k in range(0, len(files), 40):
        r = commons({"action": "query", "titles": "|".join(files[k:k + 40]), "prop": "imageinfo", "iiprop": "url|extmetadata|size", "iiurlwidth": 960})
        norm_map = {x["from"]: x["to"] for x in (r.get("query") or {}).get("normalized", [])}
        back = {v: k2 for k2, v in norm_map.items()}
        for pg in (r.get("query") or {}).get("pages", []):
            if "imageinfo" not in pg:
                continue
            ii = pg["imageinfo"][0]
            m = ii.get("extmetadata", {})
            g = lambda key: plain(m.get(key, {}).get("value", ""))
            info[back.get(pg["title"], pg["title"])] = info[pg["title"]] = {
                "thumb": ii.get("thumburl"), "page": ii.get("descriptionurl"), "artist": g("Artist") or "Unknown author",
                "license": g("LicenseShortName"), "license_url": g("LicenseUrl") or None, "description": g("ImageDescription")[:200],
                "date": g("DateTimeOriginal")[:10] or None}

    from PIL import Image
    out, skipped = {}, []
    for aid, p in sorted(pick.items()):
        meta = info.get(p["file"])
        if not meta or not meta["thumb"]:
            skipped.append((aid, "no image info"))
            continue
        lic = meta["license"]
        if not FREE.match(lic.strip()) or re.search(r"\b(nc|nd)\b", lic, re.I):
            skipped.append((aid, f"licence not free: {lic or 'none'}"))
            continue
        raw = http(meta["thumb"], accept="image/*")
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        if im.width > 720:
            im = im.resize((720, round(im.height * 720 / im.width)), Image.LANCZOS)
        im.save(os.path.join(PHOTOS, f"{aid}.jpg"), "JPEG", quality=72, optimize=True, progressive=True)
        out[aid] = {**p, "src": f"photos/{aid}.jpg", "width": im.width, "height": im.height, "title": p["file"][5:],
                    "artist": meta["artist"], "license": lic, "license_url": meta["license_url"], "page": meta["page"],
                    "date": meta["date"], "description": meta["description"]}
        time.sleep(0.3)

    doc = {"source": "Wikidata (P18) and Wikimedia Commons", "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "rules": {"max_distance_m": MAX_DIST, "licences": "CC0, public domain, CC BY, CC BY-SA only", "named_records_only": True},
           "wikidata_source": wd_source,
           "named_records": len(named), "with_photo": len(out),
           "commons_search": "skipped (--no-commons-search)" if "--no-commons-search" in sys.argv else commons_search_note,
           "by_match": {k: sum(1 for v in out.values() if v["match"] == k) for k in ("wikidata-exact", "wikidata-related", "commons-geo")},
           "skipped": [{"id": a, "reason": r} for a, r in skipped], "photos": out}
    json.dump(doc, open(os.path.join(DATA, "photos.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: doc[k] for k in ("named_records", "with_photo", "by_match")}, ensure_ascii=False), "skipped:", len(skipped))


if __name__ == "__main__":
    main()
