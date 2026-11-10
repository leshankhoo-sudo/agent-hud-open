#!/usr/bin/env python3
"""English names for attractions, stops and municipalities -> public/data/names_en.json.

Only verifiable sources are used; nothing is translated or invented:
  1. OSM `name:en` on the same OSM element (current OSM API), when that element's
     `name` / `name:ja` still equals the name in our data.
  2. OSM `name:ja-Latn` / `name:ja_rm` (romanised Japanese) on the same element.
  3. The English label of the Wikidata item linked from that element (`wikidata` tag).
  4. A Wikidata item whose Japanese label equals the record name exactly and whose
     coordinates are within 300 m (the same rule as the photo matching).
  5. Otherwise no English name: the dashboard shows the original name only.
Municipalities use their official romanised names (see MUNICIPALITIES below).

The original data files are not changed. Usage: python3 scripts/fetch_names_en.py
A review table is written to public/data/analysis/names_en_review.csv.
"""
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data')
CACHE = os.path.join(ROOT, 'data', 'cache', 'osm_elements.json')
UA = 'kyoto-gis-dashboard/1.0 (university GIS prototype; english name lookup)'

# Official romanised names (municipal websites / MLIT romanisation), keyed by N03_007 code.
MUNICIPALITIES = {
    '26101': 'Kita Ward, Kyoto City', '26102': 'Kamigyo Ward, Kyoto City', '26103': 'Sakyo Ward, Kyoto City',
    '26104': 'Nakagyo Ward, Kyoto City', '26105': 'Higashiyama Ward, Kyoto City', '26106': 'Shimogyo Ward, Kyoto City',
    '26107': 'Minami Ward, Kyoto City', '26108': 'Ukyo Ward, Kyoto City', '26109': 'Fushimi Ward, Kyoto City',
    '26110': 'Yamashina Ward, Kyoto City', '26111': 'Nishikyo Ward, Kyoto City',
    '26201': 'Fukuchiyama City', '26202': 'Maizuru City', '26203': 'Ayabe City', '26204': 'Uji City',
    '26205': 'Miyazu City', '26206': 'Kameoka City', '26207': 'Joyo City', '26208': 'Muko City',
    '26209': 'Nagaokakyo City', '26210': 'Yawata City', '26211': 'Kyotanabe City', '26212': 'Kyotango City',
    '26213': 'Nantan City', '26214': 'Kizugawa City',
    '26303': 'Oyamazaki Town, Otokuni District', '26322': 'Kumiyama Town, Kuse District',
    '26343': 'Ide Town, Tsuzuki District', '26344': 'Ujitawara Town, Tsuzuki District',
    '26364': 'Kasagi Town, Soraku District', '26365': 'Wazuka Town, Soraku District',
    '26366': 'Seika Town, Soraku District', '26367': 'Minamiyamashiro Village, Soraku District',
    '26407': 'Kyotamba Town, Funai District', '26463': 'Ine Town, Yosa District', '26465': 'Yosano Town, Yosa District',
}


def get_json(url, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            if e.code in (429, 503, 504) and k < tries - 1:
                time.sleep(65 if e.code == 429 else 10 * (k + 1))
                continue
            raise
        except urllib.error.URLError:
            if k < tries - 1:
                time.sleep(5 * (k + 1))
                continue
            raise


def fetch_elements(kind, ids, out):
    """Multi-fetch from the OSM API; a missing id makes the whole batch 404, so split it."""
    ids = [i for i in ids if f'{kind}/{i}' not in out]
    if not ids:
        return
    if len(ids) > 300:
        for k in range(0, len(ids), 300):
            fetch_elements(kind, ids[k:k + 300], out)
        return
    d = get_json(f'https://api.openstreetmap.org/api/0.6/{kind}s.json?{kind}s=' + ','.join(ids))
    time.sleep(1)
    if d is None:
        if len(ids) == 1:
            out[f'{kind}/{ids[0]}'] = None
            return
        h = len(ids) // 2
        fetch_elements(kind, ids[:h], out)
        fetch_elements(kind, ids[h:], out)
        return
    for e in d.get('elements', []):
        out[f"{e['type']}/{e['id']}"] = e.get('tags', {}) if e.get('visible', True) else None
    for i in ids:
        out.setdefault(f'{kind}/{i}', None)


WD_CACHE = os.path.join(ROOT, 'data', 'cache', 'wikidata_ja_en_kyoto_box.json')


def wikidata_box():
    """Items with coordinates in the prefecture box that have both a Japanese and an English label."""
    if os.path.exists(WD_CACHE):
        rows = json.load(open(WD_CACHE, encoding='utf-8'))
    else:
        rows = []
        x0, y0, x1, y1 = 134.84, 34.70, 136.07, 35.79
        n = 1  # the query service currently allows about one request a minute
        for i in range(n):
            for j in range(n):
                a = (x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * j / n)
                b = (x0 + (x1 - x0) * (i + 1) / n, y0 + (y1 - y0) * (j + 1) / n)
                q = f'''SELECT ?item ?ja ?en ?coord WHERE {{
  SERVICE wikibase:box {{ ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:cornerSouthWest "Point({a[0]} {a[1]})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point({b[0]} {b[1]})"^^geo:wktLiteral . }}
  ?item rdfs:label ?ja . FILTER(LANG(?ja) = "ja")
  ?item rdfs:label ?en . FILTER(LANG(?en) = "en")
}}'''
                d = get_json('https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': q, 'format': 'json'}))
                time.sleep(1.5)
                for b_ in (d or {}).get('results', {}).get('bindings', []):
                    pt = b_['coord']['value'].replace('Point(', '').replace(')', '').split()
                    rows.append({'q': b_['item']['value'].rsplit('/', 1)[1], 'ja': b_['ja']['value'], 'en': b_['en']['value'], 'xy': [float(pt[0]), float(pt[1])]})
                print(f'    wikidata tile {i},{j}: {len(rows)} rows')
        json.dump(rows, open(WD_CACHE, 'w', encoding='utf-8'), ensure_ascii=False)
    by = {}
    for r in rows:
        by.setdefault(r['ja'], []).append(r)
    return by


