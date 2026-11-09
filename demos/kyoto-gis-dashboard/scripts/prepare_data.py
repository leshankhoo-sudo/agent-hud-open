"""Build the browser data in public/data from the untouched package files in data/raw.

Run from the project folder:  python3 scripts/prepare_data.py

What it does
- Checks each raw file against the package's own SHA-256 manifest.
- Copies attractions.geojson, transport.geojson, sample_journeys.json and
  walking_routes.geojson unchanged (point coordinates and IDs are not edited).
- Makes display copies of the N03 boundary with mapshaper (simplified for the
  browser). The raw 6 MB file stays in data/raw and is never edited.
- Adds the extra published columns from the route workbook to the journeys,
  joined by exact journey_id only.
- Writes public/data/manifest.json with counts, hashes and build time.

The boundary display copies are for drawing only. Point-in-polygon checks and
any distance work must use data/raw/kyoto_boundary.geojson.
"""
import collections
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "public", "data")
MAPSHAPER = os.environ.get("MAPSHAPER", "mapshaper")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load(name):
    with open(os.path.join(RAW, name), encoding="utf-8") as f:
        return json.load(f)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest_src = json.load(open(os.path.join(RAW, "package_docs", "file_manifest.json"), encoding="utf-8"))
    expected = {m["path"].replace("\\", "/").split("/")[-1]: m["sha256"] for m in manifest_src if m["path"].replace("\\", "/").startswith("data/")}
    checks = {}
    for name, digest in expected.items():
        got = sha256(os.path.join(RAW, name))
        checks[name] = "match" if got == digest else "MISMATCH"
        if got != digest:
            print("WARNING: hash mismatch", name, file=sys.stderr)

    attractions = load("attractions.geojson")
    transport = load("transport.geojson")
    walking = load("walking_routes.geojson")
    journeys = load("sample_journeys.json")

    # Unchanged copies. walking_routes.geojson is only copied while no computed result
    # exists, so running this script again never erases scripts/walking_pilot.py output.
    for name in ("attractions.geojson", "transport.geojson", "sample_journeys.json"):
        shutil.copyfile(os.path.join(RAW, name), os.path.join(OUT, name))
    wpath = os.path.join(OUT, "walking_routes.geojson")
    try:
        existing = json.load(open(wpath, encoding="utf-8")).get("status")
    except (OSError, ValueError):
        existing = None
    if existing != "CALCULATED":
        shutil.copyfile(os.path.join(RAW, "walking_routes.geojson"), wpath)
    walking = json.load(open(wpath, encoding="utf-8"))

    # Boundary display copies (EPSG:6668 JGD2011 geographic; drawn as lon/lat)
    src = os.path.join(RAW, "kyoto_boundary.geojson")
    subprocess.run([MAPSHAPER, src, "-proj", "wgs84", "-dissolve", "N03_007", "copy-fields=N03_001,N03_003,N03_004,N03_005",
                    "-simplify", "6%", "keep-shapes", "-o", os.path.join(OUT, "municipalities_display.geojson"), "precision=0.00001", "format=geojson"],
                   check=True, capture_output=True)
    subprocess.run([MAPSHAPER, src, "-proj", "wgs84", "-dissolve", "N03_001",
                    "-simplify", "6%", "keep-shapes", "-o", os.path.join(OUT, "prefecture_outline.geojson"), "precision=0.00001", "format=geojson"],
                   check=True, capture_output=True)
    muni = json.load(open(os.path.join(OUT, "municipalities_display.geojson"), encoding="utf-8"))

    # Extra workbook columns, joined on exact journey_id only
    extra = {}
    try:
        import openpyxl
        wb = openpyxl.load_workbook(os.path.join(RAW, "documents", "Kyoto_Sample_Routes_and_Fares_EN.xlsx"), read_only=True, data_only=True)
        rows = list(wb["Route Data"].iter_rows(values_only=True))
        head = rows[0]
        for r in rows[1:]:
            rec = dict(zip(head, r))
            jid = rec.get("Journey ID")
            if jid:
                extra[jid] = {"mode": rec.get("Mode"), "service_type": rec.get("Service type"), "fare_basis": rec.get("Fare basis"),
                              "conditions": rec.get("Conditions"), "walking_status_note": rec.get("Walking distance m")}
    except Exception as e:  # workbook is optional
        print("Workbook columns not added:", e, file=sys.stderr)
    for j in journeys:
        j["workbook"] = extra.get(j["journey_id"])  # None if the workbook has no row for this id
    with open(os.path.join(OUT, "sample_journeys_display.json"), "w", encoding="utf-8") as f:
        json.dump(journeys, f, ensure_ascii=False, indent=1)

    # Spatial join: which raw N03 municipality polygon contains each point
    # (raw boundary, not the simplified display copy). Points outside every polygon get null.
    point_muni = {}
    try:
        from shapely.geometry import Point, shape
        from shapely.strtree import STRtree
        raw_b = load("kyoto_boundary.geojson")["features"]
        geoms = [shape(f["geometry"]) for f in raw_b]
        tree = STRtree(geoms)
        for fc in (attractions, transport):
            for f in fc["features"]:
                pt = Point(*f["geometry"]["coordinates"])
                code = None
                for k in tree.query(pt, predicate="intersects"):
                    pr = raw_b[int(k)]["properties"]
                    code = pr["N03_007"]
                    break
                point_muni[f["properties"]["id"]] = code
        names = {}
        for f in raw_b:
            pr = f["properties"]
            names[pr["N03_007"]] = " ".join(x for x in (pr.get("N03_003"), pr.get("N03_004"), pr.get("N03_005")) if x)
        with open(os.path.join(OUT, "point_municipality.json"), "w", encoding="utf-8") as f:
            json.dump({"method": "point-in-polygon against raw N03 polygons (data/raw/kyoto_boundary.geojson)", "names": names, "points": point_muni}, f, ensure_ascii=False, separators=(",", ":"))
    except ImportError:
        print("shapely not installed: point_municipality.json not written", file=sys.stderr)

    a_props = [f["properties"] for f in attractions["features"]]
    t_props = [f["properties"] for f in transport["features"]]
    osm_dupes = [k for k, v in collections.Counter(p["osm_id"] for p in t_props).items() if v > 1]
    manifest = {
        "built_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "raw_hash_check": checks,
        "attractions": {"records": len(a_props), "by_category": dict(collections.Counter(p["category"] for p in a_props)),
                        "unnamed": sum(1 for p in a_props if not (p.get("name") or "").strip())},
        "transport": {"records": len(t_props), "by_category": dict(collections.Counter(p["category"] for p in t_props)),
                      "by_type": dict(collections.Counter(p["transport_type"] for p in t_props)),
                      "unnamed": sum(1 for p in t_props if not (p.get("name") or "").strip()),
                      "duplicate_osm_ids": [{"osm_id": k, "ids": [p["id"] for p in t_props if p["osm_id"] == k]} for k in osm_dupes]},
        "boundary": {"raw_features": len(load("kyoto_boundary.geojson")["features"]), "display_municipalities": len(muni["features"]),
                     "raw_crs": "EPSG:6668 (JGD2011 geographic)", "display_note": "Simplified with mapshaper (6% of vertices, shapes kept) for drawing only."},
        "walking_routes": {"status": walking.get("status"), "scope": walking.get("scope"), "features": len(walking.get("features", [])), "raw_package_status": load("walking_routes.geojson").get("status")},
        "point_municipality": {"joined": sum(1 for v in point_muni.values() if v), "outside_all_polygons": sum(1 for v in point_muni.values() if not v)},
        "journeys": {"records": len(journeys), "matched_attraction_id": sum(1 for j in journeys if j.get("attraction_id")),
                     "matched_stop_id": sum(1 for j in journeys if j.get("stop_id"))},
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(json.dumps(manifest, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
