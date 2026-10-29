// Collapsible JSON viewer with line numbers, built from jsonLines().

import { jsonLines, initialCollapsed } from '../lib/json-lines.js';
import { icon } from './ui.js';

const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function valueHtml(line) {
  const text = escapeHtml(line.text);
  switch (line.valueType) {
    case 'string': return `<span class="s">${text}</span>`;
    case 'number': return `<span class="n">${text}</span>`;
    case 'boolean':
    case 'null': return `<span class="l">${text}</span>`;
    default: return text;
  }
}

const keyHtml = line => (line.key === null ? '' : `<span class="k">${escapeHtml(JSON.stringify(line.key))}</span>: `);

// Parses text; returns null when it isn't a JSON object/array worth folding.
export function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

// Renders `value` into `container`. `toggleButton` (optional) becomes a
// Collapse all ⇄ Expand all switch kept in step with the per-block arrows.
export function renderJsonView(container, value, { toggleButton } = {}) {
  const lines = jsonLines(value);
  const collapsed = initialCollapsed(lines);
  container.textContent = '';
  container.classList.add('json');
  container.setAttribute('role', 'tree');

  function draw() {
    const html = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const pad = `padding-left:${line.depth * 2}ch`;
      const ln = `<span class="ln">${i + 1}</span>`;
      if (line.kind === 'open') {
        const isCollapsed = collapsed.has(line.block);
        const fold = `<button class="fold" data-block="${line.block}" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'}">${isCollapsed ? '▸' : '▾'}</button>`;
        if (isCollapsed) {
          const close = lines[line.end];
          const label = line.bracket === '[' ? `${line.size} item${line.size === 1 ? '' : 's'}` : `${line.size} key${line.size === 1 ? '' : 's'}`;
          html.push(`<div class="jrow">${ln}${fold}<span class="jc" style="${pad}">${keyHtml(line)}${line.bracket}<button class="more" data-block="${line.block}">… ${label}</button>${close.text}${close.comma ? ',' : ''}</span></div>`);
          i = line.end;
          continue;
        }
        html.push(`<div class="jrow">${ln}${fold}<span class="jc" style="${pad}">${keyHtml(line)}${line.bracket}</span></div>`);
      } else if (line.kind === 'close') {
        html.push(`<div class="jrow">${ln}<span class="fold"></span><span class="jc" style="${pad}">${line.text}${line.comma ? ',' : ''}</span></div>`);
      } else {
        html.push(`<div class="jrow">${ln}<span class="fold"></span><span class="jc" style="${pad}">${keyHtml(line)}${valueHtml(line)}${line.comma ? ',' : ''}</span></div>`);
      }
    }
    container.innerHTML = html.join('');
    syncToggle();
  }

  const anyCollapsed = () => collapsed.size > 0;

  function syncToggle() {
    if (!toggleButton) return;
    const on = anyCollapsed();
    toggleButton.replaceChildren(icon(on ? 'expand' : 'collapse'));
    toggleButton.setAttribute('aria-pressed', String(on));
    toggleButton.setAttribute('aria-label', on ? 'Expand all' : 'Collapse all');
    toggleButton.title = on ? 'Expand all' : 'Collapse all';
  }

  container.onclick = e => {
    const target = e.target.closest('[data-block]');
    if (!target) return;
    const block = Number(target.dataset.block);
    if (collapsed.has(block)) collapsed.delete(block);
    else collapsed.add(block);
    draw();
  };

  if (toggleButton) {
    toggleButton.onclick = () => {
      if (anyCollapsed()) collapsed.clear();
      else for (const l of lines) if (l.kind === 'open' && l.depth === 1) collapsed.add(l.block);
      draw();
    };
  }

  draw();
}
