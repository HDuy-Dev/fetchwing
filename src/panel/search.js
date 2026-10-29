// Quick open (⌘K / Ctrl+K): filter requests by name, URL or method.

import { liveRequests, pathOf } from '../lib/model.js';
import { el, openDialog } from './ui.js';

export function matchRequests(ws, query) {
  const q = query.trim().toLowerCase();
  const all = liveRequests(ws).map(r => ({ r, path: pathOf(ws, r.id).join(' / ') }));
  if (!q) return all.slice(0, 50);
  return all
    .filter(({ r, path }) => `${r.method} ${r.name} ${r.url} ${path}`.toLowerCase().includes(q))
    .slice(0, 50);
}

export function openSearch(ws, onPick) {
  openDialog((box, close) => {
    const input = el('input', { type: 'text', placeholder: 'Search requests', 'aria-label': 'Search requests', spellcheck: 'false' });
    const list = el('div', { class: 'search-results', role: 'listbox' });
    let results = [];
    let index = 0;
    const pick = i => { const hit = results[i]; if (hit) { close(); onPick(hit.r.id); } };
    const draw = () => {
      results = matchRequests(ws, input.value);
      index = Math.min(index, Math.max(0, results.length - 1));
      list.textContent = '';
      if (!results.length) list.append(el('div', { class: 'side-empty' }, 'No matching requests'));
      results.forEach(({ r, path }, i) => list.append(el('button', {
        type: 'button', class: 'list-row', role: 'option', 'aria-selected': String(i === index), onclick: () => pick(i),
      }, el('span', { class: `m ${r.method}` }, r.method), el('span', { class: 'name' }, r.name), el('span', { class: 'sub' }, path))));
      list.children[index]?.scrollIntoView?.({ block: 'nearest' });
    };
    input.addEventListener('input', () => { index = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(index + 1, results.length - 1); draw(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(index - 1, 0); draw(); }
      if (e.key === 'Enter') { e.preventDefault(); pick(index); }
    });
    box.append(input, list);
    draw();
  }, { className: 'dialog search-box' });
}
