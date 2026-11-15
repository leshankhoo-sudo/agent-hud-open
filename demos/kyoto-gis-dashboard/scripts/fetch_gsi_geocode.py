"""Coordinates for the addresses in DSIGHT_1.csv from the GSI address search (国土地理院 地理院地図
住所検索, https://msearch.gsi.go.jp/address-search/AddressSearch), an official geocoder.

Run from the project folder:  python3 scripts/fetch_gsi_geocode.py [data/raw/dsight/DSIGHT_1.csv]
Output: data/cache/gsi_address.json  {address: {"town", "area", "tries": [{"query", "results"}], "matches"}}

Kyoto addresses often name the streets before the town ("寺町通広小路上る北ノ辺町397"), which the search
mixes up with other towns. So the town name is taken out ("北ノ辺町") and sent with the ward and the
block number; a result counts only when its own name contains that town (field "town_ok"). An
address without a city ("南禅寺福地町") is sent with "京都市" in front, since the file is Kyoto City's;
the audit uses such a result only when it is the only matching one.
"""
import csv
import json
import os
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "cache", "gsi_address.json")
UA = "KyotoGIS-StudentProject/0.1 (university GIS prototype; non-commercial)"


def search(q):
    url = "https://msearch.gsi.go.jp/address-search/AddressSearch?" + urllib.parse.urlencode({"q": q})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for i in range(4):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=30).read())
        except Exception:
            time.sleep(2 + 3 * i)
    return None


import re
WARDS = ["北区", "上京区", "左京区", "中京区", "東山区", "下京区", "南区", "右京区", "伏見区", "山科区", "西京区"]


KANJI = "〇一二三四五六七八九"
VARIANTS = str.maketrans({"之": "ノ", "の": "ノ", "ヶ": "ケ", "ヵ": "カ", "竃": "竈", "背": "脊", "竜": "龍", "桝": "枡"})


def same(s):
    """Spellings the search treats as one: full-width digits, 1丁目/一丁目, ノ/之/の, ヶ/ケ, 竃/竈, 背/脊, 竜/龍;
    small kana that some names write and others leave out (堂ノ庭/堂庭, 立テ本/立本) are dropped."""
    s = unicodedata.normalize("NFKC", s or "").translate(VARIANTS)
    s = re.sub(r"(\d)丁目", lambda m: KANJI[int(m.group(1))] + "丁目", s)
    return re.sub(r"[ノケテ]", "", s)


def parts(a):
    """(area, town, number): area is the ward ('左京区') or city ('亀岡市') when the address names one."""
    a = re.sub(r"\s", "", unicodedata.normalize("NFKC", a))
    a = a.split("/")[-1]                                   # two landing stages: use the second address
    area = next((w for w in WARDS if w in a), None)
    if not area:
        m = re.search(r"(?:京都府)?([^都府県\d]{1,4}市)", a)
        area = m.group(1) if m and m.group(1) != "京都市" else None
    rest = a.split(area, 1)[1] if area else a
    rest = re.sub(r"^.*(上る|下る|上ル|下ル|東入ル?る?|西入ル?る?)", "", rest)   # street directions before the town
    rest = re.sub(r"(付近|内)$", "", rest)
    m = re.match(r"^(\D+?(?:町|\d+丁目|[一二三四五六七八九]丁目))(\d[\d\-]*)?", rest) or re.match(r"^(\D{2,})(\d[\d\-]*)?$", rest)
    if not m:
        return area, None, None
    town = re.sub(r"^.*(通|筋)", "", m.group(1))
    return area, town, m.group(2)


def query(area, town, num):
    city = ("京都市" + area) if area in WARDS else (area or "")
    q = city + town + (num or "")
    res = search(q) or []
    time.sleep(0.6)
    out = [{"lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1], "title": f["properties"].get("title")} for f in res]
    for r in out:
        t = same(r["title"])
        r["town_ok"] = same(town) in t and same(area) in t
    return q, out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "raw", "dsight", "DSIGHT_1.csv")
    rows = list(csv.reader(open(src, encoding="utf-8-sig")))
    cache = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    addrs = sorted({unicodedata.normalize("NFKC", r[17]).strip() for r in rows if r[17].strip()})
    for a in addrs:
        if a in cache:
            continue
        area, town, num = parts(a)
        entry = {"town": town, "area": area, "tries": []}
        if town:
            # no ward in the address: try the town in each ward of Kyoto City and keep what matches
            for ar in ([area] if area else WARDS):
                q, res = query(ar, town, num)
                entry["tries"].append({"query": q, "results": res})
        ok = [r for t in entry["tries"] for r in t["results"] if r["town_ok"]]
        entry["matches"] = ok
        cache[a] = entry
    json.dump(cache, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(len(cache), "addresses;", sum(1 for v in cache.values() if len(v["matches"]) == 1), "with exactly one matching place")


if __name__ == "__main__":
    main()
