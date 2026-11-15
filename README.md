# OpenCode Pentest Config — AI-Assisted Web CTF Solver

> Repo đồng bộ cấu hình OpenCode giữa các máy. Repo không chứa token, mật khẩu,
> cache, log phiên làm việc, backup hoặc dependency đã cài.

## Cài trên máy mới

### 1. Yêu cầu

- OpenCode
- Git
- Node.js và npm
- Bun cho plugin dùng Bun
- `codegraph` nếu bật CodeGraph MCP
- Burp Suite MCP tại `127.0.0.1:9876` nếu dùng Burp MCP

### 2. Clone và sao lưu

```bash
git clone git@github.com:ngngocatr/opencode-config.git ~/opencode-config
mkdir -p ~/.config
cp -a ~/.config/opencode ~/.config/opencode.backup-$(date +%Y%m%d-%H%M%S)
mkdir -p ~/.config/opencode
```

Nếu máy mới chưa có `~/.config/opencode`, bỏ qua lệnh `cp -a`.

### 3. Chép cấu hình

```bash
cd ~/opencode-config
cp AGENTS.md opencode.json tui.json package.json package-lock.json bun.lock ~/.config/opencode/
cp -a agents instructions skills plugins opencode-skills-sidebar ~/.config/opencode/
cd ~/.config/opencode
npm ci
cd opencode-skills-sidebar
bun install
bun run build
```

### 4. Cài repo phụ

Các repo phụ không được nhúng vào repo cấu hình. Cài riêng để tránh Git repo lồng nhau và cache build.

```bash
cd ~/.config/opencode

git clone https://github.com/silicon-works/opensploit-plugin.git
cd opensploit-plugin
bun install
bun run build

cd ~/.config/opencode/plugins
git clone https://github.com/jus1-c/opencode-vilao-provider.git
cd opencode-vilao-provider
npm ci
npm run build
```

Source `opencode-skills-sidebar` được đồng bộ trong repo và build tại bước trước.

### 5. Cấu hình secret

