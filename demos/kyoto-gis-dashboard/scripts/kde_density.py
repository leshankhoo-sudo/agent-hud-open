"""Analysis 1: kernel density of preliminary attraction point records.

Run from the project folder:  python3 scripts/kde_density.py
Needs: pip install pyproj shapely

Method (written to public/data/analysis/density_kde_meta.json as well)
- Input: data/raw/attractions.geojson, all 523 records, each weighted 1.
  Points are not deduplicated or verified; unnamed records are included.
- Projection: EPSG:6674, JGD2011 / Japan Plane Rectangular CS VI (metres),
  the plane zone that covers Kyoto Prefecture. No distance is computed in degrees.
- Kernel: quartic (biweight), K(u) = 3/pi * (1 - u^2)^2 for u = d/h < 1, else 0.
  This is the kernel used by ArcGIS Kernel Density.
- Search radius (bandwidth) h = 2,000 m. Fixed, chosen by the analyst as a
  district/walking-area scale; it is not optimised. Other radii give other patterns.
- Output cell size: 500 m x 500 m grid, aligned to multiples of 500 m in EPSG:6674.
  The value is evaluated at each cell centre.
- Units: point records per square kilometre. One record's kernel integrates to 1.
- Extent: cells whose centre falls inside the dissolved N03 Kyoto Prefecture
  boundary (raw, not the simplified display copy). No edge correction, so values
  near the prefecture edge are biased low.
- Separate values are stored per category. Because the kernel sum is linear, the
  density of any set of categories is the sum of their columns, so the map can
  follow the category filter without recomputing.

What it is not: a measure of visitor numbers, crowding or popularity. It shows
where the preliminary OSM point records are concentrated.
"""
import datetime as dt
import json
import math
import os

import numpy as np
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.geometry import Point

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "public", "data", "analysis")
H = 2000.0
CELL = 500.0
EPSG = 6674
CATS = ["attraction", "viewpoint", "museum", "castle"]


def main():
    os.makedirs(OUT, exist_ok=True)
    fwd = Transformer.from_crs(6668, EPSG, always_xy=True)
    pts_fwd = Transformer.from_crs(4326, EPSG, always_xy=True)
    back = Transformer.from_crs(EPSG, 4326, always_xy=True)

    feats = json.load(open(os.path.join(RAW, "attractions.geojson"), encoding="utf-8"))["features"]
    xy = np.array([pts_fwd.transform(*f["geometry"]["coordinates"]) for f in feats])
    cat = np.array([f["properties"]["category"] for f in feats])

    b = json.load(open(os.path.join(RAW, "kyoto_boundary.geojson"), encoding="utf-8"))["features"]
    import shapely
    to_m = lambda a: np.column_stack(fwd.transform(a[:, 0], a[:, 1]))
    polys = [shapely.transform(shape(f["geometry"]), to_m).buffer(0) for f in b]
    pref = unary_union(polys)
    pp = prep(pref)
    area_km2 = pref.area / 1e6

    minx, miny, maxx, maxy = pref.bounds
    x0 = math.floor(minx / CELL) * CELL
    y0 = math.floor(miny / CELL) * CELL
    nx = int(math.ceil((maxx - x0) / CELL))
    ny = int(math.ceil((maxy - y0) / CELL))
    cx = x0 + (np.arange(nx) + 0.5) * CELL
    cy = y0 + (np.arange(ny) + 0.5) * CELL

    dens = {c: np.zeros((ny, nx)) for c in CATS}
    r = int(math.ceil(H / CELL)) + 1
    for (px, py), c in zip(xy, cat):
        ix = int((px - x0) // CELL)
        iy = int((py - y0) // CELL)
        xs = slice(max(0, ix - r), min(nx, ix + r + 1))
        ys = slice(max(0, iy - r), min(ny, iy + r + 1))
        gx, gy = np.meshgrid(cx[xs], cy[ys])
        u2 = ((gx - px) ** 2 + (gy - py) ** 2) / (H * H)
        k = np.where(u2 < 1, 3 / math.pi * (1 - u2) ** 2, 0.0) / (H * H)  # per m^2
        dens[c][ys, xs] += k * 1e6  # per km^2

    total = sum(dens.values())
    features = []
    inside_cells = 0
    integral = 0.0
    for j in range(ny):
        for i in range(nx):
            if not pp.contains(Point(cx[i], cy[j])):
                continue
            inside_cells += 1
            t = total[j, i]
            integral += t * (CELL * CELL / 1e6)
            if t < 0.01:
                continue
            xa, ya = x0 + i * CELL, y0 + j * CELL
            ring = [back.transform(xa, ya), back.transform(xa + CELL, ya), back.transform(xa + CELL, ya + CELL), back.transform(xa, ya + CELL)]
            ring = [[round(a, 6), round(b2, 6)] for a, b2 in ring]
            ring.append(ring[0])
            props = {"cell": f"{i}_{j}"}
            for c in CATS:
                props[c] = round(float(dens[c][j, i]), 4)
            features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props})

    inside_pts = sum(1 for p in xy if pp.contains(Point(*p)))
    meta = {
        "analysis": "Kernel density of preliminary attraction point records",
        "computed_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "input": "data/raw/attractions.geojson (523 records, weight 1 each; unnamed records included; not deduplicated)",
        "crs": f"EPSG:{EPSG} JGD2011 / Japan Plane Rectangular CS VI (metres)",
        "kernel": "quartic (biweight): K(u) = 3/pi * (1-u^2)^2 for u<1",
        "search_radius_m": H,
        "cell_size_m": CELL,
        "units": "point records per km^2",
        "extent": "cells whose centre is inside the dissolved raw N03 Kyoto Prefecture boundary",
        "edge_correction": "none (values near the prefecture edge are biased low)",
        "cells_in_extent": inside_cells,
        "cells_written": len(features),
        "cells_written_rule": "cells with total density >= 0.01 records/km^2",
        "prefecture_area_km2_projected": round(area_km2, 1),
        "points_inside_dissolved_boundary": inside_pts,
        "check_sum_density_x_cell_area": round(integral, 1),
        "check_note": "Sum of density x cell area should be close to the number of points; differences come from edge loss, the 500 m grid and points outside the boundary.",
        "categories": CATS,
        "max_total_density": round(float(total.max()), 3),
        "not_a_measure_of": "visitor numbers, crowding or popularity",
    }
    json.dump({"type": "FeatureCollection", "features": features}, open(os.path.join(OUT, "density_kde.geojson"), "w"), separators=(",", ":"))
    json.dump(meta, open(os.path.join(OUT, "density_kde_meta.json"), "w"), indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
