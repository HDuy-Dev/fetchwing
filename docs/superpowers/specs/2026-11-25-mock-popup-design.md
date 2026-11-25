# Popup bật/tắt nhanh mock

Mockup: [mockup/popup.html](../../../mockup/popup.html)

## Mục đích
Bấm icon extension là bật/tắt được mock, không phải mở DevTools.

## Mục tiêu / không làm
- Làm: liệt kê mock, bật/tắt từng mock, "Pause all".
- Không làm: sửa nội dung mock, tạo mock, đổi environment, đăng nhập Drive trong popup.

## Cách làm
- **Đã chọn:** popup chuẩn của Chrome (`action.default_popup`).
- Loại: menu chuột phải (không có công tắc), side panel (không phải popup).

## Giao diện
- Rộng 360px, danh sách cao tối đa 440px rồi cuộn. Chữ tiếng Anh. Màu lấy từ `panel.css`, sáng/tối theo `prefers-color-scheme`.
- Header: logo, "Fetchwing", "N on" (chỉ đếm mock đang chạy thật, khớp số trên badge), thêm "· K not running" nếu có mock đang bật mà không chạy được. "Pause all" mờ khi không có mock nào bật.
- Banner: khi có mock đang chạy, tab hiện tại là http/https và chưa nằm trong `mockSites`: "Mocks are not running on <site>" + nút "Enable here".
- Mỗi dòng: method, tên, URL (đã thay biến, bỏ `https://`), status code của mock (từ 400 trở lên viền và chữ màu lỗi), công tắc. Bấm cả dòng là đổi công tắc. Tên và URL xuống dòng, không cắt: phần cuối URL thường là chỗ phân biệt hai request.
- URL còn biến chưa có giá trị: "Not running · Unresolved variable: x" màu cảnh báo.
- Lỗi hiện ngay dưới dòng, `role="alert"`; công tắc trả về trạng thái cũ. Lỗi mất khi người dùng thao tác lần kế.
- Footer: "Env <tên>", thêm "Active on this site ·" phía trước khi tab hiện tại đã được bật mock.
- Rỗng: "No mocks yet" kèm hướng dẫn mở DevTools → Fetchwing.

## Accessibility
- Tương phản chữ ≥ 4.5:1 kể cả khi hover; công tắc ≥ 3:1. Vì vậy URL dùng `--muted`, màu cảnh báo bản sáng là `#8a5300`, nút tròn của công tắc đang bật ở bản tối là `#0f1520`.
- Nhãn công tắc gồm method, tên, URL, status; có cả cảnh báo "not running" nếu có.
- Dùng được bằng bàn phím (Tab, Space), có viền focus.
- Khi dữ liệu đổi, cập nhật tại chỗ theo id, không dựng lại cả danh sách, để không mất focus và vị trí cuộn.
- Trong lúc chờ background trả lời, công tắc đó bị khóa. Trước khi có dữ liệu không hiện màn hình rỗng.

## Hành vi
- Danh sách dùng cùng điều kiện với mục Mocks của panel: đang bật, hoặc có body/headers. Thứ tự không đổi khi bật/tắt.
- Popup chỉ đọc qua message `getWorkspace` và ghi qua `mutate` (`setMockEnabled`, `disableAllMocks`). Background vẫn là nơi duy nhất ghi dữ liệu. Popup vẽ lại khi `chrome.storage.onChanged` báo thay đổi.
- Khi bật mock: lấy origin của tab đang mở.
  - Tab không phải http/https: chỉ bật mock.
  - Origin đã có trong `mockSites`: chỉ bật mock.
  - Origin đã có quyền nhưng chưa có trong `mockSites`: gửi `addMockSite` rồi bật.
  - Chưa có quyền: mở `grant.html` kèm tham số cho biết việc cần làm tiếp (id mock nếu có). Cửa sổ mới lấy focus nên popup nhiều khả năng đóng ngay, vì vậy không dựa vào thông báo trong popup. Sau khi được cấp quyền, `grant.html` tự gửi `addMockSite`, bật mock (nếu có id), rồi báo kết quả hoặc lỗi. Người dùng không phải bật lại. Panel gọi `grant.html` không có tham số thì giữ hành vi cũ. Popup không tự gọi `chrome.permissions.request` vì hộp thoại có thể làm popup đóng.
- "Enable here" đi cùng các bước trên, chỉ khác là không bật thêm mock nào.

## Ràng buộc
- MV3, không thêm thư viện, không bước build mới (`scripts/build.sh` đã copy cả `src/`).
- Thêm quyền `activeTab` để đọc URL tab đang mở; bổ sung lý do vào `docs/COMPLIANCE.md`.
- Logic lọc danh sách và quyết định cấp quyền tách thành hàm thuần trong `src/lib/`, có test `node --test`.

## Để người làm tự quyết
Tên file và hàm, cách chia module trong `src/popup/`.