Không commit `.env`. Tạo token trên máy mới rồi export qua shell hoặc secret manager:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN='your-token'
```

`opencode.json` chỉ tham chiếu `{env:GITHUB_PERSONAL_ACCESS_TOKEN}`.

### 6. Kiểm tra và khởi động

```bash
cd ~/.config/opencode
opencode debug config
opencode
```

Thoát và khởi động lại OpenCode sau mọi thay đổi cấu hình.

## Nội dung được đồng bộ

- `opencode.json`, `tui.json`, `AGENTS.md`
- `agents/`, `instructions/`, `skills/`, `plugins/`, `opencode-skills-sidebar/`
- `package.json` và lockfile để cài dependency đúng phiên bản
- `.env.example` chỉ liệt kê tên biến môi trường

## Nội dung bị loại

- Token, mật khẩu, `service.json`, `.env`, credential và private key
- `node_modules`, cache, log, JSONL, backup và trạng thái phiên
- Repo Git lồng nhau; README ghi nguồn và cách cài riêng

Trước khi push, luôn kiểm tra `git diff --cached` và chạy secret scanner.
`.secretlintignore` chỉ loại ví dụ Basic Auth giả đã được kiểm tra thủ công.

> A custom [OpenCode](https://opencode.ai/) configuration that turns an AI coding agent into a structured **Web CTF solving assistant** — with a 4-phase methodology, a modular skill library organized by vulnerability class, and MCP integration with Burp Suite, browser automation, and code analysis tools.

![Status](https://img.shields.io/badge/status-in%20progress-blue)
![Platform](https://img.shields.io/badge/platform-OpenCode-black)
![Focus](https://img.shields.io/badge/focus-AI%20%2B%20offensive%20security-red)
![License](https://img.shields.io/badge/license-MIT-green)

---

## 📖 About

This repository contains my personal OpenCode configuration for **AI-assisted web CTF solving**. Rather than treating an AI agent as a generic chatbot, I've structured it as a **methodical pentester**: it must recon first, form hypotheses, exploit, and verify.

The configuration has three layers:

1. **Agent behavior** — defined in `AGENTS.md`, which encodes role, rules, workflow, and tool routing.
2. **Skill library** — modular, per-vulnerability-class instructions in `skills/`, loaded on demand.
3. **Tooling & infrastructure** — MCP servers, plugins, and model provider config in `opencode.json`.

**Goal:** automate the repetitive parts of CTF solving (recon, enumeration, payload iteration) while keeping **manual verification in the loop** — the agent proposes, I confirm.

---

## 🏗️ Architecture

```text
opencode-pentest-config/
├── AGENTS.md                    # Agent role, rules, 4-phase workflow, tool routing
├── opencode.json                # MCP servers, plugins, model provider
├── skills/                      # Modular skill library by vulnerability class
│   ├── 1_injection/             # SQLi, NoSQLi, SSTI, CMDi, JNDI, prototype pollution, LLM prompt injection
│   ├── 2_clientside/            # XSS, CSRF, clickjacking
│   ├── 3_serverside/            # SSRF, path traversal, file upload
│   ├── 4_auth/                  # JWT, session, weak credentials
│   ├── 5_logic/                 # Race conditions, business logic
│   ├── 6_meta/                  # Routing, context management
│   └── ctf-skills/              # Aggregated CTF skill set
├── plugins/                     # Custom plugins (opensploit wrapper, caveman, quota)
├── tui.json                     # Terminal UI configuration
└── package.json                 # Dependencies
```

---

## 🎯 The 4-Phase Workflow

Encoded in `AGENTS.md`, every challenge is approached in four mandatory phases:

| Phase | What happens | Output |
|---|---|---|
| **1. Reconnaissance** | Enumerate endpoints, parameters, headers, tech stack | `notes.md` per challenge |
| **2. Vulnerability Analysis** | Match observations against known vulnerability classes; form a hypothesis | Candidate vuln class + reasoning |
| **3. Exploitation** | Craft payloads, iterate with Burp/curl/browser | `payloads.md` with tested payloads |
| **4. Flag Capture & Verification** | Confirm the flag, re-verify the exploit path | Final write-up entry |

The agent is explicitly instructed **not to skip recon** and **not to jump to payloads before forming a hypothesis** — the same discipline that distinguishes a pentester from a script kiddie.

---

## 🧰 Tooling & Integrations

### MCP servers (in `opencode.json`)

| MCP | Purpose |
|---|---|
| **Burp Suite MCP** (`127.0.0.1:9876`) | Interact with Burp's proxy, repeater, and scanner programmatically |
| **CloakBrowser** | Browser automation for client-side and DOM-based challenges |
| **CodeGraph** | Static analysis of source code when the challenge provides it |

### Plugins

- **`opensploit`** — offensive-security agent wrapper
- **`quota`** — rate-limit / token-budget management
- **`caveman`** — token-saving output mode (see below)

### Token efficiency: "caveman" mode

To keep long CTF sessions within token budget, the config uses a **caveman output mode** — the agent compresses its reasoning, filters tool output with `grep`/`head`/`jq` before reading, and avoids pasting raw dumps. Logs are written to `.caveman-mode-log.jsonl` for review.

---

## 📚 Skill Library

Skills are organized by vulnerability class and loaded on demand — the agent only pulls in what's relevant to the current hypothesis.

| Group | Skills included |
|---|---|
| **Injection** | SQL injection, NoSQL injection, SSTI, OS command injection, JNDI injection, prototype pollution, **LLM prompt injection** |
| **Client-side** | XSS (reflected / stored / DOM), CSRF, clickjacking |
| **Server-side** | SSRF, path traversal, file upload |
| **Authentication** | JWT flaws, session management, weak credentials |
| **Business logic** | Race conditions, logic flaws |
| **Meta** | Routing, context management, self-correction |

The inclusion of **LLM prompt injection** reflects awareness of the OWASP Top 10 for LLM Applications — a category that's increasingly relevant in modern bug bounty programs.

---

## 🚀 Setup

### Requirements

- [OpenCode](https://opencode.ai/) installed (`npm install -g opencode-ai`)
- **Burp Suite** running with the MCP server enabled on `127.0.0.1:9876`
- A model provider API key (configured in `opencode.json`)

### Installation

Follow **Cài trên máy mới** at the start of this README. Keep provider and MCP
secrets in environment variables, never in `opencode.json`.

### Usage

```bash
# Start Burp Suite with MCP server on port 9876 first
opencode
```

Then describe the challenge to the agent (target URL, credentials, objective). The agent will follow the 4-phase workflow and log its work in `~/ctf-repo/<challenge-name>/`.

---

## 📊 Results

> *(This section will grow as I use the configuration on real challenges.)*

Challenges solved with this configuration will be listed here, with links to write-ups where available:

| Challenge | Platform | Category | Time | Notes |
|---|---|---|---|---|
| *(coming soon)* | | | | |

The intent is to **measure whether the agent actually speeds up solving** — not to claim it does. Comparative notes (agent-assisted vs. manual) will be recorded here.

---

## 🔍 Design Decisions

**Why a structured workflow instead of a free-form agent?**
Free-form AI agents tend to jump to payloads. Encoding a 4-phase workflow forces the agent to match my own pentest discipline — and makes its output auditable, since every phase leaves a trace in `notes.md` and `payloads.md`.

**Why a skill library instead of one giant prompt?**
Loading only the relevant skill keeps context focused and reduces token waste. It also makes each skill independently editable — improving SQLi doesn't risk breaking the XSS skill.

**Why MCP over shell-out tools?**
MCP gives the agent **structured access** to Burp and the browser instead of fragile parsing of terminal output. When MCP isn't available, the agent falls back to `curl`/`bash` — but MCP is preferred.

**Why keep manual verification in the loop?**
An AI agent can hallucinate a flag or misread a response. Every exploit path it proposes gets manually confirmed before being recorded as solved. The agent is a **force multiplier**, not an oracle.

---

## ⚖️ Disclaimer

This configuration is intended for **CTF competitions, personal lab environments, and systems you have explicit written permission to test**. Using an automated offensive agent against unauthorized targets is illegal and unethical. The author assumes no liability for misuse. Always verify the agent's actions before executing them, especially destructive ones.

---

## 📄 License

Released under the [MIT License](./LICENSE).
