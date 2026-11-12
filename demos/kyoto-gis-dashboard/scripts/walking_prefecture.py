"""Walking access for ALL attraction records in Kyoto Prefecture (523), nearest bus stop and
nearest rail station along the OSM road network. Extends scripts/walking_pilot.py to the whole
prefecture with the SAME method and assumptions; the pilot outputs are left untouched.

Run (from the project folder; roads folder = the unzipped Kyoto_Roads_GeoJSON.zip):
    pip install pyproj shapely numpy scipy
    python3 scripts/walking_prefecture.py /path/to/Kyoto_Roads_GeoJSON

Outputs
    public/data/walking_routes_prefecture.geojson        one feature per attraction x stop type
    public/data/analysis/walking_prefecture_table.csv     same rows as a table (for checking)
    public/data/analysis/walking_prefecture_report.json   data check, graph check, counts, method, limits

Method (identical to the pilot unless stated)
- Walkability by road class (assumption; the data has no foot/access/sidewalk tags):
    pedestrian  footway, pedestrian, path, steps, living_street
    road        residential, unclassified, service, tertiary(_link), secondary(_link), primary(_link)
    uncertain   trunk(_link), track*, cycleway, bridleway, unknown      -> used but flagged
    excluded    motorway, motorway_link, busway
- Segments connect only at identical vertices (1e-7 degree). Crossings without a shared vertex
  (bridges, tunnels) do not connect.
- Lengths in EPSG:6674 (metres). Points attach to the nearest walkable segment; that straight
  access gap is reported separately and never added to the distance or drawn.
  Snap limits: attraction 150 m, bus 60 m, rail 300 m.
- Dijkstra on segment length, cut-off 3,000 m; nearest bus and nearest rail separately.
- Walking time = distance / 80 m per minute (assumption).

Differences from the pilot
- Whole road file is used (no clip box); all 523 attraction records, named or not.
- 'unreachable' now carries a reason:
    no_stop_within_cutoff  the point sits on the main network but no stop of that type lies within 3 km
    isolated_network       the point attaches to a small piece of network with no shared vertex to the rest
- A point whose nearest segment is a small disconnected fragment (< 1,000 vertices) is attached to the
  nearest segment of the main network instead, if that is also within the snap limit; flagged.
- Extra flag near_prefecture_boundary: a road outside Kyoto Prefecture is closer (straight line) than the
  result, so a stop in the neighbouring prefecture, which is not in the data, could be nearer.
- Each record carries an identity level: named (OSM name), osm_tags (no name but the SAME OSM element
  has name:en / wikidata / website / ...), unverified (only a tourism=* tag).
"""
import csv
import datetime as dt
import glob
import json
import math
import os
import sys
import time
from collections import Counter

import numpy as np
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from shapely.geometry import LineString, Point, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
CUTOFF = 3000.0
SNAP = {"attraction": 150.0, "bus": 60.0, "rail": 300.0}
PED = {"footway", "pedestrian", "path", "steps", "living_street"}
ROAD = {"residential", "unclassified", "service", "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link"}
UNCERTAIN_PREFIX = ("trunk", "track", "cycleway", "bridleway", "unknown")
EXCLUDED = {"motorway", "motorway_link", "busway"}
WALK_SPEED = 80.0

SMALL_COMPONENT = 1000  # vertices; below this a piece of network counts as isolated
ID_TAGS = ("name:ja", "name:en", "wikidata", "wikipedia", "website", "opening_hours", "description", "description:en", "historic", "phone")
WC = ["pedestrian", "road", "uncertain"]


def walk_class(fc):
    if fc in EXCLUDED:
        return None
    if fc in PED:
        return 0
    if fc in ROAD:
        return 1
    if fc.startswith(UNCERTAIN_PREFIX):
        return 2
    return None


