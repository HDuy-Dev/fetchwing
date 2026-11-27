# Khối Logic trong Flow

Ngày: 2026-11-27 · Trạng thái: chờ duyệt · Dựa trên: `2026-11-26-flows-design.md`, `2026-11-27-request-script-design.md`

## 1. Mục đích

Người dùng cần **tính toán giữa các API trong một flow**. Ví dụ: gọi API A và API B, lấy giá trị từ hai response, tính ra một kết quả, rồi dùng kết quả đó làm input cho API C.

```
[GET price] ──┐
              ├──► [Logic: total = price × qty] ──► [POST order {{total}}]
[GET stock] ──┘
```

Khối **Logic** là một loại khối mới. Khối này không gửi request mà chạy một đoạn JavaScript. Script đọc các biến từ những khối phía trước (hoặc dùng giá trị viết cứng), rồi trả ra output. Các khối phía sau dùng output đó bằng `{{tên}}`, giống output của khối request.

## 2. Mục tiêu

- Thêm khối Logic từ nút "＋ Block" trên khung vẽ.
- Script đọc được biến từ các khối phía trước và từ environment đang chọn, theo đúng quy tắc ưu tiên mà `{{x}}` đang dùng.
- Script trả về một object. Các khóa đã khai báo trở thành output của khối.
- Vẫn giữ việc kiểm tra trước khi Run (thiếu biến, xung đột) và nhãn biến trên đường nối.
- Xem được log, lỗi và output của lần chạy gần nhất ngay trong cột chi tiết của khối.

## 3. Không làm (bản này)

- Đọc response đầy đủ của khối cha, kiểu `fw.parent('…')`. Người dùng đã chọn cách 1, chỉ dùng biến. Sau này vẫn thêm được mà không phải đổi gì.
- Rẽ nhánh theo điều kiện, vòng lặp, hay khối Logic quyết định khối nào chạy tiếp.
- Ghi vào environment từ flow.
- Gửi request từ trong script, `require`, hay thư viện ngoài.
- Dùng chung một script cho nhiều flow (thư viện script).

## 4. Điều tuyệt đối tránh

- Script làm treo hoặc sập panel, hay chạm được tới `chrome.*` hoặc workspace.
- **Lỗi bị nuốt mất.** Script ném lỗi, hết giờ, hoặc trả sai kiểu thì khối phải **failed** và nói rõ lý do. Các khối phía sau phải hiện là skipped do khối này.
- **Flow âm thầm sửa environment.** Flow vẫn chỉ đọc dữ liệu bên ngoài (giống quy tắc "flow chỉ đọc request").
- Kết quả cũ trông như mới: sửa script sau lần chạy thì khối phải hiện *outdated*.
- Máy chạy bản Fetchwing cũ làm mất khối Logic khi đồng bộ.

## 5. Ràng buộc

- Như các phần trước: ES modules thuần, không bước build, không thư viện ngoài, test bằng `node --test`. Logic thuần đặt trong `src/lib/`, giao diện đặt trong `src/panel/`. Giao diện tiếng Anh.
- MV3 cấm `eval`, nên code chạy trong **sandbox sẵn có** (`src/sandbox/script.html`), qua `createScriptRunner`: mỗi lần chạy một iframe mới, giới hạn 5 giây.

## 6. Cách xây dựng (đã chọn)

**Các cách đã cân nhắc:**
1. **Script đọc biến đã lấy ra từ các khối phía trước** (`fw.vars.get('price')`) và trả về `{ total }`. Output khai báo trước theo tên. **Người dùng chọn cách này.** Nó khớp với cách flow đang truyền dữ liệu và giữ được việc kiểm tra trước khi Run.
2. Script đọc thẳng response của khối cha (`fw.parent('Get orders').json()`). Linh hoạt hơn, nhưng gắn với tên khối (đổi tên là hỏng) và không kiểm tra trước được.
3. Cả hai. Mạnh nhất, nhưng có hai cách viết nên dễ rối, và nhiều việc hơn.

## 7. Đã quyết định

### 7.1 Dữ liệu

Khối Logic lưu ngay trong flow, không tạo item trong collection. Nhờ vậy nó đồng bộ Drive cùng flow, theo đúng quy tắc từng flow như hiện nay.

```
{ id, kind: 'logic', name: 'Logic', script: '', x, y,
  outputs: [{ name }] }          // không có path
```

Khối không có `kind`, hoặc có `kind: 'request'`, vẫn là khối request như cũ.

### 7.2 API trong script (`pm` === `fw`, dùng lại runtime sẵn có)

