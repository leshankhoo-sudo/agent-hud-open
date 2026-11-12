#!/usr/bin/env python3
"""Kyoto City Bus package (data/raw/bus_package) -> public/data/bus/

Operator: Kyoto Municipal Transportation Bureau only (not every bus operator in the prefecture).
Line geometry and stop order come from OpenStreetMap route relations (ODbL), as supplied in the
package; this is not the official GTFS feed. Nothing is invented here: stop coordinates and order
are copied, and records that look wrong are only flagged for review.

Outputs
  bus/index.json            route catalogue, fares, stop -> routes, dashboard point -> stops, review flags
  bus/variants/<id>.json    one direction / service pattern: line coordinates + ordered stops (loaded on demand)
Usage: python3 scripts/prepare_bus_routes.py
"""
import json
import math
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw', 'bus_package')
OUT = os.path.join(ROOT, 'public', 'data', 'bus')
J = lambda n: json.load(open(os.path.join(RAW, n), encoding='utf-8'))
OFFSET_REVIEW_M = 60      # a stop this far from the line is flagged
routes, cross, fares = J('bus_routes.json'), J('bus_stop_crosswalk.json'), J('bus_fares.json')
shapes, ordered, cov = J('route_shapes.geojson'), J('ordered_stops.json'), J('coverage.json')


def length_m(c):
    t = 0
    for (x1, y1), (x2, y2) in zip(c, c[1:]):
        kx = 111320 * math.cos(math.radians((y1 + y2) / 2))
        t += math.hypot((x2 - x1) * kx, (y2 - y1) * 110574)
    return t


