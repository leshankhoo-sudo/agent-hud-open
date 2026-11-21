"""Data for the "Sort the data" view on the back of the dashboard.

Run from the project folder (after scripts/poi_reconcile.py and the photo scripts):  python scripts/sort_story.py

The view replays how the attraction layer was built, with the real records only:
    523 OpenStreetMap records (data/raw/attractions.geojson) + 121 sites added from the Kyoto City list
    = 644 records, of which 5 duplicates were merged into the record they repeat and 13 are not places
    to visit (data/audit/poi_decisions.json), leaving the 626 records on the map, in 6 categories.
Nothing is decided here: every status, category and photo comes from the files listed above.

Writes
    public/data/sort_story.json    one row per record: [id, category, atlas cell (-1: no photo), status, source]
                                   status: "map" | "merged" | "left_out";  source: "osm" | "city"
    public/photos/sort-atlas.webp  small rounded thumbnails of the 330 record photos (public/photos/<id>.jpg),
                                   one cell each, for the animation; the photo credits stay in photos.json
"""
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
PHOTOS = os.path.join(ROOT, "public", "photos")
J = lambda p: json.load(open(p, encoding="utf-8"))

CELL, RADIUS, COLS = 56, 10, 20
CATS = ["viewpoint", "attraction", "museum", "temple", "shrine", "castle"]


def thumb(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    s = min(w, h)   # centre square crop, like the slots in the view (object-fit: cover)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((CELL, CELL), Image.LANCZOS)
    mask = Image.new("L", (CELL * 4, CELL * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, CELL * 4 - 1, CELL * 4 - 1), RADIUS * 4, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask.resize((CELL, CELL), Image.LANCZOS))
    return out


def main():
    live = J(os.path.join(DATA, "attractions.geojson"))["features"]
    raw = {f["properties"]["id"]: f["properties"] for f in J(os.path.join(ROOT, "data", "raw", "attractions.geojson"))["features"]}
    rel = J(os.path.join(DATA, "poi_relations.json"))
    photos = J(os.path.join(DATA, "photos.json"))["photos"]

    rows, cells = [], []
    def cell(aid):
        if aid not in photos:
            return -1
        cells.append(aid)
        return len(cells) - 1

    for f in live:
        p = f["properties"]
        rows.append([p["id"], p["category"], cell(p["id"]), "map", "osm" if p["id"] in raw else "city"])
    merged, left_out = {}, {}
    for aid, m in rel["merged"].items():
        r = raw[aid]
        rows.append([aid, r["category"], cell(aid), "merged", "osm"])
        merged[aid] = {"name": r["name"], "into": m["into"], "evidence": m["evidence"]}
    for aid, n in rel["not_sights"].items():
        r = raw[aid]
        rows.append([aid, r["category"], cell(aid), "left_out", "osm"])
        left_out[aid] = {"name": n["name"], "kind": n["kind"], "evidence": n["evidence"]}
    rows.sort(key=lambda r: r[0])

    on_map = [r for r in rows if r[3] == "map"]
    assert len(rows) == len(raw) + sum(1 for r in rows if r[4] == "city"), "every raw record and every added site appears once"
    assert all(r[1] in CATS for r in on_map), "records on the map use the 6 categories"

    rows_n = (len(cells) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * CELL, max(1, rows_n) * CELL), (0, 0, 0, 0))
    for i, aid in enumerate(cells):
        atlas.paste(thumb(os.path.join(ROOT, "public", photos[aid]["src"])), ((i % COLS) * CELL, (i // COLS) * CELL))
    atlas.save(os.path.join(PHOTOS, "sort-atlas.webp"), "WEBP", quality=80, method=6)

    out = {
        "about": "How the attraction layer was built, record by record, for the 'Sort the data' view. "
                 "Rows: [id, category, atlas cell or -1, status, source]. Built by scripts/sort_story.py from "
                 "data/raw/attractions.geojson, public/data/attractions.geojson, public/data/poi_relations.json and public/data/photos.json.",
        "counts": {
            "osm_records": len(raw),
            "city_list_added": sum(1 for r in rows if r[4] == "city"),
            "start": len(rows),
            "merged": len(merged),
            "left_out": len(left_out),
            "on_map": len(on_map),
            "with_photo": sum(1 for r in on_map if r[2] >= 0),
            "by_category": {c: sum(1 for r in on_map if r[1] == c) for c in CATS},
            "photos_by_category": {c: sum(1 for r in on_map if r[1] == c and r[2] >= 0) for c in CATS},
        },
        "categories": CATS,
        "atlas": {"file": "photos/sort-atlas.webp", "cell": CELL, "cols": COLS, "count": len(cells)},
        "rows": rows,
        "merged": merged,
        "left_out": left_out,
        "motion_credit": {
            "name": "Claude photo sorter", "author": "Divy Kairoth", "license": "MIT",
            "url": "https://github.com/kairothq/claude-photo-sorter",
            "used": "sphere layout (golden-angle spiral), depth scaling and the three-point arc flight into folders, "
                    "re-written for this project",
        },
    }
    json.dump(out, open(os.path.join(DATA, "sort_story.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(out["counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()
