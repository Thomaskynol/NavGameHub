// Asfalto Vivo — utilitários mínimos de DOM e formatação (UI).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') {
        // 'onClick' → 'click' (eventos DOM são case-sensitive)
        const ev = k.slice(2, 3).toLowerCase() + k.slice(3);
        el.addEventListener(ev, v);
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    parent.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// 2:05.32 / 12:03.08 — min:seg.centésimos
export function fmtTime(ms, withCentis = true) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return withCentis ? `${base}.${String(cs).padStart(2, '0')}` : base;
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
