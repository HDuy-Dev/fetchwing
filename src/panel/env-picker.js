// The top bar's environment picker: a button and a searchable popup.

import { liveEnvironments } from '../lib/model.js';
import { pickerRows } from '../lib/env-form.js';
import { el, icon } from './ui.js';

// handlers: { getWs, onPick(id | null), onCreate() }
export function initEnvPicker(button, { getWs, onPick, onCreate }) {
  const search = el('input', { type: 'text', class: 'env-search', placeholder: 'Search', 'aria-label': 'Search environments', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'envOptions', spellcheck: 'false', autocomplete: 'off' });
  const list = el('div', { class: 'env-options', id: 'envOptions', role: 'listbox', 'aria-label': 'Environments' });
  const popup = el('div', { class: 'env-popup', hidden: true }, search, list);
  document.body.append(popup);
  let rows = [];
  let at = 0; // the row the arrow keys are on

  const keyOf = row => (row?.kind === 'env' ? row.id : row?.kind);

  function highlight(index) {
    at = index;
    list.querySelectorAll('[role="option"]').forEach((node, i) => node.classList.toggle('on', i === at));
    const node = list.querySelectorAll('[role="option"]')[at];
    if (!node) return;
    search.setAttribute('aria-activedescendant', node.id);
    node.scrollIntoView({ block: 'nearest' });
  }

  function draw(wanted) {
    const ws = getWs();
    rows = pickerRows(liveEnvironments(ws), search.value, ws.activeEnvId);
    list.replaceChildren();
    rows.forEach((row, i) => {
      if (row.kind === 'create') {
        if (rows.length === 2 && search.value.trim()) list.append(el('div', { class: 'side-empty' }, 'No matches'));
        list.append(el('div', { class: 'sep' }));
      }
      list.append(el('div', {
        class: 'env-option', role: 'option', id: `envOption${i}`,
        'aria-selected': String(Boolean(row.active)),
        title: row.kind === 'env' ? row.name : undefined,
        onclick: () => choose(row),
        onmousemove: () => { if (at !== i) highlight(i); },
      },
      el('span', { class: 'mark-slot' }, row.kind === 'create' ? icon('plus') : row.active ? icon('check') : null),
      el('span', { class: 'name' }, row.kind === 'env' ? row.name : row.kind === 'none' ? 'No Environment' : 'Create new environment')));
    });
    const kept = rows.findIndex(row => keyOf(row) === wanted);
    highlight(kept === -1 ? 0 : kept);
  }

  function place() {
    const r = button.getBoundingClientRect();
    popup.style.top = `${r.bottom + 4}px`;
    popup.style.left = `${Math.max(4, Math.min(r.right - popup.offsetWidth, innerWidth - popup.offsetWidth - 4))}px`;
  }

  const outside = e => { if (!popup.contains(e.target) && !button.contains(e.target)) close(); };

  function open() {
    search.value = '';
    popup.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    draw(getWs().activeEnvId ?? 'none');
    place();
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('resize', place);
    search.focus();
  }

  function close() {
    popup.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside, true);
    window.removeEventListener('resize', place);
  }

  function choose(row) {
    close();
    button.focus();
    if (row.kind === 'create') onCreate();
    else onPick(row.kind === 'env' ? row.id : null);
  }

  search.addEventListener('input', () => {
    // After typing, the first match; with none, No Environment.
    const first = pickerRows(liveEnvironments(getWs()), search.value, null)[1];
    draw(search.value.trim() && first.kind === 'env' ? first.id : 'none');
  });

  popup.addEventListener('keydown', e => {
    // Keys handled here stay away from the panel's menus and dialogs.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      highlight((at + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[at]) choose(rows[at]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
      button.focus();
    } else if (e.key === 'Tab') {
      close();
      button.focus();
    } else return;
    e.stopPropagation();
  });

  button.addEventListener('click', () => (popup.hidden ? open() : close()));

  return {
    render() {
      const env = getWs().environments[getWs().activeEnvId];
      const name = env && !env.deleted ? env.name : 'No Environment';
      button.replaceChildren(icon('braces'), el('span', { class: 'name' }, name), icon('chevron'));
      button.setAttribute('aria-label', `Environment: ${name}`);
      button.title = `Environment: ${name}`;
      if (!popup.hidden) draw(keyOf(rows[at]));
    },
  };
}
