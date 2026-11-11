#!/usr/bin/env python3
"""Photos for the "Explore Kyoto" opening section -> public/explore/*.jpg + public/data/explore_places.json

Every photo is a Wikimedia Commons file that is the main image (P18) of a Wikidata item located in
Kyoto Prefecture. The location is checked against the raw N03 boundary polygons using the photo's own
coordinates when it has them, otherwise the coordinates of the linked Wikidata item. Only CC0,
public-domain, CC BY and CC BY-SA files are accepted; author, licence and source page are kept.
These are area photos for the introduction. They are not attached to attraction records.

Usage: python3 scripts/fetch_explore_photos.py     (needs network unless data/cache/explore is filled)
"""
import html
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request

from PIL import Image
from shapely.geometry import Point, shape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'data', 'cache', 'explore')
OUT = os.path.join(ROOT, 'public', 'explore')
UA = 'kyoto-gis-dashboard/1.0 (university GIS prototype; image credits lookup)'
OK_LICENCE = re.compile(r'^(CC0|Public domain|CC BY(-SA)? \d\.\d)')

# key, Commons file, Wikidata item + its coordinates, labels and the map view opened by "Explore Kyoto"
PLACES = [
    dict(key='kiyomizu', file='Kiyomizu-dera, Kyoto, November 2016 -02.jpg', wikidata='Q221716', item_xy=[135.785003, 34.994831],
         ja='清水寺', en='Kiyomizu-dera', tag='Temple', view=[135.7850, 34.9948, 15.2],
         text='A wooden stage on the hillside above the old streets of Higashiyama. It sits inside the walking pilot area, so road-network routes to the nearest stops are available here.'),
    dict(key='sanneizaka', file='Sanneizaka-kyoto.JPG', wikidata='Q11574990', item_xy=[135.780931, 34.996472],
         ja='産寧坂', en='Sannenzaka', tag='Old street', view=[135.7809, 34.9965, 16],
         text='A stone-paved slope lined with wooden townhouses on the way up to Kiyomizu-dera.'),
    dict(key='sagano', file='2021 Sagano Bamboo forest in Arashiyama, Kyoto, Japan.jpg', wikidata='Q11477322', item_xy=[135.672917, 35.018333],
         ja='嵯峨野 竹林の小径', en='Sagano Bamboo Grove', tag='Nature', view=[135.6720, 35.0170, 14.6],
         text='A path through tall bamboo in the west of Kyoto City, near Arashiyama.'),
    dict(key='byodoin', file='Phoenix Hall, Byodo-in, November 2016 -01.jpg', wikidata='Q61094', item_xy=[135.807778, 34.889444],
         ja='平等院', en='Byodo-in', tag='Temple', view=[135.8077, 34.8893, 14.8],
         text='The Phoenix Hall and its pond in Uji, south of Kyoto City.'),
    dict(key='amanohashidate', file='Amanohashidate view from Mt Moju02s3s4592.jpg', wikidata='Q259727', item_xy=[135.192008, 35.569561],
         ja='天橋立', en='Amanohashidate', tag='Coast', view=[135.1900, 35.5650, 12.6],
         text='A pine-covered sandbar across Miyazu Bay, on the Sea of Japan coast in the north of the prefecture.'),
    dict(key='ine', file='Funaya in Ine Town, Yosa District, Kyoto Prefecture 003.jpg', wikidata='Q11379620', item_xy=[135.286697, 35.6752],
         ja='伊根の舟屋', en='Ine Boat Houses', tag='Fishing village', view=[135.2867, 35.6752, 14],
         text='Boat houses built directly on the water around Ine Bay.'),
    dict(key='randen', file='Sai station 2024 5.jpg', wikidata='Q10883225', item_xy=[135.71708, 35.0084],
         ja='嵐電', en='Randen tram', tag='Public transport', view=[135.7170, 35.0100, 13.6],
         text='A Keifuku "Randen" tram at Sai Station. Tram stops, railway stations and bus stops are the three transit types on the map.'),
]


def get(url, binary=False):
    for k in range(8):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
                return r.read() if binary else json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(min(90, int(e.headers.get('retry-after') or 30) + 3))
                continue
            raise
    raise RuntimeError('rate limited: ' + url)


