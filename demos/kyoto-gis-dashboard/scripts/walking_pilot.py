"""Analysis 2 pilot: walking-network distance from attractions to the nearest bus stop
and the nearest rail station, for ONE small pilot area. Not a prefecture-wide result.

Run (from the project folder; roads folder = the unzipped Kyoto_Roads_GeoJSON.zip):
    pip install pyproj shapely networkx
    python3 scripts/walking_pilot.py /path/to/Kyoto_Roads_GeoJSON

Outputs
    public/data/walking_routes.geojson          route lines (status CALCULATED, scope pilot)
    public/data/analysis/walking_pilot_table.csv one row per attraction x stop type
    public/data/analysis/walking_pilot_report.json data check + network checks + method

Method and limits (also written to the report)
- Roads: the 5 GeoJSON parts are read as one dataset; only segments whose bounding box
  touches the pilot box plus a 2.5 km margin are kept in memory. Nothing is sent to the browser.
- Which roads count as walkable is an ASSUMPTION by road class, because the data has no
  foot/access/sidewalk tags:
    pedestrian classes  footway, pedestrian, path, steps, living_street            -> used
    ordinary roads      residential, unclassified, service, tertiary(_link),
                        secondary(_link), primary(_link)                           -> used, assumed walkable
    uncertain           trunk(_link), track*, cycleway, bridleway, unknown         -> used but flagged
    excluded            motorway, motorway_link, busway                            -> never used
  'oneway' and 'maxspeed' are vehicle rules and are ignored for walking.
- Connectivity: two segments connect only where they share an identical vertex
  (coordinates equal to 1e-7 degree). Lines that merely cross (bridges, tunnels,
  overpasses) do NOT connect. Gaps in OSM therefore stay gaps.
- Lengths are measured in EPSG:6674 (JGD2011 / Japan Plane Rectangular CS VI, metres).
- Attractions and stops are single OSM points, not entrances. Each is attached to the
  nearest walkable segment (perpendicular foot). That access gap is a straight line, so it
  is reported separately and is NOT added to the route distance or drawn as a route.
  Snap limits: attraction 150 m, bus 60 m, rail 300 m (station points often sit on tracks).
- Shortest path: Dijkstra on segment length, cut-off 3,000 m. Nearest bus and nearest rail
  are computed separately. No route within 3 km -> 'unreachable'; snap too far -> 'failed'.
- Walking time = distance / 80 m per minute (a common Japanese planning convention; an assumption).
"""
import csv
import datetime as dt
import glob
import json
import math
import os
import sys
from collections import Counter, defaultdict

import networkx as nx
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
PILOT = {"name": "Gion – Kiyomizu pilot", "bbox": [135.770, 34.990, 135.786, 35.006],
         "rule": "attraction records with a non-empty name whose point lies inside the bbox"}
MARGIN_DEG = (0.028, 0.023)  # about 2.5 km in each direction
CUTOFF = 3000.0
SNAP = {"attraction": 150.0, "bus": 60.0, "rail": 300.0}
PED = {"footway", "pedestrian", "path", "steps", "living_street"}
ROAD = {"residential", "unclassified", "service", "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link"}
UNCERTAIN_PREFIX = ("trunk", "track", "cycleway", "bridleway", "unknown")
EXCLUDED = {"motorway", "motorway_link", "busway"}
WALK_SPEED = 80.0


def walk_class(fc):
    if fc in EXCLUDED:
        return None
    if fc in PED:
        return "pedestrian"
    if fc in ROAD:
        return "road"
    if fc.startswith(UNCERTAIN_PREFIX):
        return "uncertain"
    return None


