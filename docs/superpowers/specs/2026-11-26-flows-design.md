# Flows: kịch bản API dạng sơ đồ

Ngày: 2026-11-26 · Trạng thái: chờ duyệt · Mockup cuối: `mockup/flows.html` (v8)

## 1. Mục đích

Người dùng muốn **nhìn thấy các API trong hệ thống liên kết với nhau thế nào** mà không phải dựng FE. Fetchwing thêm tính năng **Flows**: mỗi flow là một kịch bản cho một luồng nghiệp vụ, vẽ thành sơ đồ khối. Mỗi khối là một request có sẵn trong collection. Đường nối cho biết khối nào chạy sau khối nào, các nhánh không phụ thuộc nhau thì chạy song song, và response của khối trước cung cấp dữ liệu cho khối sau. Bấm **Run** để chạy cả flow rồi xem từng khối đã gửi gì, nhận gì và truyền dữ liệu gì đi.

Ví dụ: Login → Get user → (Get orders ∥ Get notifications) → Get dashboard.

## 2. Mục tiêu

- Mục **Flows** mới trên thanh bên trái, cạnh Collections, Environments và Mocks. Có danh sách flow, thêm, đổi tên và xóa.
- Khung vẽ di chuyển và phóng to, thu nhỏ kiểu Figma. Thêm khối, nối khối, kéo khối để di chuyển.
- Mỗi khối trỏ tới một request trong collection, không tạo bản sao.
- Truyền dữ liệu: khối **lấy giá trị ra** từ response thành biến. Request phía sau dùng biến đó bằng `{{tên}}` như biến environment.
- **Run**, **Stop** và **Run from here**. Trạng thái từng khối hiện trực tiếp lúc đang chạy.
- **Cột chi tiết** của khối có bốn tab Inputs / Outputs, Response, Request và Headers. Bấm chỗ trống trên khung vẽ để xem **tổng quan lần chạy**.
- Mở flow trong tab DevTools, hoặc bật sang **cửa sổ riêng**.
- Flow đồng bộ Google Drive như collection.

## 3. Không làm (bản này)

- Rẽ nhánh theo điều kiện, vòng lặp, khối viết code hoặc biến đổi dữ liệu. Tuy vậy cách lưu phải để chỗ cho các loại khối mới (xem 6.2).
- Bản đồ toàn hệ thống tự tổng hợp từ các flow (ý tưởng để sau).
- Lịch sử nhiều lần chạy: chỉ giữ lần chạy gần nhất.
- Chạy theo lịch, chạy khi đóng hết giao diện Fetchwing, hay chạy hàng loạt.
- Undo/redo trên khung vẽ, nút "Sắp xếp tự động", bản đồ nhỏ, bấm vào số trong phần tóm tắt để nhảy tới khối.
- Một khối gọi request không có trong collection.

## 4. Điều tuyệt đối tránh

- **Response mock trông giống response thật.** Khối trả về từ mock luôn có nhãn **MOCK** trên khối và trong chi tiết.
- **Kết quả cũ trông như mới.** Nếu request bị sửa sau lần chạy, khối phải hiện *outdated*.
- **Lộ token khi chia sẻ màn hình.** Giá trị nhạy cảm được ẩn mặc định (xem 6.7).
- **Lỗi bị nuốt mất.** Khối bị bỏ qua phải nói rõ là do khối nào. Khối thiếu biến phải được báo trước khi Run.
- **Làm hỏng dữ liệu sẵn có khi đồng bộ** với máy chạy bản Fetchwing cũ.
- **Sửa trong flow mà âm thầm sửa luôn request.** Flow chỉ đọc request. Muốn sửa request thì phải mở nó trong collection.

## 5. Ràng buộc

- Giữ phong cách dự án: JavaScript ES modules thuần, không bước build, không thư viện ngoài, test bằng `node --test`. Logic thuần đặt trong `src/lib/`, giao diện đặt trong `src/panel/`.
- Giao diện **tiếng Anh**, dùng màu và token sáng/tối sẵn có trong `panel.css`.
- Quyền truy cập trang xin theo từng trang, chỉ từ một cú bấm (`chrome.permissions.request` cần thao tác của người dùng).
- DevTools có thể rất hẹp, nên phải dùng được từ khoảng 360px (xem cách panel đang xử lý bố cục hẹp).

## 6. Đã quyết định

### 6.1 Cách xây dựng: chạy flow ngay trong giao diện đang mở (người dùng chọn)