- `fw.vars.get(name)`, `fw.vars.has(name)`, `fw.vars.toObject()`: các biến khối này nhìn thấy, gồm output của các khối phía trước (khối gần nhất thắng) rồi đến environment đang chọn. Cùng thứ tự ưu tiên với `{{x}}`. Giá trị giữ nguyên kiểu đã lấy ra, ví dụ số vẫn là số và mảng vẫn là mảng, chứ không đổi thành chữ.
- `fw.environment.get / has / toObject` (và `fw.env`): **chỉ đọc**. Gọi `set` hoặc `unset` sẽ ném lỗi "Flows can't change the environment. Return a value instead."
- Không có `fw.response`. Nếu script truy cập vào thì báo lỗi rõ ràng.
- `console.log / info / warn / error` như request script.
- Có thể dùng `await` ở cấp ngoài cùng.
- **Output:** `return { total: 42, ids: [1, 2] }`.
  - Khóa đã khai báo thì thành output, giá trị giữ nguyên (cách thay vào `{{}}` giống output request: chữ giữ nguyên, số và true/false đổi thành chữ, mảng và object chuyển thành JSON).
  - Khóa chưa khai báo thì bỏ qua, kèm một dòng cảnh báo trong Console.
  - Khóa đã khai báo nhưng không trả về thì không có giá trị. Khối phía sau dùng biến đó bị đánh dấu thiếu biến lúc chạy, giống output request không tìm thấy.
  - Trả về `undefined` khi không khai báo output nào là hợp lệ, phù hợp với script chỉ để log.
  - Trả về thứ không phải object (hoặc là mảng) trong khi có khai báo output: khối failed với lỗi "Script must return an object like { name: value }".
  - Giá trị không chuyển được thành JSON (hàm, vòng tham chiếu): khối failed và báo tên output gây lỗi.

### 7.3 Kiểm tra trước khi Run *(lựa chọn của Claude)*

- **Biến script dùng:** quét mã nguồn tìm các lời gọi có tên là chuỗi viết cứng `fw.vars.get('x')` / `pm.vars.get("x")` / `.has(...)`. Coi những tên tìm được như `usedVars` của khối request:
  - Không có nguồn nào cung cấp → **! Missing x**, khối không chạy.
  - Hai nhánh song song cùng cung cấp → báo xung đột.
  - Nhãn trên đường nối đi vào khối Logic hiện các biến này.
- Tên tạo động (`fw.vars.get(key)`) hoặc `toObject()` thì không kiểm tra trước được: lúc chạy biến không có sẽ ra `undefined`. Đây là giới hạn đã chấp nhận.
- **Output:** khai báo theo tên, nên kiểm tra thiếu biến và nhãn đường nối của các khối phía sau hoạt động như với khối request.

### 7.4 Chạy

- Khối Logic chạy khi **tất cả** các khối phía trước đều done, giống khối request. Khối không có khối phía trước (dùng giá trị viết cứng) thì chạy ngay từ đầu.
- Trạng thái dùng chung bộ hiện có: queued, running, done, failed, skipped, missing.
- `failed` có thêm `errorKind: 'script'` (script ném lỗi, trả sai kiểu, giá trị không chuyển được JSON) và `'timeout'` (quá 5 giây).
- Kết quả lưu trong bản ghi lần chạy: `{ state, outputs, logs, value, startMs, endMs, fingerprint }`. `value` là object đã trả về, cắt ở khoảng 256 KB khi hiển thị.
- `flow-run.js` nhận thêm một hàm được truyền vào là `runLogic({ script, vars, env, signal })`, để test được bằng `node --test`. Giao diện gắn hàm này với `createScriptRunner`, thêm loại message `logic` cho sandbox.
- **Stop:** khối Logic đang chạy thì về failed (cancelled), và iframe của nó bị gỡ.
- Các script chạy **lần lượt từng cái một** (runner hiện có xếp hàng). Request vẫn chạy song song như cũ.
- **Outdated:** dấu vân tay gồm `script`, tên các output, và giá trị của các biến environment mà script dùng (theo 7.3).
- **Run from here** dùng được với khối Logic, theo cùng quy tắc.
- Kiểm tra quyền truy cập trang bỏ qua khối Logic.

### 7.5 Khung vẽ

- Nút "＋ Block" mở menu nhỏ gồm **Request…** (ô tìm như hiện nay) và **Logic**. Chọn Logic thì thêm khối ở giữa khung nhìn rồi mở cột chi tiết ở tab Script.
- Trên khung vẽ, khối Logic thay chỗ method bằng nhãn `JS`. Dòng giữa (chỗ khối request hiện URL) hiện tên các output, ví dụ `→ total, ids`. Dòng trạng thái là `✓ 3 ms`. Khối giữ cùng kích thước và cổng nối như khối request.
- Menu chuột phải gồm Run from here, **Duplicate** và Delete. Không có Open request.
- Kịch bản trống: dòng hướng dẫn nhắc cả request lẫn Logic.

### 7.6 Cột chi tiết của khối Logic