def main(road_dir):
    t0 = time.time()
    tf = Transformer.from_crs(4326, 6674, always_xy=True)

    # ---------- 1. read and check all road parts ----------
    parts = sorted(glob.glob(os.path.join(road_dir, "Kyoto_Roads_part_*.geojson")))
    if len(parts) != 5:
        sys.exit(f"expected 5 road parts in {road_dir}, found {len(parts)}")
    check = {"files": {}, "total": 0, "unique_osm_id": 0, "fclass": Counter()}
    ids = set()
    node_ix = {}          # rounded lon/lat -> int
    node_ll = []          # int -> (lon, lat)
    eu, ev, el = [], [], []          # edge endpoints, length
    ewc, efc, ebr, etn, eway = [], [], [], [], []   # per-edge attributes
    way_geom, way_meta = [], []      # per-way metre geometry for snapping; (wc, first_edge, n_edges)
    fclass_names, fc_ix = [], {}
    names, name_ix = [""], {"": 0}
    way_osm = []
    excluded_ct, used_ct = Counter(), Counter()

    def nid(lon, lat):
        k = (round(lon, 7), round(lat, 7))
        i = node_ix.get(k)
        if i is None:
            i = node_ix[k] = len(node_ll)
            node_ll.append((lon, lat))
        return i

    for p in parts:
        fc = json.load(open(p, encoding="utf-8"))
        check["files"][os.path.basename(p)] = len(fc["features"])
        for f in fc["features"]:
            pr = f["properties"]
            check["total"] += 1
            ids.add(pr["osm_id"])
            check["fclass"][pr["fclass"]] += 1
            wc = walk_class(pr["fclass"])
            if wc is None:
                excluded_ct[pr["fclass"]] += 1
                continue
            used_ct[WC[wc]] += 1
            cs = f["geometry"]["coordinates"]
            xs, ys = tf.transform([c[0] for c in cs], [c[1] for c in cs])
            fci = fc_ix.setdefault(pr["fclass"], len(fclass_names))
            if fci == len(fclass_names):
                fclass_names.append(pr["fclass"])
            nm = pr["name"] or ""
            ni = name_ix.setdefault(nm, len(names))
            if ni == len(names):
                names.append(nm)
            wi = len(way_osm)
            way_osm.append(pr["osm_id"])
            first = len(eu)
            for k in range(len(cs) - 1):
                a, b = nid(*cs[k]), nid(*cs[k + 1])
                if a == b:
                    continue
                eu.append(a); ev.append(b)
                el.append(math.hypot(xs[k + 1] - xs[k], ys[k + 1] - ys[k]))
                ewc.append(wc); efc.append(fci); ebr.append(pr["bridge"] == "T"); etn.append(pr["tunnel"] == "T"); eway.append(wi)
            way_geom.append(LineString(list(zip(xs, ys))))
            way_meta.append((first, len(eu) - first))
        del fc
    check["unique_osm_id"] = len(ids)
    check["fclass"] = dict(check["fclass"].most_common())
    print(f"read {check['total']} segments, {len(node_ll)} vertices, {len(eu)} edges in {time.time()-t0:.0f}s", flush=True)

    eu = np.array(eu, dtype=np.int64); ev = np.array(ev, dtype=np.int64); el = np.array(el)
    ewc = np.array(ewc, dtype=np.int8); efc = np.array(efc, dtype=np.int16); ebr = np.array(ebr); etn = np.array(etn); eway = np.array(eway, dtype=np.int64)
    node_lon = np.array([c[0] for c in node_ll]); node_lat = np.array([c[1] for c in node_ll])
    nx_, ny_ = tf.transform(node_lon, node_lat)
    nx_, ny_ = np.asarray(nx_), np.asarray(ny_)
    N0 = len(node_ll)
    del node_ll, node_ix

    # ---------- 2. points ----------
    A = json.load(open(os.path.join(DATA, "attractions.geojson"), encoding="utf-8"))["features"]
    T = json.load(open(os.path.join(DATA, "transport.geojson"), encoding="utf-8"))["features"]
    cache = json.load(open(os.path.join(ROOT, "data", "cache", "osm_elements.json"), encoding="utf-8"))
    stops = [f for f in T if f["properties"]["transport_type"] in ("bus", "rail")]

    def identity(p):
        if (p["name"] or "").strip():
            return "named", {}
        tags = cache.get("node/" + p["osm_id"]) or cache.get("way/" + p["osm_id"]) or {}
        ev_ = {k: tags[k] for k in ID_TAGS if k in tags}
        return ("osm_tags" if ev_ else "unverified"), ev_

    # ---------- 3. snap every point onto the nearest walkable segment ----------
    # Components of the plain road network, used to spot points whose nearest segment is a
    # small disconnected fragment (e.g. a footway inside temple grounds not joined to the street).
    _, comp0 = connected_components(coo_matrix((np.ones(len(eu)), (eu, ev)), shape=(N0, N0)), directed=False)
    comp0_size = np.bincount(comp0)
    way_main = [way_meta[i][1] > 0 and comp0_size[comp0[eu[way_meta[i][0]]]] >= SMALL_COMPONENT for i in range(len(way_geom))]
    main_ix = [i for i, m in enumerate(way_main) if m]
    tree = STRtree(way_geom)
    tree_main = STRtree([way_geom[i] for i in main_ix])
    extra_u, extra_v, extra_l, extra_e = [], [], [], []   # new edges; extra_e = index of parent edge (attributes)
    pt_node, snap_res = {}, {}
    next_node = [N0]
    px_list, py_list = [], []

    def snap(fid, lon, lat, limit):
        x, y = tf.transform(lon, lat)
        P = Point(x, y)
        wi = int(tree.nearest(P))
        d = way_geom[wi].distance(P)
        if d > limit:
            snap_res[fid] = {"ok": False, "gap_m": round(d, 1)}
            return
        fallback = None
        if not way_main[wi]:
            # nearest segment is an isolated fragment: use the nearest main-network segment if it is
            # also within the snap limit; the (longer) access gap is reported, never added to the route
            wm = main_ix[int(tree_main.nearest(P))]
            dm = way_geom[wm].distance(P)
            if dm <= limit:
                fallback = {"fragment_gap_m": round(d, 1), "fragment_osm_id": way_osm[wi]}
                wi, d = wm, dm
        first, n = way_meta[wi]
        best = None
        for e in range(first, first + n):
            a, b = eu[e], ev[e]
            ax, ay, bx, by = nx_[a], ny_[a], nx_[b], ny_[b]
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
            qx, qy = ax + t * dx, ay + t * dy
            dd = math.hypot(x - qx, y - qy)
            if best is None or dd < best[0]:
                best = (dd, e, t, qx, qy)
        dd, e, t, qx, qy = best
        k = next_node[0]; next_node[0] += 1
        px_list.append(qx); py_list.append(qy)
        L = el[e]
        extra_u.extend([k, k]); extra_v.extend([int(eu[e]), int(ev[e])]); extra_l.extend([t * L, (1 - t) * L]); extra_e.extend([e, e])
        pt_node[fid] = k
        snap_res[fid] = {"ok": True, "gap_m": round(dd, 1), "edge": int(e), "fallback": fallback}

    for f in A:
        snap(f["properties"]["id"], *f["geometry"]["coordinates"], SNAP["attraction"])
    for f in stops:
        snap(f["properties"]["id"], *f["geometry"]["coordinates"], SNAP[f["properties"]["transport_type"]])
    # two snaps on the same segment must also connect to each other directly
    by_edge = {}
    for i in range(0, len(extra_u), 2):
        by_edge.setdefault(extra_e[i], []).append((extra_l[i], extra_u[i]))
    for e, lst in by_edge.items():
        lst.sort()
        for (t1, k1), (t2, k2) in zip(lst, lst[1:]):
            extra_u.append(k1); extra_v.append(k2); extra_l.append(t2 - t1); extra_e.append(e)
    print(f"snapped {sum(1 for v in snap_res.values() if v['ok'])}/{len(snap_res)} points in {time.time()-t0:.0f}s", flush=True)

    NN = next_node[0]
    all_x = np.concatenate([nx_, np.array(px_list)]); all_y = np.concatenate([ny_, np.array(py_list)])
    U = np.concatenate([eu, np.array(extra_u, dtype=np.int64)])
    V = np.concatenate([ev, np.array(extra_v, dtype=np.int64)])
    Lw = np.concatenate([el, np.array(extra_l)])
    parent = np.concatenate([np.arange(len(eu)), np.array(extra_e, dtype=np.int64)])
    # zero-length edges would vanish in a sparse matrix; give them a tiny length
    Lw = np.where(Lw <= 0, 1e-6, Lw)
    # keep only the shortest of duplicate undirected edges (as the pilot does)
    lo, hi = np.minimum(U, V), np.maximum(U, V)
    order = np.lexsort((Lw, hi, lo))
    lo, hi, Lw, parent = lo[order], hi[order], Lw[order], parent[order]
    keep = np.ones(len(lo), bool)
    keep[1:] = (lo[1:] != lo[:-1]) | (hi[1:] != hi[:-1])
    lo, hi, Lw, parent = lo[keep], hi[keep], Lw[keep], parent[keep]
    G = coo_matrix((Lw, (lo, hi)), shape=(NN, NN)).tocsr()
    edge_of = {}
    for i in range(len(lo)):
        edge_of[(int(lo[i]), int(hi[i]))] = int(parent[i])
    ncomp, comp = connected_components(G, directed=False)
    comp_size = np.bincount(comp)
    print(f"graph {NN} nodes, {len(lo)} edges, {ncomp} components (largest {comp_size.max()}) in {time.time()-t0:.0f}s", flush=True)

    stop_nodes = {"bus": {}, "rail": {}}
    for f in stops:
        fid = f["properties"]["id"]
        if fid in pt_node:
            stop_nodes[f["properties"]["transport_type"]][pt_node[fid]] = f
    stop_arr = {t: np.array(sorted(v)) for t, v in stop_nodes.items()}

    # Land boundary check. The prefecture outline also runs along the Sea of Japan coast, where
    # there is nothing to miss. The road file keeps roads up to ~1 km OUTSIDE the prefecture, so
    # "a road vertex outside the prefecture within 3 km" marks places where the walkable network
    # continues into a neighbouring prefecture whose stops are not in our data.
    import shapely
    n03 = json.load(open(os.path.join(ROOT, "data", "raw", "kyoto_boundary.geojson"), encoding="utf-8"))
    pref = unary_union([shape(f["geometry"]).buffer(0) for f in n03["features"]])
    pref_m = shapely.transform(pref, lambda xy: np.column_stack(tf.transform(xy[:, 0], xy[:, 1])))
    shapely.prepare(pref_m)
    outside = ~shapely.contains_xy(pref_m, nx_, ny_)
    out_tree = STRtree(shapely.points(nx_[outside], ny_[outside]))
    print(f"road vertices outside the prefecture: {int(outside.sum())}", flush=True)

    def outside_road_distance(x, y):
        P = Point(x, y)
        i = out_tree.nearest(P)
        return out_tree.geometries[int(i)].distance(P) if i is not None else math.inf

    # ---------- 4. shortest paths ----------
    rows, feats = [], []
    rn = lambda v: round(float(v), 1)
    for f in A:
        p = f["properties"]
        aid = p["id"]
        idl, idtags = identity(p)
        x, y = tf.transform(*f["geometry"]["coordinates"])
        bdist = outside_road_distance(x, y)
        sr = snap_res[aid]
        base = {"attraction_id": aid, "attraction_name": p["name"], "category": p["category"], "identity": idl,
                "attraction_snap_gap_m": sr["gap_m"], "fragment_fallback": bool(sr.get("fallback")), "outside_road_distance_m": round(bdist) if math.isfinite(bdist) else None}

        # A straight line is a lower bound for any walk, so a stop in a neighbouring prefecture can only
        # be nearer than the result if the prefecture's land edge is closer than that result.
        def bflag(limit):
            return [f"roads leave Kyoto Prefecture {bdist/1000:.1f} km away, closer than this result; a stop in the neighbouring prefecture (not in the data) could be nearer"] if bdist < limit else []

        def empty(t, status, reason, note):
            bf = bflag(CUTOFF) if status == "unreachable" else []
            note = note + ("; " + bf[0] if bf else "")
            rows.append({**base, "stop_type": t, "route_status": status, "reason": reason, "stop_id": None, "distance_m": None, "near_prefecture_boundary": bool(bf), "note": note})
            feats.append({"type": "Feature", "geometry": None, "properties": {"attraction_id": aid, "stop_id": None, "stop_type": t, "route_status": status, "reason": reason,
                                                                               "distance_m": None, "duration_min": None, "identity": idl, "near_prefecture_boundary": bool(bf), "note": note}})

        if not sr["ok"]:
            for t in ("bus", "rail"):
                empty(t, "failed", "attraction_too_far_from_network", f"attraction point is {sr['gap_m']} m from the nearest walkable segment (limit {SNAP['attraction']:.0f} m)")
            continue
        src = pt_node[aid]
        dist, pred = dijkstra(G, directed=False, indices=src, limit=CUTOFF, return_predecessors=True)
        csize = int(comp_size[comp[src]])
        for t in ("bus", "rail"):
            sa = stop_arr[t]
            dd = dist[sa] if len(sa) else np.array([])
            if not len(dd) or not np.isfinite(dd).any():
                if csize < SMALL_COMPONENT:
                    wname = names_of(sr["edge"], eway, way_osm, efc, fclass_names)
                    empty(t, "unreachable", "isolated_network", f"no {t} stop reachable; the point attaches to {wname}, part of an isolated piece of {csize} vertices with no shared vertex to the main network")
                else:
                    empty(t, "unreachable", "no_stop_within_cutoff", f"no {t} stop within {CUTOFF:.0f} m along the walkable network")
                continue
            j = int(np.nanargmin(np.where(np.isfinite(dd), dd, np.inf)))
            n = int(sa[j]); dmin = float(dd[j])
            sf = stop_nodes[t][n]
            path = [n]
            while path[-1] != src:
                path.append(int(pred[path[-1]]))
            path.reverse()
            es = [edge_of[(min(a, b), max(a, b))] for a, b in zip(path, path[1:])]
            seglen = [float(G[a, b]) if G[a, b] else float(G[b, a]) for a, b in zip(path, path[1:])]
            Ltot = sum(seglen) or 1
            share = lambda mask: round(sum(l for l, m in zip(seglen, mask) if m) / Ltot, 3)
            unc = share([ewc[e] == 2 for e in es])
            tun = share([etn[e] for e in es])
            brg = share([ebr[e] for e in es])
            flags = []
            if unc > 0:
                uc = Counter()
                for e, l in zip(es, seglen):
                    if ewc[e] == 2:
                        uc[fclass_names[efc[e]]] += l
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
            fb = sr.get("fallback")
            if fb:
                flags.append(f"nearest path (OSM way {fb['fragment_osm_id']}, {fb['fragment_gap_m']} m) is not joined to the street network; attached to the nearest connected street {sr['gap_m']} m away instead")
            sfb = snap_res[sf["properties"]["id"]].get("fallback")
            if sfb:
                flags.append(f"stop attached to the nearest connected street ({snap_res[sf['properties']['id']]['gap_m']} m) because its nearest path is a disconnected fragment")
            bf = bflag(dmin)
            flags += bf
            dur = round(dmin / WALK_SPEED, 1)
            # Attraction and stop attach to the same street point: the network distance really is 0.
            # It is kept as 0 with its own reason (never a stand-in for a missing value), and no line is drawn.
            same = dmin < 1.0
            if same:
                flags.insert(0, f"attraction and stop attach to the same street point; only the straight access gaps separate them ({sr['gap_m']} m + {sgap} m, not added)")
            row = {**base, "near_prefecture_boundary": bool(bf), "stop_type": t, "route_status": "ok", "reason": "same_access_point" if same else None, "stop_id": sf["properties"]["id"], "stop_name": sf["properties"]["name"], "stop_category": sf["properties"]["category"],
                   "distance_m": 0.0 if same else rn(dmin), "duration_min": 0.0 if same else dur, "stop_snap_gap_m": sgap, "segments": len(es),
                   "share_pedestrian": share([ewc[e] == 0 for e in es]), "share_road_assumed": share([ewc[e] == 1 for e in es]), "share_uncertain": unc,
                   "share_tunnel": tun, "share_bridge": brg, "flags": "; ".join(flags)}
            rows.append(row)
            lon, lat = Transformer.from_crs(6674, 4326, always_xy=True).transform(all_x[path], all_y[path])
            coords = [[round(a, 6), round(b, 6)] for a, b in zip(lon, lat)]
            feats.append({"type": "Feature", "geometry": None if same else {"type": "LineString", "coordinates": coords},
                          "properties": {"attraction_id": aid, "stop_id": row["stop_id"], "stop_type": t, "route_status": "ok", "reason": row["reason"], "distance_m": row["distance_m"], "duration_min": row["duration_min"],
                                         "identity": idl, "near_prefecture_boundary": bool(bf),
                                         "attraction_snap_gap_m": sr["gap_m"], "stop_snap_gap_m": sgap, "share_uncertain": unc, "share_tunnel": tun, "share_bridge": brg, "note": row["flags"]}})
    print(f"routes done in {time.time()-t0:.0f}s", flush=True)

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    out = {"type": "FeatureCollection", "status": "CALCULATED", "scope": "prefecture", "attraction_ids": [f["properties"]["id"] for f in A],
           "computed_at": now, "method": "Dijkstra on OSM road segments joined at shared vertices; class-based walkability assumption; see walking_prefecture_report.json", "features": feats}
    json.dump(out, open(os.path.join(DATA, "walking_routes_prefecture.geojson"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    cols = ["attraction_id", "attraction_name", "category", "identity", "stop_type", "route_status", "reason", "stop_id", "stop_name", "stop_category", "distance_m", "duration_min",
            "attraction_snap_gap_m", "fragment_fallback", "stop_snap_gap_m", "outside_road_distance_m", "near_prefecture_boundary", "segments", "share_pedestrian", "share_road_assumed", "share_uncertain",
            "share_tunnel", "share_bridge", "flags", "note"]
    with open(os.path.join(DATA, "analysis", "walking_prefecture_table.csv"), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: ("" if r.get(c) is None else r.get(c)) for c in cols})

    res = Counter((r["stop_type"], r["route_status"], r["reason"] or "") for r in rows)
    ok = [r for r in rows if r["route_status"] == "ok"]
    report = {
        "computed_at": now,
        "scope": "Kyoto Prefecture, all 523 attraction records (named and unnamed). Not validated record by record.",
        "road_data_check": check,
        "segments_used_by_walk_class": dict(used_ct),
        "segments_excluded_by_class": dict(excluded_ct),
        "graph": {"nodes": int(NN), "edges": int(len(lo)), "components": int(ncomp), "largest_component_nodes": int(comp_size.max()),
                  "small_component_threshold_vertices": SMALL_COMPONENT},
        "attractions": len(A),
        "attractions_by_identity": dict(Counter(identity(f["properties"])[0] for f in A)),
        "attractions_near_prefecture_boundary": len({r["attraction_id"] for r in rows if r["near_prefecture_boundary"]}),
        "boundary_rule": "flagged when a road vertex outside Kyoto Prefecture (original N03 polygons) is closer in a straight line than the walking result (or than the 3 km cut-off when no stop was found); the coast has no roads outside, so it is never flagged",
        "stops_considered": dict(Counter(f["properties"]["transport_type"] for f in stops)),
        "stops_snapped": {t: len(v) for t, v in stop_nodes.items()},
        "stops_not_snapped": [{"id": k, "gap_m": v["gap_m"]} for k, v in snap_res.items() if not v["ok"] and k.startswith("S")],
        "attractions_not_snapped": [{"id": k, "gap_m": v["gap_m"]} for k, v in snap_res.items() if not v["ok"] and k.startswith("A")],
        "results": {":".join(k).rstrip(":"): v for k, v in sorted(res.items())},
        "ok_rows_with_flags": sum(1 for r in ok if r["flags"]),
        "points_attached_to_main_network_instead_of_fragment": {"attractions": sum(1 for k, v in snap_res.items() if k.startswith("A") and v.get("fallback")),
                                                                 "stops": sum(1 for k, v in snap_res.items() if k.startswith("S") and v.get("fallback"))},
        "assumptions": {"walkable_classes": sorted(PED | ROAD), "uncertain_classes_used_flagged": list(UNCERTAIN_PREFIX), "excluded_classes": sorted(EXCLUDED),
                        "ignored_fields": "oneway, maxspeed (vehicle rules)", "connectivity": "shared identical vertex only; crossings do not connect",
                        "snap_limits_m": SNAP, "cutoff_m": CUTOFF, "walk_speed_m_per_min": WALK_SPEED, "crs": "EPSG:6674"},
        "limitations": [
            "No foot/access/sidewalk tags: walkability is assumed from road class and may be wrong for private service roads, roads without sidewalks, closed paths or tunnels.",
            "Attraction and stop points are not entrances or platforms; the straight access gap is reported separately and not added.",
            "Temple grounds, opening hours, steps without ramps and fee gates are not modelled.",
            "Stops are OSM records; outside Kyoto City bus stops of private operators may be missing, so 'no stop within 3 km' can reflect missing data.",
            "Stops outside Kyoto Prefecture are not in the data; records near the boundary are flagged.",
            "A reachable stop says nothing about how often it is served.",
            "Results are not checked record by record.",
        ],
    }
    json.dump(report, open(os.path.join(DATA, "analysis", "walking_prefecture_report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: report[k] for k in ("graph", "attractions_by_identity", "attractions_near_prefecture_boundary", "stops_snapped", "stops_not_snapped", "attractions_not_snapped", "results", "ok_rows_with_flags", "points_attached_to_main_network_instead_of_fragment")}, ensure_ascii=False, indent=1))
    print(f"total {time.time()-t0:.0f}s")


def names_of(e, eway, way_osm, efc, fclass_names):
    return f"OSM way {way_osm[eway[e]]} ({fclass_names[efc[e]]})"


if __name__ == "__main__":
    main(sys.argv[1])
