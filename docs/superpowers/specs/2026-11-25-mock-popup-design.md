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
- Rộng 480px, cao tối đa 600px (giới hạn của Chrome); danh sách cao tối đa 470px rồi cuộn, tự co lại khi có banner hoặc lỗi. Chữ tiếng Anh. Màu lấy từ `panel.css`, sáng/tối theo `prefers-color-scheme`.
- Header: logo, "Fetchwing", "N on" (chỉ đếm mock đang chạy thật, khớp số trên badge), thêm "· K not running" nếu có mock đang bật mà không chạy được. "Pause all" mờ khi không có mock nào bật.
- Banner: khi có mock đang chạy, tab hiện tại là http/https và chưa nằm trong `mockSites`: "Mocks are not running on <site>" + nút "Enable here".
- Mỗi dòng: method, tên, URL rút gọn, status code của mock (từ 400 trở lên viền và chữ màu lỗi), công tắc. Bấm cả dòng là đổi công tắc. Cách rút gọn ở mục "Dòng rút gọn".
- URL còn biến chưa có giá trị: "Not running · Unresolved variable: x" màu cảnh báo.
- Lỗi hiện ngay dưới dòng, `role="alert"`; công tắc trả về trạng thái cũ. Lỗi mất khi người dùng thao tác lần kế.
- Footer: "Env <tên>", thêm "Active on this site ·" phía trước khi tab hiện tại đã được bật mock.
- Rỗng (chưa có request nào): "No requests yet" kèm hướng dẫn mở DevTools → Fetchwing và dán cURL.

## Accessibility
- Tương phản chữ ≥ 4.5:1 kể cả khi hover; công tắc ≥ 3:1. Vì vậy URL dùng `--muted`, màu cảnh báo bản sáng là `#8a5300`, nút tròn của công tắc đang bật ở bản tối là `#0f1520`.
- Nhãn công tắc gồm method, tên, URL, status; có cả cảnh báo "not running" nếu có.
- Dùng được bằng bàn phím (Tab, Space), có viền focus.
- Khi dữ liệu đổi, cập nhật tại chỗ theo id, không dựng lại cả danh sách, để không mất focus và vị trí cuộn.
- Trong lúc chờ background trả lời, công tắc đó bị khóa. Trước khi có dữ liệu không hiện màn hình rỗng.

## Hành vi
- Danh sách gồm mọi request trong workspace, theo thứ tự cây collection/folder, mock đang bật hay tắt đều hiện. Thứ tự không đổi khi bật/tắt.
- Popup chỉ đọc qua message `getWorkspace` và ghi qua `mutate` (`setMockEnabled`, `disableAllMocks`). Background vẫn là nơi duy nhất ghi dữ liệu. Popup vẽ lại khi `chrome.storage.onChanged` báo thay đổi.
- Công tắc chỉ bật/tắt mock, có hiệu lực ngay, không phụ thuộc site đang mở. (Sửa sau khi thử: bản đầu mở cửa sổ cấp quyền ngay khi bật, popup đóng theo và công tắc vẫn tắt, người dùng tưởng không có gì xảy ra.)
- Quyền cho site đang mở do banner lo. "Enable here" lấy origin của tab:
  - Origin đã có quyền nhưng chưa có trong `mockSites`: gửi `addMockSite`.
  - Chưa có quyền: mở `grant.html` (tham số `site=1`). Sau khi được cấp quyền, `grant.html` tự gửi `addMockSite` rồi báo kết quả hoặc lỗi. Panel gọi `grant.html` không có tham số thì giữ hành vi cũ. Popup không tự gọi `chrome.permissions.request` vì hộp thoại có thể làm popup đóng.

## Ràng buộc
- MV3, không thêm thư viện, không bước build mới (`scripts/build.sh` đã copy cả `src/`).
- Thêm quyền `activeTab` để đọc URL tab đang mở; bổ sung lý do vào `docs/COMPLIANCE.md`.
- Logic lọc danh sách và quyết định cấp quyền tách thành hàm thuần trong `src/lib/`, có test `node --test`.

## Để người làm tự quyết
Tên file và hàm, cách chia module trong `src/popup/`.

