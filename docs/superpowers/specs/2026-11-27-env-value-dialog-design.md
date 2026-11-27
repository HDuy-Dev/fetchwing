# Hộp thoại sửa giá trị biến environment

## Mục đích
Giá trị biến có thể là object lớn nhiều dòng. Ô một dòng hiện tại khó xem, khó sửa, và làm mất xuống dòng.

## Mục tiêu / không làm
- Làm: hộp thoại soạn giá trị, tóm tắt trong bảng, giữ nguyên xuống dòng.
- Không làm: đổi mô hình dữ liệu hay đồng bộ, cách thay `{{tên}}`, tô màu ngay trong ô đang gõ, bung các chuỗi chứa JSON lồng bên trong.
- Không được xảy ra: mất chữ đang gõ, giá trị bị đổi khi chỉ mở ra xem, secret bị lộ hoặc bị đồng bộ.

## Cách làm
- A: trình soạn mở ngay dưới dòng. Thấy các biến xung quanh, nhưng đẩy bảng xuống.
- B: khung soạn bên cạnh bảng. Cao, nhưng chật khi DevTools hẹp.
- **Đã chọn (C):** hộp thoại lớn. Nhiều chỗ soạn, ít sửa code; đổi lại che bảng biến.

Mockup: `mockup/env-value.html`.

## Bảng biến
- Giá trị có xuống dòng, hoặc là JSON object/array không rỗng: ô Value thành nút tóm tắt (`JSON · 12 lines · …` hoặc `Text · 28 lines · …`; chỉ ghi số dòng khi lớn hơn 1, JSON một dòng thì ghi số key/item). Bấm để mở hộp thoại. Nhãn cho trình đọc màn hình: "Edit value of <tên>". Biến secret không hiện đoạn xem trước. Panel hẹp thì phần xem trước bị cắt trước; loại và số dòng giữ nguyên.
- Giá trị khác: vẫn sửa trong ô như cũ.
- Biến còn sửa trong ô có thêm nút "Open in editor", hiện khi hover hoặc focus vào dòng (luôn hiện với `hover: none`). Dòng tóm tắt không cần nút này, chỗ của nó để trống để các cột thẳng hàng. Dòng trống không có.
- Dán chữ nhiều dòng vào ô Value (kể cả ở dòng trống): giữ nguyên xuống dòng, ô chuyển thành nút tóm tắt, focus ở nút đó.

## Hộp thoại
- Tiêu đề: tên biến và tên env. Cao khoảng 80% panel, vùng soạn chiếm phần còn lại. DevTools thấp (dưới khoảng 440px): hộp thoại gần kín panel, bỏ khoảng trống phía trên và dòng gợi ý phím. Vùng soạn không có chiều cao tối thiểu cứng (style `.dialog textarea` hiện đặt 160px, phải ghi đè).
- Bàn phím: mở ra thì focus vào ô soạn, con trỏ ở đầu (`openDialog` hiện focus phần tử đầu tiên, tức là nút tab). Tab không ra ngoài hộp thoại. Tab trong ô soạn vẫn chuyển focus (không bẫy bàn phím); Enter giữ thụt lề của dòng trước. Đang gõ dở bằng bộ gõ (IME) thì Esc/Enter không đóng, không lưu.
- Trình đọc màn hình: hộp thoại được đặt tên theo tiêu đề; hai tab báo trạng thái đang chọn.
- **Edit:** ô chữ nhiều dòng, font mono, không tô màu (mockup có tô màu chỉ để minh hoạ).
- **Tree:** chỉ xem, gập/mở bằng trình xem JSON sẵn có. Chỉ bật khi nội dung là JSON object/array không rỗng. Tree đọc giá trị đã parse nên số quá lớn bị làm tròn: khi có số như vậy, hiện "Large numbers are rounded here. Edit shows the exact text."
- Nội dung bắt đầu bằng `{` hoặc `[`: hiện "✓ Valid JSON" hoặc "✕ Invalid JSON" (không chỉ khác màu). Chi tiết lỗi, kèm dòng và cột khi tính được, nằm ngay dưới ô soạn, cập nhật sau khi ngừng gõ. Lỗi chỉ để báo, vẫn lưu được.
- **Format:** chỉ bật khi JSON hợp lệ; giữ nguyên cách viết số và chuỗi (`formatJson`).
- JSON viết một dòng được tự format khi mở. Không sửa gì thì giá trị giữ nguyên. Nếu sửa và vẫn hợp lệ thì lưu lại dạng một dòng, để dùng trong URL/header không bị vỡ. Giá trị vốn nhiều dòng hoặc không hợp lệ thì lưu đúng như đang thấy.
- **Save** (hoặc ⌘/Ctrl+Enter) lưu và đóng. **Cancel** bỏ thay đổi. Esc hoặc bấm ra ngoài khi đã sửa thì hỏi "Discard changes?" thay cho hàng nút cuối (hai nút luôn đi cùng nhau khi xuống dòng; "Keep editing" được focus sẵn, Esc lần nữa là quay lại soạn; nút Cancel thì bỏ ngay); chưa sửa thì đóng luôn. Đóng xong trả focus về dòng đó.
- Giá trị bị đổi từ nơi khác (sync) trong lúc đang sửa: Save lần đầu báo và đổi thành "Save anyway". Biến hoặc env đã bị xoá: báo, không lưu, chữ vẫn còn để copy.

## Secret
Hộp thoại mở với vùng soạn được thay bằng "This value is secret and hidden." và nút "Show value" (focus sẵn). Edit, Tree, Format bị tắt; chân chỉ có "Close". Nút này hiện nội dung và cho sửa; nó chỉ áp dụng cho lần mở này, **không** tắt cờ secret. (Không dùng nút khoá để xem, vì tắt khoá sẽ làm giá trị được đồng bộ.)

## Phần để người làm quyết
Tên file, class, kích thước, icon; cách chặn đóng trong `openDialog`; điều xảy ra khi panel mở hộp thoại khác trong lúc đang sửa (không được mất chữ). Chỉ dùng token sẵn có trong `panel.css`.

## Kiểm tra
Logic thuần (phân loại, tóm tắt, quyết định chuỗi lưu) có test viết trước. `npm test` đạt. Thử trong trình duyệt ở dark, light và panel hẹp.
