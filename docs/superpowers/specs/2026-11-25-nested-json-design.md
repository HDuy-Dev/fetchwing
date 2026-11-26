# Xem và sửa JSON nằm trong chuỗi

## Mục đích
API hay trả một field là cả JSON bị đóng thành chuỗi (ví dụ `product_details`). Cần xem và sửa phần bên trong như JSON bình thường trong DevTools.

## Mục tiêu / không làm
- Làm: xem dạng cây ở response và body mock; sửa từng chuỗi JSON ở mock.
- Không làm: popup trên toolbar, sửa response, tìm kiếm trong cây.
- Không được xảy ra: field vốn là chuỗi biến thành object trong dữ liệu mock trả về, hoặc phần không sửa bị đổi.

## Cách làm
- **Đã chọn (A):** nút sửa riêng ở từng chuỗi JSON. Biết chắc chuỗi nào cần đóng lại.
- Loại (B): bung cả body trong một ô sửa. Phải nhớ field theo vị trí, đổi tên key hay đảo mảng là có thể đóng sai mà không báo.
- Loại: đánh dấu trong text (`{"$json": …}`). Khó đọc, có thể trùng dữ liệu thật.

## Xem (response và mock)
- Chuỗi nào parse ra object hoặc array không rỗng thì hiện thành cây con, có nhãn "JSON string". Chuỗi khác (kể cả `"123"`, `"{}"`, JSON sai) giữ nguyên.
- Áp dụng cho mọi tầng, kể cả khi cả body là một chuỗi JSON thì giữ cách hiện như hiện nay.
- Gập/mở, "Collapse all", số dòng và việc tự gập khi dữ liệu lớn hoạt động như các khối khác. Mặc định mở.
- Copy và Raw vẫn là dữ liệu gốc.

## Sửa (chỉ mock)
- Mỗi dòng mở của chuỗi JSON có nút sửa, nhãn `aria-label` "Edit JSON string <key>".
- Bấm vào: vùng body thành ô text chứa JSON bên trong, thụt 2 khoảng trắng, phía trên ghi "Editing: <đường dẫn>" và hai nút "Cancel", "Done". Chữ tiếng Anh như phần còn lại của app. Nút sửa cả body và nút gập ẩn đi trong lúc này.
- "Done": JSON sai cú pháp, hoặc không còn là object/array, thì hiện lỗi (`role="alert"`), giữ ô text và không lưu. Đúng thì đóng lại thành chuỗi và lưu mock.
- Chỉ lưu khi bấm "Done". "Cancel" bỏ thay đổi. Không sửa gì mà bấm "Done" thì body giữ nguyên từng ký tự.
- Chỉ chuỗi vừa sửa bị thay trong body, phần còn lại giữ nguyên văn bản. Chuỗi nằm sâu nhiều tầng thì đóng lại lần lượt từng tầng.
- Bên trong chuỗi: bản gốc viết gọn thì lưu gọn, bản gốc nhiều dòng thì lưu thụt 2 khoảng trắng. Giá trị số và thứ tự key giữ đúng như người dùng thấy và gõ (không làm tròn số lớn). Cách escape có thể khác bản gốc (ví dụ `\/` hay `é`) nhưng giá trị không đổi.
- Sau khi lưu hoặc hủy, trở về cây và đưa focus về nút sửa vừa bấm.

## Ràng buộc
- Không thêm thư viện, không bước build mới.
- Logic nhận diện chuỗi JSON và thay chuỗi trong body là hàm thuần trong `src/lib/`, có test `node --test`.

## Để người làm tự quyết
Tên file, hàm, cách vẽ nhãn và nút.

## Bổ sung: sửa cả body ở dạng đã format

### Vì sao
Nút sửa riêng ở từng chuỗi khó thấy. Cần bấm bút chì lớn của Body là sửa được mọi thứ ở dạng format.

### Cách làm
- **Đã chọn (1):** bút chì lớn mở cả body đã format, chuỗi JSON được bung ra.
- Loại (2): sửa ngay trên cây. Nhanh khi đổi một giá trị, nhưng thêm, xóa, dán cả khối vẫn cần ô sửa.
- Thay cho lý do loại cách B ở trên: rủi ro đóng sai được xử lý bằng các quy tắc dưới đây.

### Hành vi (chỉ khi body là object hoặc array; body khác giữ cách sửa cũ, tự lưu)
- Ô text hiện body thụt 2 khoảng trắng, mọi tầng chuỗi JSON được bung thành object/array.
- Có "Cancel" và "Done", chỉ lưu khi bấm "Done" (thay cho tự lưu: JSON gõ dở không đóng lại được). JSON sai thì báo lỗi và không lưu.
- Field vốn là chuỗi JSON được nhận lại theo đường dẫn key. Nếu ở đó là object/array thì đóng lại thành chuỗi; nếu người dùng gõ thành giá trị khác thì giữ nguyên giá trị đó.
- Mảng: nếu trong dữ liệu gốc, mọi giá trị object/array ở cùng vị trí của các phần tử đều là chuỗi JSON thì phần tử mới, chèn hay đổi chỗ cũng được đóng thành chuỗi.
- Không chắc thì không lưu ngay: (a) một field vốn là chuỗi JSON không còn ở đường dẫn cũ (đổi tên, di chuyển, xóa); (b) mảng lẫn cả chuỗi JSON lẫn object thật ở cùng vị trí mà bị thêm, bớt hay đổi chỗ phần tử. Hiện cảnh báo nêu tên field và nút "Save anyway". Sửa tiếp trong ô text thì cảnh báo biến mất.
- Không sửa gì mà bấm "Done" thì body giữ nguyên từng ký tự. Có sửa thì body ngoài được viết lại: gốc một dòng thì lưu gọn, gốc nhiều dòng thì thụt 2. Chuỗi JSON có nội dung không đổi giữ nguyên văn bản gốc. Không làm tròn số.
- Mock bị đổi từ nơi khác trong lúc sửa: "Done" cảnh báo "The mock body changed while you were editing" và cần "Save anyway".

### Nút sửa riêng
Giữ lại, đổi thành nút có viền gồm icon và chữ "Edit" cho dễ thấy.
