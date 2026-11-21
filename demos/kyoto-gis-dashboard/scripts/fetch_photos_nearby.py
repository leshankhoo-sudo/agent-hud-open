#!/usr/bin/env python3
"""Photos for the attractions that still have none: Commons photos taken right there, each one checked by eye.

Run from the project folder (after fetch_photos_sites.py):
    python3 scripts/fetch_photos_nearby.py --dry-run   # search (cached) and save previews to look at
    python3 scripts/fetch_photos_nearby.py             # add the photos listed in ACCEPTED
Needs: pip install pillow ; network access to commons.wikimedia.org and upload.wikimedia.org.

G. nearby-checked  For every record without a photo: Commons files whose own coordinates are within 60 m of the
                   point (80 m for a viewpoint, whose view is the same a few dozen metres away). The four nearest
                   free JPEG/PNG photos at least 800 px wide are kept as candidates. Each candidate is looked at:
                   a photo is used only if it shows this place (the building, its gate or sign, its garden or
                   exhibits, or for a viewpoint the view from it), and the record says what it shows.
                   Photos of something else nearby, people, vehicles, food, signs that name another place,
                   close-ups that do not show the place, and old prints are turned down.
Free licences only (CC0, public domain, CC BY, CC BY-SA). Nothing already in photos.json is replaced.
"""
import io
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_photos import commons, dist, http  # noqa: E402
from fetch_photos_sites import CACHE, DATA, J, entry, file_info, free, save  # noqa: E402

