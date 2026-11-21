#!/usr/bin/env python3
"""Labels for attraction records that have no OSM name -> public/data/attraction_labels.json.

The records keep their original fields (name stays empty, display_name and IDs unchanged); this file only
adds a label the dashboard can show, and says what each label rests on. Nothing is translated, romanised
or invented, and no record is linked to another dataset by its name.

Records that already have a verified English name from the name:en tag of the same OSM record
(attraction_context.json) keep that and get no label. For the rest, in this order:
  1. name    - a name in another language on the SAME OSM record (name:ja, name:zh, name:ko, name:es, ...).
  2. desc    - the description tag of the same OSM record (shown as a description, not as a name).
  3. place   - the point lies inside a named OSM area (temple grounds, park, ...; Overpass is_in, from
               attraction_context.json). A location relationship, not an identification: "Viewpoint at X".
               With several areas the main site is used (temple, shrine, park, ...), not a building inside it.
  4. address - the town (町・字) of the point from the GSI reverse geocoder, used only when GSI's
               municipality code equals the record's own point-in-polygon municipality (MLIT N03).
  5. muni    - otherwise the municipality alone.
GSI answers are cached in data/cache/gsi_reverse_unnamed.json; run with --offline to use the cache only.
A review table is written to public/data/analysis/attraction_labels_review.csv.
Usage: python3 scripts/label_unnamed.py [--offline]
"""
import csv
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data')
CACHE = os.path.join(ROOT, 'data', 'cache')
GSI_CACHE = os.path.join(CACHE, 'gsi_reverse_unnamed.json')
GSI_URL = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat={lat}&lon={lon}'
UA = 'kyoto-gis-dashboard/1.0 (university GIS prototype; place labels)'
LANGS = {'ja': 'Japanese', 'zh': 'Chinese', 'ko': 'Korean', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'ru': 'Russian', 'it': 'Italian', 'pt': 'Portuguese'}
SITE_ORDER = ['Buddhist temple', 'Shinto shrine', 'park', 'garden', 'historic site', 'zoo', 'theme park', 'museum', 'burial mound', 'lake or pond', 'visitor site', 'building']


