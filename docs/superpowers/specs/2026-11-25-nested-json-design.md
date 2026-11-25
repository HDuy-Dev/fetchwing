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
