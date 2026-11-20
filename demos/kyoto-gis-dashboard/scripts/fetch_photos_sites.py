#!/usr/bin/env python3
"""More attraction photos, added to photos.json (run after the other fetch_photos*.py scripts).

Run from the project folder:
    python3 scripts/fetch_photos_sites.py --dry-run   # list the viewpoint candidates and save previews to review
                                                      # (the Commons search is cached; --refresh searches again)
    python3 scripts/fetch_photos_sites.py             # add photos (viewpoint candidates only if ACCEPTED)
Needs: pip install pillow ; network access to www.wikidata.org, commons.wikimedia.org, upload.wikimedia.org.

D. site-contains    A record with no name, labelled by the named OSM site it lies in (attraction_labels.json),
                    gets that site's photo: the site's own OSM element (data/cache/osm_site_areas.json, read by
                    its ID, name checked) carries wikidata=Q..., and the photo is that item's image (P18).
                    The UI says it is a photo of the site, not of the record itself.
E. wikidata-checked A named record whose name the cross-check confirmed against a Wikidata item
                    (name_checks.json: same Japanese name within 300 m, or the record's own OSM link)
                    gets that item's image (P18), if it has one.
F. viewpoint-here   A viewpoint gets a Commons photo whose own coordinates are within 40 m of it: a photo
                    taken at that spot. Every candidate is looked at by eye first (--dry-run writes previews);
                    only files listed in ACCEPTED are added, with what they show.
Free licences only (CC0, public domain, CC BY, CC BY-SA), JPEG/PNG photos, as in fetch_photos.py.
Nothing already in photos.json is replaced.
"""
import io
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_photos import FREE, commons, dist, http  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data')
PHOTOS = os.path.join(ROOT, 'public', 'photos')
CACHE = os.path.join(ROOT, 'data', 'cache')
REVIEW = os.path.join(CACHE, 'viewpoint_photo_review')
HERE_M = 40.0
# Viewpoint photos checked by eye, one per record (--dry-run previews). Turned down: plaques, signs, close-ups,
# bicycles, animals, station interiors, stereo pairs, 360-degree panoramas, an old postcard, and views that are not
# the one a record's name describes: A00075, A00078, A00086, A00144, A00147, A00216, A00247, A00279, A00336, A00338, A00363, A00378, A00383, A00457, A00512.
ACCEPTED = {   # record -> (file, what it shows); each one looked at
    'A00005': ('File:Amanohashidate (4572910581).jpg', 'Amanohashidate from the viewpoint'),
    'A00006': ('File:View of Amano-Hashidate at Kasamatsu Park.JPG', 'Amanohashidate from Kasamatsu Park'),
    'A00009': ('File:Fushimi Inari Grand Shrine - 伏見稲荷大社 - panoramio (9).jpg', 'the city from the hillside of Mt Inari'),
    'A00010': ('File:天橋立 - panoramio (7).jpg', 'Amanohashidate from the Ouchi pass'),
    'A00019': ('File:View from the top of Arashiyama Monkey Park Iwatayama, Japan.jpg', 'Kyoto from the top of Iwatayama'),
    'A00089': ('File:View from Mount Otokoyama 20260922c.jpg', 'the plain from Mt Otokoyama'),
    'A00092': ('File:Tangocho Fudeshi, Kyotango, Kyoto Prefecture 627-0222, Japan - panoramio (1).jpg', 'the Byobu-iwa rocks on the coast'),
    'A00096': ('File:成相寺パノラマ展望所から見る天橋立1 - panoramio.jpg', 'Amanohashidate from Mt Nariai'),
    'A00097': ('File:Sagatenryuji Tsukurimichicho, Ukyo Ward, Kyoto, Kyoto Prefecture 616-8384, Japan - panoramio.jpg', 'Togetsukyo bridge in autumn'),
    'A00100': ('File:Arashiyama 2012-11-21 (8279735684).jpg', 'the Hozu gorge from above'),
    'A00101': ('File:Shonenji temple (8279737034).jpg', 'across the valley to a temple in autumn'),
    'A00102': ('File:SakuroTanabe02.jpg', 'the Keage incline and the city'),
    'A00106': ('File:清水寺 - panoramio (7).jpg', 'the city from Kiyomizu-dera'),
    'A00107': ('File:Kiyomizu 1-chome, Higashiyama Ward, Kyoto, Kyoto Prefecture 605-0862, Japan - panoramio - jetsun (4).jpg', 'the stage of Kiyomizu-dera'),
    'A00108': ('File:View of Kyoto from Mount Inari, 20240818 1438 4551.jpg', 'Kyoto from Mt Inari'),
    'A00109': ('File:View of Kyoto from Mount Inari, 20240818 1435 4549.jpg', 'Kyoto from Mt Inari'),
    'A00110': ('File:Kinkakujicho, Kita Ward, Kyoto, Kyoto Prefecture 603-8361, Japan - panoramio (1).jpg', 'the Golden Pavilion in snow'),
    'A00111': ('File:鹿苑寺金閣 - panoramio (3).jpg', 'the Golden Pavilion across its pond'),
    'A00112': ('File:金閣寺 - panoramio (15).jpg', 'the Golden Pavilion through the trees'),
    'A00113': ('File:Ginkaku-ji Temple, Kyoto, 20240820 1050 4995.jpg', 'Ginkaku-ji and the city below'),
    'A00114': ('File:Ginkakuji 2011-04 (5760913966).jpg', 'the Silver Pavilion'),
    'A00117': ('File:Sekisui-in.jpg', 'looking out from the Sekisui-in veranda'),
    'A00118': ('File:Amanohashidate 20211008160858 (51811910891).jpg', 'Amanohashidate from Hiryukan'),
    'A00119': ('File:天橋立 - panoramio (6).jpg', 'Amanohashidate from Hiryukan'),
    'A00120': ('File:Kameshima, Ine, Yosa District, Kyoto Prefecture 626-0424, Japan - panoramio (15).jpg', 'Ine bay'),
    'A00124': ('File:150124 At Yasakakamimachi Kyoto Japan02n.jpg', 'the Yasaka pagoda up the street'),
    'A00125': ('File:Entoku-in, Nantei (Garden) -1 (December 2015) - panoramio.jpg', 'the Entoku-in garden in autumn'),
    'A00126': ('File:仁和寺 - panoramio (5).jpg', 'the Ninna-ji garden'),
    'A00127': ("File:Pond in Shinden's north garden, with tea house and five-storied pagoda in the background, Ninna-ji, Kyoto, 2016.jpg", 'the Ninna-ji pond and pagoda'),
    'A00131': ('File:Three-storied Pagoda, Kiyomizu-dera, Kyoto, Southeast view 20190416 2.jpg', 'the three-storied pagoda of Kiyomizu-dera'),
    'A00134': ('File:Jingo-ji (7066697281).jpg', 'the valley below Jingo-ji'),
    'A00146': ('File:Oigawa River and Mount Arashiyama from Nakanoshima Island 1.jpg', 'the Oi river and Mt Arashiyama'),
    'A00148': ('File:北野天満宮 - panoramio (5).jpg', 'maples at Kitano Tenmangu in autumn'),
    'A00149': ('File:The cut of the autumn shrine - panoramio.jpg', 'maples at Kitano Tenmangu in autumn'),
    'A00153': ('File:View of Kioto from mountains - panoramio (1).jpg', 'Kyoto from Mt Daimonji'),
    'A00169': ('File:Oyamazaki town view from Mt.Tennozan.jpg', 'Oyamazaki from Mt Tennozan'),
    'A00177': ('File:20160402 Amanohashidate 2566 (26761397076).jpg', 'Amanohashidate'),
    'A00181': ('File:Mt.Daikichi.jpg', 'Uji at sunset from Mt Daikichi'),
    'A00182': ('File:Mt.Daikichi.jpg', 'Uji at sunset from the Mt Daikichi deck'),
    'A00183': ('File:Mt.Daikichi.jpg', 'Uji at sunset from the Mt Daikichi deck'),
    'A00184': ('File:Mt.Daikichi.jpg', 'Uji at sunset from the Mt Daikichi deck'),
    'A00185': ('File:Mt.Daikichi.jpg', 'Uji at sunset from the Mt Daikichi deck'),
    'A00197': ('File:Asokai bay and Miyazu town (29608963261).jpg', 'Aso bay and Miyazu from Mt Benten'),
    'A00199': ('File:Tofuku-ji (4587863480).jpg', 'Tofuku-ji in autumn'),
    'A00200': ('File:Kodai-ji, Kyoto - Kodaiji7310.jpg', 'the covered corridor of Kodai-ji in autumn'),
    'A00203': ('File:20160402 Amanohashidate 2565 (26761398036).jpg', 'Amanohashidate'),
    'A00251': ('File:海住山寺より - panoramio.jpg', 'the valley from Kaijusen-ji'),
    'A00266': ('File:大雲院 - panoramio.jpg', 'the Yasaka pagoda from Kodai-ji'),
    'A00270': ('File:20160402 Arashiyama 1773 (26614035062).jpg', 'the Arashiyama bamboo grove'),
    'A00271': ('File:Yoshimine-dera (8256329584).jpg', 'the Yoshimine-dera grounds in autumn'),
    'A00272': ('File:Yoshimine-dera (8256317474).jpg', 'the pine of Yoshimine-dera'),
    'A00274': ('File:Yoshimine-dera (8255260375).jpg', 'the plain from Yoshimine-dera in autumn'),
    'A00280': ('File:Amanohashidate, Japan, sun rays and clouds.jpg', 'Amanohashidate'),
    'A00281': ('File:20160402 Amanohashidate 2570 (26513478000).jpg', 'Amanohashidate'),
    'A00282': ('File:20160402 Amanohashidate 3585 (26513449310).jpg', 'the bay with cherry blossom'),
    'A00283': ('File:天橋立 - panoramio (6).jpg', 'Amanohashidate'),
    'A00284': ('File:Amanohashidate 20211008160858 (51811910891).jpg', 'Amanohashidate'),
    'A00285': ('File:天橋立 - panoramio (6).jpg', 'Amanohashidate'),
    'A00286': ('File:天橋立 - panoramio (6).jpg', 'Amanohashidate'),
    'A00288': ('File:天橋立 - panoramio (6).jpg', 'Amanohashidate'),
    'A00289': ('File:天橋立ビューランド - panoramio (5).jpg', 'Amanohashidate'),
    'A00290': ('File:Amanohashidate 20211008160858 (51811910891).jpg', 'Amanohashidate'),
    'A00291': ('File:Amanohashidate 20211008160858 (51811910891).jpg', 'Amanohashidate'),
    'A00317': ('File:Daikaku-ji, Osawa-no-ike (Pond) -1 (November 2013) - panoramio.jpg', 'the Osawa pond at night'),
    'A00321': ('File:Yoshimine-dera (8255249769).jpg', 'Yoshimine-dera maples'),
    'A00322': ('File:Kyoto overlook, with Kyoto Tower near the cente (8255248439).jpg', 'Kyoto from Yoshimine-dera'),
    'A00323': ('File:Yoshimine-dera (8255238327).jpg', 'Yoshimine-dera maples'),
    'A00331': ('File:Tofuku-ji Temple 東福寺23 - panoramio.jpg', 'Tsuten-kyo from the deck'),
    'A00332': ('File:Amanohashidate, Japan, sun rays and clouds.jpg', 'Amanohashidate'),
    'A00333': ('File:View of Amano-Hashidate at Kasamatsu Park.JPG', 'Amanohashidate from Kasamatsu Park'),
    'A00334': ('File:Precincts of Kono-jinja.JPG', 'the town and bay from Kasamatsu Park'),
    'A00337': ('File:Shishigatani-Higashiyama-Kyoto.jpg', 'Kyoto from the hills'),
    'A00345': ('File:南禅寺山門の絶景 Nanzenji-Temple , View of the Sanmon-Gate - panoramio.jpg', 'the view from the Nanzen-ji Sanmon gate'),
    'A00350': ('File:Tofuku-ji (4585774014).jpg', 'Tofuku-ji maples'),
    'A00351': ('File:Honmachi 15-chome, Higashiyama Ward, Kyoto, Kyoto Prefecture 605-0981, Japan - panoramio (11).jpg', 'Tofuku-ji in autumn'),
    'A00352': ('File:Jyojakkouji,Sagano,Kyoto - panoramio.jpg', 'Jojakko-ji in autumn'),
    'A00354': ('File:Kiyomizutera(sanjyutou) - panoramio (1).jpg', 'the Kiyomizu stage across the valley'),
    'A00356': ('File:Sagaogurayamacho, Ukyo Ward, Kyoto, Kyoto Prefecture 616-8395, Japan - panoramio.jpg', 'the Jojakko-ji pagoda'),
    'A00357': ('File:Nison-in in Arashiyama, Kyoto - panoramio.jpg', 'the view from Nison-in'),
    'A00362': ('File:Panorama of South Kyoto (4160106777).jpg', 'south Kyoto'),
    'A00366': ('File:Shishigatani Daikokudanicho, Sakyo Ward, Kyoto, Kyoto Prefecture 606-8442, Japan - panoramio.jpg', 'the city from Shishigatani'),
    'A00370': ('File:Sagamizuohatogasu, Ukyo Ward, Kyoto, Kyoto Prefecture 616-8461, Japan - panoramio.jpg', 'the Hozu gorge'),
    'A00376': ('File:Kyoto 20190103 143547.jpg', 'the Chishaku-in garden'),
    'A00399': ('File:Shonenji temple (8279737034).jpg', 'across the valley to a temple in autumn'),
    'A00405': ('File:Sagatenryuji Susukinobabacho, Ukyo Ward, Kyoto, Kyoto Prefecture 616-8385, Japan - panoramio (12).jpg', 'the Hozu river in autumn'),
    'A00415': ('File:愛宕念仏寺 京都市右京区 Otagi Nembutsuji 2013.11.21 - panoramio (2).jpg', 'Otagi Nenbutsu-ji in autumn'),
    'A00427': ('File:Mt. Kasagiyama View - panoramio (1).jpg', 'the hills from Mt Kasagi'),
    'A00440': ('File:Hiyoshidamu 02.jpg', 'the Hiyoshi dam'),
    'A00444': ('File:Siting place in the garden.jpg', 'the garden shelter at this spot'),
    'A00445': ('File:比叡山山頂 - panoramio.jpg', 'the view from Mt Hiei'),
    'A00465': ('File:Cityscape of Kyoto from Mount Funaoka 202609.jpg', 'Kyoto from Mt Funaoka'),
    'A00483': ('File:Kamo River in Kyoto, 20240820 1745 5189.jpg', 'the Kamo river'),
    'A00484': ('File:Katsura River canal seen from Nakanoshima Bridge, Kyoto, 2016.jpg', 'the Katsura river canal'),
    'A00487': ('File:二条城 Nijojo castle - panoramio.jpg', 'the south-east corner tower of Nijo Castle'),
    'A00488': ('File:At Kyoto 2024 122.jpg', 'the south-east corner tower of Nijo Castle from the west'),
    'A00489': ('File:Nijō-jō - panoramio (1).jpg', 'the Ninomaru Palace of Nijo Castle'),
    'A00490': ('File:Inner Moat near Narukomon Gate of Nijo Castle.JPG', 'the Honmaru wall and inner moat of Nijo Castle'),
    'A00493': ('File:Zushiokukachocho, Yamashina Ward, Kyoto, Kyoto Prefecture 607-8456, Japan - panoramio (2).jpg', 'the city at night'),
    'A00495': ('File:Power spot of Kurama-dera - panoramio.jpg', 'the mountains from the Kurama-dera main hall'),
    'A00496': ('File:Roofs of Chion-in.jpg', 'the roofs of Chion-in and the city'),
    'A00497': ('File:Kyoto Shrine06.jpg', 'the city from Awata shrine'),
    'A00499': ('File:比叡山頂 - panoramio.jpg', 'the view from Mt Hiei'),
    'A00503': ('File:比叡山と大文字 - panoramio.jpg', 'Mt Hiei and Daimonji at sunset'),
    'A00507': ('File:Kamo River just north of the Kamogawa Delta.jpg', 'the Kamo river'),
    'A00508': ('File:Arashiyama Bamboo Grove.jpg', 'the bamboo path'),
}


