# 🧭 Locator Extractor Dashboard (v2.1 – Enterprise Edition)

An **enterprise-grade Playwright automation dashboard** that allows QA engineers to visually or automatically extract element locators, metadata, and AI-ready prompts from any website.  
It supports both **interactive UI mode** and **headless CLI mode**, making it perfect for manual exploration and CI/CD pipelines alike.

---

## ⚙️ Highlights

✅ **Multi-framework AI Prompt Support**  
Generate prompts for Playwright, Selenium, Cypress, Robot Framework, BDD (Cucumber), or your **custom syntax**.

✅ **Two Extraction Modes**  
- **Manual:** Use Ctrl/Cmd + Click to capture elements.  
- **Auto:** Perform full-page scanning with Smart DOM Walker.

✅ **Smart Filtering**  
Restrict scans by tags or attributes (`button,input,a,[data-test-id]`, etc.).

✅ **Iframe + Shadow DOM Support**  
Automatically injects capture scripts across all frames and shadow roots.

✅ **Enterprise-safe Proxy Support**  
Works behind authenticated proxies using environment variables or CLI flags.

✅ **Real-time WebSocket Logs**  
Live progress and errors streamed to the dashboard UI and terminal.

✅ **Atomic Output Handling**  
Thread-safe JSON/TXT saves with timestamped filenames.

✅ **Cross-platform Ready**  
Runs on Windows, macOS, and Linux (Node ≥ 18 required).

---

## 🧩 Folder Overview

```
locator-extractor-dashboard-v2/
│
├── logs/                      # Optional runtime logs
├── output/                    # JSON + AI prompt output
│   ├── locators_<timestamp>.json
│   └── copilot_prompts_<framework>_<timestamp>.txt
│
├── src/
│   ├── config/
│   │   └── extractor.config.js   # Default runtime settings
│   ├── core/
│   │   ├── extractor.js          # Playwright engine & logic
│   │   └── utils.js              # Shared helpers
│   ├── services/
│   │   ├── dashboard.html        # Web dashboard UI
│   │   ├── style.css             # Dashboard styling
│   │   └── server.js             # Express + WebSocket server
│   ├── tools/
│   │   └── test-proxy.js         # Proxy connectivity tester
│   └── index.js                  # CLI entry point
│
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

---

## 🚀 Quick Start

### 1️⃣ Install

```bash
git clone https://github.com/<your-org>/locator-extractor-dashboard-v2.git
cd locator-extractor-dashboard-v2
npm install
```

### 2️⃣ Launch Dashboard (UI Mode)

```bash
npm run dashboard
```

Open [http://localhost:3000](http://localhost:3000)

### 3️⃣ Extract Locators

1. Enter:
   - **URL:** e.g., `https://enterprise.company.com/login`
   - **Tag Filter:** `button,input,a`
   - **Framework:** Playwright / Selenium / etc.
2. (Optional) Toggle:
   - **Generate AI Prompts**
3. Click **Start Extraction** → Ctrl/Cmd + Click elements to capture.
4. Click **Stop Extraction** to save files.

Results appear under `/output/`:
```
locators_2025-10-24_01-41-02.json
copilot_prompts_playwright_2025-10-24_01-41-02.txt
```

---

## ⚡ CLI / Headless Mode

```bash
node src/index.js   --url https://example.com   --framework selenium   --tagFilter button,input,a   --headless true   --generatePrompts true
```

| Flag | Description | Default |
|------|--------------|----------|
| `--url` | Target URL *(required)* | – |
| `--framework` | playwright \| selenium \| cypress \| robot \| bdd \| custom | playwright |
| `--promptType` | locator \| action \| assertion | locator |
| `--tagFilter` | Comma-separated filters | null |
| `--headless` | Run browser headless | false |
| `--outputDir` | Output folder | output |
| `--customExample` | Example syntax for custom framework | "" |
| `--proxyUrl`, `--proxyUser`, `--proxyPass` | Proxy configuration | null |

---

## 🌐 Proxy Configuration

### Option 1 — Environment Variables
```bash
export HTTPS_PROXY=http://proxy.corp.local:8080
export PROXY_USER=jane
export PROXY_PASS=Secret123
npm run dashboard
```

### Option 2 — CLI Flags
```bash
node src/index.js   --url https://example.com   --proxyUrl http://proxy.corp.local:8080   --proxyUser jane   --proxyPass Secret123
```

### Test Connectivity
```bash
node src/tools/test-proxy.js https://example.com
```

---

## 🧾 Logs

- **UI Console:** live feed under `<pre id="log">`
- **Server Console:** same logs with timestamps

Levels:  
🟢 SUCCESS 🔵 INFO 🟡 WARN 🔴 ERROR

---

## 🪶 Output Files

| File | Purpose |
|------|----------|
| `locators_*.json` | Structured metadata of all elements |
| `copilot_prompts_*.txt` | AI-ready prompts (Copilot/ChatGPT/LLM) |

All saves are **atomic** to prevent corruption in concurrent runs.

---

## 🧠 Tag / Attribute Filter Logic

Tag filters accept:
- Plain tags (`button`, `input`)
- Attribute selectors (`[data-test-id]`, `[role=button]`)
- Class (`.btn-primary`) or ID (`#login`) syntax  

Matching uses **case-insensitive smart comparison**, so mixed filters like  
`button,[data-test],.active` work seamlessly.

---

## 🧰 Troubleshooting

| Symptom | Fix |
|----------|-----|
| “Invalid or unsafe URL” | Must start with `http` or `https` |
| No elements captured | Ensure Ctrl + Click on visible elements |
| “Cannot GET /” | Keep `dashboard.html` next to `server.js` |
| Proxy fails | Verify with `node src/tools/test-proxy.js` |
| Auto-extract skips elements | Check tag/attribute filters and visibility rules |

---

## 🧩 Tech Stack

- **Playwright 1.43+**
- **Express 4.19 + WebSocket 8.17**
- **Vanilla HTML/CSS frontend**
- **Node 18+ Runtime**

---

## 🔒 Enterprise Readiness Checklist

| Capability | Status |
|-------------|---------|
| Safe URL validation | ✅ |
| Graceful error handling | ✅ |
| Proxy & auth support | ✅ |
| Atomic write operations | ✅ |
| WebSocket session isolation | ✅ |
| Configurable ports & output paths | ✅ |
| Iframe / Shadow DOM injection | ✅ |
| Cross-platform CI/CD (headless) | ✅ |
| Logging & audit-friendly output | ✅ |

---

## 🏁 Typical Workflow

```bash
npm run dashboard
# -> open http://localhost:3000
# -> extract locators visually
# -> output saved under /output/
```

or automated:

```bash
node src/index.js --url https://app.company.com --framework playwright --headless
```

---

### 🔮 Future Enhancements

- Hidden element scanning (for off-screen or conditional elements)
- Screenshot capture for selected elements
- Chrome DevTools protocol integration for advanced metadata

---

**Enjoy effortless, enterprise-grade locator extraction and AI-assisted automation! 🚀**