**Các cách đã cân nhắc:**
- **(A) Background worker điều phối việc chạy**, các giao diện chỉ theo dõi. Ưu điểm là đóng DevTools giữa lúc chạy vẫn chạy tiếp. Nhược điểm là thêm message, thêm chỗ chuyển qua lại giữa giao diện và background.
- **(B) Giao diện đã bấm Run điều phối, mỗi khối gửi qua message `send` của background.** Ít code hơn. Nếu đóng giao diện giữa lúc chạy thì lần chạy dừng. **Người dùng chọn B.**

**Cách làm:**
- Một module thuần `src/lib/flow-run.js` lo toàn bộ logic chạy: tính thứ tự, chạy song song, quyết định khối bị bỏ qua, thay biến, lấy biến ra và dùng mock. Hàm gửi request được truyền vào, nên test được bằng `node --test`.
- Giao diện gọi module này. Mỗi khối không dùng mock sẽ gửi qua message `send` của background, để vẫn giữ được cookie từ cURL, Cancel và kiểm tra URL như khi bấm Send.
- **Message `send` cần mở rộng**, giữ nguyên hành vi cũ khi không truyền trường mới:
  - `vars`: biến của flow. Khi chạy, chúng được ưu tiên hơn biến cùng tên trong environment đang chọn.
  - `key`: khóa của lần gửi, dùng cho `inFlight` và `cancelSend`. Hiện `inFlight` lấy `requestId` làm khóa, mà một flow có thể dùng cùng một request ở hai khối. Không truyền `key` thì vẫn dùng `requestId` như cũ.
- Trạng thái và kết quả lần chạy ghi vào `chrome.storage.session` theo `flowId`. Chỗ khác đang mở cùng flow (tab DevTools hoặc cửa sổ riêng) theo dõi qua `storage.onChanged`, nên cũng thấy flow đang chạy.
- Chỉ một lần chạy cho mỗi flow tại một thời điểm. Bấm Run ở chỗ thứ hai khi flow đang chạy thì nút đó hiện **Stop** và dừng lần chạy kia.
- *(Lựa chọn của Claude)* **Giao diện đang chạy bị đóng giữa chừng.** Trang không có cách nào chắc chắn để báo lúc mình bị đóng, nên làm như sau:
  - Bản ghi lần chạy có một **nhịp sống**: giao diện đang chạy cập nhật một mốc thời gian khoảng 2 giây một lần.
  - Chỗ nào thấy nhịp sống cũ hơn khoảng 6 giây thì coi lần chạy là bị bỏ dở: các khối chưa xong trở về not run, và ghi chú "Run stopped: the window running it was closed".
- *(Lựa chọn của Claude)* **Stop từ chỗ thứ hai.** Chỗ đó ghi cờ `stopRequested` vào bản ghi lần chạy. Giao diện đang chạy nghe `storage.onChanged`, thấy cờ thì dừng. Vì vậy `flow-run.js` nhận một tín hiệu hủy (`AbortSignal`) truyền từ ngoài vào.
- *(Lựa chọn của Claude)* **Sửa flow trong lúc đang chạy.** Vẫn sửa được. Lần chạy dùng **bản chụp** của flow, request và environment lấy lúc bấm Run, và bản chụp này lưu trong bản ghi lần chạy. Những gì sửa sau đó áp dụng cho lần chạy kế tiếp. Khối bị sửa sẽ hiện *outdated* (xem 6.4).

### 6.2 Dữ liệu

- Workspace có thêm `flows: { [id]: Flow }`, đặt cạnh `environments`, sửa qua các mutation mới trong `applyMutation` (`addFlow`, `updateFlow`, `deleteFlow`, …). Có `updatedAt` và `deleted` như các mục khác.
- Gợi ý cấu trúc `Flow` (chi tiết để người xây dựng quyết):
  ```
  { id, name, order, updatedAt, deleted,
    blocks: [{ id, kind: 'request', requestId, x, y,
               outputs: [{ name, path }] }],
    edges:  [{ from: blockId, to: blockId }] }
  ```
  Trường `kind` chừa chỗ cho các loại khối sau này (điều kiện, vòng lặp).
