# Data guide and provenance

## Map files
- data/attractions.geojson and .csv: 523 preliminary point records. Categories: attraction 156, viewpoint 246, museum 102, castle 19. 218 names are blank. Not an official exhaustive inventory; worship and polygon features were not included.
- data/transport.geojson and .csv: 5479 preliminary point records. bus_stop 5215, railway_station 240, railway_halt 8, bus_station 14, tram_stop 2. 28 blank names; one duplicate osm_id. Not necessarily 5479 distinct operational facilities.
- data/kyoto_boundary.geojson: original N03 Kyoto Prefecture municipality/ward polygons, 999 features; NOT 999 prefectures. Draw all polygons or properly dissolve when needed. Preserve a raw copy. Source coordinates must be interpreted as geographic longitude/latitude; do not calculate metre distances directly in degrees.
- Point coordinate order is [longitude, latitude]. Existing points were selected with point-in-polygon screening against the N03 boundary. Borderline/outside transit stops must be reconsidered for network analysis. This conversion preserves the existing records, it does not perform fresh field verification.
- Local IDs A00001... and S00001... are assigned once in this package; retain them when filtering. They are project record identifiers, not official IDs. osm_id remains a string. Names may be Japanese. A fallback display label is not a translated official name.

## Sources
OpenStreetMap contributors via Geofabrik Kansai: https://download.geofabrik.de/asia/japan/kansai.html
Attribution/licence: https://www.openstreetmap.org/copyright (ODbL). Display attribution and observe applicable database reuse requirements.
Original point layers: gis_osm_pois_free_1 and gis_osm_transport_free_1. Exact OSM snapshot date was not independently confirmed; do not substitute this package date for the source date.
Administrative boundaries: MLIT National Land Numerical Information N03, 2026: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html

## Route and fare records
data/sample_journeys.json: nine published sample bus journeys, seven destination labels. Destination and stop identifiers are deliberately null until verified matches exist. Walking distances and geometry are also null, not zero.
All journeys originate at Kyoto Station and have no vehicle transfer. They are examples, not the fastest/cheapest options.
Standard routes are from the November 2024 official guide; current operating timetables were not verified. Express route details and fares were checked on operator web pages on 2026-11-10. Weekend/holiday restrictions are sourced from the guide and must be rechecked for travel dates.
Each JSON record contains official route/fare URLs and evidence status. Source access date is not the date a fare became effective.
Fare source: https://www2.city.kyoto.lg.jp/kotsu/webguide/en/fare/fare_bus.html
Express source: https://www2.city.kyoto.lg.jp/kotsu/webguide/en/bus/limited_express.html
Guide: https://www.city.kyoto.lg.jp/kotsu/cmsfiles/contents/0000323/323259/2024_11_kyoto_A4pamphlet_en_fix.pdf

## Optional road input (separate ZIP)
Original gis_osm_roads_free_1 shapefile and supporting files. Whole downloaded extent, not clipped Kyoto. 1492473 records in the previously inspected DBF. Includes motorway, primary, secondary, tertiary, residential, footway, pedestrian, path and steps.
Fields: osm_id, code, fclass, name, ref, oneway, maxspeed, layer, bridge, tunnel. These lack full pedestrian access permissions. Oneway/maxspeed may be vehicle-related and should not automatically constrain pedestrian routes. A geometric intersection does not prove a traversable junction.
The archive does not contain a built network or validated routes. Start with 10-20 attractions and inspect actual routes, entrances and alternatives.

## Supplementary tourism workbook
documents/Kyoto_Tourism_Data_EN.xlsx preserves existing tourism tables and their source notes. Not revalidated in this packaging step. Municipality visitor totals are not attraction totals. 2015 site visits are historical; 2023 foreign visitor survey shares are percentages, not counts; Nijo Castle admissions are fiscal-year admissions. Never merge these measures into one ranking or allocate city totals to individual points.

## Weather
No static weather values supplied. Use live requests when possible. https://open-meteo.com/en/docs
Education/noncommercial usage is subject to free API limits and attribution, not unlimited usage: https://open-meteo.com/en/terms and https://open-meteo.com/en/pricing . Model grids can give nearby points the same forecast.

## Pending
Boundary decision; source-date audit; deduplication; attraction/entrance verification; external nearby stops; walkable graph construction; measured routes; density results; journey joins; weather API runtime test; optional true 3D terrain/building sources.
