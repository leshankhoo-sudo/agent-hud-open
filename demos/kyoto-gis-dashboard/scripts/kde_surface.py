"""Analysis 1b: the same attraction kernel density on a finer grid, for the 3D density surface.

Run from the project folder:  python3 scripts/kde_surface.py
Needs: pip install numpy pyproj shapely

Same method as scripts/kde_density.py (read its notes): the map's attraction layer
(public/data/attractions.geojson), each record weight 1; quartic kernel, search radius 2,000 m;
distances measured in EPSG:6674 (metres); units = point records per km^2; no edge correction.
Only the output grid differs:
- the grid is regular in longitude/latitude (so the browser can place it without a projection),
  with a step of about 250 m: 0.0027 deg of longitude by 0.00225 deg of latitude at 35 N;
- the value is evaluated at each grid node; nodes whose point lies outside the dissolved
  N03 Kyoto Prefecture boundary are marked "outside" (not zero).
Output: public/data/analysis/density_surface.json
  { lon0, lat0, dlon, dlat, nx, ny, scale, outside, peak, values: base64 of little-endian uint16 }
  value = round(density * scale); `outside` marks nodes outside the prefecture.
What it is not: a measure of visitor numbers, crowding or popularity.
"""
import base64
import datetime as dt
import json
import math
import os

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = 2000.0
STEP_M = 250.0
SCALE = 1000          # stored value = density x 1000 (0.001 records/km^2 resolution)
OUTSIDE = 65535


def main():
    fwd = Transformer.from_crs(6668, 6674, always_xy=True)
    pts_fwd = Transformer.from_crs(4326, 6674, always_xy=True)
    feats = json.load(open(os.path.join(ROOT, "public", "data", "attractions.geojson"), encoding="utf-8"))["features"]
    lonlat = np.array([f["geometry"]["coordinates"] for f in feats])
    px, py = pts_fwd.transform(lonlat[:, 0], lonlat[:, 1])

    b = json.load(open(os.path.join(ROOT, "data", "raw", "kyoto_boundary.geojson"), encoding="utf-8"))["features"]
    pref_ll = unary_union([shape(f["geometry"]).buffer(0) for f in b])          # JGD2011 lon/lat
    to_m = lambda a: np.column_stack(fwd.transform(a[:, 0], a[:, 1]))
    pref_m = unary_union([shapely.transform(shape(f["geometry"]), to_m).buffer(0) for f in b])

    minlon, minlat, maxlon, maxlat = pref_ll.bounds
    lat_mid = (minlat + maxlat) / 2
    dlat = round(STEP_M / 110950.0, 6)
    dlon = round(STEP_M / (111320.0 * math.cos(math.radians(lat_mid))), 6)
    lon0 = math.floor(minlon / dlon) * dlon
    lat0 = math.floor(minlat / dlat) * dlat
    nx = int(math.ceil((maxlon - lon0) / dlon)) + 1
    ny = int(math.ceil((maxlat - lat0) / dlat)) + 1
    glon = lon0 + np.arange(nx) * dlon
    glat = lat0 + np.arange(ny) * dlat
    LON, LAT = np.meshgrid(glon, glat)                       # rows are latitude (south to north)
    GX, GY = fwd.transform(LON, LAT)                         # node positions in metres
    inside = shapely.contains_xy(pref_ll, LON, LAT)

    dens = np.zeros((ny, nx))
    for x, y in zip(px, py):
        u2 = ((GX - x) ** 2 + (GY - y) ** 2) / (H * H)
        near = u2 < 1
        dens[near] += 3 / math.pi * (1 - u2[near]) ** 2 / (H * H) * 1e6     # records per km^2
    # check: the kernel sum times node area should be close to the number of points inside
    node_area_km2 = np.abs(np.gradient(GX, axis=1)) * np.abs(np.gradient(GY, axis=0)) / 1e6
    integral = float((dens * node_area_km2)[inside].sum())

    q = np.where(inside, np.minimum(np.round(dens * SCALE), OUTSIDE - 1), OUTSIDE).astype("<u2")
    out = {
        "analysis": "Kernel density of attraction point records on a ~250 m lon/lat grid (for the 3D surface)",
        "computed_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "input": f"public/data/attractions.geojson ({len(feats)} records, weight 1 each)",
        "kernel": "quartic (biweight), search radius 2000 m, distances in EPSG:6674",
        "units": "point records per km^2",
        "grid": "regular in lon/lat (JGD2011 = WGS84 to within a metre here); value at each node",
        "step_m_approx": STEP_M,
        "lon0": round(lon0, 6), "lat0": round(lat0, 6), "dlon": dlon, "dlat": dlat, "nx": nx, "ny": ny,
        "scale": SCALE, "outside": OUTSIDE,
        "peak": round(float(dens[inside].max()), 3),
        "nodes_inside": int(inside.sum()),
        "check_sum_density_x_node_area": round(integral, 1),
        "points": len(feats),
        "prefecture_area_km2_projected": round(pref_m.area / 1e6, 1),
        "edge_correction": "none (values near the prefecture edge are biased low)",
        "not_a_measure_of": "visitor numbers, crowding or popularity",
        "values": base64.b64encode(q.tobytes()).decode("ascii"),
    }
    path = os.path.join(ROOT, "public", "data", "analysis", "density_surface.json")
    json.dump(out, open(path, "w"), separators=(",", ":"))
    print(json.dumps({k: v for k, v in out.items() if k != "values"}, indent=1), "\n", round(os.path.getsize(path) / 1e3), "kB")


if __name__ == "__main__":
    main()