- **Đồng bộ Drive:** `toRemote` và `merge` thêm `flows`, dùng cùng quy tắc bản sửa sau cùng thắng **theo từng flow**. Kết quả lần chạy không đồng bộ.
- **Tương thích với bản cũ:** máy chạy bản cũ đọc rồi ghi lại file Drive sẽ làm mất `flows` trong file, nhưng không được làm mất flow ở máy mới. Máy mới vẫn giữ flow trên máy và tải lại lên ở lần đồng bộ sau. Người xây dựng kiểm tra lại `sync.js` / `sync-merge.js`, xem việc thiếu `flows` trong file có bị hiểu là "đã xóa" không, và viết test cho trường hợp này.

### 6.3 Biến và truyền dữ liệu

- **Lấy ra (outputs):** mỗi output có tên biến và đường dẫn theo một cú pháp nhỏ: `body.a.b`, `body.items[0].id`, `body.items[*].id`, `headers.x-request-id` (không phân biệt hoa thường), `status`. Không dùng JSONPath đầy đủ.
  - Đường dẫn không tìm thấy giá trị thì biến không có giá trị, và các khối dùng biến đó bị đánh dấu thiếu biến khi tới lượt chạy.
  - Khi thay vào `{{tên}}`: giá trị chuỗi giữ nguyên, số và true/false đổi thành chữ, mảng và object chuyển thành JSON (`[*]` cho ra một mảng).
- **Thứ tự ưu tiên khi thay biến:** biến của flow từ các khối phía trước, rồi đến environment đang chọn.
- **Nguồn của một biến:** một khối chỉ thấy output của các khối **phía trước nó**, tức các khối có đường nối dẫn tới nó. Nếu hai khối phía trước cùng lấy ra một tên biến:
  - Một khối nằm sau khối kia: khối gần hơn thắng.
  - Hai khối nằm ở hai nhánh song song: **báo lỗi ngay khi dựng sơ đồ**. Khối dùng biến hiện cảnh báo xung đột và không chạy được.
- **Kiểm tra lúc dựng sơ đồ (chưa cần Run):**
  - Request dùng `{{x}}` mà không khối nào phía trước lấy ra `x` và environment đang chọn cũng không có `x` → khối hiện **! Missing x** và không được gửi khi chạy.
  - Không cho nối thành vòng.
- **Nhãn trên đường nối** được tự tính: là những biến khối nguồn lấy ra mà request của khối đích có dùng. Một đường nối không mang biến nào thì chỉ có nghĩa là "chạy sau".
- **＋ Output trong Response:** rê chuột lên một dòng JSON sẽ hiện nút này. Bấm vào thì tạo output với đường dẫn của dòng đó, tên biến đề xuất là khóa cuối cùng (người dùng sửa được).

### 6.4 Chạy

- **Trạng thái khối:** not run, queued, running, done (✓), failed (✕), skipped (⊘), missing variable (!). Mỗi trạng thái có ký hiệu riêng, không chỉ phân biệt bằng màu.
- Một khối chạy khi **tất cả** các khối phía trước đều done. Có khối phía trước failed hoặc skipped thì khối đó skipped. Các nhánh độc lập chạy song song.
- **Failed** gồm ba loại, hiện rõ trong chi tiết:
  - Server trả 4xx/5xx: có response.
  - Không kết nối được hoặc bị hủy: không có response.
  - Thiếu biến: không gửi.
- **Mock:** request đang bật mock thì khối trả về response mock (status, headers, body, delay), không gọi server, và có nhãn MOCK. Biến vẫn lấy ra từ response mock như bình thường.
  - **Không có công tắc riêng** kiểu "Ignore mocks" cho flow hay cho từng khối. Người dùng xác nhận điều này ngày 2026-11-26, sau khi đã được nói đủ các hệ quả:
    - Mock bật để test trang cũng ảnh hưởng tới flow.
    - Công tắc mock chỉ lưu trên từng máy, nên cùng một flow có thể chạy khác nhau trên hai máy.
    - Muốn gọi server thật thì phải tắt mock của request đó.
- **Quyền truy cập trang:** trước khi chạy, gom các trang mà các khối cần gửi tới (trừ khối dùng mock) và chưa có quyền, rồi hỏi **một lần** trong cú bấm Run (`chrome.permissions.request` với nhiều origin). Bị từ chối thì không chạy và báo lý do.
- **Stop:** hủy các request đang gửi (qua `cancelSend` với `key`). Các khối chưa chạy trở về not run.
- **Run from here** (chuột phải vào khối): chạy khối đó và các khối phía sau, dùng lại output của các khối phía trước từ lần chạy gần nhất. *(Lựa chọn của Claude)*
  - **Tắt** khi:
    - không còn kết quả lần chạy trước, ví dụ trình duyệt đã khởi động lại và `storage.session` đã bị xóa;
    - có khối phía trước chưa done;
    - các khối, đường nối hoặc output phía trước đã thay đổi so với bản chụp của lần chạy đó.
  - **Vẫn chạy nhưng có cảnh báo** "Using outputs from an earlier run" khi khối phía trước chỉ *outdated*, hoặc khi environment đã đổi.