def commons_meta():
    path = os.path.join(CACHE, 'commons_meta.json')
    meta = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}
    need = [p['file'] for p in PLACES if p['file'] not in meta]
    if need:
        d = get('https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({
            'action': 'query', 'titles': '|'.join('File:' + f for f in need), 'prop': 'imageinfo|coordinates',
            'iiprop': 'url|size|extmetadata', 'iiurlwidth': 1600, 'format': 'json'}))
        strip = lambda s: html.unescape(re.sub(r'<[^>]+>', '', s or '')).strip()
        for pg in d['query']['pages'].values():
            ii = pg['imageinfo'][0]
            m = ii.get('extmetadata', {})
            g = lambda k: strip(m.get(k, {}).get('value'))
            co = pg.get('coordinates')
            meta[pg['title'][5:]] = {'w': ii['width'], 'h': ii['height'], 'license': g('LicenseShortName'), 'license_url': g('LicenseUrl'),
                                     'artist': g('Artist'), 'desc': g('ImageDescription'), 'date': g('DateTimeOriginal'),
                                     'photo_gps': [co[0]['lon'], co[0]['lat']] if co else None, 'assess': g('Assessments'),
                                     'thumb': ii.get('thumburl'), 'page': ii.get('descriptionurl')}
        os.makedirs(CACHE, exist_ok=True)
        json.dump(meta, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return meta


def main():
    meta = commons_meta()
    polys = [(shape(f['geometry']), f['properties']) for f in json.load(open(os.path.join(ROOT, 'data', 'raw', 'kyoto_boundary.geojson'), encoding='utf-8'))['features']]

    def muni(xy):
        for g, pr in polys:
            if g.contains(Point(xy)):
                return pr.get('N03_007')
        return None

    names = json.load(open(os.path.join(ROOT, 'public', 'data', 'names_en.json'), encoding='utf-8'))['municipalities']
    ja = json.load(open(os.path.join(ROOT, 'public', 'data', 'point_municipality.json'), encoding='utf-8'))['names']
    os.makedirs(OUT, exist_ok=True)
    out = []
    for p in PLACES:
        m = meta[p['file']]
        if not OK_LICENCE.match(m['license']):
            raise SystemExit(f"{p['key']}: licence not accepted: {m['license']}")
        by_photo = muni(m['photo_gps']) if m.get('photo_gps') else None
        code = by_photo or muni(p['item_xy'])
        if not code:
            raise SystemExit(f"{p['key']}: location is not inside the Kyoto Prefecture boundary")
        src = os.path.join(CACHE, p['key'] + '.jpg')
        if not os.path.exists(src):
            open(src, 'wb').write(get(m['thumb'], binary=True))
            time.sleep(1)
        im = Image.open(src).convert('RGB')
        sizes = {}
        for suffix, width, q in (('', 1400, 72), ('-s', 440, 68)):
            t = im.copy()
            t.thumbnail((width, width))
            buf = io.BytesIO()
            t.save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
            open(os.path.join(OUT, f"{p['key']}{suffix}.jpg"), 'wb').write(buf.getvalue())
            sizes[suffix or 'main'] = [t.width, t.height, len(buf.getvalue())]
        # average colour, used as the placeholder while loading or if the file cannot be loaded
        r, g_, b = im.resize((1, 1)).getpixel((0, 0))
        out.append({
            'key': p['key'], 'ja': p['ja'], 'en': p['en'], 'tag': p['tag'], 'text': p['text'], 'view': p['view'],
            'municipality': {'code': code, 'ja': ja[code], 'en': names[code]['en']},
            'src': f"explore/{p['key']}.jpg", 'thumb': f"explore/{p['key']}-s.jpg", 'width': sizes['main'][0], 'height': sizes['main'][1],
            'bytes': sizes['main'][2], 'color': f'#{r:02x}{g_:02x}{b:02x}',
            'credit': {'artist': m['artist'], 'license': m['license'], 'license_url': m['license_url'], 'page': m['page'], 'file': p['file'],
                       'taken': m.get('date', '')[:10], 'changes': 'resized and recompressed'},
            'verified': {'wikidata': p['wikidata'],
                         'method': 'photo coordinates inside the N03 polygon' if by_photo else 'file description and linked Wikidata item (item coordinates inside the N03 polygon); the file has no coordinates'},
        })
        print(p['key'], code, ja[code], m['license'], m['artist'], sizes)
    json.dump({'generated': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'note': 'Area photos for the introduction; not attached to attraction records.', 'places': out},
              open(os.path.join(ROOT, 'public', 'data', 'explore_places.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
