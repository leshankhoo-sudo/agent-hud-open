"""Keep the prefecture walking results in step with the map layer after records leave it.

Run from the project folder (after scripts/poi_reconcile.py):  python scripts/walking_keep_map_records.py

scripts/walking_prefecture.py routes every attraction record on its own (Dijkstra from that record to
its nearest bus stop and nearest rail station), so one record's result never depends on another
record. When a record leaves the map layer (a merged duplicate, or a "not a sight" decision in
data/audit/poi_decisions.json), dropping its rows gives exactly what a full rerun would give, without
the 200,000-segment road file. Nothing is recomputed or changed for the records that stay.

Updates
    public/data/walking_routes_prefecture.geojson        rows and attraction_ids of records no longer on the map are dropped
    public/data/analysis/walking_prefecture_table.csv     same rows
    public/data/analysis/walking_prefecture_report.json   record counts, result counts and flags recounted from the kept rows;
                                                          graph, road and stop checks are unchanged (they do not depend on the records)
"""
import csv
import json
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
J = lambda p: json.load(open(p, encoding="utf-8"))


def main():
    live = {f["properties"]["id"] for f in J(os.path.join(DATA, "attractions.geojson"))["features"]}

    gpath = os.path.join(DATA, "walking_routes_prefecture.geojson")
    g = J(gpath)
    gone = sorted(set(g["attraction_ids"]) - live)
    g["attraction_ids"] = [a for a in g["attraction_ids"] if a in live]
    g["features"] = [f for f in g["features"] if f["properties"]["attraction_id"] in live]
    json.dump(g, open(gpath, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    tpath = os.path.join(DATA, "analysis", "walking_prefecture_table.csv")
    with open(tpath, encoding="utf-8-sig", newline="") as fh:
        rd = csv.DictReader(fh)
        cols, rows = rd.fieldnames, [r for r in rd if r["attraction_id"] in live]
    with open(tpath, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

    rpath = os.path.join(DATA, "analysis", "walking_prefecture_report.json")
    r = J(rpath)
    ids = sorted({x["attraction_id"] for x in rows})
    ident = {x["attraction_id"]: x["identity"] for x in rows}
    res = Counter((x["stop_type"], x["route_status"], x["reason"] or "") for x in rows)
    ok = [x for x in rows if x["route_status"] == "ok"]
    r["attractions"] = len(ids)
    r["attractions_by_identity"] = dict(Counter(ident[a] for a in ids))
    r["attractions_near_prefecture_boundary"] = len({x["attraction_id"] for x in rows if x["near_prefecture_boundary"] == "True"})
    r["attractions_not_snapped"] = [a for a in r["attractions_not_snapped"] if a["id"] in live]
    r["results"] = {":".join(k).rstrip(":"): v for k, v in sorted(res.items())}
    r["ok_rows_with_flags"] = sum(1 for x in ok if x["flags"])
    r["ok_rows_with_steps"] = sum(1 for x in ok if x["steps_m"] not in ("", "0", "0.0"))
    r["points_attached_to_main_network_instead_of_fragment"]["attractions"] = len({x["attraction_id"] for x in rows if x["fragment_fallback"] == "True"})
    r["records_left_out_after_routing"] = sorted(set(r.get("records_left_out_after_routing", [])) | set(gone))
    r["records_left_out_note"] = ("Records that left the map layer after the routing run (merged duplicates or not-a-sight decisions, "
                                  "data/audit/poi_decisions.json). Their rows were dropped by scripts/walking_keep_map_records.py; "
                                  "every other record's route is unchanged, since each record is routed on its own.")
    json.dump(r, open(rpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({"dropped": gone, "attractions": r["attractions"], "rows": len(rows), "results": r["results"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
