# Publishing Fetchwing

One-time setup for the developer: a stable extension ID, a Google Cloud OAuth client so users can sync, then the Chrome Web Store listing. Fetchwing works without the OAuth client; only Drive sync stays off ("Sync is not set up in this build").

## 1. Give the dev build a stable extension ID

The OAuth redirect URI contains the extension ID, so the unpacked build needs a fixed one.

```sh
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out ~/fetchwing-key.pem   # keep OUT of git
openssl rsa -in ~/fetchwing-key.pem -pubout -outform DER | openssl base64 -A    # prints the public key
```

Add the printed value to `manifest.json` as `"key": "<public key>"`. Reload the extension in `chrome://extensions` and note its ID (`<dev-id>`). `npm run build` drops this key from the upload zip.

## 2. Google Cloud project

1. Go to <https://console.cloud.google.com/> and create a project, e.g. "Fetchwing".
2. **APIs & Services → Library:** enable the **Google Drive API**.
3. **OAuth consent screen** (Google Auth Platform):
   - User type: **External**.
   - App name "Fetchwing", a support email, the app logo (`assets/icons/icon-128.png`) and a developer contact email.
   - App domain: home page `https://hduy-dev.github.io/fetchwing/`, privacy policy `https://hduy-dev.github.io/fetchwing/privacy.html`.
   - Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/drive.file`. All three are non-sensitive, so no security assessment is needed.
   - While in **Testing**, only listed test users can sign in. Add yourself. Click **Publish app** when going live; Google may ask for a short brand verification.
4. **Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**.
   - Authorized redirect URIs: `https://<dev-id>.chromiumapp.org/`. Add the Store one in step 4.
5. Copy the client ID into `src/config.js` (`GOOGLE_CLIENT_ID`). It is public, not a secret. Never add a client secret to the extension.

## 3. Test sign-in

Reload the extension. Open DevTools → **Fetchwing** → cloud button → **Sync with Google Drive**. Expect a `Fetchwing data` file in your Drive. Sign in on a second Chromium browser (Edge or Brave) and check that a request created on one appears on the other within about 5 minutes, or straight away after **Sync now**.

## 4. Chrome Web Store

1. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). This account is already registered.
2. Build the upload: `npm run build` → `dist/fetchwing-<version>.zip`.
3. **New item** → upload the zip. The Store assigns the final ID (`<store-id>`). Add `https://<store-id>.chromiumapp.org/` to the OAuth client's redirect URIs.
4. Listing:
   - Description: see "Store listing text" below.
   - Icon: `assets/icons/icon-128.png`.
   - Screenshots, uploaded in this order: `docs/store/screenshot-1.png` … `screenshot-4.png` (1280×800).
   - Small promo tile: `docs/store/promo-small.png` (440×280).
   - Category: Developer Tools. Language: English.
   - Privacy practices tab: paste the single purpose, permission justifications and data disclosure from `docs/COMPLIANCE.md`.
   - Privacy policy URL: `https://hduy-dev.github.io/fetchwing/privacy.html`.
5. Submit for review. Reviews take from a few days to a few weeks; extensions with broad optional host permissions often take longer.

## 5. Website and privacy policy (GitHub Pages)

Repo **Settings → Pages → Deploy from a branch → `main` / `/docs`**. The site is `https://hduy-dev.github.io/fetchwing/`, with the policy at `privacy.html`.

## Store listing text

Name (`manifest.json` `name`): **Fetchwing**

Short description (`manifest.json` `description`, max 132 characters):

> API client in DevTools: paste cURL, send requests, organise collections, and mock responses for web pages.

Detailed description:

> Fetchwing is a lightweight API client that lives in Chrome DevTools. Grab a request from the Network tab, send it again, tweak it, and make your web page get the response you want while the real API is unfinished or misbehaving.
>
> SEND REQUESTS
> • Network tab → right-click → Copy as cURL, then one click on Paste cURL
> • Import a file holding many cURL commands at once
> • Edit method, URL, query parameters, headers and body; cookies from cURL are sent too
> • Status, time, size and headers, plus a JSON viewer you can fold
> • Collections, folders, open tabs and quick search (Ctrl/⌘+K)
> • Environments with {{variables}}; secret values stay on your computer
>
> MOCK RESPONSES
> • Turn on a mock and pages calling the same method and URL get your status, headers, body and delay
> • Matches the full URL including the query, in any order
> • Works for fetch and XMLHttpRequest, and keeps working with DevTools closed
> • Start from a real response with one click, then edit it
> • The toolbar badge shows how many mocks are on; pause them all in one click
>
> SYNC (OPTIONAL)
> • Sign in to keep your workspace in one file in your own Google Drive and use it on other computers
> • Only asks for your email and access to the file it creates (drive.file)
>
> PRIVATE BY DESIGN
> • Asks for access to a site only when you first send to it or mock it
> • No servers, no analytics, no ads; nothing is sent to the developer
> • Free and open source (MIT): https://github.com/HDuy-Dev/fetchwing
>
> Not affiliated with Google. Google Drive is a trademark of Google LLC.

## Icons and store images

- `assets/icons/icon.svg` is the source. `npm run images` renders `assets/icons/icon-{16,32,48,128}.png` and `docs/store/promo-small.png` (from `docs/store/src/promo-small.html`) with Google Chrome. Override the path with `CHROME=...`.
- Screenshots are taken from the real panel with sample data at 1280×800:
  1. a request with a JSON response (dark);
  2. the mock pane with a mock on (dark);
  3. the Mocks section;
  4. the light theme.

  They are saved to `docs/store/screenshot-<n>.png`.
- After changing the icon, copy `assets/icons/icon-128.png` to `docs/icon-128.png` for the website.