## Ô tìm kiếm (bổ sung 2026-11-25)
Mockup: [mockup/popup-search.html](../../../mockup/popup-search.html)
- Nằm dưới header, luôn hiện khi có request, có focus khi mở popup. Placeholder "Search requests", nhãn `aria-label` cùng chữ.
- Lọc ngay khi gõ, không phân biệt hoa thường. Tách theo khoảng trắng; mọi từ phải xuất hiện trong method, tên, URL (như đang hiện) hoặc đường dẫn collection/folder.
- Phần khớp được tô sáng (`<mark>`) trong tên, URL, đường dẫn. Đường dẫn folder chỉ hiện khi đang tìm.
- Số "N on" và "Pause all" vẫn tính trên toàn bộ request.
- Footer khi đang tìm: "K of M requests · Env …", được đọc cho screen reader (`aria-live="polite"`).
- Không khớp: "No requests match “q”", dòng "Search looks in names, URLs, methods and folders." và nút "Clear search".
- Nút × xóa từ khóa và đưa focus về ô. Esc khi ô có chữ thì xóa chữ, không đóng popup; khi ô trống thì đóng như bình thường.
- Không nhớ từ khóa giữa các lần mở.

## Dòng rút gọn (bổ sung 2026-11-25)
Mockup: [mockup/popup-compact.html](../../../mockup/popup-compact.html)

### Cách làm
- **Đã chọn (A):** hai dòng, tên và path.
- Loại: một dòng chỉ có tên (thấy thêm 2 dòng nhưng hai request trùng tên khác host trông giống hệt nhau).

### Hành vi
- Dòng phụ là phần sau host (path, query, fragment); URL chỉ có host thì là "/".
- Giữ host khi một request khác cùng method, cùng path nhưng khác host (so host không phân biệt hoa thường).
- Khi tìm: vẫn lọc trên URL đầy đủ. Dòng nào có từ khóa nằm trong URL đầy đủ mà không nằm trong URL rút gọn thì hiện URL đầy đủ.
- Tên và URL nằm trên một dòng, dài quá thì cắt bằng "…". Rê chuột thấy tên và URL đầy đủ. Dòng "Not running · …" không bị cắt.
- Nhãn `aria-label` giữ URL đầy đủ.

## Mở mock từ popup (bổ sung 2026-11-25)
Mockup: [mockup/popup-edit.html](../../../mockup/popup-edit.html)

Mục đích: từ popup mở đúng mock để sửa nhanh. Điều này thay cho "không sửa nội dung mock trong popup": popup vẫn không sửa, chỉ mở trình sửa.

### Cách làm
- **Đã chọn:** cửa sổ riêng chạy `panel.html`. Dùng được mà không cần mở DevTools, một cú bấm.
- Loại: chọn mock trong panel DevTools đang mở. Chrome không cho extension tự mở DevTools hay chuyển tab trong DevTools, nên bấm trên popup có thể không thấy gì xảy ra.

### Hành vi
- Mỗi dòng có nút bút chì (28px) trước status, luôn hiện, `title` "Edit mock", `aria-label` "Edit mock: METHOD tên, url". Bấm nút chỉ mở trình sửa. Bấm chỗ khác trên dòng vẫn bật/tắt như cũ.
- Cửa sổ loại popup 1000×700, chọn sẵn request ở tab Mock, sidebar ở Collections với thư mục chứa nó được mở. Popup đóng sau khi mở.
- Chỉ có một cửa sổ sửa: nếu đã mở thì đưa lên trước và chuyển sang request mới, đóng hộp thoại đang mở trong đó. Báo qua `chrome.storage.session`; panel DevTools bỏ qua tín hiệu này.
- Cửa sổ nhận id tab web mở popup để biết site đang xem, và đọc lại origin khi nhận focus. Tab không phải http/https thì giữ tab cũ.
- Chrome chỉ cho cửa sổ đọc địa chỉ tab nhờ quyền tạm lúc mở popup (hoặc site đã cấp quyền). Khi không đọc được (tab đã sang site khác, đã đóng, không phải web) mà người dùng bật mock trong cửa sổ, hiện thông báo rằng không biết site nào và chỉ cách bấm "Enable here" trên popup. DevTools panel không đổi.
- Không mở được: lỗi hiện dưới dòng, "Could not open the editor window."
- Không xin thêm quyền.
- Chấp nhận: cửa sổ và panel DevTools lưu chung danh sách tab request đang mở (localStorage), bên thao tác sau cùng thắng ở lần mở lại.
