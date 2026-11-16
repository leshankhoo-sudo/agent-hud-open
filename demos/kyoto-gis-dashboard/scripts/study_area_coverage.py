"""Which municipalities the study area covers, from a real polygon intersection.

Study area: Kyoto Prefecture, i.e. the union of every polygon in the raw N03 boundary file
(data/raw/kyoto_boundary.geojson, MLIT N03, full precision). The outline drawn on the map is a
simplified copy of the same polygon, for display only.

Level: municipalities (shi / cho / son, N03_004). The 11 wards of Kyoto City (N03_005) are a
lower level; they are listed under Kyoto City and never counted as municipalities.

Method (areas in JGD2011 / Japan Plane Rectangular CS VI, EPSG:6674, metres):
  overlap = area(municipality ∩ study area) / area(municipality)
  full     overlap >= 99.9 %
  partial  overlap between the two, and the shared area is at least 1,000 m²
  not counted  shared area under 1,000 m² or under 0.1 % (edge contact or sliver from digitising)
The tolerance is about one 30 m × 30 m cell, well under the N03 positional accuracy at 1:25,000.

Output: public/data/study_area_coverage.json, and public/data/coverage_lines.geojson (each
municipality's boundary rings as separate lines, for the map: simplified by 15 m in metres for
drawing, every island and hole kept as its own ring, never joined to another)
Run: python scripts/study_area_coverage.py
"""
import json, os
from shapely.geometry import shape, mapping
from shapely import transform as tf
from shapely.ops import unary_union
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw', 'kyoto_boundary.geojson')
OUT = os.path.join(ROOT, 'public', 'data', 'study_area_coverage.json')
FULL, MIN_SHARE, MIN_AREA = 0.999, 0.001, 1000.0

def main():
    fc = json.load(open(RAW, encoding='utf-8'))
    T = Transformer.from_crs('EPSG:6668', 'EPSG:6674', always_xy=True)
    B = Transformer.from_crs('EPSG:6674', 'EPSG:6668', always_xy=True)
    to_m = lambda g: tf(g, lambda xy: __import__('numpy').column_stack(T.transform(xy[:, 0], xy[:, 1])))
    to_deg = lambda g: tf(g, lambda xy: __import__('numpy').column_stack(B.transform(xy[:, 0], xy[:, 1])))
    parts, wards = {}, {}
    for f in fc['features']:
        p = f['properties']
        g = to_m(shape(f['geometry']).buffer(0))
        name, code = p['N03_004'], p['N03_007']
        if not name or not code:   # unassigned land would be reported, never guessed
            parts.setdefault(('?', 'unassigned'), []).append(g); continue
        ward = p.get('N03_005')
        muni_code = code[:3] + '00' if ward else code
        parts.setdefault((muni_code, name), []).append(g)
        if ward: wards.setdefault((muni_code, code, ward), []).append(g)
    study = unary_union([g for gs in parts.values() for g in gs])
    rows, lines = [], []
    for (code, name), gs in sorted(parts.items()):
        m = unary_union(gs)
        inter = m.intersection(study).area
        share = inter / m.area if m.area else 0
        status = 'full' if share >= FULL else 'partial' if inter >= MIN_AREA and share >= MIN_SHARE else 'not counted'
        kind = {'市': 'city', '町': 'town', '村': 'village'}.get(name[-1], 'other')
        row = {'code': code, 'name': name, 'type': kind, 'status': status, 'share': round(share, 6),
               'area_km2': round(m.area / 1e6, 2), 'parts': len(getattr(m, 'geoms', [m]))}
        sub = [{'code': c, 'name': w, 'area_km2': round(unary_union(g).area / 1e6, 2)} for (mc, c, w), g in sorted(wards.items()) if mc == code]
        if sub: row['wards'] = sub
        rows.append(row)
        if status != 'not counted':
            for poly in getattr(m.simplify(15, preserve_topology=True), 'geoms', [m.simplify(15, preserve_topology=True)]):
                for k, ring in enumerate([poly.exterior, *poly.interiors]):
                    cs = [[round(x, 5), round(y, 5)] for x, y in to_deg(ring).coords]
                    if len(cs) >= 4: lines.append({'type': 'Feature', 'properties': {'code': code, 'name': name, 'hole': k > 0}, 'geometry': {'type': 'LineString', 'coordinates': cs}})
    counted = [r for r in rows if r['status'] != 'not counted']
    out = {
        'study_area': {'name': 'Kyoto Prefecture', 'definition': 'union of all N03 polygons for Kyoto Prefecture', 'area_km2': round(study.area / 1e6, 1)},
        'level': 'municipality', 'label': 'Municipalities covered',
        'source': 'MLIT National Land Numerical Information N03 (administrative areas), data/raw/kyoto_boundary.geojson',
        'method': 'Polygon intersection in EPSG:6674 (metres). Full: at least 99.9% of the municipality lies in the study area. Partial: shared area at least 1,000 m² and 0.1%. Smaller overlaps (edge contact, digitising slivers) are not counted. Kyoto City wards are a lower level and are listed under Kyoto City, not counted.',
        'tolerance': {'full_share': FULL, 'min_share': MIN_SHARE, 'min_area_m2': MIN_AREA},
        'counts': {'covered': len(counted), 'full': sum(r['status'] == 'full' for r in rows), 'partial': sum(r['status'] == 'partial' for r in rows),
                   'by_type': {t: sum(r['type'] == t for r in counted) for t in ('city', 'town', 'village')}},
        'municipalities': rows,
    }
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump({'type': 'FeatureCollection', 'features': lines}, open(os.path.join(ROOT, 'public', 'data', 'coverage_lines.geojson'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(len(lines), 'boundary rings')
    print(out['counts'], out['study_area'])

if __name__ == '__main__':
    main()
