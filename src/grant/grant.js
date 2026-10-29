const origin = new URLSearchParams(location.search).get('origin') || '';
document.getElementById('origin').textContent = origin;
document.getElementById('allow').addEventListener('click', async () => {
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  document.getElementById('result').textContent = granted
    ? 'Access granted. You can close this window and try again in Fetchwing.'
    : 'Access was not granted.';
  if (granted) setTimeout(() => window.close(), 1200);
});
