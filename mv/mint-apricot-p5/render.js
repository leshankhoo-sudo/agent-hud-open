// Headless Chrome (puppeteer-core) renders the p5 canvas frame by frame and pipes JPEGs straight into ffmpeg.
// usage: node render.js [out.mp4] [--w 1920] [--fps 30] [--from 0] [--to <frames>] [--stills t1,t2,...]
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const args = process.argv.slice(2), opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const OUT = args[0] && !args[0].startsWith('--') ? args[0] : 'MintApricot_p5.mp4';
const W = +(opt('w') || 1920), FPS = +(opt('fps') || 30), AUDIO = opt('audio') || 'song.mp3';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => { const f = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); });
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage(); await page.setViewport({ width: W, height: Math.round(W * 9 / 16) });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message)); page.on('console', m => console.log('page:', m.text()));
  await page.goto(`http://127.0.0.1:${port}/index.html?w=${W}`); await page.waitForFunction('window.ready === true', { timeout: 60000 });
  const grab = async t => { const b64 = await page.evaluate(t => { window.renderFrame(t); return document.querySelector('canvas').toDataURL('image/jpeg', .93).split(',')[1]; }, t); return Buffer.from(b64, 'base64'); };
  const stills = opt('stills');
  if (stills) { fs.mkdirSync('stills', { recursive: true }); for (const t of stills.split(',').map(Number)) fs.writeFileSync(`stills/t${t.toFixed(2).padStart(6, '0')}.jpg`, await grab(t)); }
  else {
    const dur = await new Promise(r => { const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', AUDIO]); let o = ''; p.stdout.on('data', d => o += d); p.on('close', () => r(parseFloat(o))); });
    const from = +(opt('from') || 0), to = +(opt('to') || Math.ceil(dur * FPS));
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-ss', String(from / FPS), '-i', AUDIO,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let f = from; f < to; f++) { const buf = await grab(f / FPS); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (f % 60 === 0) console.log(`frame ${f}/${to}  ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
    ff.stdin.end(); await new Promise(r => ff.on('close', r)); console.log('wrote', OUT);
  }
  await browser.close(); server.close();
})();
