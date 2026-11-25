# Mock Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bấm icon extension là mở popup để bật/tắt mock.

**Architecture:** Logic hiển thị và cấp quyền là hàm thuần trong `src/lib/`. Popup (`src/popup/`) chỉ đọc bằng `getWorkspace`, ghi bằng message `mutate` / `addMockSite`; background không đổi. `grant.html` nhận thêm tham số để làm nốt việc sau khi được cấp quyền.

**Tech Stack:** Chrome MV3, ES module thuần, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-mock-popup-design.md` (hình mẫu: `mockup/popup.html`, markup và CSS lấy từ đây)

## Global Constraints

- Không thêm thư viện, không bước build mới.
- Chữ trên giao diện bằng tiếng Anh, copy đúng như spec và mockup.
- Rộng 360px; danh sách cao tối đa 440px rồi cuộn; sáng/tối theo `prefers-color-scheme`.
- Màu từ `panel.css`; riêng `--warn` bản sáng `#8a5300`, nút tròn công tắc đang bật ở bản tối `#0f1520`, URL dùng `--muted`.
- Background là nơi duy nhất ghi dữ liệu. Popup không gọi `chrome.permissions.request`.
- Quyền mới duy nhất: `activeTab`.
- Làm trên nhánh `feat/mock-popup` tách từ `main`. Spec, plan, `mockup/popup.html` vào commit đầu tiên.

## Review Focus

1. Origin còn trong `mockSites` nhưng quyền đã bị gỡ trong Settings: phải đi lại luồng cấp quyền, không được báo "Active on this site". (Task 1)
2. Tab `chrome://`, trang trống hoặc không đọc được URL: bật mock bình thường, không banner, không mở cửa sổ cấp quyền. (Task 1)
3. Tên mock hoặc URL chứa HTML (`<img onerror=…>`): hiện nguyên chữ; chỉ dùng `textContent`/`el()`. (Task 3)
4. Cấp quyền xong nhưng bật mock bị từ chối vì trùng: cửa sổ grant hiện lỗi và không tự đóng. (Task 2)
5. Background không trả lời hoặc trả lỗi: công tắc về trạng thái cũ, được mở khóa, lỗi hiện dưới dòng. (Task 3)

---

### Task 1: Logic của popup

**Files:**
- Create: `src/lib/popup-model.js`
- Test: `tests/popup-model.test.js`

**Interfaces:**
- Consumes: `liveRequests`, `deriveActiveMocks`, `envVars`, `resolveVars`.
- Produces:
  - `popupView(ws, { mockSites: string[], tabOrigin: string|null, hasAccess: boolean })` → `{ rows: Array<{id, method, name, url, status, enabled, missing: string[]}>, liveCount, idleCount, envName, siteActive: boolean, showBanner: boolean }`
  - `siteStep({ origin: string|null, mockSites: string[], hasAccess: boolean })` → `'none' | 'add' | 'grant'`

- [ ] **Step 1: Viết test fail.** Dựng workspace như helper trong `tests/mocks.test.js`: `a` có mock đã cấu hình (URL `{{base}}/api/users`, base `http://localhost:3000`), `c` URL `{{nope}}/x`, `d` mock mặc định.

```js
test('lists mocks that are on or configured, in stable order', () => {
  // a configured but off; c switched on; d untouched
  assert.deepEqual(view().rows.map(r => r.id), ['a', 'c']);
  // enabling a does not reorder
});
test('url is resolved without scheme; unresolved keeps raw url and lists missing', () => {
  assert.equal(row('a').url, 'localhost:3000/api/users');
  assert.deepEqual(row('c').missing, ['nope']);
  assert.equal(row('c').url, '{{nope}}/x');
});
test('counts match the badge', () => {
  // a on, c on
  assert.equal(v.liveCount, deriveActiveMocks(ws).length); // 1
  assert.equal(v.idleCount, 1);
  assert.equal(v.envName, 'Local');
});
test('banner and active site', () => {
  const o = 'http://shop.local:5173';
  // live mock, origin not in sites -> showBanner true, siteActive false
  // in sites + hasAccess -> showBanner false, siteActive true
  // in sites, hasAccess false -> showBanner true, siteActive false
  // no live mock -> showBanner false
  // tabOrigin null or 'chrome://extensions' -> both false
});
test('siteStep', () => {
  const o = 'http://a.test';
  assert.equal(siteStep({ origin: null, mockSites: [], hasAccess: false }), 'none');
  assert.equal(siteStep({ origin: 'null', mockSites: [], hasAccess: false }), 'none');
  assert.equal(siteStep({ origin: 'chrome://newtab', mockSites: [], hasAccess: false }), 'none');
  assert.equal(siteStep({ origin: o, mockSites: [o], hasAccess: true }), 'none');
  assert.equal(siteStep({ origin: o, mockSites: [], hasAccess: true }), 'add');
  assert.equal(siteStep({ origin: o, mockSites: [o], hasAccess: false }), 'grant');
});
```