REVIEW = os.path.join(CACHE, 'nearby_photo_review')
NEAR_M = {'viewpoint': 80.0}
NEAR_DEFAULT = 60.0
# Looked at every --dry-run preview. Turned down (96): photos of the street, a neighbour, a station,
# food, signs or people instead of the place, and records whose name does not say what they are:
# A00003, A00018, A00025, A00034, A00041, A00044, A00056, A00058, A00069, A00076, A00078, A00099, A00103, A00105, A00115, A00116, A00123, A00129, A00136, A00137, A00142, A00144, A00147, A00155, A00158, A00171, A00172, A00178, A00187, A00188, A00194, A00195, A00198, A00208, A00216, A00219, A00220, A00229, A00230, A00244, A00246, A00247, A00269, A00276, A00277, A00278, A00294, A00297, A00302, A00304, A00327, A00328, A00329, A00338, A00339, A00342, A00343, A00359, A00377, A00378, A00383, A00402, A00404, A00406, A00412, A00413, A00432, A00433, A00443, A00446, A00448, A00450, A00456, A00457, A00458, A00466, A00471, A00472, A00476, A00477, A00478, A00482, A00486, A00494, A00502, A00504, A00510, A00511, A00512, A00516, A00519, A00523, A00602, A00616, A00622, A00627.
ACCEPTED = {   # record -> (file, what it shows); each one looked at
    'A00007': ('File:Fushimi-Inari Taisha (11122077515).jpg', 'the torii-lined path at the junction'),
    'A00008': ('File:View of Kyoto from Mount Inari, 20240818 1435 4549.jpg', 'the view over Kyoto from the junction'),
    'A00075': ('File:月桂冠酒蔵 - panoramio (2).jpg', 'the Fushimi canal by the Gekkeikan brewery'),
    'A00083': ('File:170325 Sekihouji Kyoto Japan02n.jpg', 'the gate of Sekiho-ji, where the tomb is'),
    'A00085': ('File:“Omokaruishi” (Heavy-Light Stone) at Fushimi Inari Grand Shrine.JPG', 'the Omokaru stone'),
    'A00086': ('File:Amanohashidate 20211008164231 (51810951717).jpg', 'the pine-lined path of Amanohashidate'),
    'A00104': ('File:Around Tenryū-ji (2020) - img 03.jpg', 'the small spring and shrine at this spot'),
    'A00135': ('File:花見小路通 - panoramio.jpg', 'Hanami-koji street in Gion'),
    'A00138': ('File:Kushi-yaki restaurant by titanium22 in Pontocho, Kyoto.jpg', 'Pontocho alley at night'),
    'A00139': ('File:将軍塚展望台 - panoramio - kajikawa.jpg', 'the view from Shogunzuka with its guide board'),
    'A00143': ('File:Night Cobble (259954181).jpeg', 'Nene-no-michi at night'),
    'A00190': ('File:Kyoto Imahiejinja 京都 新日吉神社 - panoramio.jpg', 'the gate of Imahie Jingu'),
    'A00193': ('File:大谷本廟 - panoramio.jpg', 'Otani Honbyo'),
    'A00202': ('File:茶室 - panoramio.jpg', 'the thatched teahouse at this spot'),
    'A00227': ('File:宮川町 花街.jpg', 'the Miyagawa-cho street'),
    'A00228': ('File:JP 日本 Japan 京都 Kyoto 皇宮 Imperial Palace and 御園 National Garden wooden sign intro June 2026 N13P 01.jpg', 'the gate and its information board'),
    'A00231': ('File:Ishibe Koji - panoramio.jpg', 'Ishibe-koji'),
    'A00243': ('File:Samurai armors in a museum.jpg', 'samurai armour on display'),
    'A00245': ('File:浮舟と匂宮の像 - panoramio.jpg', 'the Ukifune and Niou statue of the Uji Jujo monument'),
    'A00261': ('File:Wooden and bamboo facades of dwellings with sudare in a cobbled street of Gion, perspective effect with vanishing point, Kyoto, Japan.jpg', 'the old wooden street'),
    'A00264': ('File:60秒で揚がります。 (29275479367).jpg', 'Pontocho alley with its lantern'),
    'A00268': ('File:Katsura River in Kyoto.jpg', 'the Katsura river gorge from the park'),
    'A00279': ('File:Yumiki, Yosano, Yosa District, Kyoto Prefecture 629-2263, Japan - panoramio (5).jpg', 'the bay from the Ouchi pass park'),
    'A00287': ('File:天橋立 - panoramio (6).jpg', 'Amanohashidate'),
    'A00295': ('File:花見小路通 - panoramio.jpg', 'Hanami-koji street'),
    'A00307': ('File:Kyoto (53853427547).jpg', 'a macaque at the Iwatayama monkey park'),
    'A00341': ('File:At Kyoto 2024 428.jpg', 'the gate passage between the stone walls'),
    'A00360': ('File:“Omokaruishi” (Heavy-Light Stone) at Fushimi Inari Grand Shrine.JPG', 'the Omokaru stone'),
    'A00395': ('File:Nintendo former headquarter Kyoto.jpg', 'the former Nintendo headquarters building'),
    'A00420': ('File:丹後町中浜 - panoramio.jpg', 'the rock off the coast at Nakahama'),
    'A00426': ('File:木津川 - panoramio (2).jpg', 'the Kizu river from the mountain'),
    'A00430': ('File:Sessha or Massha of Fushimi Inari-taisha.jpg', 'the small shrine at this spot'),
    'A00431': ('File:Miniature Torii gates at Fushimi Inari Shrine, Japan1.jpg', 'the miniature torii at the shrine'),
    'A00434': ('File:FushimiInari Taisha TopShrine.jpg', 'the shrine at the summit of Mt Inari'),
    'A00453': ('File:Sagano Scenic Railway DE10 1104 171205 (24204031827).jpg', 'the Sagano Romantic Train'),
    'A00454': ('File:Kyoto 20220730102530 (52650501185).jpg', 'the Sagano Romantic Train'),
    'A00468': ('File:JP 日本 Japan 京都 Kyoto 皇宮 Imperial Palace 御園 Storage and Exhibition Room June 2026 N13P 227.jpg', 'exhibits inside the residence'),
    'A00469': ('File:Sento Imperial Palace - 仙洞御所 【Gaia Walker Slide Show Demonstration】 - panoramio.jpg', 'the garden of the Sento Imperial Palace'),
    'A00470': ('File:Sento Imperial Palace 仙洞御所 【Gaia Walker Slide Show Demonstration】 - panoramio (9).jpg', 'the South Pond with its wisteria bridge'),
    'A00473': ('File:At Kyoto 2024 137.jpg', 'the old brick building at this corner'),
    'A00479': ('File:Samurai armors in a museum.jpg', 'samurai armour on display'),
    'A00485': ('File:舞鶴 赤レンガ倉庫 - panoramio (1).jpg', 'the Maizuru red-brick warehouses where the booth is'),
    'A00513': ('File:鴨川デルタの飛び石.jpg', 'the turtle stepping stones on the Kamo river'),
    'A00624': ('File:091128 Konchi-in Kyoto Japan16s3.jpg', 'the Konchi-in garden'),
    'A00644': ('File:安産守護染殿院 - panoramio.jpg', 'Somedono-in'),
}


