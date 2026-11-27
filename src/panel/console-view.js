// Console pane: what the request script logged, its error and env changes.

import { el, icon, iconButton } from './ui.js';

// entry: undefined (script never ran) | { at: ms, items: [{ level, text }] }
export function renderConsole(pane, entry, { onClear }) {
  pane.textContent = '';
  if (!entry?.items.length) {
    pane.append(el('div', { class: 'pane-hint' }, icon('terminal'),
      el('span', {}, 'Console output from the request script shows here')));
    return;
  }
  const time = new Date(entry.at).toLocaleTimeString();
  pane.append(
    el('div', { class: 'resp-tools' },
      el('span', { class: 'hint' }, `Script ran at ${time}`),
      el('div', { class: 'tool-icons ml-auto' }, iconButton('trash', 'Clear console', onClear))),
    el('div', { class: 'console-list', role: 'log', 'aria-label': 'Script console' },
      entry.items.map(({ level, text }) => el('div', { class: `console-row ${level}` },
        el('span', { class: 'console-level' }, level), el('pre', {}, text)))));
}

export const hasConsoleError = entry => Boolean(entry?.items.some(i => i.level === 'error'));
