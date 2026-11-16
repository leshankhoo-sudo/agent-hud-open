import { Children, isValidElement, useLayoutEffect, useRef, useState } from 'react';

// Uneven bento grid whose tiles can be reordered by dragging their grip.
// While a tile is dragged it follows the pointer; the others glide to their new places (FLIP, transforms
// only, so nothing is re-laid out per frame); on release the tile snaps into the nearest slot.
// Keyboard: focus a grip and use the arrow keys. The order is remembered per grid.
// Wide containers use two columns; a tile with w={2} spans both. Narrow containers stack every tile.
const KEY = (id) => `kyoto-gis-bento-${id}`;
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function restore(id, keys) {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(KEY(id)) || '[]'); } catch { /* none */ }
  const known = saved.filter((k) => keys.includes(k));
  return [...known, ...keys.filter((k) => !known.includes(k))];   // new tiles go to the end, removed ones drop out
}

export function Tile({ children }) { return children; }

export default function Bento({ id, children, className = '' }) {
  const tiles = Children.toArray(children).filter((c) => isValidElement(c) && c.props.k);
  const keys = tiles.map((t) => t.props.k);
  const [order, setOrder] = useState(() => restore(id, keys));
  const box = useRef(null);
  const els = useRef(new Map());
  const before = useRef(null);       // offsets before a reorder, for the glide
  const drag = useRef(null);
  const [dragKey, setDragKey] = useState(null);
  const [said, setSaid] = useState('');
  const shown = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
  const orderRef = useRef(shown);
  orderRef.current = shown;
  const currentOrder = () => orderRef.current;
  const byKey = new Map(tiles.map((t) => [t.props.k, t]));

  const offsets = () => new Map([...els.current].map(([k, el]) => [k, [el.offsetLeft, el.offsetTop]]));
  const move = (key, to) => {
    const cur = orderRef.current;
    const from = cur.indexOf(key);
    if (from < 0 || to === from || to < 0 || to >= cur.length) return false;
    before.current = offsets();
    const next = [...cur];
    next.splice(from, 1);
    next.splice(to, 0, key);
    orderRef.current = next;
    setOrder(next);
    return true;
  };
  const save = (o) => { try { localStorage.setItem(KEY(id), JSON.stringify(o)); } catch { /* not stored */ } };

  // glide: every tile that changed slot animates from its old place to the new one
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    if (!prev) return;
    const d = drag.current;
    for (const [k, el] of els.current) {
      if (d && k === d.key) { follow(); continue; }
      const p = prev.get(k);
      if (!p) continue;
      const dx = p[0] - el.offsetLeft, dy = p[1] - el.offsetTop;
      if (!dx && !dy) continue;
      if (reduce()) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  });

  // the dragged tile sits at the pointer, measured from its slot (offsets ignore transforms)
  const follow = () => {
    const d = drag.current;
    if (!d) return;
    const el = els.current.get(d.key);
    const r = box.current.getBoundingClientRect();
    el.style.transform = `translate(${d.x - d.ox - (r.left + el.offsetLeft)}px, ${d.y - d.oy - (r.top + el.offsetTop)}px) scale(1.02)`;
  };
  const nearest = () => {
    const d = drag.current;
    const r = box.current.getBoundingClientRect();
    const x = d.x - r.left, y = d.y - r.top;
    let best = null, bd = Infinity;
    for (const [k, el] of els.current) {
      const inside = x >= el.offsetLeft && x <= el.offsetLeft + el.offsetWidth && y >= el.offsetTop && y <= el.offsetTop + el.offsetHeight;
      const cd = Math.hypot(x - (el.offsetLeft + el.offsetWidth / 2), y - (el.offsetTop + el.offsetHeight / 2));
      const score = inside ? -1 : cd;
      if (score < bd) { bd = score; best = k; }
    }
    return best;
  };
  const start = (e, key) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = els.current.get(key);
    const rect = el.getBoundingClientRect();
    drag.current = { key, x: e.clientX, y: e.clientY, ox: e.clientX - rect.left, oy: e.clientY - rect.top, last: 0, raf: 0, scroll: 0 };
    setDragKey(key);
    const scroller = box.current.closest('.panel') || box.current.parentElement;
    const tick = () => {
      const d = drag.current;
      if (!d) return;
      // near the top or bottom of the panel: scroll it so far tiles can be reached
      const sr = scroller.getBoundingClientRect();
      const edge = d.y < sr.top + 48 ? -1 : d.y > sr.bottom - 48 ? 1 : 0;
      if (edge) { scroller.scrollTop += edge * 10; follow(); }
      d.raf = requestAnimationFrame(tick);
    };
    drag.current.raf = requestAnimationFrame(tick);
    const mv = (ev) => {
      const d = drag.current;
      d.x = ev.clientX; d.y = ev.clientY;
      follow();
      const now = performance.now();
      if (now - d.last < 140) return;            // a little hysteresis so tiles do not swap back and forth
      const target = nearest();
      if (target && target !== d.key && move(d.key, currentOrder().indexOf(target))) d.last = now;
    };
    const up = () => {
      // listen on window: reordering moves the tile's node, which drops pointer capture on the grip
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      const d = drag.current;
      cancelAnimationFrame(d.raf);
      drag.current = null;
      const t = el.style.transform;
      el.style.transform = '';
      // snap into the slot
      if (!reduce() && t) el.animate([{ transform: t }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.9,.25,1.15)' });
      setDragKey(null);
      save(currentOrder());
      setSaid(`${byKey.get(key)?.props.label || key} placed at position ${currentOrder().indexOf(key) + 1} of ${keys.length}.`);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  const onKey = (e, key) => {
    const i = shown.indexOf(key);
    const to = { ArrowUp: i - 1, ArrowLeft: i - 1, ArrowDown: i + 1, ArrowRight: i + 1, Home: 0, End: shown.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    if (move(key, Math.max(0, Math.min(shown.length - 1, to)))) {
      const next = [...shown]; next.splice(i, 1); next.splice(Math.max(0, Math.min(shown.length - 1, to)), 0, key);
      save(next);
      setSaid(`${byKey.get(key)?.props.label || key} moved to position ${next.indexOf(key) + 1} of ${keys.length}.`);
      requestAnimationFrame(() => els.current.get(key)?.querySelector('.tile-grip')?.focus());
    }
  };

  return (
    <div className={'bento ' + className + (dragKey ? ' is-dragging' : '')} ref={box}>
      {shown.map((k) => {
        const t = byKey.get(k);
        if (!t) return null;
        const { w = 1, label = k } = t.props;
        return (
          <div key={k} className={'tile' + (dragKey === k ? ' dragging' : '')} data-w={w} data-tile={k}
            ref={(el) => { if (el) els.current.set(k, el); else els.current.delete(k); }}>
            <button type="button" className="tile-grip" aria-label={`Move tile ${shown.indexOf(k) + 1} of ${shown.length}`} aria-description="Drag, or use the arrow keys" title="Drag to move this tile"
              onPointerDown={(e) => start(e, k)} onKeyDown={(e) => onKey(e, k)}>
              <svg viewBox="0 0 10 16" width="8" height="13" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1.3" /><circle cx="8" cy="2" r="1.3" /><circle cx="2" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="2" cy="14" r="1.3" /><circle cx="8" cy="14" r="1.3" /></g></svg>
            </button>
            {t.props.children}
          </div>
        );
      })}
      <span className="sr-only" aria-live="polite">{said}</span>
    </div>
  );
}
export const resetBento = (id) => { try { localStorage.removeItem(KEY(id)); } catch { /* */ } };
