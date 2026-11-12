"""Context for attraction records that have no name in OpenStreetMap (218 of 523).

Two kinds of evidence, both about the SAME OSM element or its location, never a match by name:
1. Tags on the same OSM element (cache: data/cache/osm_elements.json): name:en, wikidata, website, ...
   -> identity "osm_tags"; an English name is taken only from that element's own name:en.
2. Named OSM areas that contain the point (Overpass is_in, cache: data/cache/osm_is_in_unnamed.json),
   e.g. "inside the grounds of 金閣寺". Administrative areas, islands and very broad areas are skipped.
   This is a location relationship; it does not say the point IS that place.
Records with neither stay "unverified".

Run: python3 scripts/prepare_context.py      (offline; reads the two caches)
To refresh the Overpass cache, see fetch_is_in() below (needs network).
Output: public/data/attraction_context.json
"""
import datetime as dt
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
CACHE = os.path.join(ROOT, "data", "cache")
ID_TAGS = ("name:ja", "name:en", "wikidata", "wikipedia", "website", "opening_hours", "description", "description:en", "historic", "phone")


def site_kind(t):
    """Plain-English kind of a containing area, from its own tags only; None if it is not a 'site'."""
    if "boundary" in t or "place" in t:
        return None
    rel = t.get("religion")
    if t.get("amenity") == "place_of_worship" or t.get("landuse") == "religious":
        return {"buddhist": "Buddhist temple", "shinto": "Shinto shrine", "christian": "church"}.get(rel, "place of worship")
    if t.get("tourism") in ("zoo", "theme_park", "museum", "attraction", "viewpoint", "yes"):
        if rel == "shinto":
            return "Shinto shrine"
        if rel == "buddhist":
            return "Buddhist temple"
        return {"zoo": "zoo", "theme_park": "theme park", "museum": "museum"}.get(t["tourism"], "visitor site")
    if t.get("historic") in ("castle", "tomb", "archaeological_site", "ruins", "memorial", "yes", "heritage"):
        return {"castle": "castle site", "tomb": "burial mound", "archaeological_site": "archaeological site", "ruins": "ruins"}.get(t["historic"], "historic site")
    if t.get("leisure") in ("park", "garden", "nature_reserve"):
        return {"park": "park", "garden": "garden", "nature_reserve": "nature reserve"}[t["leisure"]]
    if t.get("natural") in ("water", "peak", "beach"):
        return {"water": "lake or pond", "peak": "peak", "beach": "beach"}[t["natural"]]
    if "building" in t:
        return "building"
    return None


RANK = {"building": 2}  # a named building is less telling than the temple or park around it


def main():
    A = json.load(open(os.path.join(DATA, "attractions.geojson"), encoding="utf-8"))["features"]
    tags_cache = json.load(open(os.path.join(CACHE, "osm_elements.json"), encoding="utf-8"))
    isin = json.load(open(os.path.join(CACHE, "osm_is_in_unnamed.json"), encoding="utf-8"))
    inside = {}
    cur = None
    for e in isin["elements"]:
        if e["type"] == "node":
            cur = str(e["id"])
            inside.setdefault(cur, [])
        elif cur:
            inside[cur].append(e)

    out = {}
    counts = {"osm_tags": 0, "unverified": 0, "with_english_name": 0, "inside_named_site": 0}
    for f in A:
        p = f["properties"]
        if (p["name"] or "").strip():
            continue
        tags = tags_cache.get("node/" + p["osm_id"]) or tags_cache.get("way/" + p["osm_id"]) or {}
        evidence = {k: tags[k] for k in ID_TAGS if k in tags}
        rec = {"identity": "osm_tags" if evidence else "unverified", "osm_element": "node/" + p["osm_id"]}
        counts[rec["identity"]] += 1
        if evidence:
            rec["tags"] = evidence
        en = (tags.get("name:en") or "").split(";")[0].strip()
        if en:
            rec["name_en"] = en
            rec["name_en_source"] = "OSM name:en of the same record"
            counts["with_english_name"] += 1
        sites = []
        for a in inside.get(p["osm_id"], []):
            t = a.get("tags", {})
            k = site_kind(t)
            if not k or not t.get("name"):
                continue
            # Overpass area id kept as returned (its mapping back to a way/relation id is not relied on)
            sites.append({"name": t["name"], "name_en": (t.get("name:en") or "").split(";")[0].strip() or None, "kind": k, "overpass_area_id": a["id"]})
        sites.sort(key=lambda s: RANK.get(s["kind"], 1))
        if sites:
            rec["inside"] = sites[:3]
            counts["inside_named_site"] += 1
        out[p["id"]] = rec

    meta = {
        "built_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "scope": "attraction records with an empty OSM name",
        "sources": {
            "same_record_tags": "data/cache/osm_elements.json (OSM element tags, fetched with fetch_names_en.py)",
            "containing_areas": f"data/cache/osm_is_in_unnamed.json (Overpass is_in, {isin.get('endpoint')}, OSM base {isin.get('osm3s', {}).get('timestamp_osm_base')})",
        },
        "rules": [
            "English names come only from the name:en tag of the same OSM record; nothing is translated or romanised.",
            "'inside' lists named OSM areas that contain the point (temple grounds, parks, ...). It is a location relationship, not an identification.",
            "Administrative areas, islands, time zones and historic provinces are skipped.",
        ],
        "counts": counts,
        "licence": "OpenStreetMap contributors, ODbL",
    }
    json.dump({"meta": meta, "records": out}, open(os.path.join(DATA, "attraction_context.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(json.dumps(counts))


if __name__ == "__main__":
    sys.exit(main())
