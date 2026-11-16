"""More attraction photos: Wikimedia Commons files that name the place AND were taken right there.

Run from the project folder (after fetch_photos.py and fetch_photos_linked.py):
    python3 scripts/fetch_photos_search.py --dry-run     # find candidates, write a list to review
    python3 scripts/fetch_photos_search.py               # add the reviewed ones (REJECTED excluded)
Needs: pip install pillow ; network access to commons.wikimedia.org and upload.wikimedia.org.

C. Commons search  (match: commons-search)
   Only named records that still have no photo. The Commons search is asked for files that mention the
   record's Japanese name (or its English name, if it has one of at least two words) AND whose own
   camera coordinates are within 300 m of the record's point (CirrusSearch "nearcoord"). A file is kept
   only if the name also appears in its title or in one of its categories (a passing mention in a long
   description is not enough), it is a JPEG or PNG photo at least 800 px wide, and its licence is free
   (CC0, public domain, CC BY, CC BY-SA). The nearest such file is taken.
   Names that describe a kind of place (展望台, 駐車場, ...) or that several records share are not searched.
   Every candidate was then looked at by eye; ones that do not show the place are listed in REJECTED.
Output: public/photos/<id>.jpg and public/data/photos.json (new entries added, nothing replaced).
"""
import io
import json
import os
import re
import sys
import time
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_photos import DATA, FREE, PHOTOS, ROOT, commons, dist, http, norm, plain  # noqa: E402
from fetch_photos_linked import GENERIC, REJECTED as REJECTED_EARLIER  # noqa: E402

RADIUS = 300  # metres, from the file's own camera coordinates to the record's point
# candidates looked at by eye and turned down (right name, place and licence, but they do not show the place)
REJECTED = {**REJECTED_EARLIER}   # the same four photos come up again here; they were already turned down by eye
DRY = os.path.join(ROOT, "data", "cache", "photos_search_candidates.json")


def candidates(text, lon, lat):
    r = commons({"action": "query", "list": "search", "srnamespace": 6, "srlimit": 20,
                 "srsearch": f'"{text}" nearcoord:{RADIUS}m,{lat:.6f},{lon:.6f}'})
    titles = [x["title"] for x in (r.get("query") or {}).get("search", [])]
    if not titles:
        return []
    r = commons({"action": "query", "titles": "|".join(titles), "prop": "coordinates|categories|imageinfo",
                 "iiprop": "size|mime", "cllimit": "max", "clshow": "!hidden", "colimit": "max"})
    out = []
    for pg in (r.get("query") or {}).get("pages", []):
        co, ii = pg.get("coordinates"), (pg.get("imageinfo") or [{}])[0]
        if not co or ii.get("mime") not in ("image/jpeg", "image/png") or ii.get("width", 0) < 800:
            continue
        out.append({"file": pg["title"], "xy": (co[0]["lon"], co[0]["lat"]), "cats": [c["title"][9:] for c in pg.get("categories", [])]})
    return out


def main():
    dry = "--dry-run" in sys.argv
    A = json.load(open(os.path.join(DATA, "attractions.geojson"), encoding="utf-8"))["features"]
    doc = json.load(open(os.path.join(DATA, "photos.json"), encoding="utf-8"))
    have = doc["photos"]
    shared = Counter(norm(f["properties"].get("name") or "") for f in A)
    todo = [f for f in A if f["properties"]["id"] not in have and (f["properties"].get("name") or "").strip()]
    pick, notes = {}, []
    if not dry and os.path.exists(DRY):
        pick = {k: v for k, v in json.load(open(DRY, encoding="utf-8"))["found"].items() if k not in REJECTED}
        notes = [(k, f"Commons photo {pick_['file']} turned down: {REJECTED[k]}") for k, pick_ in json.load(open(DRY, encoding="utf-8"))["found"].items() if k in REJECTED]
    else:
        prog_path = os.path.join(ROOT, "data", "cache", "photos_search_progress.json")
        prog = json.load(open(prog_path, encoding="utf-8")) if os.path.exists(prog_path) else {}
        for i, f in enumerate(todo, 1):
            p = f["properties"]
            if p["id"] in prog:   # already searched in an earlier run
                if prog[p["id"]]:
                    pick[p["id"]] = prog[p["id"]]
                continue
            name, en = p["name"].strip(), (p.get("name_en") or "").strip()
            n = norm(name)
            if n in GENERIC or shared[n] > 1 or len(n) < 2:
                continue
            terms = [(name, n)]
            if len(en.split()) >= 2:
                terms.append((en, norm(en)))
            best = None
            for text, key in terms:
                for c in candidates(text, *f["geometry"]["coordinates"]):
                    where = "file name" if key in norm(c["file"][5:]) else next((cat for cat in c["cats"] if key in norm(cat)), None)
                    if not where:
                        continue
                    d = dist(tuple(f["geometry"]["coordinates"]), c["xy"])
                    if d <= RADIUS and (best is None or d < best["distance_m"]):
                        best = {"match": "commons-search", "file": c["file"], "wikidata": None, "matched_text": text,
                                "matched_label": None if where == "file name" else "Category:" + where, "distance_m": round(d)}
                if best:
                    break
            if best:
                pick[p["id"]] = best
            prog[p["id"]] = best
            json.dump(prog, open(prog_path, "w", encoding="utf-8"), ensure_ascii=False)
            if i % 20 == 0:
                print(f"  {i}/{len(todo)} checked, {len(pick)} found", flush=True)
        print("C. Commons files that name the place and were taken within", RADIUS, "m:", len(pick), flush=True)

    # credits, licences, thumbnails (as in fetch_photos_linked.py)
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
    review = os.path.join(ROOT, "data", "cache", "photos_search_review")
    os.makedirs(review, exist_ok=True)
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
        im = Image.open(io.BytesIO(http(meta["thumb"], accept="image/*"))).convert("RGB")
        if im.width > 720:
            im = im.resize((720, round(im.height * 720 / im.width)), Image.LANCZOS)
        im.save(os.path.join(review if dry else PHOTOS, f"{aid}.jpg"), "JPEG", quality=72, optimize=True, progressive=True)
        entry.update(width=im.width, height=im.height)
        time.sleep(0.3)
        added[aid] = entry
    if dry:
        json.dump({"found": pick, "added": added, "skipped": skipped}, open(DRY, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("dry run:", len(added), "candidates to review in", review, ";", len(skipped), "skipped")
        return
    have.update(added)
    kinds = ("wikidata-exact", "wikidata-related", "commons-geo", "osm-wikidata", "osm-image", "osm-commons", "commons-near", "site-wikidata", "commons-search")
    doc.update({
        "source": "Wikidata (P18), Wikimedia Commons and the records' own OpenStreetMap links",
        "search_retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rules": {**doc["rules"], "commons_search_m": RADIUS},
        "named_records": sum(1 for f in A if (f["properties"]["name"] or "").strip()), "records": len(A),
        "with_photo": len(have), "with_photo_named": sum(1 for f in A if f["properties"]["id"] in have and (f["properties"]["name"] or "").strip()),
        "by_match": {k: sum(1 for v in have.values() if v["match"] == k) for k in kinds},
        "skipped": doc.get("skipped", []) + [{"id": a, "reason": r} for a, r in skipped],
        "search_notes": [{"id": a, "note": r} for a, r in notes],
    })
    json.dump(doc, open(os.path.join(DATA, "photos.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: doc[k] for k in ("with_photo", "with_photo_named", "by_match")}, ensure_ascii=False), "| skipped:", len(skipped), "| turned down:", len(notes))


if __name__ == "__main__":
    main()
