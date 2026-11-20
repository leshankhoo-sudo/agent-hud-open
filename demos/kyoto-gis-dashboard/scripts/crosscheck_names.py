#!/usr/bin/env python3
"""Cross-check of every attraction's name against independent sources -> public/data/name_checks.json.

Nothing in the records is changed; this says which sources agree with each name.
Sources (all open; Google Maps is not used: its terms forbid copying or storing its data, so the review
table only carries a link for checking by hand):
  - Wikidata (CC0): every item with coordinates in the prefecture's bounding box and a Japanese label,
    fetched once (data/cache/wikidata_kyoto_box.json).
  - The Wikidata link on the record's own OpenStreetMap node (data/cache/osm_attraction_nodes.json).
  - Kyoto City's sightseeing list DSIGHT_1.csv (CC BY 4.0): records already tied to a site, with evidence
    (public/data/dsight_records.json), and the sites added from it.
For a named record:
  wikidata      an item within 300 m whose Japanese label, or one of its Japanese aliases, equals the name
                (after NFKC and removing spaces)
  osm-wikidata  the record's own OSM node carries wikidata=Q..., and that item's label equals the name
  kyoto-city    the Kyoto City list names this site
  related       only an item within 300 m whose label contains the name or is contained in it (3+ characters)
  status: confirmed (one or more of the first three), related (only the last), osm-only (none).
For a record with no name: Wikidata items within 100 m are listed as candidates for a person to review.
They are not used as its name (a nearby item can be a different thing).
Review table: public/data/analysis/name_checks_review.csv (with OpenStreetMap and Google Maps links).
Usage: python3 scripts/crosscheck_names.py
"""
import csv
import json
import math
import os
import unicodedata
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data')
CACHE = os.path.join(ROOT, 'data', 'cache')
NEAR_NAMED, NEAR_UNNAMED = 300.0, 100.0


