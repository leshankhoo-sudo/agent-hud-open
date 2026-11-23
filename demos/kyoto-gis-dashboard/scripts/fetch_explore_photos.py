#!/usr/bin/env python3
"""Photos for the "Explore Kyoto" opening section, one card per city of the study area -> public/explore/*.jpg
+ public/data/explore_places.json

Every photo is a Wikimedia Commons file: the main image (P18) of a Wikidata item inside the city, or a
geotagged Commons photo. The location is checked against the raw N03 boundary polygons using the photo's own
coordinates when it has them, otherwise the coordinates of the linked Wikidata item, and it must fall inside
that city (for Kyoto City: inside one of its wards). Only CC0,
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

# The fifteen cities of the study area (MLIT N03, study_area_coverage.json), one card each, ordered from Kyoto
# City and then north to south. Each photo is the Commons main image (P18) of a Wikidata item inside the
# city, or a geotagged Commons photo; the check below requires the photo's own coordinates (or, if it has
# none, the item's) to fall inside that city's own N03 polygon. Region: the prefecture's own administrative
# areas (Tango, Chutan, Nantan, Kyoto City, Yamashiro). The text says only what the photo shows and where
# the city lies; the numbers on the card come from the project data, not from this list.
CITIES = [
    dict(key='kyoto', code='26100', ja='京都市', en='Kyoto City', region=('京都市', 'Kyoto City'), file='Kiyomizu-dera, Kyoto, November 2016 -02.jpg', wikidata='Q221716', item_xy=[135.785003, 34.994831],
         subject=('清水寺', 'Kiyomizu-dera'), text='The prefectural capital, eleven wards from the northern mountains to Fushimi in the south.'),
    dict(key='kyotango', code='26212', ja='京丹後市', en='Kyotango City', region=('丹後', 'Tango'), file='Kyougamisaki 04.jpg', wikidata='Q28374560', item_xy=[135.2233611, 35.7771389],
         subject=('経ヶ岬灯台', 'Kyōgamisaki Lighthouse'), text='The north of the Tango Peninsula, facing the Sea of Japan.'),
    dict(key='miyazu', code='26205', ja='宮津市', en='Miyazu City', region=('丹後', 'Tango'), file='Amanohashidate view from Mt Moju02s3s4592.jpg', wikidata='Q259727', item_xy=[135.192008, 35.569561],
         subject=('天橋立', 'Amanohashidate'), text='On Miyazu Bay, where a pine-covered sandbar crosses the water.'),
    dict(key='maizuru', code='26202', ja='舞鶴市', en='Maizuru City', region=('中丹', 'Chūtan'), file='Red brick museum01s3200.jpg', wikidata='Q11635286', item_xy=[135.387444, 35.476083],
         subject=('赤れんが博物館', 'Maizuru Red Brick Museum'), text='A port city on Maizuru Bay, with its red-brick warehouses.'),
    dict(key='fukuchiyama', code='26201', ja='福知山市', en='Fukuchiyama City', region=('中丹', 'Chūtan'), file='Fukuchiyama castle19.jpg', wikidata='Q2969288', item_xy=[135.129625, 35.296753],
         subject=('福知山城', 'Fukuchiyama Castle'), text='A castle town on the Yura River, in the middle of the prefecture.'),
    dict(key='ayabe', code='26203', ja='綾部市', en='Ayabe City', region=('中丹', 'Chūtan'), file='Koumyouji5501.JPG', wikidata='Q107020578', item_xy=[135.4421, 35.38741],
         subject=('光明寺二王門', 'Niō Gate of Kōmyō-ji'), text='Hills and the Yura River valley, east of Fukuchiyama.'),
    dict(key='nantan', code='26213', ja='南丹市', en='Nantan City', region=('南丹', 'Nantan'), file='かやぶきの里2021-01-04.jpg', wikidata=None, item_xy=None,
         subject=('かやぶきの里（美山）', 'Thatched farmhouses of Miyama'), text='Wooded mountains north of Kameoka, with the thatched village of Miyama.'),
    dict(key='kameoka', code='26206', ja='亀岡市', en='Kameoka City', region=('南丹', 'Nantan'), file='Izumo-daijingū keidai.JPG', wikidata='Q10896675', item_xy=[135.578382, 35.059248],
         subject=('出雲大神宮', 'Izumo-daijingū'), text='A basin just west of Kyoto City, where the Hozu River boat ride starts.'),
    dict(key='muko', code='26208', ja='向日市', en='Muko City', region=('山城', 'Yamashiro'), file='Muko-jinja, shaden.jpg', wikidata='Q11415986', item_xy=[135.69712, 34.944148],
         subject=('向日神社', 'Mukō Shrine'), text='South-west of Kyoto City, on the low hills of Otokuni.'),
    dict(key='nagaokakyo', code='26209', ja='長岡京市', en='Nagaokakyo City', region=('山城', 'Yamashiro'), file='NagaokaTenmangu.jpg', wikidata='Q11652030', item_xy=[135.686333, 34.922833],
         subject=('長岡天満宮', 'Nagaoka Tenmangū'), text='Named after Nagaoka-kyō, the capital before Kyoto, south-west of Kyoto City.'),
    dict(key='uji', code='26204', ja='宇治市', en='Uji City', region=('山城', 'Yamashiro'), file='Phoenix Hall, Byodo-in, November 2016 -01.jpg', wikidata='Q61094', item_xy=[135.807778, 34.889444],
         subject=('平等院', 'Byōdō-in'), text='On the Uji River south of Kyoto City, known for its green tea.'),
    dict(key='joyo', code='26207', ja='城陽市', en='Joyo City', region=('山城', 'Yamashiro'), file='Mito-Jinja (Joyo), keidai.jpg', wikidata='Q11548558', item_xy=[135.789565, 34.854739],
         subject=('水度神社', 'Mito Shrine'), text='Between Uji and Kyotanabe, east of the Kizu River.'),
    dict(key='yawata', code='26210', ja='八幡市', en='Yawata City', region=('山城', 'Yamashiro'), file='Iwashimizu Hachimangu4.jpg', wikidata='Q710098', item_xy=[135.7, 34.879722],
         subject=('石清水八幡宮', 'Iwashimizu Hachimangū'), text='Where the Katsura, Uji and Kizu rivers meet, below Mount Otokoyama.'),
    dict(key='kyotanabe', code='26211', ja='京田辺市', en='Kyotanabe City', region=('山城', 'Yamashiro'), file='Ikkyuji Somon DSCN1286 20101117.JPG', wikidata='Q11644421', item_xy=[135.75755556, 34.82102778],
         subject=('酬恩庵（一休寺）', 'Ikkyū-ji (Shūon-an)'), text='In the south of the prefecture, between Kyoto and Nara.'),
    dict(key='kizugawa', code='26214', ja='木津川市', en='Kizugawa City', region=('山城', 'Yamashiro'), file='Joruriji Kizugawa Kyoto pref Japan02s3.jpg', wikidata='Q1093645', item_xy=[135.87305556, 34.71611111],
         subject=('浄瑠璃寺', 'Jōruri-ji'), text='The southern edge of the prefecture, next to Nara.'),
]

PLACES = CITIES

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
    feats = json.load(open(os.path.join(ROOT, 'data', 'raw', 'kyoto_boundary.geojson'), encoding='utf-8'))['features']
    polys = [(shape(f['geometry']), f['properties']) for f in feats]

    def muni(xy):
        for g, pr in polys:
            if g.contains(Point(xy)):
                return pr.get('N03_007')
        return None
    city_of = lambda code: '26100' if code and code.startswith('261') else code   # Kyoto City wards -> Kyoto City

    def bbox(code):
        b = [180, 90, -180, -90]
        for g, pr in polys:
            if city_of(pr.get('N03_007')) == code:
                x0, y0, x1, y1 = g.bounds
                b = [min(b[0], x0), min(b[1], y0), max(b[2], x1), max(b[3], y1)]
        return [round(v, 5) for v in b]

    cov = {m['code']: m for m in json.load(open(os.path.join(ROOT, 'public', 'data', 'study_area_coverage.json'), encoding='utf-8'))['municipalities']}
    for f in os.listdir(OUT):
        if f.endswith('.jpg'):
            os.remove(os.path.join(OUT, f))
    out = []
    for p in PLACES:
        m = meta[p['file']]
        if not OK_LICENCE.match(m['license']):
            raise SystemExit(f"{p['key']}: licence not accepted: {m['license']}")
        by_photo = muni(m['photo_gps']) if m.get('photo_gps') else None
        code = city_of(by_photo or (muni(p['item_xy']) if p['item_xy'] else None))
        if code != p['code']:
            raise SystemExit(f"{p['key']}: the photo is not inside {p['en']} ({code})")
        c = cov[p['code']]
        if c['type'] != 'city':
            raise SystemExit(f"{p['key']}: {p['code']} is not a city in study_area_coverage.json")
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
        r, g_, b = im.resize((1, 1)).getpixel((0, 0))
        out.append({
            'key': p['key'], 'code': p['code'], 'ja': p['ja'], 'en': p['en'], 'tag': p['region'][1], 'region': {'ja': p['region'][0], 'en': p['region'][1]},
            'subject': {'ja': p['subject'][0], 'en': p['subject'][1]}, 'text': p['text'], 'area_km2': c['area_km2'], 'wards': len(c.get('wards') or []),
            'bbox': bbox(p['code']), 'municipality': {'code': p['code'], 'ja': p['ja'], 'en': p['en']},
            'src': f"explore/{p['key']}.jpg", 'thumb': f"explore/{p['key']}-s.jpg", 'width': sizes['main'][0], 'height': sizes['main'][1],
            'bytes': sizes['main'][2], 'color': f'#{r:02x}{g_:02x}{b:02x}',
            # public-domain files have no licence page, so the licence link goes to the file page;
            # a file whose author field only says "taken by the uploader" is credited to its uploader as such
            'credit': {'artist': 'the uploader (投稿者が撮影)' if m['artist'] == '投稿者が撮影' else m['artist'], 'license': m['license'], 'license_url': m['license_url'] or m['page'], 'page': m['page'], 'file': p['file'],
                       'taken': m.get('date', '')[:10], 'changes': 'resized and recompressed'},
            'verified': {'wikidata': p['wikidata'],
                         'method': 'photo coordinates inside the N03 polygon of the city' if by_photo else 'file description and linked Wikidata item (item coordinates inside the N03 polygon of the city); the file has no coordinates'},
        })
        print(p['key'], code, m['license'], m['artist'][:30], sizes['main'])
    json.dump({'generated': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'note': 'One area photo per city of the study area, for the introduction; not attached to attraction records. Area from study_area_coverage.json.', 'places': out},
              open(os.path.join(ROOT, 'public', 'data', 'explore_places.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
