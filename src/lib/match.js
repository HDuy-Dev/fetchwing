// How a page request is matched against a mock: method + full URL, with the
// query parameter order ignored.

export function normalizeUrl(url) {
  const text = String(url ?? '').trim();
  let u;
  try {
    u = new URL(text);
  } catch {
    return text;
  }
  const params = [...u.searchParams.entries()].sort(([ak, av], [bk, bv]) =>
    ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  const query = new URLSearchParams(params).toString();
  // URL already lowercases scheme/host and drops default ports.
  return `${u.origin}${u.pathname}${query ? `?${query}` : ''}`;
}

export function matchKey(method, url) {
  return `${String(method).toUpperCase()} ${normalizeUrl(url)}`;
}
