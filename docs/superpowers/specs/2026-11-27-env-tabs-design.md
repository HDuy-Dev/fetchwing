# Environment mở thành tab, chọn env có tìm kiếm (kiểu Postman)

## Mục đích
Dùng environment giống Postman: chọn nhanh có tìm kiếm, xem và sửa env ngay cạnh request đang mở, thao tác nhanh từ sidebar.

## Mục tiêu / không làm
- Làm: tab env, dropdown chọn env có tìm kiếm, ô lọc và thao tác hover ở sidebar, bỏ dialog Environments.
- Không làm: nút xem nhanh biến, tìm trong bảng biến, import/export, Share, Fork, đổi mô hình dữ liệu hay đồng bộ.
- Không được xảy ra: mất giá trị đang gõ (đổi tab, đổi section, đóng tab, vẽ lại do sync), giá trị secret bị đồng bộ đi.

## Cách làm
- **Đã chọn:** env dùng chung thanh tab với request. Đúng yêu cầu "tab env mở cạnh tab request".
- Loại: thanh tab riêng cho env. Không nằm cạnh request được.
- Loại: giữ thêm dialog bên cạnh tab. Hai giao diện cho cùng một việc.
- Bản thiết kế `2026-11-26-environments-dialog-design.md` từng loại cách mở bằng tab; bản này thay nó.

## Thiết kế
**Tab.** Tab env có icon `{}` và tên env, đóng được như tab request (✕, chuột giữa). Mở tab mới thì chèn ngay bên phải tab đang xem. Env đã mở thì chỉ chuyển sang tab đó. Danh sách tab được nhớ khi mở lại panel. Env bị xoá (kể cả do sync) thì tab tự đóng.

**Nội dung tab.** Chiếm vùng chính, thay cho request editor và Response/Mock. Giữ tính năng của dialog:
- Đầu trang: ô tên, nhãn "Active" hoặc nút "Set active", nút Duplicate (mở tab bản mới, không tự kích hoạt) và Delete (hỏi lại tại chỗ, focus mặc định ở "Cancel").
- Tên trống: báo "Name can't be empty", không lưu; rời ô thì trả tên cũ.
- Bảng biến tự lưu, nút khoá secret, nút xoá biến, dòng trống ở cuối tự thành biến khi gõ.
- Dòng gợi ý cú pháp `{{tên}}`.
- Panel vẽ lại (thay đổi bất kỳ trong workspace) không được làm mất focus, con trỏ hay chữ đang gõ. Thay đổi từ sync chỉ được vẽ đè khi tab không còn gì chờ lưu.

**Điểm vào.** Bấm env ở sidebar, nút "+" của section Environments, và cảnh báo thiếu biến (thêm sẵn dòng có tên đó, focus ô giá trị) đều mở tab. Dialog Environments bị bỏ.

**Dropdown trên thanh đầu** (thay `<select>`). Nút hiện tên env đang active và mũi tên. Mở ra có: ô "Search" được focus sẵn; "No Environment"; danh sách env, env đang active có ✓; dưới đường kẻ là "+ Create new environment" (tạo xong mở tab, focus ô tên). Lọc theo tên, không phân biệt hoa thường; "No Environment" và nút tạo luôn hiện. Không khớp thì báo "No matches". Bấm một dòng là đặt active. Phím lên/xuống để di chuyển, Enter để chọn, Esc và bấm ra ngoài để đóng.

**Sidebar Environments.**
- Ô lọc theo tên ở trên danh sách.
- Env active luôn hiện ✓. Env khác hiện nút "Set active" khi hover hoặc focus bằng bàn phím.
- Nút ⋯ hiện khi hover hoặc focus, mở menu: Duplicate, Delete (hỏi lại, dùng menu sẵn có). Chuột phải vào dòng mở cùng menu.
- Dòng được tô nền là env của tab đang xem (không còn là env active).
- Bỏ số đếm biến, giống Postman.

**Style.** Chỉ dùng token sẵn có trong `panel.css`, chạy cả dark, light và panel hẹp.

## Phần để người làm quyết
Tên file, class, kích thước, cách lưu danh sách tab. Giữ nguyên các mutation hiện có.

## Kiểm tra
`npm test` đạt. Mở panel trong trình duyệt, thử từng hành vi ở trên, ở cả dark, light và bề rộng hẹp.