def main():
    dry = '--dry-run' in sys.argv
    doc = J(os.path.join(DATA, 'photos.json'))
    have = doc['photos']
    A = {f['properties']['id']: f for f in J(os.path.join(DATA, 'attractions.geojson'))['features']}
    todo = [aid for aid in A if aid not in have]
    cache_path = os.path.join(CACHE, 'nearby_photo_candidates.json')
    cached = J(cache_path) if os.path.exists(cache_path) and '--refresh' not in sys.argv else None
    cands = cached['candidates'] if cached else {}
    for i, aid in enumerate([] if cached else todo):
        f = A[aid]
        lon, lat = f['geometry']['coordinates']
        radius = NEAR_M.get(f['properties']['category'], NEAR_DEFAULT)
        r = commons({'action': 'query', 'list': 'geosearch', 'gscoord': f'{lat}|{lon}', 'gsradius': int(radius),
                     'gsnamespace': 6, 'gslimit': 12})
        for g in (r.get('query') or {}).get('geosearch', []):
            d = dist((lon, lat), (g['lon'], g['lat']))
            if d <= radius:
                cands.setdefault(aid, []).append({'file': g['title'], 'm': round(d)})
        if i % 25 == 0:
            print(f'  records {i}/{len(todo)}, with candidates {len(cands)}', file=sys.stderr, flush=True)
    if not cached:
        finfo = file_info([c['file'] for cs in cands.values() for c in cs])
        for aid in list(cands):
            cands[aid] = sorted([{**c, 'info': finfo[c['file']]} for c in cands[aid]
                                 if free(finfo.get(c['file'])) and (finfo[c['file']].get('width') or 0) >= 800], key=lambda c: c['m'])[:4]
            if not cands[aid]:
                del cands[aid]
        with open(cache_path, 'w', encoding='utf-8') as fh:
            json.dump({'retrieved_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'radius_m': {'viewpoint': 80, 'other': 60},
                       'candidates': cands}, fh, ensure_ascii=False, indent=1)
    finfo = {c['file']: c['info'] for cs in cands.values() for c in cs}
    print('records with candidate photos:', len(cands), 'files', sum(len(v) for v in cands.values()))

    if dry:
        from PIL import Image
        os.makedirs(REVIEW, exist_ok=True)
        import urllib.request
        from fetch_photos import UA

        def preview(url, fn):
            # one try per file: Commons refuses to render some files for a while (429), and waiting on each
            # one in turn would stall the whole list; those are tried again at the end at a smaller size
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=40) as r:
                    im = Image.open(io.BytesIO(r.read())).convert('RGB')
                im.thumbnail((360, 360))
                im.save(os.path.join(REVIEW, fn), 'JPEG', quality=70)
                return True
            except Exception as e:
                print(f'  preview {fn}: {e}', file=sys.stderr)
                return False
            finally:
                time.sleep(1.0)

        listing, later = [], []
        for aid, cs in cands.items():
            for k, c in enumerate(cs):
                fn = f'{aid}-{k}.jpg'
                thumb = finfo[c['file']]['thumb']
                if not os.path.exists(os.path.join(REVIEW, fn)) and not preview(thumb.replace('/960px-', '/330px-'), fn):
                    later.append((aid, k, c))
                    continue
                listing.append({'id': aid, 'preview': fn, 'file': c['file'], 'm': c['m'], 'description': finfo[c['file']]['description']})
        for aid, k, c in later:
            fn = f'{aid}-{k}.jpg'
            if preview(finfo[c['file']]['thumb'].replace('/960px-', '/250px-'), fn):
                listing.append({'id': aid, 'preview': fn, 'file': c['file'], 'm': c['m'], 'description': finfo[c['file']]['description']})
        print('previews', len(listing), 'not available', len(later) - sum(1 for a, k, _ in later if any(x['preview'] == f'{a}-{k}.jpg' for x in listing)))
        json.dump(listing, open(os.path.join(REVIEW, 'candidates.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('previews in', REVIEW)
        return

    added = {}
    for aid, (file, shows) in ACCEPTED.items():
        c = next((c for c in cands.get(aid, []) if c['file'] == file), None)
        if c and aid not in have:
            added[aid] = entry(finfo[file], file, {'match': 'nearby-checked', 'm': c['m'], 'shows': shows}, save(finfo[file], f'{aid}.jpg'))
    have.update(added)
    doc['with_photo'] = len(have)
    doc['by_match'] = {}
    for v in have.values():
        doc['by_match'][v['match']] = doc['by_match'].get(v['match'], 0) + 1
    doc['nearby_retrieved_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    doc.setdefault('rules', {})['nearby_checked'] = 'a Commons photo taken within 60 m of the point (80 m for a viewpoint) that shows this place, each one checked by eye'
    with open(os.path.join(DATA, 'photos.json'), 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    print('added', len(added))


if __name__ == '__main__':
    main()
