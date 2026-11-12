# Data interfaces for analysis results

The dashboard reads analysis results only from these files. Replace them with new real results in the same shape; no code change is needed.

## Analysis 2 · `public/data/walking_routes_prefecture.geojson` (since 2026-11-12; the pilot file `walking_routes.geojson` has the same shape)

Extra properties in the prefecture file: `reason` (`null` | `same_access_point` | `no_stop_within_cutoff` | `isolated_network` | `attraction_too_far_from_network`), `identity` (`named` | `osm_tags` | `unverified`), `near_prefecture_boundary`, `steps_m`, `share_*`. `same_access_point` is the only case where an ok row has `distance_m: 0` and `geometry: null` (attraction and stop attach to the same street point; a measured 0, not a stand-in).

```jsonc
{
  "type": "FeatureCollection",
  "status": "CALCULATED",          // anything else -> "Walking analysis not yet available"
  "scope": "pilot" | "prefecture", // "pilot": only attraction_ids get results; all other records stay "not available"
  "attraction_ids": ["A00041", ...],
  "pilot": { "name": "...", "bbox": [minLon, minLat, maxLon, maxLat], "rule": "..." },
  "computed_at": "ISO 8601",
  "method": "...",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "LineString", "coordinates": [[lon, lat], ...] } | null,
      "properties": {
        "attraction_id": "A00230",
        "stop_id": "S00602" | null,
        "stop_type": "bus" | "rail" | "tram",      // one row per type, never mixed
        "route_status": "ok" | "unreachable" | "failed" | "unverified",
        "distance_m": 74.7 | null,                 // > 0 for ok (0 only with reason same_access_point); null otherwise (never 0 as a stand-in)
        "duration_min": 0.9 | null,
        "attraction_snap_gap_m": 0.3,              // straight access gap, NOT added to distance
        "stop_snap_gap_m": 0.5,
        "share_uncertain": 0, "share_tunnel": 0, "share_bridge": 0,
        "note": "flags or the reason there is no route"
      }
    }
  ]
}
```

Rules enforced by `src/lib/walking.js` (rows that break them are set aside, not repaired):
- `ok` rows need a line geometry, a `stop_id` and `distance_m > 0`.
- `unreachable` / `failed` rows must have `distance_m: null`.
- Coverage counts distinct attraction IDs once. Its denominator is the number of in-scope records in the current category filter. Records with no route are reported separately.

The package's original empty file (`data/raw/walking_routes.geojson`, status `NOT_CALCULATED`) is kept unchanged.

## Analysis 1 · `public/data/analysis/density_kde.geojson`

- Polygons are 500 m cells (EPSG:6674 grid, stored as WGS84 corners).
- Properties hold one density value per category (`attraction`, `viewpoint`, `museum`, `castle`), in records/km².
- The map sums the selected categories. This is valid because the kernel sum is linear.
- The method parameters are in `density_kde_meta.json` and are shown in the UI.
