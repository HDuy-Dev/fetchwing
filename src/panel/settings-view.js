// Settings dialog: where mocks run, and which sites Fetchwing can reach.

import { el, openDialog } from './ui.js';
import { ensureOrigin } from './permissions.js';

const send = msg => chrome.runtime.sendMessage(msg);

export function openSettings(state) {
  openDialog((box, close) => {
    const mockList = el('div', { class: 'rows' });
    const accessList = el('div', { class: 'rows' });

    const drawMockSites = () => {
      mockList.textContent = '';
      if (!state.mockSites.length) mockList.append(el('div', { class: 'hint' }, 'None yet. Turning a mock on adds the page open in this tab.'));
      for (const origin of state.mockSites) {
        mockList.append(el('div', { class: 'row' }, el('code', { style: 'flex:1' }, origin), el('button', {
          type: 'button',
          onclick: async () => {
            const res = await send({ type: 'removeMockSite', origin });
            if (res?.ok) { state.mockSites = res.mockSites; drawMockSites(); }
          },
        }, 'Remove')));
      }
      const here = state.inspectedOrigin;
      if (here && /^https?:/.test(here) && !state.mockSites.includes(here)) {
        mockList.append(el('div', { class: 'row' }, el('button', {
          type: 'button',
          onclick: async () => {
            const access = await ensureOrigin(here);
            if (access !== 'granted') return;
            const res = await send({ type: 'addMockSite', origin: here });
            if (res?.ok) { state.mockSites = res.mockSites; drawMockSites(); }
          },
        }, `Run mocks on ${here}`)));
      }
    };

    const drawAccess = async () => {
      accessList.textContent = '';
      const { origins = [] } = await chrome.permissions.getAll();
      const sites = origins.filter(o => /^https?:\/\//.test(o));
      if (!sites.length) accessList.append(el('div', { class: 'hint' }, 'No sites yet. Fetchwing asks the first time you send to a site.'));
      for (const pattern of sites) {
        accessList.append(el('div', { class: 'row' }, el('code', { style: 'flex:1' }, pattern.replace(/\/\*$/, '')), el('button', {
          type: 'button',
          onclick: async () => {
            await chrome.permissions.remove({ origins: [pattern] }).catch(() => {});
            const origin = pattern.replace(/\/\*$/, '');
            if (state.mockSites.includes(origin)) {
              const res = await send({ type: 'removeMockSite', origin });
              if (res?.ok) state.mockSites = res.mockSites;
              drawMockSites();
            }
            drawAccess();
          },
        }, 'Remove access')));
      }
    };

    box.append(
      el('h2', {}, 'Settings'),
      el('div', { class: 'hint' }, 'Sites where mocks run'),
      mockList,
      el('div', { class: 'hint', style: 'margin-top:8px' }, 'Sites Fetchwing can access'),
      accessList,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'primary', onclick: close }, 'Done')),
    );
    drawMockSites();
    drawAccess();
  });
}
