# Thiết kế lại dialog Environments

## Mục đích
Dialog hiện tại khó hiểu: chưa có biến thì chỉ còn một dấu `+` không nhãn, "Use as {{name}}" và nút "Use" không rõ nghĩa, nút xoá xoá ngay, tên trống bị bỏ qua im lặng.

## Mục tiêu / không làm
- Làm: bố cục mới, bảng biến, kích hoạt, nhân bản, xoá có xác nhận, báo lỗi tên.
- Không làm: đổi mô hình dữ liệu hay đồng bộ, tìm kiếm biến, kéo đổi thứ tự, import/export, sửa sidebar và env pill.
- Không được xảy ra: mất giá trị đang gõ (đổi môi trường hoặc đóng dialog ngay sau khi gõ), giá trị secret bị đồng bộ đi.

## Cách làm
- **Đã chọn (A):** hai cột, bên trái là danh sách, bên phải là bảng biến. Thấy cùng lúc mọi môi trường, ít phải sửa.
- Loại (B): một cột với dropdown. Gọn hơn ở panel hẹp nhưng không thấy hết môi trường, thêm một bước.
- Loại (C): mở thành tab chính. Rộng nhất nhưng phải sửa hệ thống tab.

## Thiết kế
**Khung.** Tiêu đề "Environments" và nút đóng (✕). Chân dialog: "Saved automatically" bên trái, "Done" bên phải. Esc và bấm ra ngoài vẫn đóng như cũ.

**Cột trái.** Danh sách môi trường. Dòng đang chọn tô nền. Môi trường đang dùng có dấu ✓ (nhãn "Active"). Dưới đường kẻ là "+ New environment". Tạo xong thì chọn môi trường mới, focus vào ô tên và bôi đen sẵn.

**Đầu cột phải.** Ô tên. Cạnh đó là nhãn "Active", hoặc nút "Set active". Rồi tới hai nút icon "Duplicate" và "Delete", đều có `aria-label` và tooltip.
- Tên trống: hiện "Name can't be empty" (`role="alert"`) dưới ô, không lưu. Rời ô khi vẫn trống thì trả lại tên cũ.
- Duplicate: tạo "<tên> copy" với toàn bộ biến (cả giá trị secret, chỉ trên máy này), chọn bản mới, không tự kích hoạt.
- Delete: hỏi lại ngay trong dialog ("Delete <tên>? Its variables will be removed." kèm "Cancel", "Delete"). Focus mặc định ở "Cancel".

**Bảng biến.** Cột "Variable", "Value", rồi hai nút ở mỗi dòng.
- Ô khoá thay checkbox "Secret". Là nút bật/tắt (`aria-pressed`), tooltip "Secret: stays on this device, never synced". Bật thì giá trị bị che. Trạng thái khác nhau cả ở hình icon (khoá mở/khoá đóng), không chỉ ở màu.
- Nút ✕ xoá biến ngay, không hỏi.
- Cuối bảng luôn có một dòng trống ("Add variable…", "Value"). Gõ vào thì nó thành biến thật và một dòng trống mới xuất hiện, con trỏ không bị mất. Dòng trống không có nút và không được lưu. Nút `+` cũ bỏ đi.
- Mở dialog từ cảnh báo thiếu biến: thêm sẵn dòng có tên đó, focus vào ô giá trị.

**Gợi ý.** Dưới bảng: "Type {{tên}} in a URL, header or body. Secret values stay on this device." `{{tên}}` là biến đầu tiên có tên; chưa có thì là `{{baseUrl}}`.

**Không còn môi trường nào.** Cột phải hiện "Add an environment to define {{variables}}." và nút "New environment".

**Panel hẹp** (khoảng dưới 560px): cột trái chuyển lên trên bảng, thành hàng nút tự xuống dòng. (Khác mockup đã nói là ô chọn: giữ cùng một phần tử, chỉ đổi CSS, đơn giản hơn.)

**Màu và style.** Chỉ dùng token sẵn có trong `panel.css`, chạy cả dark và light. Style inline hiện tại chuyển thành class.

## Phần để người làm quyết
Kích thước, khoảng cách cụ thể, tên class, hình icon khoá. Giữ nguyên các mutation hiện có (nhân bản = `addEnvironment` rồi `updateEnvironment`).

## Kiểm tra
`npm test` vẫn đạt. Mở dialog trong trình duyệt, thử từng hành vi ở trên, ở cả dark, light và bề rộng hẹp.