- **Đầu cột:** nhãn `JS`, tên khối sửa ngay tại chỗ (mặc định "Logic"), thông tin trạng thái `✓ 3 ms`, nhãn *outdated*.
- **Ba tab** (thay cho Response, Request và Headers):
  - **Script:** ô soạn mã đơn cách (style `code-area` như tab Script của request), một dòng gợi ý (`fw.vars.get('x')`, `return { name: value }`, `console.log()`). Bên dưới là danh sách **Outputs** chỉ gồm tên, có ＋ Add output.
    - *(Lựa chọn của Claude)* Có thêm nút "Detect" để tự thêm các khóa tìm được trong `return { … }` cuối cùng, ở dạng đơn giản nhất.
    - Lưu khi dừng gõ (debounce), như các ô sửa khác của flow.
  - **Inputs / Outputs:** dùng lại tab hiện có. Inputs là các biến tìm được theo 7.3, kèm giá trị và nguồn. Outputs là tên, giá trị, và các khối dùng nó.
  - **Console:** log, lỗi (kèm dòng nếu có) và cảnh báo khóa chưa khai báo của lần chạy gần nhất. Dùng lại cách hiển thị của Console request.
- Khi khối failed, dòng ghi chú phía trên hiện lỗi và các khối bị bỏ qua vì nó, giống khối request.
- Tổng quan lần chạy và dòng thời gian tính cả khối Logic.

### 7.7 Đồng bộ và bản cũ

- Bản Fetchwing cũ gặp khối `kind: 'logic'` (không có `requestId`) sẽ hiện khối đó là "Request deleted". Bản cũ **không được xóa khối hay bỏ các trường lạ** khi ghi lại. Người xây dựng kiểm tra `applyMutation` / `updateFlow` và `sync-merge.js` xem có lọc khối hay trường không, rồi viết test cho trường hợp này. Nếu có lọc thì sửa ở bản này. Bản đã cài ở máy người khác thì không sửa được, nên chỉ ghi lại hạn chế đó.

### 7.8 Chi tiết đã chốt sau khi review *(lựa chọn của Claude)*

- **Biến script nhận được:** `runLogic` nhận **toàn bộ** biến mà khối nhìn thấy. Đó là output của các khối phía trước (khối gần nhất thắng; tên bị xung đột thì bỏ ra và Console cảnh báo), cộng với toàn bộ environment đang chọn. Request script hiện cũng nhận cả environment, nên làm thế này là nhất quán. Nhờ vậy `toObject()` và tên tạo động dùng được.
  - Dấu vân tay chỉ tính các biến environment tìm được khi quét (7.3). Sửa một biến env mà script chỉ đọc qua tên tạo động sẽ **không** làm khối outdated. Đây là giới hạn đã chấp nhận.
- **Biến tùy chọn:** chỉ những tên đọc bằng `get('x')` mới là **bắt buộc** (thiếu thì ! Missing). Tên chỉ xuất hiện trong `has('x')` là tùy chọn: vẫn hiện trên nhãn đường nối, nhưng thiếu thì không chặn Run.
- **Kiểu giá trị:** output của request và output của Logic giữ nguyên kiểu khi vào script. Biến environment luôn là chữ, nên script cần tự `Number(...)` khi cần. Gợi ý trong tab Script nhắc điều này. Khi thay vào `{{}}`, `withFlowVars` đã đổi sẵn thành chữ, nên không cần sửa `vars.js`.
- **Giới hạn kích thước:** các output khi chuyển sang JSON vượt 1 MB thì khối failed với lỗi "Output `x` is too large (max 1 MB)".
- **Tên output:** áp dụng cùng quy tắc với tên output của request. Tên trùng nhau trong cùng một khối thì không cho thêm. Trùng với biến env hoặc với output của khối khác thì xử lý theo quy tắc khối gần nhất thắng và quy tắc xung đột sẵn có, không thêm quy tắc mới.
- **Runner riêng cho flow:** mỗi lần chạy flow dùng một `createScriptRunner` riêng, để script của flow không phải xếp hàng sau script của Send thủ công. Runner có thêm `cancel()`: script đang chạy thì gỡ iframe của nó, script đang chờ thì bỏ đi. Stop gọi hàm này.
- **Run from here:** bản chụp so sánh khối Logic theo `kind`, `script` và tên `outputs`. Sửa script của một khối phía trước thì khối đó *outdated* và có cảnh báo "Using outputs from an earlier run", giống sửa request. Thêm, bớt hoặc đổi tên output phía trước thì tắt Run from here, giống quy tắc output hiện có.

## 8. Để người xây dựng tự quyết

- Cách chia module. Gợi ý: `src/lib/logic-block.js` (quét `fw.vars.get`, kiểm tra kết quả trả về, dấu vân tay), mở rộng `script-runtime.js` với `runLogic`, chạy `npm run sync` để sinh lại sandbox.
- Tên chính xác các trường kết quả và các message sandbox.
- Mức cắt khi hiển thị `value` và log.
- Cách "Detect" đọc `return { … }`. Nếu không làm được gọn thì bỏ nút này.
- Kiểm tra giao diện bằng trình duyệt tự động như các tính năng trước. Logic thuần có test `node --test`: quét biến, chạy và skip, outdated, kiểm tra kết quả trả về, đồng bộ với bản cũ.
