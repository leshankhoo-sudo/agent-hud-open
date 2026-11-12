# Kyoto City Bus route animation data

This standalone package contains 175 mapped route variants across 89 route numbers (1, 10, 102, 105, 106, 11, 12, 15, 18, 19, 20, 201, 202, 203, 204, 205, 206, 207, 208, 22, 23, 25, 26, 27, 28, 29, 3, 31, 32, 33, 37, 4, 43, 46, 5, 50, 51, 52, 53, 55, 58, 59, 6, 65, 67, 7, 70, 71, 75, 78, 8, 80, 81, 84, 85, 86, 9, 91, 93, EX100, EX101, M1, 北1, 北3, 北8, 南2, 南3, 南5, 南6, 南8, 快速202・立命館, 快速205・立命館, 特13, 特18, 特27, 特33, 特37, 特71, 特8, 特80, 特南1, 特西4, 特西5, 西2, 西3, 西4, 西5, 西6, 西8). Extracted 12 November 2026. It is intended for the Kyoto GIS Dashboard route reveal and stop pop-out animation.

## Files and integration

- `route_shapes.geojson` contains directional LineStrings in WGS84 longitude/latitude. Use `properties.variant_id` to join to `ordered_stops.json`, and `properties.route_key` to join to the existing route catalogue.
- `ordered_stops.json` lists platform markers in travel order, keyed by variant ID. Use the station coordinates for marker placement. `route_progress` is the projected position along the LineString as a fraction from 0 to 1. Trigger each marker pop-out when the line reveal crosses its fraction. Use one consistent distance metric for rendering and alignment. Preserve repeated stops as separate sequence entries.
- `coverage.json` identifies which official route labels have at least one usable animation variant and lists the remaining labels.
- Starting from a clicked stop, select a variant that includes its official stop key. If the same stop occurs twice, use the appropriate boarding occurrence. Use the catalogue's existing stop crosswalk for Dashboard point IDs. The animation data uses its own platform coordinates.

## Provenance and coverage

Road geometry and mapped stops are from [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0, via the OpenStreetMap API and [Geofabrik Kansai extract](https://download.geofabrik.de/asia/japan/kansai.html). Keep visible OpenStreetMap attribution. Each feature links to its exact OSM relation. The package is a subset of mapped routes and is not the official GTFS archive.

All included stops were matched to the Kyoto City Bus route's published stop list. EX100 and EX101 travel order was cross-checked with the [operator's sightseeing route table](https://www2.city.kyoto.lg.jp/kotsu/webguide/en/bus/limited_express.html). For other routes the sequence comes from the mapped OSM relation. Some directions or service variants are absent. Retain the existing stop highlighting for routes without a supported line. This static data does not give live bus locations or day-specific availability.
