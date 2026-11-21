// Rolling counter: each digit is a strip 0-9-0 that turns like a mechanical counter. The ones column turns
// for every step, a higher column only when the one below passes 9, and always forwards while the count
// rises. Values are written straight to the DOM (no React render per frame). One shared frame loop.
const live = new Set();
let raf = 0;
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function frame(now) {
  raf = 0;
  for (const o of live) o.step(now);
  if (live.size) raf = requestAnimationFrame(frame);
}

export function createOdometer(el, digits) {
  el.textContent = '';
  el.classList.add('odo');
  const cols = [];
  for (let k = digits - 1; k >= 0; k--) {
    const col = document.createElement('span');
    col.className = 'odo-col';
    col.setAttribute('aria-hidden', 'true');
    const strip = document.createElement('span');
    strip.className = 'odo-strip';
    strip.textContent = '0123456789'.split('').concat('0').join('\n');
    col.append(strip);
    el.append(col);
    cols.unshift({ col, strip, d: 0, k });
  }
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  el.append(sr);
  let value = 0, last = 0;
  const paint = () => {
    for (const c of cols) {
      c.strip.style.transform = `translateY(${(-(((c.d % 10) + 10) % 10) * 100 / 11).toFixed(3)}%)`;
      c.col.classList.toggle('lead', c.k > 0 && value < 10 ** c.k);
    }
  };
  const o = {
    step(now) {
      const dt = Math.min(64, now - (last || now));
      last = now;
      const a = 1 - Math.exp(-dt / 85);
      let moving = false;
      for (const c of cols) {
        const v = Math.floor(value / 10 ** c.k);
        c.d += (v - c.d) * a;
        if (Math.abs(v - c.d) < 0.002) c.d = v; else moving = true;
      }
      paint();
      if (!moving) { live.delete(o); last = 0; }
    },
    set(n, instant = false) {
      n = Math.max(0, Math.round(n));
      if (n === value && !instant) return;
      const down = n < value;
      value = n;
      sr.textContent = String(n);
      if (instant || down || reduce()) {   // a reset or a drop jumps; only rising counts roll
        for (const c of cols) c.d = Math.floor(n / 10 ** c.k);
        paint();
        live.delete(o);
        return;
      }
      live.add(o);
      if (!raf) raf = requestAnimationFrame(frame);
    },
    get value() { return value; },
    destroy() { live.delete(o); },
  };
  paint();
  return o;
}
