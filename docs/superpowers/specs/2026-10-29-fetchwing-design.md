# Fetchwing — Thiết kế

Ngày: 2026-10-29 · Trạng thái: chờ duyệt

## 1. Mục đích

Fetchwing là một **công cụ gọi API gọn kiểu Postman, nằm ngay trong DevTools** của các trình duyệt nhân Chromium. Chức năng chính là dán lệnh cURL (lấy từ tab Network → "Copy as cURL"), sửa, rồi gọi ngay từ trình duyệt; request được sắp xếp trong collection như Postman và dùng biến môi trường.

Tính năng phụ là **mock**: khi API chưa xong hoặc trả kết quả không mong muốn, người dùng cấu hình một response cố định cho một request; khi **trang web** (ví dụ app localhost) gọi đúng API đó, trang nhận response giả thay vì gọi server thật.

Dữ liệu lưu trong trình duyệt và đồng bộ vào **Google Drive riêng của từng người**. Phát hành công khai trên Chrome Web Store.

## 2. Mục tiêu

- Một tab **"Fetchwing"** trong DevTools, cạnh tab Network.
- **Paste cURL**: đọc lệnh cURL từ clipboard (hoặc ô dán), tách method, URL, query, header, cookie, body thành một request có thể sửa.
- Gọi request trực tiếp từ trình duyệt và xem response: status, thời gian, kích thước, header, body (JSON được định dạng).
- **Collection** kiểu Postman: collection → thư mục (lồng nhau) → request; tạo, đổi tên, xóa, kéo thả sắp xếp.
- **Environment**: nhiều môi trường (Local, Staging…), chọn môi trường đang dùng, biến `{{tên}}` trong URL, header, body.
- **Mock** gắn với từng request trong collection: status, header, body, độ trễ, công tắc bật/tắt. Mock **vẫn chạy khi đóng DevTools**.
- Tạo mock theo 2 cách: **"Mock this"** chép response thật vừa nhận, hoặc tự gõ.
- Đăng nhập Google để đồng bộ giữa các máy; không đăng nhập vẫn dùng đầy đủ trong một trình duyệt.
- Giao diện **tiếng Anh**; sẵn sàng nộp Chrome Web Store.

## 3. Không làm (bản đầu)

- Danh sách request bắt được (Captured) trong panel. Người dùng dùng "Copy as cURL" của tab Network rồi Paste cURL.
- Thêm mục vào menu chuột phải của tab Network (Chrome không cho phép).
- Import collection Postman, OpenAPI; export ra định dạng khác.
- Chia sẻ collection cho người khác, làm việc nhóm.
- Script trước/sau request, test tự động, chạy hàng loạt, GraphQL/WebSocket chuyên biệt, OAuth helper.
- Firefox, Safari; ứng dụng điện thoại.
- Mock tài nguyên không phải API (ảnh, script, trang HTML).

## 4. Điều tuyệt đối tránh

- **Mock bật mà người dùng không biết** → tưởng API thật trả kết quả đó. Luôn có dấu hiệu rõ ràng khi có mock đang bật.
- Đưa **secret** (token, mật khẩu trong biến môi trường) lên Drive khi người dùng đã đánh dấu là secret.
- Xin quyền "mọi trang web" ngay khi cài.
- Dùng tên, logo hay giao diện sao chép của Postman (hoặc bất kỳ thương hiệu nào).
- Mất dữ liệu khi đồng bộ giữa hai máy.

## 5. Ràng buộc

- Chrome Manifest V3; chạy trên Chrome, Edge, Brave, Cốc Cốc… Tab DevTools dùng `chrome.devtools.panels`.
- Không bước build bắt buộc, không framework nặng (giữ phong cách dự án Sticky Notes Sync: JavaScript ES modules thuần, `node --test`).
- Đồng bộ Google: chỉ quyền `openid`, `email`, `https://www.googleapis.com/auth/drive.file`; không client secret.
- Tên sản phẩm: **Fetchwing** (đã kiểm tra trùng tên trên web; người dùng tự tra thêm nhãn hiệu).

## 6. Đã quyết định

### 6.1 Giao diện (tab Fetchwing trong DevTools, bố cục hai cột)

- **Thanh trên cùng:** ô chọn environment đang dùng; chỉ báo **"● N mocks ON"** (bấm để xem danh sách mock đang bật); nút Account/Settings.
- **Cột trái — Collections:** cây collection → thư mục → request (mỗi request hiện method + tên; request có mock đang bật có chấm màu). Nút **New**, **Paste cURL**.
- **Cột phải — Request:** method + URL + **Send**; tab con **Params / Headers / Body**. Phần dưới chuyển giữa **Response** và **Mock**.
- **Response:** status, thời gian, kích thước, tab Body (JSON định dạng, chế độ raw) và Headers; nút **Mock this**.
- **Mock:** công tắc bật/tắt, status, header, body, độ trễ (ms).
- Icon extension hiện **số mock đang bật** (badge).

