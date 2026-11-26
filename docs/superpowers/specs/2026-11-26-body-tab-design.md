# Thiết kế lại tab Body

## Mục đích
Tab Body dễ gây nhầm: dòng trống ghi "Key / Value" gần giống tiêu đề cột; nhãn trên tab không đổi theo loại body đang chọn (và hiện mã nội bộ như `formdata`); body của GET/HEAD bị bỏ khi gửi mà không báo; None để trống hoàn toàn; ô JSON/Text không có gợi ý.

## Mục tiêu / không làm
- Làm: thanh chọn loại body, dòng trống rõ nghĩa, sửa nhãn tab, gợi ý và cảnh báo.
- Không làm: đổi mô hình dữ liệu, đổi cách gửi request, upload file, xử lý header `Content-Type` có sẵn xung đột với loại body.
- Không được xảy ra: mất dữ liệu khi đổi qua lại giữa các loại, mất con trỏ khi gõ vào dòng trống.

## Cách làm
- **Đã chọn (A):** thanh chọn liền khối, dòng trống ghi "Add …", thêm gợi ý và cảnh báo. Người dùng chọn.
- Loại (B): giữ nút radio, chỉ đổi chữ gợi ý và sửa hai lỗi. Ít thay đổi nhưng phần chọn loại vẫn rời rạc.
- Loại (C): danh sách thả xuống. Gọn nhưng giấu mất 5 lựa chọn, thêm một lần bấm.

## Thiết kế
**Thanh chọn.** None, JSON, Text, URL-encoded, Form data nằm trong một khối liền, mục đang chọn tô `--accent-soft`, chữ `--accent`, đậm. Bên dưới vẫn là radio thật, nên phím mũi tên và trình đọc màn hình dùng được. Có viền focus. Sau khi đổi loại, focus ở lại mục vừa chọn (hiện bị mất do vẽ lại cả tab). Panel hẹp thì cho xuống dòng.

**Dòng trống (Params, Headers, URL-encoded, Form data).** Dấu `+` ở cột đầu, hai ô viền nét đứt. Params và body: "Add key" / "Add value". Headers: "Add header" / "Add value". `aria-label` của ô trống trùng với chữ gợi ý; ô đã có dữ liệu giữ "Key" / "Value". Gõ vào thì thành dòng thật và dòng trống mới xuất hiện như hiện nay. Params chưa có cột đầu, nên thêm một cột hẹp cho dấu `+`.

**Nhãn tab Body.** Cập nhật ngay khi đổi loại, dùng tên dễ đọc (JSON, Text, URL-encoded, Form data). None thì không có nhãn.

**Gợi ý theo loại.**
- None: "This request has no body. Pick a type above to add one."
- JSON: placeholder `{ "name": "value" }`. Nút format hiện cả chữ "Format JSON".
- Text: placeholder "Enter the request body".
- URL-encoded: "Sent as key=value&key2=value2."
- Form data: "Text fields only. File upload isn't supported yet."

**Cảnh báo GET/HEAD.** Khi method là GET hoặc HEAD và loại body khác None: "GET requests don't send a body. Change the method to send it." (HEAD thì ghi HEAD), màu `--warn`, có icon, đặt dưới thanh chọn. Đổi method thì cảnh báo hiện hoặc ẩn ngay. Không khoá việc chỉnh sửa body.

**Style.** Chỉ dùng token sẵn có trong `panel.css`, chạy cả dark và light.

## Phần để người làm quyết
Kích thước, khoảng cách, tên class.

## Kiểm tra
`npm test` vẫn đạt. Mở panel trong trình duyệt, thử từng hành vi ở trên, ở cả dark, light và bề rộng hẹp.