- **Outdated** *(lựa chọn của Claude)*:
  - Lúc chạy, mỗi khối lưu một dấu vân tay của những gì quyết định kết quả: method, URL, headers, body, request đang bật mock hay không (và nội dung mock), cùng giá trị của các biến environment mà request dùng.
  - Khối hiện *outdated* khi dấu vân tay hiện tại khác lúc chạy. Đổi tên, di chuyển hay sắp xếp request **không** làm khối outdated. Không dùng `updatedAt` vì trường này đổi cả khi đổi tên hay sắp xếp.
- **Response bị cắt** *(lựa chọn của Claude)*: `send` chỉ giữ 2 MB đầu của body (`bodyTruncated`).
  - Nếu không đọc được output vì body bị cắt, khối được tính là **failed** với lỗi "Response too large to read output `x`". Không coi là thiếu biến, để lỗi không bị lẫn.
  - Flow dùng chung các giới hạn của `send` hiện có, ví dụ `credentials: 'omit'`, cookie chỉ lấy từ cURL.
- Request bị xóa khỏi collection: khối hiện "Request deleted", không chạy được, và các khối phía sau nó bị skipped khi chạy.

### 6.5 Khung vẽ (theo mockup v8)

- **Di chuyển:** kéo vào chỗ trống, lăn hai ngón trên trackpad, hoặc giữ Space rồi kéo.
- **Phóng to, thu nhỏ:** lăn chuột hoặc chụm hai ngón, tâm phóng là con trỏ, trong khoảng **10%–400%**. Nút − / % / + / ⤢ (vừa khung). Phím tắt ⌘+ / ⌘− / ⌘0 / ⇧1.
- **Khi thu nhỏ dưới 60%:** khối chỉ còn tên và ký hiệu trạng thái phóng to, ẩn nhãn trên đường nối.
- **Khối:** method, tên, URL và dòng trạng thái (status · thời gian). Có nhãn MOCK và *outdated* khi cần. Khối failed viền đỏ, khối skipped mờ và viền nét đứt, khối thiếu biến viền vàng.
- **Đường nối:** màu xám khi chưa truyền, xanh khi đã truyền, xanh có hiệu ứng chạy khi đang truyền, đỏ nét đứt khi bị chặn.
- **Thao tác:**
  - Thêm khối: "＋ Block" mở ô tìm request (tái dùng ⌘K search), hoặc kéo một request từ cây collection thả vào khung vẽ.
  - Nối khối: kéo từ chấm bên phải của khối này sang chấm bên trái của khối kia.
  - Kéo khối để di chuyển, bám theo lưới 16px.
  - Chọn khối hoặc đường nối rồi bấm Delete để xóa.
  - Chuột phải vào khối: Run from here, Open request, Delete.
- **Bàn phím:** Tab đi giữa các khối, Enter mở chi tiết, ⌘↵ Run.
- **Kịch bản trống:** hướng dẫn thêm khối đầu tiên.
- Mỗi chỗ mở (tab DevTools, cửa sổ riêng) giữ vị trí xem và mức zoom riêng.

### 6.6 Cột chi tiết (theo mockup v8)

- **Đầu cột:**
  - Method và tên khối (tối đa 2 dòng), MOCK, *outdated*.
  - Một dòng nhỏ cho thông tin phụ: `✓ 200 OK · 88 ms · 1.2 KB · started +142 ms`. Rê chuột lên "started" để xem đã chờ bao lâu rồi chạy bao lâu.
  - Nút ⤢ (mở rộng cả khung) và ✕ (đóng, phím Esc).