### 6.2 Paste cURL

- Đọc clipboard khi bấm Paste cURL; nếu không đọc được thì mở ô để dán.
- Hỗ trợ cURL dạng **bash** và **cmd** (hai dạng Chrome xuất ra "Copy as cURL"): `-X`, `-H`, `-b/--cookie`, `--data`, `--data-raw`, `--data-binary`, `--data-urlencode`, `-F`, `-u`, `--compressed` (bỏ qua), URL có/không ngoặc.
- Tạo request mới trong collection/thư mục đang chọn, đặt tên mặc định "METHOD path". URL giữ nguyên như trong cURL (không tự thay bằng biến).

### 6.3 Gọi request

- Extension gửi request (không bị CORS của trang). Header `Cookie` trong cURL vẫn được gửi (dùng cơ chế sửa header của extension, vì trình duyệt cấm đặt trực tiếp).
- Biến `{{tên}}` được thay theo environment đang chọn trước khi gửi; biến chưa có giá trị được tô đỏ.

### 6.4 Environment

- Nhiều environment, mỗi cái là danh sách tên = giá trị; một environment đang chọn.
- Mỗi biến có thể đánh dấu **secret**: giá trị chỉ lưu trong máy, không đồng bộ lên Drive.

### 6.5 Mock

- **So khớp:** method + **URL đầy đủ kể cả query**; thứ tự tham số query không quan trọng. Biến trong URL của mock được thay theo environment đang chọn tại thời điểm so khớp.
- Response mock **cố định**: lần nào gọi cũng trả đúng status, header, body đã cấu hình (sau độ trễ nếu có).
- **Cơ chế:** script chèn vào trang (thế giới chính của trang, chạy sớm nhất) thay `fetch` và `XMLHttpRequest`; request khớp mock thì trả response giả, không khớp thì đi bình thường.
- **Chạy cả khi đóng DevTools**, trên các trang web đã được cấp quyền.

### 6.6 Quyền truy cập trang web

- Không xin quyền mọi trang lúc cài. Xin theo **từng domain khi cần**:
  - lần đầu Send tới domain API nào → hỏi quyền cho domain đó;
  - lần đầu bật mock → hỏi quyền chèn script cho **trang đang được DevTools kiểm tra** (ví dụ `http://localhost:3000`), vì mock phải chạy trong trang web chứ không phải domain API.
- Settings có danh sách domain đã cấp quyền để thu hồi, và danh sách trang đang chạy mock.

### 6.7 Đồng bộ Google Drive

- Đăng nhập Google như Sticky Notes Sync (cửa sổ đăng nhập chuẩn, tự gia hạn ngầm, kiểm tra quyền Drive; xử lý thiếu quyền Drive).
- Lưu toàn bộ collection, thư mục, request, mock, environment vào **một file JSON** do app tạo trong Drive của người dùng; tìm lại file khi đăng nhập ở máy khác.
- Dùng được khi offline; sửa ở hai máy → bản sửa sau cùng thắng, tính riêng từng mục (request, thư mục, environment…). Xóa = đánh dấu đã xóa.
- Mỗi người một Drive riêng, không chia sẻ.

### 6.8 Phát hành

- Giao diện tiếng Anh; giấy phép MIT; trang web + Privacy Policy (GitHub Pages), tài liệu đối chiếu bản quyền/chính sách Store, icon và ảnh Store tự thiết kế.
- Không dùng tên/logo Postman; mô tả Store không nói "Postman clone".

## 7. Để người xây dựng tự quyết (lựa chọn của Claude, chưa xác nhận từng mục)

- Cấu trúc module tách phần thuần (parse cURL, thay biến, so khớp URL mock, gộp dữ liệu đồng bộ) để test bằng `node --test`; phần giao diện kiểm tra bằng Chromium tự động như dự án trước.
- Lưu cục bộ trong `chrome.storage.local`; response của lần gửi gần nhất chỉ giữ trong bộ nhớ (không lưu lịch sử).
- Gửi Cookie bằng luật `declarativeNetRequest` tạm thời cho đúng request đó.
- Đăng ký script mock bằng `chrome.scripting.registerContentScripts` cho các trang đã cấp quyền; script chỉ chặn khi có mock khớp, còn lại để nguyên.
- Body request: JSON / text / form-urlencoded / form-data (không upload file ở bản đầu).
- Giới hạn hiển thị response lớn (ví dụ > 2 MB chỉ hiện raw, có nút tải xuống).
- Tên file Drive "Fetchwing data", có `appProperties` để tìm lại.
- Hai mock đang bật cùng khớp một method + URL: không cho bật cái thứ hai, báo "Another mock for this request is already on" kèm tên request kia.
- Mock không ghi header thì mặc định `Content-Type: application/json` khi body là JSON hợp lệ.
- Phím tắt: Ctrl/Cmd+Enter để Send.
- Icon: thiết kế đơn giản (cánh + mũi tên request), màu riêng, không giống logo thương hiệu nào.
