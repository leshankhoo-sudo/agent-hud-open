# Build the Windows ZIP: Kyoto-Prefecture-Travel-Atlas/{Start-Dashboard.bat, serve.ps1, README-Windows.txt,
# assistant-config.json, site/...} from windows/, server/assistant-config.json and the built site in dist/.
# usage: python scripts/make_windows_zip.py <project dir> <out.zip>   (run `npm run build` first)
import os, sys, zipfile
proj, out = sys.argv[1], sys.argv[2]
top = 'Kyoto-Prefecture-Travel-Atlas'
n = 0
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for name in ('Start-Dashboard.bat', 'serve.ps1', 'README-Windows.txt'):
        z.write(os.path.join(proj, 'windows', name), f'{top}/{name}'); n += 1
    # the assistant's settings (model, thinking, Standard tier, prices, limits) sit next to serve.ps1, which reads them
    z.write(os.path.join(proj, 'server', 'assistant-config.json'), f'{top}/assistant-config.json'); n += 1
    dist = os.path.join(proj, 'dist')
    for root, dirs, files in os.walk(dist):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(root, f)
            rel = os.path.relpath(p, dist).replace(os.sep, '/')
            # media is already compressed; storing it keeps the ZIP quick to open
            ct = zipfile.ZIP_STORED if f.lower().endswith(('.mp4', '.mp3', '.jpg', '.webp', '.woff2', '.woff')) else zipfile.ZIP_DEFLATED
            z.write(p, f'{top}/site/{rel}', compress_type=ct); n += 1
print(n, 'files,', round(os.path.getsize(out) / 1e6, 1), 'MB')