def J(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def p18(qids):
    out = {}
    qids = sorted(set(qids))
    for k in range(0, len(qids), 40):
        r = json.loads(http('https://www.wikidata.org/w/api.php', {'action': 'wbgetentities', 'ids': '|'.join(qids[k:k + 40]),
                                                                    'props': 'claims', 'format': 'json'}))
        for q, e in (r.get('entities') or {}).items():
            c = (e.get('claims') or {}).get('P18') or []
            v = c and c[0].get('mainsnak', {}).get('datavalue', {}).get('value')
            if v:
                out[q] = 'File:' + v
        time.sleep(0.5)
    return out


def file_info(titles):
    info = {}
    titles = sorted(set(titles))
    for k in range(0, len(titles), 40):
        r = commons({'action': 'query', 'titles': '|'.join(titles[k:k + 40]), 'prop': 'imageinfo',
                     'iiprop': 'url|extmetadata|size|mime', 'iiurlwidth': 960})
        back = {x['to']: x['from'] for x in (r.get('query') or {}).get('normalized', [])}
        for pg in (r.get('query') or {}).get('pages', []):
            if 'imageinfo' not in pg:
                continue
            ii = pg['imageinfo'][0]
            m = ii.get('extmetadata', {})
            g = lambda key: re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', m.get(key, {}).get('value', '') or '')).strip()
            meta = {'thumb': ii.get('thumburl'), 'page': ii.get('descriptionurl'), 'artist': g('Artist') or 'Unknown author',
                    'license': g('LicenseShortName'), 'license_url': g('LicenseUrl') or None, 'description': g('ImageDescription')[:200],
                    'date': g('DateTimeOriginal')[:10] or None, 'mime': ii.get('mime'), 'width': ii.get('width')}
            info[pg['title']] = meta
            if pg['title'] in back:
                info[back[pg['title']]] = meta
    return info


def free(meta):
    lic = (meta or {}).get('license', '').strip()
    return bool(meta and meta.get('thumb') and FREE.match(lic) and not re.search(r'\b(nc|nd)\b', lic, re.I)
                and meta.get('mime') in ('image/jpeg', 'image/png'))


def save(meta, name):
    from PIL import Image
    path = os.path.join(PHOTOS, name)
    if not os.path.exists(path):
        im = Image.open(io.BytesIO(http(meta['thumb'], accept='image/*'))).convert('RGB')
        if im.width > 720:
            im = im.resize((720, round(im.height * 720 / im.width)), Image.LANCZOS)
        im.save(path, 'JPEG', quality=72, optimize=True, progressive=True)
        time.sleep(0.3)
    from PIL import Image as I2
    w, h = I2.open(path).size
    return {'src': f'photos/{name}', 'width': w, 'height': h}


def entry(meta, file, extra, saved):
    return {**extra, **saved, 'file': file, 'title': file[5:], 'artist': meta['artist'], 'license': meta['license'],
            'license_url': meta['license_url'], 'page': meta['page'], 'date': meta['date'], 'description': meta['description']}


def main():
    dry = '--dry-run' in sys.argv
    doc = J(os.path.join(DATA, 'photos.json'))
    have = doc['photos']
    A = {f['properties']['id']: f for f in J(os.path.join(DATA, 'attractions.geojson'))['features']}
    labels = J(os.path.join(DATA, 'attraction_labels.json'))['labels']
    ctx = J(os.path.join(DATA, 'attraction_context.json'))['records']
    sites = J(os.path.join(CACHE, 'osm_site_areas.json'))
    checks = J(os.path.join(DATA, 'name_checks.json'))['records']
    added = {}

    # D. the site a record with no name lies in
    want = {}
    for aid, l in labels.items():
        if l['kind'] != 'place' or aid in have:
            continue
        s = next((s for s in ctx[aid]['inside'] if s['name'] == l['text']), None)
        el = s and sites.get(str(s['overpass_area_id']))
        if el and el.get('wikidata'):
            want[aid] = (el['wikidata'], s['name'], s.get('name_en') or '')
    # E. named records whose name a Wikidata item confirms
    want_e = {aid: c['wikidata']['q'] for aid, c in checks.items()
              if aid not in have and c.get('wikidata') and set(c.get('by', [])) & {'wikidata', 'osm-wikidata'}}
    imgs = p18([q for q, _, _ in want.values()] + list(want_e.values()))
    info = file_info(list(imgs.values()))
    for aid, (q, name, name_en) in want.items():
        f = imgs.get(q)
        if f and free(info.get(f)) and not dry:
            added[aid] = entry(info[f], f, {'match': 'site-contains', 'wikidata': q, 'site': name, 'site_en': name_en},
                               save(info[f], f'site-{q}.jpg'))
    for aid, q in want_e.items():
        f = imgs.get(q)
        if f and free(info.get(f)) and not dry:
            added[aid] = entry(info[f], f, {'match': 'wikidata-checked', 'wikidata': q}, save(info[f], f'{aid}.jpg'))
    print('D site photos possible:', sum(1 for a, (q, _, _) in want.items() if free(info.get(imgs.get(q)))), 'of', len(want))
    print('E checked-name photos possible:', sum(1 for a, q in want_e.items() if free(info.get(imgs.get(q)))), 'of', len(want_e))

    # F. photos taken at a viewpoint
    vps = [aid for aid, f in A.items() if f['properties']['category'] == 'viewpoint' and aid not in have and aid not in added]
    cache_path = os.path.join(CACHE, 'viewpoint_photo_candidates.json')
    cached = J(cache_path) if os.path.exists(cache_path) and '--refresh' not in sys.argv else None
    cands = cached['candidates'] if cached else {}
    for i, aid in enumerate([] if cached else vps):
        lon, lat = A[aid]['geometry']['coordinates']
        r = commons({'action': 'query', 'list': 'geosearch', 'gscoord': f'{lat}|{lon}', 'gsradius': int(HERE_M),
                     'gsnamespace': 6, 'gslimit': 10})
        for g in (r.get('query') or {}).get('geosearch', []):
            if dist((lon, lat), (g['lon'], g['lat'])) <= HERE_M:
                cands.setdefault(aid, []).append({'file': g['title'], 'm': round(dist((lon, lat), (g['lon'], g['lat'])))})
        if i % 25 == 0:
            print(f'  viewpoints {i}/{len(vps)}, with candidates {len(cands)}', file=sys.stderr)
    if not cached:
        finfo = file_info([c['file'] for cs in cands.values() for c in cs])
        for aid in list(cands):
            # the three nearest free JPEG/PNG photos at least 800 px wide
            cands[aid] = sorted([{**c, 'info': finfo[c['file']]} for c in cands[aid] if free(finfo.get(c['file'])) and (finfo[c['file']].get('width') or 0) >= 800], key=lambda c: c['m'])[:3]
            if not cands[aid]:
                del cands[aid]
        with open(cache_path, 'w', encoding='utf-8') as fh:
            json.dump({'retrieved_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'radius_m': HERE_M, 'candidates': cands}, fh, ensure_ascii=False, indent=1)
    finfo = {c['file']: c['info'] for cs in cands.values() for c in cs}
    print('F viewpoints with candidate photos:', len(cands), 'files', sum(len(v) for v in cands.values()))
    if dry:
        from PIL import Image
        os.makedirs(REVIEW, exist_ok=True)
        listing = []
        for aid, cs in cands.items():
            for k, c in enumerate(cs):
                fn = f'{aid}-{k}.jpg'
                if not os.path.exists(os.path.join(REVIEW, fn)):
                    try:
                        im = Image.open(io.BytesIO(http(finfo[c['file']]['thumb'], accept='image/*'))).convert('RGB')
                        im.thumbnail((360, 360))
                        im.save(os.path.join(REVIEW, fn), 'JPEG', quality=70)
                        time.sleep(0.3)
                    except Exception as e:   # leave it out of this review rather than stop
                        print(f'  preview {fn}: {e}', file=sys.stderr)
                        continue
                listing.append({'id': aid, 'preview': fn, 'file': c['file'], 'm': c['m'], 'description': finfo[c['file']]['description']})
        json.dump(listing, open(os.path.join(REVIEW, 'candidates.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('previews in', REVIEW)
        return
    for aid, (file, shows) in ACCEPTED.items():
        c = next((c for c in cands.get(aid, []) if c['file'] == file), None)
        if c and aid not in have:
            added[aid] = entry(finfo[file], file, {'match': 'viewpoint-here', 'm': c['m'], 'shows': shows}, save(finfo[file], f'{aid}.jpg'))

    have.update(added)
    doc['with_photo'] = len(have)
    doc['by_match'] = {}
    for v in have.values():
        doc['by_match'][v['match']] = doc['by_match'].get(v['match'], 0) + 1
    doc['sites_retrieved_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    doc.setdefault('rules', {})['site_contains'] = 'a record with no name gets the photo of the named OSM site it lies in (by the site\'s own Wikidata link); the UI says so'
    doc['rules']['wikidata_checked'] = 'a named record confirmed by the name cross-check gets that Wikidata item\'s image'
    doc['rules']['viewpoint_here'] = f'a Commons photo taken within {HERE_M:.0f} m of a viewpoint, each one checked by eye'
    with open(os.path.join(DATA, 'photos.json'), 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    print('added', len(added), {k: sum(1 for v in added.values() if v['match'] == k) for k in ('site-contains', 'wikidata-checked', 'viewpoint-here')})


if __name__ == '__main__':
    main()
