# Compliance checklist

What was checked before publishing, and how each point is met. This is a practical checklist, not legal advice.

## Intellectual property

| Item | How it is met |
| --- | --- |
| Original code | All code in `src/` was written for this project (see `git log`). No code was copied from other API clients or extensions. |
| Original visuals | The icon (`assets/icons/icon.svg`), the teal palette and the panel layout were designed for this project. Store images show the extension itself with made-up sample requests. |
| No Postman look-alike | The name, logo, colours, wording and Store text do not use Postman's name or brand. Familiar API-client ideas (collections, environments, tabs) are generic and not anyone's trade dress. The Store text never says "Postman clone" or "Postman alternative". |
| Third-party code | None. No npm dependencies, no bundled libraries or fonts (system font stack). |
| Licence | MIT (`LICENSE`). |
| Name | "Fetchwing": no product with this name was found in a web search on 2026-10-29. A formal trademark search is recommended if the product becomes commercial. |

## Google branding and trademarks

| Item | How it is met |
| --- | --- |
| No "Sign in with Google" button | The panel's menu item reads "Sync with Google Drive" (a description of where data goes), so the Sign in with Google button branding rules do not apply. Google's own account chooser handles the sign-in. |
| No Google marks in our brand | The extension name, icon and Store images contain no Google name or logo. |
| Descriptive use only | "Google Drive" only describes where synced data is stored. The privacy policy and Store listing say "Not affiliated with Google. Google Drive is a trademark of Google LLC." |

## Google API Services User Data Policy

| Item | How it is met |
| --- | --- |
| Minimum scopes | `openid`, `email`, `drive.file` only. `drive.file` limits access to the one file the app created. |
| Limited Use disclosure | In `docs/privacy.html` ("Google API Services User Data Policy" section). |
| No transfer / no ads / no human reading | No developer servers or analytics. Data goes only between the browser and Google. |
| No client secret | Implicit OAuth flow via `chrome.identity.launchWebAuthFlow`; only the public client ID ships in `src/config.js`. |
| Secrets | Variables marked secret are uploaded with empty values. |

## Chrome Web Store Program Policies

**Single purpose:** An API client inside Chrome DevTools: send HTTP requests built from cURL commands, keep them in collections, and mock the responses web pages receive. Sync to the user's own Google Drive is optional.

Permission justifications (paste into the Privacy practices tab):

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's collections, requests, mocks, environments and settings locally so they work offline and survive restarts. |
| `scripting` | Adds the mock script to the sites the user chose, so those pages' fetch and XMLHttpRequest calls receive the user's mock responses. |
| `declarativeNetRequestWithHostAccess` | Sets the Cookie header from the user's cURL command on that one request while it is sent (a temporary session rule, removed right after). |
| `clipboardRead` | The "Paste cURL" button reads the cURL command the user just copied from the Network tab. |
| `identity` | Lets the user sign in with Google to sync their workspace to their own Google Drive. |
| `alarms` | Runs a sync every 5 minutes while signed in, so edits from another computer arrive. |
| Optional host `http://*/*`, `https://*/*` | Requested one site at a time, only when the user sends a request to that site or turns a mock on for it. Never requested at install. |
| Host `www.googleapis.com` | Google Drive API: find, create, read and write the user's "Fetchwing data" file. |
| Host `openidconnect.googleapis.com` | Read the signed-in account's email address to display it. |
| Host `oauth2.googleapis.com` | Revoke the Google token when the user signs out. |

Remote code: none. All JavaScript ships in the package.

Data disclosure (Privacy practices tab): **Personally identifiable information** (email address) and **Website content** (the requests and mock responses the user creates). They are stored only in the user's browser and the user's own Google Drive, never sent to the developer, never sold, and used only for the single purpose. Tick the three Limited Use certifications.

## Before each release

- [ ] `npm test` passes.
- [ ] `src/config.js` has the real `GOOGLE_CLIENT_ID` (`npm run build` warns when it is empty).
- [ ] The upload zip was built with `npm run build` (drops the manifest `"key"`).
- [ ] The privacy policy URL is public and matches the OAuth consent screen.
- [ ] `manifest.json` version was bumped.