def J(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def gsi_lookup(cache, key, lon, lat, offline):
    if key in cache:
        return cache[key]
    if offline:
        return None
    req = urllib.request.Request(GSI_URL.format(lat=f'{lat:.7f}', lon=f'{lon:.7f}'), headers={'User-Agent': UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                res = json.load(r).get('results') or {}
            cache[key] = {'muniCd': str(res.get('muniCd') or ''), 'lv01Nm': res.get('lv01Nm') or '', 'lon': lon, 'lat': lat}
            time.sleep(0.35)
            return cache[key]
        except Exception as e:  # network trouble: try again, then leave it for the next run
            print(f'  GSI {key}: {e}', file=sys.stderr)
            time.sleep(2 + attempt * 3)
    return None


def main():
    offline = '--offline' in sys.argv
    A = J(os.path.join(DATA, 'attractions.geojson'))['features']
    ctx = J(os.path.join(DATA, 'attraction_context.json'))['records']
    nodes = J(os.path.join(CACHE, 'osm_attraction_nodes.json'))['nodes']
    pm = J(os.path.join(DATA, 'point_municipality.json'))
    muni_en = {k: v['en'] for k, v in J(os.path.join(DATA, 'names_en.json')).get('municipalities', {}).items()}
    gsi = J(GSI_CACHE)['answers'] if os.path.exists(GSI_CACHE) else {}

    labels, review = {}, []
    for f in A:
        p = f['properties']
        if (p.get('name') or '').strip():
            continue
        c = ctx.get(p['id'], {})
        if c.get('name_en'):
            continue  # already shows the English name of the same OSM record
        tags = (nodes.get(p['osm_id']) or {}).get('tags', {})
        code = (pm['points'].get(p['id']) or '')
        lon, lat = f['geometry']['coordinates']
        lab = None
        # 1. a name in another language on the same record
        for k, v in sorted(tags.items(), key=lambda kv: (kv[0] != 'name:ja', kv[0])):
            lang = k.split(':', 1)[1] if k.startswith('name:') else ''
            if lang in LANGS and v.strip():
                lab = {'kind': 'name', 'text': v.strip(), 'lang': lang, 'basis': f'OSM {k} of the same record ({LANGS[lang]})'}
                break
        # 2. its description tag
        if not lab and (tags.get('description') or '').strip():
            lab = {'kind': 'desc', 'text': tags['description'].strip(), 'basis': 'OSM description of the same record'}
        # 3. a named OSM area that contains the point
        if not lab and c.get('inside'):
            sites = sorted(c['inside'], key=lambda s: SITE_ORDER.index(s['kind']) if s['kind'] in SITE_ORDER else len(SITE_ORDER))
            s = sites[0]
            lab = {'kind': 'place', 'text': s['name'], 'text_en': s.get('name_en') or '', 'site_kind': s['kind'],
                   'basis': f'inside the named OSM area "{s["name"]}" ({s["kind"]}; Overpass is_in)'}
        # 4. the town from the GSI reverse geocoder, when GSI agrees on the municipality
        g = None
        if not lab:
            g = gsi_lookup(gsi, p['id'], lon, lat, offline)
            town = (g or {}).get('lv01Nm', '').strip()
            if g and town and town not in ('－', '-') and g.get('muniCd') == code:
                lab = {'kind': 'address', 'text': town, 'muni': code, 'basis': 'town from the GSI reverse geocoder; its municipality code matches the MLIT N03 join'}
        # 5. the municipality alone
        if not lab:
            lab = {'kind': 'muni', 'muni': code, 'basis': 'municipality from the MLIT N03 point-in-polygon join' + (
                '' if not g else f' (GSI gave {g.get("muniCd")} {g.get("lv01Nm")}, not used)')}
        if lab.get('muni'):
            lab['muni_en'] = muni_en.get(lab['muni'], '')
        labels[p['id']] = lab
        review.append([p['id'], p['osm_id'], p['category'], lab['kind'], lab.get('text', ''), lab.get('text_en', ''), lab.get('muni_en', ''), lab['basis']])

    # Named records whose name tag is cut short: the same OSM record's name:ja begins with the name and
    # goes on (e.g. name 天, name:ja 天鷲絨美術館). The longer form is shown; the name field stays as it is.
    full = {}
    for f in A:
        p = f['properties']
        n = (p.get('name') or '').strip()
        ja = ((nodes.get(p['osm_id']) or {}).get('tags', {}).get('name:ja') or '').strip()
        if n and ja != n and ja.startswith(n):
            full[p['id']] = {'text': ja, 'basis': f'OSM name:ja of the same record; its name tag "{n}" is the start of it, cut short'}

    os.makedirs(CACHE, exist_ok=True)
    with open(GSI_CACHE, 'w', encoding='utf-8') as fh:
        json.dump({'source': GSI_URL.split('?')[0], 'retrieved_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'answers': gsi}, fh, ensure_ascii=False, indent=1)

    counts = {}
    for v in labels.values():
        counts[v['kind']] = counts.get(v['kind'], 0) + 1
    out = {
        'meta': {
            'built_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'scope': 'attraction records with an empty OSM name and no English name of their own',
            'rules': [
                'The records are not changed: name stays empty, display_name and IDs stay as they are.',
                'name: a name in another language on the same OSM record. desc: its description tag.',
                'place: the point lies inside that named OSM area (a location relationship, not an identification).',
                'address: the town from the GSI reverse geocoder, used only when its municipality code matches the MLIT N03 join.',
                'muni: the municipality alone. Nothing is translated, romanised or invented.',
            ],
            'counts': counts, 'records': len(labels),
            'sources': {'osm_tags': 'data/cache/osm_attraction_nodes.json (OSM API)', 'inside': 'public/data/attraction_context.json',
                        'gsi': 'data/cache/gsi_reverse_unnamed.json (GSI reverse geocoder)', 'municipality': 'public/data/point_municipality.json'},
            'licence': 'OpenStreetMap contributors (ODbL); GSI reverse geocoder (国土地理院)',
        },
        'labels': labels,
        'full_names': full,
    }
    with open(os.path.join(DATA, 'attraction_labels.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    os.makedirs(os.path.join(DATA, 'analysis'), exist_ok=True)
    with open(os.path.join(DATA, 'analysis', 'attraction_labels_review.csv'), 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['id', 'osm_id', 'category', 'label_kind', 'text', 'text_en', 'municipality_en', 'basis'])
        w.writerows(review)
    # the manifest says how the unnamed records are shown
    mpath = os.path.join(DATA, 'manifest.json')
    man = J(mpath)
    man['attractions']['unnamed_display'] = {
        'english_name_same_record': sum(1 for f in A if not (f['properties'].get('name') or '').strip() and ctx.get(f['properties']['id'], {}).get('name_en')),
        'labelled': len(labels), 'by_basis': counts, 'file': 'attraction_labels.json',
        'note': 'Labels are shown for records with no OSM name; the name field itself stays empty.',
    }
    with open(mpath, 'w', encoding='utf-8') as fh:
        json.dump(man, fh, ensure_ascii=False, indent=1)
    print(len(labels), 'labels', counts)


if __name__ == '__main__':
    main()
