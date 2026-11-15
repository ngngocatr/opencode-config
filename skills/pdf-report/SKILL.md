---
name: pdf-report
description: >-
  Tạo báo cáo PDF tiếng Việt từ phiên làm việc OpenCode. Use when người dùng yêu cầu "xuất báo cáo PDF", "tổng hợp công việc thành PDF", "tạo báo cáo", "lưu báo cáo sang máy Windows", hoặc muốn đóng gói kết quả phiên làm việc thành tài liệu PDF. Renders HTML/CSS to PDF via WeasyPrint.
when_to_use: Kích hoạt khi có yêu cầu tạo/tổng hợp/xuất báo cáo PDF.
metadata:
  audience: system-admin
  workflow: pdf-reporting
---

# PDF Report Skill

Tạo báo cáo PDF tiếng Việt chuyên nghiệp từ nội dung phiên làm việc OpenCode, dùng WeasyPrint (HTML/CSS → PDF).

## Nguyên tắc bắt buộc

1. **Không bịa nội dung.** Chỉ đưa vào báo cáo những gì thực tế đã xảy ra trong phiên làm việc hiện tại: lệnh đã chạy, output thực, file thực, kết quả thực. Nếu không có dữ liệu, ghi rõ "Không có" hoặc bỏ mục đó.
2. **Không lưu bí mật.** Không ghi mật khẩu, API key, token, hash password, hoặc thông tin nhạy cảm khác vào báo cáo. Nếu gặp trong output, thay bằng `[REDACTED]`.
3. **Không ghi đè báo cáo cũ.** Luôn tạo tên file mới với timestamp.
4. **Không tự xóa báo cáo cũ.**
5. Báo cáo viết bằng **tiếng Việt**, giữ nguyên thuật ngữ kỹ thuật tiếng Anh (SQL, SSH, exploit, reverse shell, ...).
6. Ngắn gọn, đầy đủ ý, không dài dòng.

## Quy trình thực hiện

### Bước 1 — Thu thập nội dung

Tổng hợp từ phiên hiện tại:
- Mục tiêu và phạm vi công việc.
- Các lệnh đã chạy và output quan trọng (trích dòng quyết định, không dán toàn bộ log).
- File đã tạo/sửa, cấu hình đã thay đổi.
- Kết quả thực tế, lỗi phát sinh và cách xử lý.
- Kết luận và đề xuất.

### Bước 2 — Tạo HTML

Tạo file HTML tạm (ví dụ `/tmp/report.html`) với cấu trúc:

```
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: "DejaVu Sans", "Liberation Sans", sans-serif;
         font-size: 11pt; line-height: 1.5; color: #222; }
  h1 { color: #1a5276; border-bottom: 2px solid #1a5276; padding-bottom: 6px; }
  h2 { color: #1a5276; margin-top: 1.4em; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
  th { background: #eaf2f8; }
  pre, code { font-family: "DejaVu Sans Mono", monospace; font-size: 9pt;
              background: #f5f5f5; padding: 2px 4px; }
  pre { padding: 10px; border: 1px solid #ddd; border-radius: 4px;
        white-space: pre-wrap; word-wrap: break-word; }
  .meta { color: #555; font-size: 9.5pt; }
  .error { color: #b03a2e; }
  .ok { color: #1e8449; }
  img { max-width: 100%; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>
  <!-- nội dung -->
</body>
</html>
```

Quy tắc nội dung HTML:
- Dùng `h1` cho tiêu đề báo cáo, `h2` cho từng mục chính.
- Dùng `<table>` cho bảng biểu, `<pre><code>` cho lệnh và cấu hình.
- Dùng `<img src="file:///đường/dẫn/tuyệt/đối/ảnh.png">` cho ảnh minh họa.
- Thêm `<div class="page-break"></div>` để ngắt trang khi cần.

Các mục bắt buộc (theo đúng thứ tự, bỏ mục nào không có dữ liệu):
1. Tiêu đề báo cáo
2. Thời gian thực hiện
3. Mục tiêu
4. Các công việc đã thực hiện
5. Lệnh và cấu hình quan trọng
6. Kết quả thực tế
7. Lỗi phát sinh và cách xử lý
8. Kết luận và đề xuất

### Bước 3 — Chuyển thành PDF

Dùng script hỗ trợ (đã cài sẵn) để render và đặt tên file:

```bash
python3 ~/.config/opencode/skills/pdf-report/scripts/build_pdf.py \
  --html /tmp/report.html --title "Tên báo cáo"
```

Script sẽ tự:
- Phát hiện thư mục lưu mặc định (Shared Folder VMware/VirtualBox, nếu không có thì dùng `~/reports`).
- Đặt tên `report-YYYY-MM-DD-HHMMSS.pdf`.
- Trả về đường dẫn file PDF đã tạo.

Tùy chọn ghi đè thư mục lưu (nếu người dùng chỉ định):

```bash
python3 ~/.config/opencode/skills/pdf-report/scripts/build_pdf.py \
  --html /tmp/report.html --out /đường/dẫn/khác
```

### Bước 4 — Xác nhận và thông báo

- Kiểm tra file PDF tồn tại và dung lượng > 0.
- Báo cho người dùng đường dẫn tuyệt đối của file PDF.
- Xóa file HTML tạm nếu muốn (không bắt buộc).

## Phát hiện thư mục lưu (do script tự làm)

Thứ tự ưu tiên:
1. `/mnt/hgfs/ai-report-mnt` (VMware Shared Folder) — chỉ dùng khi mount là `vmhgfs-fuse` thật VÀ ghi được thực tế.
2. `/mnt/hgfs/AI-Reports` (VMware, nếu tồn tại).
3. `/media/sf_AI-Reports` (VirtualBox, nếu tồn tại).
4. `~/reports` (thư mục tạm trên Kali).

Quy tắc:
- **Không giả định** thư mục đã mount chỉ vì đường dẫn tồn tại. Script kiểm tra thực tế (loại mount + ghi file thử rồi xóa).
- Nếu không có Shared Folder hợp lệ, dùng `~/reports` và thông báo rõ chưa xuất trực tiếp sang Windows.
- Không tự sửa cấu hình máy Windows. Không tạo thư mục giả tại đường dẫn mount.

## Ghi chú môi trường (đã kiểm tra khi cài đặt)

- Kali Linux, virtualization: **VMware** (`vmware-vmblock` + `vmhgfs-fuse`).
- WeasyPrint: `62.3` (cài sẵn tại `/usr/bin/weasyprint`).
- Font hỗ trợ tiếng Việt: DejaVu Sans, Liberation Sans, Lato (đều có sẵn).
- Shared Folder VMware phát hiện: `/mnt/hgfs/ai-report-mnt` (mount `vmhgfs-fuse`, ghi được).