def main():
    layers = {}
    for key, fname in (('attractions', 'attractions.geojson'), ('transport', 'transport.geojson')):
        layers[key] = [f['properties'] for f in json.load(open(os.path.join(DATA, fname), encoding='utf-8'))['features']]

    cache = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}
    ids = sorted({p['osm_id'] for ps in layers.values() for p in ps if p.get('osm_id')})
    print(f'{len(ids)} OSM ids; {len(cache)} cached')
    # the package does not record the element type: try nodes first, then ways, then relations
    for kind in ('node', 'way', 'relation'):
        todo = [i for i in ids if not any(cache.get(f'{t}/{i}') for t in ('node', 'way', 'relation'))]
        print(f'  fetching {len(todo)} as {kind}s')
        fetch_elements(kind, todo, cache)
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False)

    def tags_for(osm_id, name):
        # an element counts only if its current name still matches ours (ids are not unique across types)
        for t in ('node', 'way', 'relation'):
            tg = cache.get(f'{t}/{osm_id}')
            if tg and name and name in (tg.get('name'), tg.get('name:ja')):
                return t, tg
        return None, None

    rows, out, qids = [], {'attractions': {}, 'transport': {}}, {}
    for key, ps in layers.items():
        for p in ps:
            name = (p.get('name') or '').strip()
            t, tg = tags_for(p.get('osm_id'), name)
            en = src = None
            if tg:
                for tag, label in (('name:en', 'OSM name:en'), ('name:ja-Latn', 'OSM name:ja-Latn'), ('name:ja_rm', 'OSM name:ja_rm')):
                    v = (tg.get(tag) or '').strip()
                    if v and v != name:
                        en, src = v, label
                        break
                if not en and tg.get('wikidata'):
                    qids.setdefault(tg['wikidata'], []).append((key, p['id']))
            if en:
                out[key][p['id']] = {'en': en, 'source': src, 'osm': f'{t}/{p["osm_id"]}'}
            rows.append([p['id'], key, p.get('osm_id'), f'{t}/{p["osm_id"]}' if t else '', name, en or '', src or ''])

    # Wikidata English labels for the remaining linked items
    q = sorted(qids)
    labels = {}
    for k in range(0, len(q), 50):
        d = get_json('https://www.wikidata.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'wbgetentities', 'ids': '|'.join(q[k:k + 50]), 'props': 'labels', 'languages': 'en', 'format': 'json'}))
        time.sleep(1)
        for qid, ent in (d or {}).get('entities', {}).items():
            v = ent.get('labels', {}).get('en', {}).get('value')
            if v:
                labels[qid] = v
    by_id = {r[0]: r for r in rows}
    for qid, refs in qids.items():
        if qid not in labels:
            continue
        for key, pid in refs:
            r = by_id[pid]
            if labels[qid] == r[4]:
                continue
            out[key][pid] = {'en': labels[qid], 'source': 'Wikidata label', 'wikidata': qid, 'osm': r[3]}
            r[5], r[6] = labels[qid], f'Wikidata label ({qid})'

    # 4. Wikidata items near the record with exactly the same Japanese label
    near = wikidata_box()
    import math
    def dist(a, b):
        kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
        return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110574)
    feats = {key: {f['properties']['id']: f['geometry']['coordinates'] for f in json.load(open(os.path.join(DATA, fn), encoding='utf-8'))['features']}
             for key, fn in (('attractions', 'attractions.geojson'), ('transport', 'transport.geojson'))}
    for r in rows:
        pid, key, name = r[0], r[1], r[4]
        if not name or pid in out[key] or name not in near:
            continue
        c = feats[key][pid]
        cands = sorted((dist(c, it['xy']), it) for it in near[name] if it['en'] != name)
        cands = [x for x in cands if x[0] <= 300]
        if cands and len({x[1]['en'] for x in cands}) == 1:   # ambiguous labels are skipped
            d0, it = cands[0]
            out[key][pid] = {'en': it['en'], 'source': 'Wikidata label (same Japanese name, within 300 m)', 'wikidata': it['q'], 'distance_m': round(d0)}
            r[5], r[6] = it['en'], f"Wikidata label ({it['q']}, {round(d0)} m)"

    out['municipalities'] = {c: {'en': v, 'source': 'official romanised name'} for c, v in MUNICIPALITIES.items()}
    out['meta'] = {
        'generated': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'rules': 'OSM name:en, then OSM name:ja-Latn / name:ja_rm, then the English label of the linked Wikidata item; '
                 'only when the OSM element name still equals the record name. No machine translation. Records without '
                 'a verified English name show the original name only.',
        'counts': {k: {'with_en': len(out[k]), 'total': len(layers[k])} for k in ('attractions', 'transport')},
        'sources': {k: {s: sum(1 for v in out[k].values() if v['source'] == s) for s in sorted({v['source'] for v in out[k].values()})} for k in ('attractions', 'transport')},
    }
    json.dump(out, open(os.path.join(DATA, 'names_en.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    os.makedirs(os.path.join(DATA, 'analysis'), exist_ok=True)
    with open(os.path.join(DATA, 'analysis', 'names_en_review.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['id', 'layer', 'osm_id', 'osm_element_matched', 'name', 'name_en', 'name_en_source'])
        w.writerows(rows)
    print(json.dumps(out['meta'], ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.exit(main())