os.makedirs(os.path.join(OUT, 'variants'), exist_ok=True)
by_route, review, n_stops = {}, [], 0
for f in shapes['features']:
    p = f['properties']
    vid = p['variant_id']
    stops = ordered.get(vid)
    flags = []
    if not stops:
        review.append({'variant_id': vid, 'route_number': p['route_number'], 'issue': 'no ordered stops for this line'})
        continue
    seqs = [s['stop_sequence'] for s in stops]
    if seqs != sorted(seqs) or len(set(seqs)) != len(seqs):
        flags.append('stop_sequence is not strictly increasing')
    back = [s['stop_sequence'] for a, s in zip(stops, stops[1:]) if s['route_progress'] < a['route_progress'] - 1e-6]
    if back:
        flags.append(f'position along the line goes backwards at stop sequence {back}')
    far = [(s['stop_sequence'], s['name_ja'], s['offset_to_line_m_approx']) for s in stops if s['offset_to_line_m_approx'] > OFFSET_REVIEW_M]
    if far:
        flags.append('stops far from the line: ' + ', '.join(f'#{a} {b} {c:.0f} m' for a, b, c in far))
    coords = [[round(x, 6), round(y, 6)] for x, y in f['geometry']['coordinates']]
    out_stops = [{'seq': s['stop_sequence'], 'key': s['official_stop_key'], 'ja': s['name_ja'], 'en': s.get('name_en') or '', 'xy': [round(v, 6) for v in s['coordinates']],
                  'p': round(s['route_progress'], 6), 'off': round(s['offset_to_line_m_approx'], 1), 'review': s['offset_to_line_m_approx'] > OFFSET_REVIEW_M} for s in stops]
    xs = [c[0] for c in coords] + [s['xy'][0] for s in out_stops]
    ys = [c[1] for c in coords] + [s['xy'][1] for s in out_stops]
    v = {'id': vid, 'route_key': p['route_key'], 'route_number': p['route_number'], 'origin_ja': p['origin_ja'], 'terminal_ja': p['terminal_ja'], 'name_ja': p['route_name_ja'],
         'length_m': round(length_m(coords)), 'osm_relation_url': p['osm_relation_url'], 'official_stop_listing_url': p['official_stop_listing_url'],
         'official_order_checked': bool(p['official_order_checked']), 'bbox': [min(xs), min(ys), max(xs), max(ys)], 'review': flags, 'line': coords, 'stops': out_stops}
    json.dump(v, open(os.path.join(OUT, 'variants', f'{vid}.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    n_stops += len(out_stops)
    en = lambda key: (cross.get(key) or {}).get('name_en') or ''
    by_route.setdefault(p['route_key'], []).append({
        'id': vid, 'origin_ja': p['origin_ja'], 'origin_en': out_stops[0]['en'], 'terminal_ja': p['terminal_ja'], 'terminal_en': out_stops[-1]['en'],
        'via_ja': out_stops[len(out_stops) // 3]['ja'], 'via_en': out_stops[len(out_stops) // 3]['en'], 'loop': p['origin_ja'] == p['terminal_ja'],
        'stops': len(out_stops), 'length_m': v['length_m'], 'official_order_checked': v['official_order_checked'], 'review': len(flags),
        'order': [s['key'] for s in out_stops]})   # stop keys in travel order (repeats kept)
    for fl in flags:
        review.append({'variant_id': vid, 'route_number': p['route_number'], 'direction': f"{p['origin_ja']} → {p['terminal_ja']}", 'issue': fl})

def numkey(r):
    n = r['number']
    d = ''.join(ch for ch in n if ch.isdigit())
    return (0 if n.isdigit() else 1 if d else 2, int(d) if d else 0, n)

cat, stop_routes = [], {}
for key, r in routes.items():
    fa = fares.get(key, {})
    for sk in r.get('listed_stop_keys_unordered', []):
        stop_routes.setdefault(sk, []).append(key)
    cat.append({'key': key, 'number': r['route_number'], 'via_ja': r.get('main_via_ja', ''), 'fare_class_ja': r.get('official_fare_class_ja', ''), 'url': r['official_route_url'],
                'stop_keys': r.get('listed_stop_keys_unordered', []),
                'fare': {'type': fa.get('type'), 'adult': fa.get('adult_jpy'), 'child': fa.get('child_jpy'), 'checked_on': fa.get('checked_on'), 'sources': fa.get('source_urls', []),
                         'chart_url': fa.get('official_fare_chart_url'), 'chart_page': fa.get('official_fare_chart_page'), 'planner_url': fa.get('trip_fare_lookup_url')} if fa else None,
                'variants': sorted(by_route.get(key, []), key=lambda v: (v['origin_ja'], v['terminal_ja']))})
cat.sort(key=numkey)
stops = {k: {'ja': v['name_ja'], 'en': v.get('name_en') or '', 'points': v.get('dashboard_point_id_candidates', []), 'match': v.get('name_match'), 'routes': stop_routes.get(k, [])} for k, v in cross.items()}
point_stops = {}
for k, v in stops.items():
    for pid in v['points']:
        point_stops.setdefault(pid, []).append(k)
index = {
    'generated': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
    'operator': 'Kyoto Municipal Transportation Bureau (Kyoto City Bus) only',
    'sources': {
        'catalogue': 'Kyoto City Bus official route index and stop lists, checked 2026-11-12 (stop membership per route is an unordered set)',
        'animation': 'Line geometry and stop order: OpenStreetMap contributors (ODbL), route relations extracted 2026-11-12. Not the official GTFS feed.',
        'fares': 'Kyoto City Bus fare guide, checked 2026-11-12 (separate fare package)'},
    'coverage': {'routes': len(cat), 'routes_with_animation': sum(1 for r in cat if r['variants']), 'variants': sum(len(r['variants']) for r in cat), 'stop_occurrences': n_stops,
                 'route_numbers_without_animation': cov['route_numbers_without_animation'], 'relations_checked': cov['relation_validation_outcomes'],
                 'official_order_checked': sorted({r['number'] for r in cat for v in r['variants'] if v['official_order_checked']})},
    'review': review, 'routes': cat, 'stops': stops, 'point_stops': point_stops,
}
json.dump(index, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(json.dumps(index['coverage'], ensure_ascii=False))
print('review flags:', len(review), '| index', round(os.path.getsize(os.path.join(OUT, 'index.json')) / 1e3), 'KB | variants dir', round(sum(os.path.getsize(os.path.join(OUT, 'variants', f)) for f in os.listdir(os.path.join(OUT, 'variants'))) / 1e6, 2), 'MB')
for r in review[:12]:
    print(' ', r['route_number'], r.get('direction', ''), '|', r['issue'][:150])
print('fare keys sample:', {k: list(v.keys()) for k, v in list(fares.items())[:1]}, [list(v.keys()) for v in fares.values() if v.get('type') == 'multi_section'][:1])