- **Bốn tab.** Tab đang mở được giữ nguyên khi chuyển sang khối khác. Đổi tab bằng ← →.
  - **Inputs / Outputs:** bảng Inputs (biến, giá trị, khối nguồn hoặc environment) và bảng Outputs (biến, đường dẫn, giá trị, các khối dùng nó). Tên khối bấm được, bấm vào thì khung vẽ di chuyển tới khối đó. Nút ＋ Add output.
  - **Response:** ô Filter có đếm số dòng khớp, nút gập/mở tất cả, nút sao chép, chọn JSON hoặc Raw. Dòng nào được lấy ra làm biến thì được tô sáng và có nhãn `→ tên`. Phía trên có một dòng ghi chú gọn: mock, outdated, hoặc các khối bị bỏ qua vì lỗi này. Tái dùng `json-view.js` nếu được.
  - **Request:** URL đã thay biến (mỗi biến là một ô ghi tên và giá trị), bảng query, body, và link "open to edit" trong collection.
  - **Headers:** request headers (đã thay biến) và response headers.
- Khối chưa chạy, skipped hoặc thiếu biến: thay nội dung bằng một dòng giải thích lý do, kèm link tới khối gây ra.
- Kéo mép trái để đổi độ rộng cột (mặc định 440px). Khi giao diện hẹp, cột nổi đè lên khung vẽ. Khi cột hẹp hơn 380px, bảng Inputs/Outputs xếp dọc từng biến.
- **Tổng quan lần chạy** (bấm chỗ trống trên khung vẽ):
  - Một dòng nhỏ: tổng thời gian, ✓, ✕, ⊘, số khối dùng mock.
  - Dòng thời gian của tất cả các khối, cho thấy khối nào chạy song song và khối nào chậm.
  - Mục **Needs attention**: liệt kê khối lỗi, bị bỏ qua và thiếu biến. Bấm vào để nhảy tới khối.

### 6.7 Giá trị nhạy cảm và giá trị dài

- **Ẩn mặc định** (`••••••••`, bấm ◉ để hiện):
  - Biến environment đánh dấu *secret*.
  - Header `Authorization`, `Cookie` và các header có `api-key` trong tên.
  - Biến được lấy ra có tên giống token: chứa `token`, `secret`, `password` hoặc `key`.
- **Giá trị dài:** cắt ở giữa trên một dòng, bấm vào để xem đầy đủ. Rê chuột lên một dòng sẽ hiện nút sao chép.

### 6.8 Tên dài

| Chỗ | Cách xử lý |
|---|---|
| Tên khối trên khung vẽ | Tối đa 2 dòng rồi "…", khối giữ độ rộng cố định. |
| URL trên khối | Cắt ở giữa, giữ cả phần đầu và phần cuối. |
| Nhãn trên đường nối | Hai tên đầu kèm "+N". |
| Tiêu đề cột chi tiết | Tối đa 2 dòng. |
| Tên khối trong bảng và dòng thời gian | Một dòng rồi "…". |
| Tên flow ở thanh bên | Một dòng rồi "…", giống cây collection. |

Mọi chỗ bị cắt đều xem được tên đầy đủ khi rê chuột.

### 6.9 Chỗ mở

- **Tab DevTools:** chọn một flow trong mục Flows thì khung vẽ và cột chi tiết thay chỗ vùng request ở giữa.
- **Cửa sổ riêng:** nút ⧉ mở cửa sổ riêng, mở rộng cơ chế `editor-window.js` sẵn có với tham số `flow=<id>`. Hai chỗ cùng đọc một workspace nên sửa ở chỗ này thì chỗ kia cập nhật theo, giống collection hiện nay.

## 7. Để người xây dựng tự quyết (lựa chọn của Claude, chưa xác nhận từng mục)

- Tên và cấu trúc chính xác của các mutation, của `Flow` và của dữ liệu lần chạy.
- Số khối chạy song song cùng lúc tối đa: đề xuất 6.
- Giới hạn dung lượng kết quả lưu trong `chrome.storage.session` (giới hạn khoảng 10 MB). Đề xuất dùng lại mức cắt 2 MB mỗi body đang có (`MAX_DISPLAY_BYTES`), và bỏ kết quả của flow lâu không mở khi vượt giới hạn.
- Chia module giao diện, ví dụ `src/panel/flow-canvas.js`, `flow-details.js`, `flow-view.js`.
- Tên biến đề xuất khi bấm ＋ Output trùng với tên đã có thì thêm số vào sau.
- Khi gửi, Fetchwing không tự thêm header nào khác ngoài cách `send` đang làm.
- Phần giao diện được kiểm tra bằng trình duyệt tự động như các tính năng trước. Phần logic (`flow-run.js`, đường dẫn output, kiểm tra biến và vòng, gộp đồng bộ) có test `node --test`.
