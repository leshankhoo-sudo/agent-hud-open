"""Fit the online-preview build (dist-artifact) into the preview host's limit of 511 files per version.

Run after:  VITE_TARGET=artifact npx vite build --outDir dist-artifact
            python scripts/pack_preview.py [dist-artifact] [--limit 511]

Nothing here changes what the data says; it only changes how the preview build is packaged:
  0. the Explore city cards use their main image as the small image too (one file per city instead of two);
  1. the 175 bus route variants (data/bus/variants/<id>.json) go into one file, data/bus/variants.json,
     keyed by the same ids; App.jsx reads that file when VITE_TARGET is 'artifact';
  2. files under data/ that the page never loads (review tables for people, .gitattributes) are left out;
  3. the .woff copy of each font is left out (the .woff2 listed before it is what browsers load), and
     font subsets whose unicode-range covers no character in the site's code or data are left out
     (the browser only downloads a subset when a character in its range is on the page);
  4. if the build is still over the limit, the Shippori Mincho subsets used by the fewest characters are
     left out one by one; those characters fall back to the system serif font. They are listed in the output.
The Windows ZIP is built from dist (not this folder) and keeps every file.
"""
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')   # the dropped characters are Japanese; Windows consoles default to cp1252
except AttributeError:
    pass

root = next((a for a in sys.argv[1:] if not a.startswith('--')), 'dist-artifact')
limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 511


def files():
    return [os.path.join(d, f) for d, _, fs in os.walk(root) for f in fs]


# 1. bus variants -> one file
vdir = os.path.join(root, 'data', 'bus', 'variants')
if os.path.isdir(vdir):
    packed = {}
    for f in sorted(os.listdir(vdir)):
        if f.endswith('.json'):
            packed[f[:-5]] = json.load(open(os.path.join(vdir, f), encoding='utf-8'))
            os.remove(os.path.join(vdir, f))
    os.rmdir(vdir)
    json.dump(packed, open(os.path.join(root, 'data', 'bus', 'variants.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('bus variants packed:', len(packed))

# the Explore section's small card images: the preview uses the main image for the small card too
# (same photo, larger file), which saves one file per city
ep = os.path.join(root, 'data', 'explore_places.json')
if os.path.exists(ep):
    d = json.load(open(ep, encoding='utf-8'))
    for p in d['places']:
        t = os.path.join(root, p['thumb'])
        if p['thumb'] != p['src'] and os.path.exists(t):
            os.remove(t)
        p['thumb'] = p['src']
    json.dump(d, open(ep, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('explore: small card images use the main image:', len(d['places']))

# git settings files copied from public/ (.gitattributes) are not part of the site
for p in files():
    if os.path.basename(p).startswith('.'):
        os.remove(p)
        print('left out (git setting, not part of the site):', os.path.relpath(p, root).replace(os.sep, '/'))

# 2. data files the page never asks for (their names do not appear in the built code)
code = ''.join(open(p, encoding='utf-8', errors='ignore').read() for p in files() if p.endswith(('.js', '.html')))
for p in files():
    rel = os.path.relpath(p, root).replace(os.sep, '/')
    if rel.startswith('data/') and os.path.basename(p) not in code and not rel.startswith('data/bus/'):
        os.remove(p)
        print('left out (not loaded by the page):', rel)

# 3./4. font subsets. Every @font-face lists a .woff2 file first and a .woff copy for old browsers; every
# browser the site supports takes the .woff2, so the .woff copies are left out of the preview.
assets = os.path.join(root, 'assets')
woff = [f for f in os.listdir(assets) if f.endswith('.woff')]
for f in woff:
    os.remove(os.path.join(assets, f))
print('.woff fallbacks left out (the .woff2 of each is kept):', len(woff))
chars = set()
for p in files():
    if p.endswith(('.json', '.geojson', '.js', '.html')):
        chars |= set(open(p, encoding='utf-8', errors='ignore').read())
cps = {ord(c) for c in chars}
css = open(os.path.join(assets, next(f for f in os.listdir(assets) if f.startswith('index-') and f.endswith('.css'))), encoding='utf-8').read()
rows = []
for block in re.findall(r'@font-face\{[^}]*\}', css):
    m = re.search(r'url\(\./([^)]+?\.woff2)\)', block)
    ur = re.search(r'unicode-range:([^;}]+)', block)
    if not m or not ur or not os.path.exists(os.path.join(assets, m.group(1))):
        continue
    used = []
    for part in ur.group(1).split(','):
        part = part.strip().upper().replace('U+', '')
        a, b = (part.split('-') if '-' in part else (part, part))
        a, b = int(a, 16), int(b, 16)
        used += [chr(c) for c in cps if a <= c <= b]
    rows.append((len(used), m.group(1), ''.join(sorted(used))))
unused = [r for r in rows if r[0] == 0]
for _, fn, _ in unused:
    os.remove(os.path.join(assets, fn))
print('font subsets left out (no character on the site):', len(unused))
over = len(files()) - limit
dropped = []
if over > 0:
    for n, fn, used in sorted(r for r in rows if r[0] > 0 and 'shippori' in r[1])[:over]:
        os.remove(os.path.join(assets, fn))
        dropped.append(used)
    print(f'Shippori Mincho subsets left out to fit {limit} files: {len(dropped)}; these {sum(map(len, dropped))} characters use the system serif:', ''.join(dropped))
print('files:', len(files()))
if len(files()) > limit:
    sys.exit(f'still over the limit of {limit}')
