"""Build the map's attraction layer from the raw records, the reviewed audit decisions and the
verified DSIGHT_1.csv sites.

Run from the project folder (after scripts/audit_poi.py):  python3 scripts/poi_reconcile.py
scripts/prepare_data.py calls build() for the same result, so the pipeline stays one path.

Inputs (all kept unchanged)
    data/raw/attractions.geojson        the 523 original records (IDs A00001-A00523)
    data/audit/poi_decisions.json       reviewed decisions: duplicates to merge, groups, notes
    data/audit/poi_audit.json           audit result: CSV sites, their location checks, links
    data/audit/dsight_sites.geojson     CSV sites whose location two sources confirm, not on the map yet
    data/audit/poi_ids.json             IDs given to added sites (made once, then reused)
Outputs
    public/data/attractions.geojson     raw records minus confirmed duplicates, plus verified sites
    public/data/poi_relations.json      merged records, parent/child links, groups, CSV records per site
    public/data/point_municipality.json the attraction part is recomputed (stops are kept as they are)
    public/data/names_en.json           English names of added sites (OSM name:en or Wikidata label)
    public/data/manifest.json           attraction counts

Rules
    - A merged record is not deleted anywhere: it stays in data/raw and is listed under "merged" with
      the record that keeps it; its ID still opens that record.
    - An added site keeps the Japanese name of its OSM feature; the CSV's names are kept as aliases
      (search finds both). Category: castle for historic=castle, museum for tourism=museum,
      otherwise attraction (temples, shrines, burial mounds).
    - Each added site carries the evidence for its location (OSM feature + Wikidata item, distance,
      address area) and the CSV record IDs it stands for.
"""
import collections
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
AUD = os.path.join(ROOT, "data", "audit")
OUT = os.path.join(ROOT, "public", "data")
J = lambda p: json.load(open(p, encoding="utf-8"))


def ascii_fold(s):
    """'Nanzen-ji' -> 'nanzenji', 'Jōjakkō-ji' -> 'jojakkoji' (extra search spellings)."""
    s = unicodedata.normalize("NFKD", s or "")
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if not unicodedata.combining(c)).lower())


def category(tags):
    if tags.get("historic") == "castle":
        return "castle"
    if tags.get("tourism") == "museum":
        return "museum"
    return "attraction"