def main(road_dir):
    tf = Transformer.from_crs(4326, 6674, always_xy=True)
    tb = Transformer.from_crs(6674, 4326, always_xy=True)
    b = PILOT["bbox"]
    clip = (b[0] - MARGIN_DEG[0], b[1] - MARGIN_DEG[1], b[2] + MARGIN_DEG[0], b[3] + MARGIN_DEG[1])

    # ---------- 1. read all parts, check, clip ----------
    parts = sorted(glob.glob(os.path.join(road_dir, "Kyoto_Roads_part_*.geojson")))
    check = {"files": {}, "total": 0, "unique_osm_id": 0, "fields": None, "bbox": [180, 90, -180, -90], "fclass": Counter(), "geometry": Counter()}
    ids = set()
    kept = []
    for p in parts:
        fc = json.load(open(p, encoding="utf-8"))
        check["files"][os.path.basename(p)] = len(fc["features"])
        for f in fc["features"]:
            pr = f["properties"]
            check["total"] += 1
            ids.add(pr["osm_id"])
            check["fields"] = check["fields"] or list(pr.keys())
            check["fclass"][pr["fclass"]] += 1
            check["geometry"][f["geometry"]["type"]] += 1
            cs = f["geometry"]["coordinates"]
            xs = [c[0] for c in cs]
            ys = [c[1] for c in cs]
            bb = check["bbox"]
            bb[0], bb[1], bb[2], bb[3] = min(bb[0], min(xs)), min(bb[1], min(ys)), max(bb[2], max(xs)), max(bb[3], max(ys))
            if max(xs) < clip[0] or min(xs) > clip[2] or max(ys) < clip[1] or min(ys) > clip[3]:
                continue
            kept.append(f)
        del fc
    check["unique_osm_id"] = len(ids)
    check["fclass"] = dict(check["fclass"].most_common())
    check["geometry"] = dict(check["geometry"])

    # ---------- 2. build graph from shared vertices ----------
    G = nx.Graph()
    seg_info = []  # (u, v, segment LineString in metres, props)
    excluded_ct = Counter()
    used_ct = Counter()
    key = lambda lon, lat: (round(lon, 7), round(lat, 7))
    lonlat = {}
    for f in kept:
        pr = f["properties"]
        wc = walk_class(pr["fclass"])
        if wc is None:
            excluded_ct[pr["fclass"]] += 1
            continue
        used_ct[wc] += 1
        cs = f["geometry"]["coordinates"]
        for (x1, y1), (x2, y2) in zip(cs, cs[1:]):
            u, v = key(x1, y1), key(x2, y2)
            if u == v:
                continue
            lonlat[u], lonlat[v] = (x1, y1), (x2, y2)
            a, c = tf.transform(x1, y1), tf.transform(x2, y2)
            L = math.dist(a, c)
            attrs = {"length": L, "osm_id": pr["osm_id"], "fclass": pr["fclass"], "wc": wc, "bridge": pr["bridge"] == "T", "tunnel": pr["tunnel"] == "T", "name": pr["name"]}
            if G.has_edge(u, v) and G[u][v]["length"] <= L:
                continue
            G.add_edge(u, v, **attrs)
            seg_info.append((u, v, LineString([a, c])))
    comps = sorted(nx.connected_components(G), key=len, reverse=True)
    comp_of = {}
    for i, c in enumerate(comps):
        for n in c:
            comp_of[n] = i

    # ---------- 3. points ----------
    A = json.load(open(os.path.join(DATA, "attractions.geojson"), encoding="utf-8"))["features"]
    T = json.load(open(os.path.join(DATA, "transport.geojson"), encoding="utf-8"))["features"]
    inside = lambda c: b[0] <= c[0] <= b[2] and b[1] <= c[1] <= b[3]
    inclip = lambda c: clip[0] <= c[0] <= clip[2] and clip[1] <= c[1] <= clip[3]
    pilot_attr = [f for f in A if inside(f["geometry"]["coordinates"]) and (f["properties"]["name"] or "").strip()]
    stops = [f for f in T if inclip(f["geometry"]["coordinates"]) and f["properties"]["transport_type"] in ("bus", "rail")]

    tree = STRtree([s[2] for s in seg_info])
    snaps = defaultdict(list)  # segment index -> [(t, point_key, xy)]
    snap_res = {}

    def snap(fid, lon, lat, limit):
        x, y = tf.transform(lon, lat)
        P = Point(x, y)
        i = int(tree.nearest(P))
        u, v, seg = seg_info[i]
        d = seg.distance(P)
        if d > limit:
            snap_res[fid] = {"ok": False, "gap_m": round(d, 1)}
            return
        t = seg.project(P) / seg.length
        q = seg.interpolate(t, normalized=True)
        snaps[i].append((t, ("snap", fid), (q.x, q.y)))
        snap_res[fid] = {"ok": True, "gap_m": round(d, 1), "seg": i}

    for f in pilot_attr:
        snap(f["properties"]["id"], *f["geometry"]["coordinates"], SNAP["attraction"])
    for f in stops:
        snap(f["properties"]["id"], *f["geometry"]["coordinates"], SNAP[f["properties"]["transport_type"]])

    for i, lst in snaps.items():
        u, v, seg = seg_info[i]
        if not G.has_edge(u, v):
            continue
        attrs = dict(G[u][v])
        L = attrs["length"]
        G.remove_edge(u, v)
        # orient: seg goes from u to v
        chain = [(0.0, u, None)] + sorted(lst, key=lambda z: z[0]) + [(1.0, v, None)]
        for (t1, n1, p1), (t2, n2, p2) in zip(chain, chain[1:]):
            for n, p in ((n1, p1), (n2, p2)):
                if p is not None:
                    lonlat[n] = tb.transform(*p)
                    comp_of[n] = comp_of.get(u)
            G.add_edge(n1, n2, **{**attrs, "length": max(0.0, (t2 - t1) * L)})

    stop_by_type = {"bus": {}, "rail": {}}
    for f in stops:
        fid = f["properties"]["id"]
        if snap_res.get(fid, {}).get("ok"):
            stop_by_type[f["properties"]["transport_type"]][("snap", fid)] = f

    # ---------- 4. shortest paths ----------
    rows, feats = [], []
    for f in pilot_attr:
        aid = f["properties"]["id"]
        sr = snap_res[aid]
        base = {"attraction_id": aid, "attraction_name": f["properties"]["name"], "attraction_snap_gap_m": sr["gap_m"]}
        if not sr["ok"]:
            for t in ("bus", "rail"):
                rows.append({**base, "stop_type": t, "route_status": "failed", "stop_id": None, "distance_m": None, "note": f"attraction point is {sr['gap_m']} m from the nearest walkable segment (limit {SNAP['attraction']} m)"})
                feats.append({"type": "Feature", "geometry": None, "properties": {k: rows[-1][k] for k in ("attraction_id", "stop_id", "stop_type", "route_status", "distance_m", "note")} | {"duration_min": None}})
            continue
        src = ("snap", aid)
        dist, paths = nx.single_source_dijkstra(G, src, cutoff=CUTOFF, weight="length")
        for t in ("bus", "rail"):
            cands = [(dist[n], n) for n in stop_by_type[t] if n in dist]
            if not cands:
                u0, v0, _ = seg_info[sr["seg"]]
                e0 = G.get_edge_data(*next(iter(G.edges(src))))
                csize = len(nx.node_connected_component(G, src))
                note = (f"no {t} stop reachable within {int(CUTOFF)} m on the walkable network; the point attaches to OSM way {e0['osm_id']} "
                        f"({e0['fclass']}{', ' + e0['name'] if e0['name'] else ''}), part of an isolated piece of {csize} vertices with no shared vertex to the street network")
                rows.append({**base, "stop_type": t, "route_status": "unreachable", "stop_id": None, "distance_m": None, "note": note})
                feats.append({"type": "Feature", "geometry": None, "properties": {"attraction_id": aid, "stop_id": None, "stop_type": t, "route_status": "unreachable", "distance_m": None, "duration_min": None, "note": note}})
                continue
            dmin, n = min(cands)
            sf = stop_by_type[t][n]
            path = paths[n]
            edges = [G[a][c] for a, c in zip(path, path[1:])]
            Ltot = sum(e["length"] for e in edges) or 1
            share = lambda pred: round(sum(e["length"] for e in edges if pred(e)) / Ltot, 3)
            flags = []
            unc = share(lambda e: e["wc"] == "uncertain")
            tun = share(lambda e: e["tunnel"])
            brg = share(lambda e: e["bridge"])
            if unc > 0:
                uc = Counter()
                for e in edges:
                    if e["wc"] == "uncertain":
                        uc[e["fclass"] + (" " + e["name"] if e["name"] else "")] += e["length"]
                flags.append(f"{unc:.0%} on uncertain classes (" + ", ".join(f"{k} {v:.0f} m" for k, v in uc.most_common(3)) + ")")
            if tun > 0:
                flags.append(f"{tun:.0%} in tunnel segments")
            if brg > 0:
                flags.append(f"{brg:.0%} on bridges")
            sgap = snap_res[sf["properties"]["id"]]["gap_m"]
            if sr["gap_m"] > 50:
                flags.append(f"attraction point {sr['gap_m']} m from road (entrance unverified)")
            if sgap > 50:
                flags.append(f"stop point {sgap} m from road")
            status = "ok"
            dur = round(dmin / WALK_SPEED, 1)
            row = {**base, "stop_type": t, "route_status": status, "stop_id": sf["properties"]["id"], "stop_name": sf["properties"]["name"], "stop_category": sf["properties"]["category"],
                   "distance_m": round(dmin, 1), "duration_min": dur, "stop_snap_gap_m": sgap, "segments": len(edges),
                   "share_pedestrian": share(lambda e: e["wc"] == "pedestrian"), "share_road_assumed": share(lambda e: e["wc"] == "road"), "share_uncertain": unc,
                   "share_tunnel": tun, "share_bridge": brg, "flags": "; ".join(flags)}
            rows.append(row)
            coords = [[round(lonlat[x][0], 7), round(lonlat[x][1], 7)] for x in path]
            feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
                          "properties": {"attraction_id": aid, "stop_id": row["stop_id"], "stop_type": t, "route_status": status, "distance_m": row["distance_m"], "duration_min": dur,
                                         "attraction_snap_gap_m": sr["gap_m"], "stop_snap_gap_m": sgap, "share_uncertain": unc, "share_tunnel": tun, "share_bridge": brg, "note": row["flags"]}})

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    out = {"type": "FeatureCollection", "status": "CALCULATED", "scope": "pilot", "pilot": PILOT, "attraction_ids": [f["properties"]["id"] for f in pilot_attr],
           "computed_at": now, "method": "Dijkstra on OSM road segments joined at shared vertices; class-based walkability assumption; see walking_pilot_report.json", "features": feats}
    json.dump(out, open(os.path.join(DATA, "walking_routes.geojson"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.join(DATA, "analysis"), exist_ok=True)
    cols = ["attraction_id", "attraction_name", "stop_type", "route_status", "stop_id", "stop_name", "stop_category", "distance_m", "duration_min", "attraction_snap_gap_m", "stop_snap_gap_m", "segments", "share_pedestrian", "share_road_assumed", "share_uncertain", "share_tunnel", "share_bridge", "flags", "note"]
    with open(os.path.join(DATA, "analysis", "walking_pilot_table.csv"), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") if r.get(c) is not None else "" for c in cols})

    pilot_nodes_main = sum(1 for f in pilot_attr if snap_res[f["properties"]["id"]]["ok"] and comp_of.get(("snap", f["properties"]["id"])) == 0)
    report = {
        "computed_at": now,
        "scope": "PILOT ONLY - not a Kyoto Prefecture result",
        "pilot": PILOT,
        "road_data_check": check,
        "clip_bbox_deg": clip,
        "segments_in_clip": len(kept),
        "segments_used_by_walk_class": dict(used_ct),
        "segments_excluded_by_class": dict(excluded_ct),
        "graph": {"nodes": G.number_of_nodes(), "edges": G.number_of_edges(), "components": len(comps), "largest_component_nodes": len(comps[0]) if comps else 0,
                  "small_components_under_20_nodes": sum(1 for c in comps if len(c) < 20)},
        "pilot_attractions": len(pilot_attr),
        "pilot_attractions_on_largest_component": pilot_nodes_main,
        "candidate_stops_in_clip": dict(Counter(f["properties"]["transport_type"] for f in stops)),
        "stops_snapped": {t: len(v) for t, v in stop_by_type.items()},
        "stops_not_snapped": [{"id": k, "gap_m": v["gap_m"]} for k, v in snap_res.items() if not v["ok"] and k.startswith("S")],
        "results": dict(Counter((r["stop_type"], r["route_status"]) for r in rows).items()) and {f"{k[0]}:{k[1]}": v for k, v in Counter((r["stop_type"], r["route_status"]) for r in rows).items()},
        "assumptions": {"walkable_classes": sorted(PED | ROAD), "uncertain_classes_used_flagged": list(UNCERTAIN_PREFIX), "excluded_classes": sorted(EXCLUDED),
                        "ignored_fields": "oneway, maxspeed (vehicle rules)", "connectivity": "shared identical vertex only; crossings do not connect",
                        "snap_limits_m": SNAP, "cutoff_m": CUTOFF, "walk_speed_m_per_min": WALK_SPEED, "crs": "EPSG:6674"},
        "limitations": [
            "No foot/access/sidewalk tags: walkability is assumed from road class and may be wrong for private service roads, roads without sidewalks, closed paths or tunnels.",
            "Attraction and stop points are not entrances or platforms; the straight access gap is reported separately and not added.",
            "Temple grounds, opening hours, steps without ramps and fee gates are not modelled.",
            "Stops outside the 2.5 km clip margin are not considered; the pilot area is far from the prefecture edge.",
        ],
    }
    json.dump(report, open(os.path.join(DATA, "analysis", "walking_pilot_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: report[k] for k in ("segments_in_clip", "segments_used_by_walk_class", "segments_excluded_by_class", "graph", "pilot_attractions", "pilot_attractions_on_largest_component", "candidate_stops_in_clip", "stops_snapped", "results")}, ensure_ascii=False, indent=1))
    print("road check:", check["total"], "records,", check["unique_osm_id"], "unique ids,", check["files"])
    for r in rows:
        print(r["attraction_id"], r["stop_type"], r["route_status"], r.get("stop_id"), r.get("stop_name"), r.get("distance_m"), r.get("flags") or r.get("note"))


if __name__ == "__main__":
    main(sys.argv[1])