Phần comment trong hai test trên được viết thành assert với đúng giá trị đã ghi.

- [ ] **Step 2:** `npm test` → FAIL (không tìm thấy module).
- [ ] **Step 3:** Cài đặt hai hàm. Điều kiện liệt kê giống `panel.js`: `mock.enabled || mock.body || mock.headers.length`. `liveCount = deriveActiveMocks(ws).length`; `idleCount` là số dòng đang bật trừ `liveCount`. `envName` là `'No environment'` khi không có env đang chọn.
- [ ] **Step 4:** `npm test` → PASS toàn bộ.
- [ ] **Step 5:** Commit `feat: add popup view logic`.

### Task 2: Cấp quyền rồi làm nốt

**Files:**
- Create: `src/lib/grant-follow-up.js`
- Modify: `src/grant/grant.js`, `src/grant/grant.html`
- Test: `tests/grant-follow-up.test.js`

**Interfaces:**
- Produces:
  - `grantPath(origin: string, mockId?: string|null)` → `'src/grant/grant.html?origin=…&site=1[&mock=…]'` (qua `URLSearchParams`)
  - `completeGrant({ send, origin, mockId })` → `Promise<string|null>` (thông báo lỗi hoặc null)

- [ ] **Step 1: Viết test fail.**

```js
test('adds the site, then turns the mock on', async () => {
  // fake send records messages, returns {ok:true}
  assert.deepEqual(sent, [
    { type: 'addMockSite', origin: 'http://a.test' },
    { type: 'mutate', mutation: { type: 'setMockEnabled', id: 'm1', enabled: true } },
  ]);
  assert.equal(result, null);
});
test('without a mock only adds the site', ...); // sent.length === 1
test('returns the duplicate error', ...); // mutate -> {ok:false,error:'Another mock for this request is already on: X'} => result is that string
test('stops when the site cannot be added', ...); // addMockSite {ok:false,error:'Invalid site'} => 'Invalid site', sent.length === 1
test('reports a missing reply', ...); // send resolves undefined or rejects => 'Could not reach Fetchwing.'
test('grantPath', () => {
  assert.equal(grantPath('http://a.test:3000', 'm1'), 'src/grant/grant.html?origin=http%3A%2F%2Fa.test%3A3000&site=1&mock=m1');
});
```

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Cài đặt. Trong `grant.js`: có `site=1` và được cấp quyền thì gọi `completeGrant`. Lỗi: hiện lỗi, cửa sổ ở lại. Thành công: "Done. Mocks now run on this site." rồi đóng sau 1200ms. Không có `site=1` (panel gọi): giữ nguyên chữ và hành vi cũ.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: finish turning a mock on after access is granted`.

### Task 3: Popup

**Files:**
- Create: `src/popup/popup.html`, `src/popup/popup.css`, `src/popup/popup.js`
- Modify: `manifest.json` (`action.default_popup: "src/popup/popup.html"`, thêm `"activeTab"`), `docs/COMPLIANCE.md`, `README.md`

**Interfaces:**
- Consumes: Task 1, Task 2, `el` và `icon` từ `src/panel/ui.js`.

- [ ] **Step 1:** Viết popup theo mockup và các mục "Giao diện", "Accessibility", "Hành vi" của spec.
  - Origin tab: `chrome.tabs.query({ active: true, currentWindow: true })`. Quyền: `chrome.permissions.contains({ origins: [`${origin}/*`] })`.
  - Mở grant: `chrome.windows.create({ url: chrome.runtime.getURL(grantPath(origin, id)), type: 'popup', width: 440, height: 260 })`. Với `'grant'`, mock chưa bật; công tắc về tắt; hiện "Allow access in the window that opened."
  - `'add'`: gửi `addMockSite` rồi `setMockEnabled`. "Enable here" dùng cùng bước, không có mock id.
  - Giữ dòng trong `Map` theo id và cập nhật tại chỗ. Vẽ lại khi `storage.onChanged` có `workspace` hoặc `mockSites`.
  - Lỗi của "Pause all" và "Enable here" hiện ở vùng `role="alert"` dưới header.
- [ ] **Step 2:** Thêm vào bảng quyền trong `docs/COMPLIANCE.md`: `| \`activeTab\` | When the user clicks the toolbar icon, reads the current tab's address so a mock can be turned on for that site. |`. README thêm một câu về popup.
- [ ] **Step 3:** Chạy popup với `chrome` giả (harness trong scratchpad, không commit). Kiểm bằng ảnh và DOM: 5 trạng thái của mockup ở sáng và tối; tên `<img src=x onerror=alert(1)>` hiện nguyên chữ; `send` bị reject thì công tắc về cũ, không còn `disabled`, lỗi hiện dưới dòng; focus giữ nguyên sau khi `onChanged` bắn; đo lại ba tỉ lệ tương phản đã đổi.
- [ ] **Step 4:** `npm test` và `npm run build` → PASS; zip có `src/popup/popup.html`.
- [ ] **Step 5:** Commit `feat: add a toolbar popup to toggle mocks`.

