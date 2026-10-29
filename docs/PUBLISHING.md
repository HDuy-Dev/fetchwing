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
   - Screenshots, uploaded in this order: `docs/store/screenshot-1.png` … `screenshot-5.png` (1280×800).
   - Small promo tile: `docs/store/promo-small.png` (440×280).
   - Category: Developer Tools. Language: English.
   - Privacy practices tab: paste the single purpose, permission justifications and data disclosure from `docs/COMPLIANCE.md`.
   - Privacy policy URL: `https://hduy-dev.github.io/fetchwing/privacy.html`.
5. Submit for review. Reviews take from a few days to a few weeks; extensions with broad optional host permissions often take longer.

## 5. Website and privacy policy (GitHub Pages)

Repo **Settings → Pages → Deploy from a branch → `main` / `/docs`**. The site is `https://hduy-dev.github.io/fetchwing/`, with the policy at `privacy.html`.

## Store listing text

Name (`manifest.json` `name`, max 75 characters): **Fetchwing – API Client & Mock Server for DevTools** (49). The brand comes first, then the words people search for. `short_name` stays "Fetchwing", and the DevTools tab is still called Fetchwing.

Short description (`manifest.json` `description`, max 132 characters, 121 used):

> REST API client for DevTools: paste cURL, send HTTP requests, organize collections, and mock API responses on live pages.

Detailed description (keep "mock" at 6 mentions or fewer; the spam policy flags repeated keywords):

> Fetchwing is a lightweight REST API client that lives in Chrome DevTools, with built-in API mocking. Copy a request as cURL from the Network tab, paste it, send it, tweak it, and make your page get the JSON response you want while the real API is unfinished or misbehaving.
>
> SEND HTTP REQUESTS
> • Network tab → right-click → Copy as cURL, then one click on Paste cURL
> • Import a file holding many cURL commands at once
> • Edit method, URL, query parameters, headers and body; cookies from cURL are sent too
> • Status, time, size and headers, plus a JSON viewer you can fold
> • Collections, folders, open tabs and quick search (Ctrl/⌘+K)
> • Environments with {{variables}}; secret values stay on your computer
>
> MOCK API RESPONSES
> • Turn one on and pages calling the same method and URL get your status, headers, body and delay
> • Matches the full URL including the query, in any order
> • Works for fetch and XMLHttpRequest, and keeps working with DevTools closed
> • Start from a real response with one click, then edit it
> • The toolbar badge counts active ones; pause them all in one click
>
> SYNC (OPTIONAL)
> • Sign in to keep your workspace in one file in your own Google Drive and use it on other computers
> • Only asks for your email and access to the file it creates (drive.file)
>
> PRIVATE BY DESIGN
> • Asks for access to a site only when you first send to it or use it for a mock
> • No servers, no analytics, no ads; nothing is sent to the developer
> • Free and open source (MIT): https://github.com/HDuy-Dev/fetchwing
>
> Not affiliated with Google. Google Drive is a trademark of Google LLC.

## Icons and store images

- `assets/icons/icon.svg` is the source. `npm run images` renders `assets/icons/icon-{16,32,48,128}.png` and `docs/store/promo-small.png` (from `docs/store/src/promo-small.html`) with Google Chrome. Override the path with `CHROME=...`.
- Screenshots show the real panel with sample data, captured at 2× and placed in a 1280×800 frame: a headline, a subline and the panel in a rounded, shadowed box. The headlines, in order:
  1. "Paste cURL, hit Send", with a "Copied as cURL" card;
  2. "Organize every request", with ⌘K search open;
  3. "Mock any API response", in the side-by-side layout;
  4. "Mocks keep working with DevTools closed", with the Mocks list, the Pause all menu, and a small browser card showing the badge;
  5. "Synced to your own Google Drive", in the light theme with the sync menu open and a card for the "Fetchwing data" file (text only, no Google logo).

  They are saved to `docs/store/screenshot-<n>.png`.
- After changing the icon, copy `assets/icons/icon-128.png` to `docs/icon-128.png` for the website.
