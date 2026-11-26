# Environments Dialog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Thực hiện ngay trong phiên (người dùng đã bảo "làm đi").

**Goal:** Dựng lại dialog Environments theo spec.
**Architecture:** Logic thuần nằm ở `src/lib/env-form.js` (có test), DOM ở `src/panel/env-editor.js`, style ở `panel.css`. Không đổi mutation.
**Tech Stack:** JS thuần, `node --test`.
**Spec:** `docs/superpowers/specs/2026-11-26-environments-dialog-design.md`

## Global Constraints
- Chữ trên UI bằng tiếng Anh, đúng nguyên văn trong spec. Chỉ dùng token màu sẵn có.
- Giữ nguyên phần sửa chưa commit (bỏ mock chip). Không commit khi chưa được yêu cầu.
- Dialog nằm ngoài `.app` nên bề rộng hẹp dùng `@media (max-width: 560px)`.

## Review Focus
- Gõ rồi đổi môi trường, nhân bản trong vòng 300ms: giá trị vẫn còn.
- Gõ tên rồi bấm Esc ngay: tên vẫn được lưu.
- Xoá môi trường khi còn lệnh lưu đang chờ: không hiện toast lỗi.
- Tên chỉ có khoảng trắng: coi như trống.
- Gõ ở dòng trống: con trỏ ở nguyên ô đang gõ.

### Task 1: Logic thuần
**Files:** Create `src/lib/env-form.js`, `tests/env-form.test.js`
**Produces:** `copyName(name): string`, `savableVars(vars): Var[]`, `hintName(vars): string`, `envPatch(name, vars): {vars, name?}`
- [ ] Viết test: `copyName('Local') === 'Local copy'`; `savableVars` bỏ dòng rỗng cả key lẫn value, giữ dòng chỉ có một trong hai; `hintName([]) === 'baseUrl'`, bỏ qua key trống; `envPatch('  ', vars)` không có `name`.
- [ ] `npm test`: FAIL (thiếu module). Viết module. `npm test`: PASS.

### Task 2: Dialog
**Files:** Modify `src/panel/env-editor.js`, `src/panel/ui.js` (icon `lock`, `unlock`, `check`), `src/panel/panel.css`
**Consumes:** Task 1. `openEnvironments(state, { envId?, addVar? })` giữ nguyên chữ ký.
- [ ] Lưu: một debounce cho cả tên và biến (`envPatch`), lưu theo `input`. `flush()` đợi lệnh đang chạy, gọi trước khi đổi, tạo, nhân bản, kích hoạt. Xoá thì `cancel()` rồi đợi.
- [ ] Dựng khung, cột trái, đầu cột phải, bảng biến với dòng trống, xác nhận xoá, trạng thái rỗng, gợi ý, focus.
- [ ] CSS: class `env-*`, bỏ style inline, thêm `@media` cho bề rộng hẹp.
- [ ] Kiểm tra trên trình duyệt bằng trang giả lập `chrome.*` trong scratchpad (dùng `applyMutation` thật): từng hành vi trong spec, Review Focus, dark, light, hẹp.
- [ ] `npm test` PASS, rà lại diff.