## Kiểm trên Chrome thật (người dùng làm)

Load unpacked, rồi: bấm icon thấy popup; bật mock trên site mới, cấp quyền, mock chạy ngay không cần bật lại; "Enable here"; dùng Tab và Space.

### Task 4: Ô tìm kiếm

**Files:** Modify `src/lib/popup-model.js`, `src/popup/popup.{html,css,js}`; Test `tests/popup-model.test.js`

**Interfaces:**
- `popupView` rows thêm `path: string` (tên collection/folder chứa request, nối bằng " / ").
- `filterRows(rows, query: string)` → rows khớp (giữ thứ tự). Query rỗng/khoảng trắng → nguyên danh sách.
- `matchRanges(text: string, query: string)` → `Array<[start, end]>` đã sắp xếp và gộp chồng lấn, không phân biệt hoa thường.

- [ ] **Step 1: Test fail:** `path` = `'My Collection / Folder'` cho request trong folder; `filterRows` khớp theo tên, URL, method, path, nhiều từ là AND, hoa thường như nhau, query `'  '` trả nguyên; `matchRanges('Order orders', 'order')` → `[[0,5],[6,11]]`, `matchRanges('abc', 'b c')` → `[[1,2],[2,3]]` gộp thành `[[1,3]]`, query rỗng → `[]`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Cài đặt.
- [ ] **Step 4:** `npm test` → PASS. Commit `feat: filter logic for popup search`.
- [ ] **Step 5:** Popup theo spec "Ô tìm kiếm" và mockup. Lọc bằng `hidden` trên dòng có sẵn (giữ focus/scroll). Tô sáng chỉ dựng bằng text node và `<mark>`, không `innerHTML`.
- [ ] **Step 6:** Chromium với extension thật: focus khi mở; gõ lọc đúng; tên `<img onerror>` vẫn là chữ khi tô sáng; Esc xóa chữ không đóng; × đưa focus về ô; không khớp hiện nút Clear; bật/tắt dòng đang lọc vẫn chạy; footer đếm đúng; ảnh sáng/tối. `npm test`, `npm run build` PASS. Commit `feat: add a search box to the popup`.

Review Focus thêm: từ khóa có ký tự regex (`(`, `.*`, `[`) không làm lỗi; dữ liệu đổi qua `storage.onChanged` khi đang tìm thì danh sách vẫn được lọc theo từ khóa hiện tại.
