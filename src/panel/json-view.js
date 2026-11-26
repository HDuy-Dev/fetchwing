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

const attr = s => escapeHtml(s).replace(/"/g, '&quot;');

// Marks a block that is really a string in the data, with a way to edit it.
function embeddedHtml(line, index, editable) {
  if (!line.embedded) return '';
  const tag = '<span class="jtag">JSON string</span>';
  if (!editable) return tag;
  const label = attr(`Edit JSON string ${line.embedded.at(-1)}`);
  return `${tag}<button type="button" class="jedit" data-edit="${index}" aria-label="${label}" title="${label}">${icon('edit').outerHTML}Edit</button>`;
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

// The key of a line's path in `highlights`.
export const pathKey = path => JSON.stringify(path);

// Lines sitting inside a string that holds JSON: no path reaches into a string.
function insideStrings(lines) {
  const inside = new Set();
  lines.forEach((line, i) => {
    if (line.kind === 'open' && line.embedded) for (let j = i + 1; j < line.end; j++) inside.add(j);
  });
  return inside;
}

// Renders `value` into `container`. `toggleButton` (optional) becomes a
// Collapse all ⇄ Expand all switch kept in step with the per-block arrows.
// `onEditString(path, lineIndex)` (optional) adds an edit button to each string holding JSON.
// `highlights` (optional, Map of pathKey -> name) marks those lines with `→ name`.
// `onAddOutput(path)` (optional) gives the other lines a "＋ Output" button.
export function renderJsonView(container, value, { toggleButton, onEditString, highlights, onAddOutput } = {}) {
  const lines = jsonLines(value);
  const collapsed = initialCollapsed(lines);
  const unreachable = onAddOutput ? insideStrings(lines) : null;
  // The end of a row: its `→ name` tag, or the button that makes it an output.
  const tail = (line, i) => {
    const hit = highlights?.get(pathKey(line.path));
    if (hit) return `<span class="xtag">→ ${escapeHtml(hit)}</span>`;
    if (!onAddOutput || !line.path.length || unreachable.has(i)) return '';
    return `<button type="button" class="grab" data-add="${i}" aria-label="${attr(`Add output from line ${i + 1}`)}">＋ Output</button>`;
  };
  const rowClass = line => (highlights?.has(pathKey(line.path)) ? 'jrow hit' : 'jrow');
  container.textContent = '';
  container.classList.add('json');
  container.setAttribute('role', 'tree');

  function draw() {
    const html = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const pad = `padding-left:${line.depth * 2}ch`;
      const ln = `<span class="ln">${i + 1}</span>`;
      const held = embeddedHtml(line, i, Boolean(onEditString));
      if (line.kind === 'open') {
        const isCollapsed = collapsed.has(line.block);
        const fold = `<button class="fold" data-block="${line.block}" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'}">${isCollapsed ? '▸' : '▾'}</button>`;
        if (isCollapsed) {
          const close = lines[line.end];
          const label = line.bracket === '[' ? `${line.size} item${line.size === 1 ? '' : 's'}` : `${line.size} key${line.size === 1 ? '' : 's'}`;
          html.push(`<div class="${rowClass(line)}">${ln}${fold}<span class="jc" style="${pad}">${keyHtml(line)}${line.bracket}<button class="more" data-block="${line.block}">… ${label}</button>${close.text}${close.comma ? ',' : ''}${held}</span>${tail(line, i)}</div>`);
          i = line.end;
          continue;
        }
        html.push(`<div class="${rowClass(line)}">${ln}${fold}<span class="jc" style="${pad}">${keyHtml(line)}${line.bracket}${held}</span>${tail(line, i)}</div>`);
      } else if (line.kind === 'close') {
        html.push(`<div class="jrow">${ln}<span class="fold"></span><span class="jc" style="${pad}">${line.text}${line.comma ? ',' : ''}</span></div>`);
      } else {
        html.push(`<div class="${rowClass(line)}">${ln}<span class="fold"></span><span class="jc" style="${pad}">${keyHtml(line)}${valueHtml(line)}${line.comma ? ',' : ''}</span>${tail(line, i)}</div>`);
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
    const add = e.target.closest('[data-add]');
    if (add) return onAddOutput(lines[Number(add.dataset.add)].path);
    const edit = e.target.closest('[data-edit]');
    if (edit) return onEditString(lines[Number(edit.dataset.edit)].embedded, Number(edit.dataset.edit));
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