def J(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def norm(s):
    return ''.join(unicodedata.normalize('NFKC', s or '').split()).replace('　', '')


def dist_m(lon1, lat1, lon2, lat2):
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def main():
    A = J(os.path.join(DATA, 'attractions.geojson'))['features']
    wd = J(os.path.join(CACHE, 'wikidata_kyoto_box.json'))
    items = wd['items']
    nodes = J(os.path.join(CACHE, 'osm_attraction_nodes.json'))['nodes']
    dsight = J(os.path.join(DATA, 'dsight_records.json'))['records']
    city = {}
    for r in dsight:
        if r.get('site_id'):
            city.setdefault(r['site_id'], []).append(r['id'])
    # a coarse grid so each record only looks at items near it
    grid = {}
    for q, it in items.items():
        grid.setdefault((int(it['lon'] * 100), int(it['lat'] * 100)), []).append(q)

    def near(lon, lat, radius):
        out = []
        cx, cy = int(lon * 100), int(lat * 100)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for q in grid.get((cx + dx, cy + dy), []):
                    it = items[q]
                    d = dist_m(lon, lat, it['lon'], it['lat'])
                    if d <= radius:
                        out.append((d, q, it))
        return sorted(out)

    records, review, counts = {}, [], {}
    for f in A:
        p = f['properties']
        lon, lat = f['geometry']['coordinates']
        name = (p.get('name') or '').strip()
        rec = {}
        tags = (nodes.get(p.get('osm_id') or '') or {}).get('tags', {})
        if name:
            n = norm(name)
            by = []
            exact = [(d, q, it) for d, q, it in near(lon, lat, NEAR_NAMED) if norm(it['ja']) == n or n in {norm(a) for a in it.get('alt', [])}]
            if exact:
                d, q, it = exact[0]
                by.append('wikidata')
                rec['wikidata'] = {'q': q, 'ja': it['ja'], 'en': it['en'], 'm': round(d), 'via': 'label' if norm(it['ja']) == n else 'alias'}
            own = tags.get('wikidata')
            if own and own in items and (norm(items[own]['ja']) == n or n in {norm(a) for a in items[own].get('alt', [])}):
                by.append('osm-wikidata')
                rec.setdefault('wikidata', {'q': own, 'ja': items[own]['ja'], 'en': items[own]['en'],
                                            'm': round(dist_m(lon, lat, items[own]['lon'], items[own]['lat']))})
            if p['id'] in city or 'DSIGHT' in (p.get('source') or ''):
                by.append('kyoto-city')
                rec['kyoto_city'] = city.get(p['id'], [])[:3]
            if not by:
                rel = [(d, q, it) for d, q, it in near(lon, lat, NEAR_NAMED)
                       if len(n) >= 3 and len(norm(it['ja'])) >= 3 and (n in norm(it['ja']) or norm(it['ja']) in n)]
                if rel:
                    d, q, it = rel[0]
                    rec['related'] = {'q': q, 'ja': it['ja'], 'en': it['en'], 'm': round(d)}
            rec['status'] = 'confirmed' if by else 'related' if rec.get('related') else 'osm-only'
            rec['by'] = by
        else:
            cands = [{'q': q, 'ja': it['ja'], 'en': it['en'], 'm': round(d)} for d, q, it in near(lon, lat, NEAR_UNNAMED)[:3]]
            rec['status'] = 'unnamed'
            if cands:
                rec['candidates'] = cands
        counts[rec['status']] = counts.get(rec['status'], 0) + 1
        records[p['id']] = rec
        w = rec.get('wikidata') or rec.get('related') or {}
        review.append([p['id'], p['category'], name or '(no OSM name)', rec['status'], ' + '.join(rec.get('by', [])),
                       w.get('q', ''), w.get('ja', ''), w.get('m', ''),
                       ' | '.join(f"{c['ja']} ({c['q']}, {c['m']} m)" for c in rec.get('candidates', [])),
                       f'https://www.openstreetmap.org/?mlat={lat:.6f}&mlon={lon:.6f}#map=18/{lat:.6f}/{lon:.6f}',
                       f'https://www.google.com/maps/search/?api=1&query={lat:.6f},{lon:.6f}'])

    for k in ('wikidata', 'osm-wikidata', 'kyoto-city'):
        counts['by_' + k] = sum(1 for r in records.values() if k in r.get('by', []))
    counts['unnamed_with_candidates'] = sum(1 for r in records.values() if r.get('candidates'))
    out = {
        'meta': {
            'built_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'sources': {'wikidata': f"{wd['source']} (retrieved {wd['retrieved_at']}, CC0)",
                        'osm': 'data/cache/osm_attraction_nodes.json (OSM API)',
                        'kyoto_city': 'DSIGHT_1.csv, Kyoto City, CC BY 4.0 (public/data/dsight_records.json)'},
            'rules': [f'wikidata: an item within {NEAR_NAMED:.0f} m with the same Japanese name (its label or an alias).',
                      'osm-wikidata: the Wikidata link on the record\'s own OSM node, with the same name.',
                      'kyoto-city: the Kyoto City sightseeing list names this site.',
                      f'Records with no name: Wikidata items within {NEAR_UNNAMED:.0f} m are candidates for review only, never used as the name.',
                      'Google Maps is not a source (its terms forbid copying its data); the review table links to it for checking by hand.'],
            'counts': counts,
        },
        'records': records,
    }
    with open(os.path.join(DATA, 'name_checks.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(DATA, 'analysis', 'name_checks_review.csv'), 'w', encoding='utf-8-sig', newline='') as fh:
        wr = csv.writer(fh)
        wr.writerow(['id', 'category', 'name', 'status', 'confirmed_by', 'wikidata', 'wikidata_label', 'wikidata_m', 'candidates_nearby', 'openstreetmap', 'google_maps'])
        wr.writerows(review)
    print(json.dumps(counts, ensure_ascii=False))


if __name__ == '__main__':
    main()