def build():
    raw = J(os.path.join(RAW, "attractions.geojson"))
    dec = J(os.path.join(AUD, "poi_decisions.json"))
    audit = J(os.path.join(AUD, "poi_audit.json"))
    add = J(os.path.join(AUD, "dsight_sites.geojson"))["features"]
    ids_path = os.path.join(AUD, "poi_ids.json")
    ids = J(ids_path) if os.path.exists(ids_path) else {}

    merged = {}
    for d in dec["duplicates"]:
        for m in d["merge"]:
            merged[m] = d["keep"]
    keep_info = collections.defaultdict(list)
    for d in dec["duplicates"]:
        keep_info[d["keep"]].append({"merged": d["merge"], "evidence": d["evidence"]})

    feats = []
    for f in raw["features"]:
        p = f["properties"]
        if p["id"] in merged:
            continue
        g = {"type": "Feature", "geometry": f["geometry"], "properties": dict(p)}
        if p["id"] in keep_info:
            g["properties"]["merged_ids"] = [x for k in keep_info[p["id"]] for x in k["merged"]]
        feats.append(g)

    # new IDs, stable: the first run numbers the sites after the last raw ID in OSM order
    last = max(int(f["properties"]["id"][1:]) for f in raw["features"])
    used = set(ids.values())
    nxt = max([last] + [int(v[1:]) for v in used]) + 1
    for s in sorted(add, key=lambda s: s["properties"]["osm"]):
        o = s["properties"]["osm"]
        if o not in ids:
            ids[o] = f"A{nxt:05d}"
            nxt += 1
    json.dump(ids, open(ids_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    names_en = {}
    for s in add:
        q = s["properties"]
        aid = ids[q["osm"]]
        typ, num = q["osm"].split("/")
        name = q["osm_name"] or q["site"]
        al = sorted({a for a in q["aliases"] + [q["site"]] if a != name})
        spell = sorted({ascii_fold(x) for x in [q.get("name_en") or ""] if ascii_fold(x)})
        feats.append({"type": "Feature", "geometry": s["geometry"], "properties": {
            "id": aid, "osm_id": num, "name": name, "display_name": name, "category": category(q["osm_tags"]),
            "source": "DSIGHT_1.csv (site) · OpenStreetMap (location) · Wikidata (check)", "validation_status": "verified location",
            "osm_element": q["osm"], "wikidata": q["wikidata"], "aliases": al, "search_text": " ".join(al + spell),
            "dsight_ids": q["dsight_ids"], "location_evidence": q["location_evidence"], "point_is": q["point_is"]}})
        if q.get("name_en"):
            names_en[aid] = {"en": q["name_en"], "source": q["name_en_source"], "osm": q["osm"]}

    # parents and children
    site_by_key = {s["key"]: s for s in audit["sites"]}
    parent_of_site = {}
    for s in audit["sites"]:
        if s.get("parent_id"):
            parent_of_site[s["key"]] = s["parent_id"]
        elif s["status"] == "Verified" and s.get("osm") in ids:
            parent_of_site[s["key"]] = ids[s["osm"]]
    parents = collections.defaultdict(lambda: {"children": [], "dsight": []})
    child_of = {}
    for key, pid in parent_of_site.items():
        s = site_by_key[key]
        for h in s["dashboard"]:
            if h["relation"] == "part of the site" and h["id"] not in merged and h["id"] != pid:
                parents[pid]["children"].append(h["id"])
                child_of[h["id"]] = pid
    for x in audit["records"]:
        pid = parent_of_site.get(x.get("site_key"))
        if pid:
            parents[pid]["dsight"].append({"csv_id": x["csv_id"], "name": x["name"], "part": x["part"], "kind": x["kind"]})

    groups = [{"name": g["name"], "ids": g["ids"], "note": g["note"]} for g in dec["related_groups"]]
    rel = {"about": "Built by scripts/poi_reconcile.py from data/audit. merged: record -> record that keeps it. parents: a site and what belongs to it (dashboard records and DSIGHT_1.csv records, which are buildings, objects and trees of that site, without points of their own). groups: separate features of one place.",
           "merged": {k: {"into": v, "evidence": next(d["evidence"] for d in dec["duplicates"] if k in d["merge"])} for k, v in merged.items()},
           "parents": dict(parents), "child_of": child_of, "groups": groups,
           "possible_duplicates": dec["possible_duplicates"], "distinct": dec["distinct"],
           "csv": {"file": "DSIGHT_1.csv", **audit["summary"]["csv"]},
           "location_check": {"raw": "OpenStreetMap point of the original package; the node was read again from OSM on 2026-11-15 and is at the same position (within 30 m) with the same name, inside the N03 municipality polygon. One source: not independently confirmed",
                              "added": "OpenStreetMap feature and Wikidata item agree; see location_evidence on each record"}}
    return {"type": "FeatureCollection", "features": feats}, rel, names_en


def point_municipality(fc):
    from shapely.geometry import Point, shape
    from shapely.strtree import STRtree
    b = J(os.path.join(RAW, "kyoto_boundary.geojson"))["features"]
    geoms = [shape(f["geometry"]) for f in b]
    tree = STRtree(geoms)
    out = {}
    for f in fc["features"]:
        pt = Point(*f["geometry"]["coordinates"])
        out[f["properties"]["id"]] = next((b[int(k)]["properties"]["N03_007"] for k in tree.query(pt, predicate="intersects")), None)
    return out


def main():
    fc, rel, names_en = build()
    json.dump(fc, open(os.path.join(OUT, "attractions.geojson"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(rel, open(os.path.join(OUT, "poi_relations.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    # municipality join for attractions (stops unchanged)
    pm = J(os.path.join(OUT, "point_municipality.json"))
    pm["points"] = {k: v for k, v in pm["points"].items() if not k.startswith("A")}
    pm["points"].update(point_municipality(fc))
    json.dump(pm, open(os.path.join(OUT, "point_municipality.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    # English names of added sites
    en = J(os.path.join(OUT, "names_en.json"))
    raw_ids = {f["properties"]["id"] for f in J(os.path.join(RAW, "attractions.geojson"))["features"]}
    live = {f["properties"]["id"] for f in fc["features"]}
    # merged records leave with their English names (the record that keeps the place has its own)
    en["attractions"] = {k: v for k, v in en["attractions"].items() if k in raw_ids and k in live}
    en["attractions"].update(names_en)
    en["meta"]["counts"]["attractions"] = {"with_en": sum(1 for k in en["attractions"] if k in live), "total": len(fc["features"])}
    en["meta"]["sources"]["attractions"]["OSM name:en or Wikidata label of an added site (scripts/poi_reconcile.py)"] = len(names_en)
    json.dump(en, open(os.path.join(OUT, "names_en.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    # manifest counts
    m = J(os.path.join(OUT, "manifest.json"))
    ps = [f["properties"] for f in fc["features"]]
    m["attractions"] = {"records": len(ps), "by_category": dict(collections.Counter(p["category"] for p in ps)),
                        "unnamed": sum(1 for p in ps if not (p.get("name") or "").strip()),
                        "raw_records": len(raw_ids), "merged_duplicates": len(rel["merged"]),
                        "added_from_dsight": sum(1 for p in ps if p.get("dsight_ids"))}
    json.dump(m, open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    checklist(fc, rel)
    print(json.dumps(m["attractions"], ensure_ascii=False))


def checklist(fc, rel):
    """data/audit/poi_audit_checklist.csv: every POI that changed or was checked, with its original ID,
    what it was matched to, what was done, the location evidence and the final result."""
    import csv
    audit = J(os.path.join(AUD, "poi_audit.json"))
    ids = J(os.path.join(AUD, "poi_ids.json"))
    dec = J(os.path.join(AUD, "poi_decisions.json"))
    by_id = {f["properties"]["id"]: f["properties"] for f in fc["features"]}
    raw = {f["properties"]["id"]: f["properties"] for f in J(os.path.join(RAW, "attractions.geojson"))["features"]}
    rows = []
    for s in sorted(audit["sites"], key=lambda s: s["site"]):
        if s.get("parent_id"):
            final = f"already on the map as {s['parent_id']}; CSV records attached to it"
        elif s["status"] == "Verified":
            final = f"added as {ids[s['osm']]} ({by_id[ids[s['osm']]]['category']})"
        else:
            final = "not added: Unverified Location (kept in this list)"
        rows.append(["CSV site", " ".join(s["records"]), s["site"], " / ".join(s["aliases"]),
                     "; ".join(f"{h['id']} {h['name']} ({h['relation']}{'' if h['distance_m'] is None else ', ' + str(h['distance_m']) + ' m'})" for h in s["dashboard"]) or (s.get("osm") or ""),
                     s["action"], f"{s['status']}: {s['reason']}", final])
    for x in audit["records"]:
        site = next((t for t in audit["sites"] if t["key"] == x.get("site_key")), None)
        parent = (site.get("parent_id") or ids.get(site.get("osm"))) if site and (site.get("parent_id") or site["status"] == "Verified") else None
        rows.append(["CSV record", x["csv_id"], x["name"], x.get("alt_name") or "", x.get("site") or "", x["kind"], x.get("address") or "",
                     f"child of {parent} (no point of its own)" if parent else x["result"]])
    for d in dec["duplicates"]:
        for m in d["merge"]:
            rows.append(["dashboard record", m, raw[m]["name"], f"osm node {raw[m]['osm_id']}", d["keep"], "A Confirmed Duplicate: merged", d["evidence"], f"merged into {d['keep']} (kept in data/raw)"])
    for g in dec["possible_duplicates"]:
        rows.append(["dashboard records", " ".join(g["ids"]), g["name"], "", "", "B Possible Duplicate: kept", g["note"], "kept, flagged on the card"])
    for g in dec["related_groups"]:
        rows.append(["dashboard records", " ".join(g["ids"]), g["name"], "", "", "C Related POI: kept, grouped", g["note"], "kept, group shown on the card"])
    for g in dec["distinct"]:
        rows.append(["dashboard records", " ".join(g["ids"]), g["name"], "", "", "D Distinct POI", g["note"], "kept"])
    for c, pid in sorted(rel["child_of"].items()):
        rows.append(["dashboard record", c, raw[c]["name"], "", pid, "C Related POI: part of an added site", "inside the site (within 700 m, name contains the site name)", f"child of {pid}"])
    for f in audit["dashboard_findings"]:
        rows.append(["dashboard record", f["id"], raw[f["id"]]["name"], "", "", f["topic"], f["finding"], f["status"]])
    with open(os.path.join(AUD, "poi_audit_checklist.csv"), "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["subject", "original_id", "name", "other_names_or_osm", "matched_to_or_site", "decision_or_kind", "location_evidence_or_note", "final_result"])
        w.writerows(rows)


if __name__ == "__main__":
    main()
