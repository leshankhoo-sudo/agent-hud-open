const { chromium } = require('playwright'); const fs = require('fs'); const path=require('path');
const [,, dir, w, fps, from, to, outdir, list] = process.argv;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const W=+w, H=Math.round(W*9/16);
  const p = await b.newPage({ viewport: { width: W, height: H } });
  p.on('console', m => console.log('PAGE', m.text())); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto(`http://127.0.0.1:8765/scene.html?w=${W}`); await p.waitForFunction('window.ready', null, {timeout: 60000});
  fs.mkdirSync(outdir, { recursive: true });
  const frames = list ? list.split(',').map(Number) : null;
  const idx = frames || Array.from({length: +to - +from}, (_, i) => +from + i);
  const t0 = Date.now();
  for (const f of idx) {
    const t = frames ? f : f / +fps;
    await p.evaluate(t => window.renderFrame(t), t);
    await p.screenshot({ path: path.join(outdir, (frames ? 't'+t.toFixed(2) : String(f).padStart(5,'0')) + '.jpg'), type: 'jpeg', quality: 94 });
    if (!frames && f % 50 === 0) console.log('frame', f, ((Date.now()-t0)/1000).toFixed(1)+'s');
  }
  await b.close();
})();
