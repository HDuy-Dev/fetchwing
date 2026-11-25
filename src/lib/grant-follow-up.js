// What the grant window finishes once access is given. The popup that opened it
// has usually closed by then, so the window does the rest itself.

const UNREACHABLE = 'Could not reach Fetchwing.';

export function grantPath(origin, mockId) {
  const params = new URLSearchParams({ origin, site: '1' });
  if (mockId) params.set('mock', mockId);
  return `src/grant/grant.html?${params}`;
}

// Returns an error message, or null.
export async function completeGrant({ send, origin, mockId }) {
  const steps = [{ type: 'addMockSite', origin }];
  if (mockId) steps.push({ type: 'mutate', mutation: { type: 'setMockEnabled', id: mockId, enabled: true } });
  for (const step of steps) {
    const res = await send(step).catch(() => undefined);
    if (!res?.ok) return res?.error ?? UNREACHABLE;
  }
  return null;
}
