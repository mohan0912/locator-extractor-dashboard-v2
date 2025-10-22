# 🧭 Locator Extractor Dashboard (v2)

An **enterprise-ready Playwright-powered web automation utility** for capturing and exporting locators, attributes, and AI-ready prompts from any website.  
This dashboard enables testers, automation engineers, and QA developers to **visually select elements** or **auto-scan entire pages** and generate **framework-specific locators or test steps** — including Playwright, Selenium, Cypress, Robot Framework, BDD (Cucumber), or your custom automation framework.

---

## 🚀 Key Features

✅ **Multi-framework Prompt Support**
- Supports Playwright, Selenium, Cypress, Robot Framework, and Cucumber.
- Allows defining **custom frameworks** via your own example syntax.

✅ **Element Capture**
- Use **Ctrl + Click** (or Cmd + Click on Mac) to capture elements on any page.
- Captures full element metadata: tag, id, class, aria-label, CSS selector, XPath, visibility, etc.

✅ **Smart Tag / Attribute Filters**
- Restrict scanning to specific tags or attributes (`button,input,a,[data-test-id]`, etc.).

✅ **Hidden Elements Support**
- Option to include elements even if not visible on the page.

✅ **Cross-origin, iframe & Shadow DOM Support**
- Handles multi-frame or shadow-root DOMs transparently.

✅ **Real-time WebSocket Logs**
- Displays live extraction progress, errors, and completion messages on the web dashboard.

✅ **Concurrent Safe File Output**
- Writes results atomically to `output/` folder with timestamps.

✅ **Enterprise Mode Ready**
- Works in interactive mode for manual exploration.
- Can also run headless in CI/CD pipelines (CLI mode).

✅ **Proxy & Network Flexibility**
- Optional proxy support for corporate networks.
- Configurable dashboard port for local environments.

---

## 🧩 Project Structure

```
locator-extractor-dashboard-v2/
│
├── src/
│   ├── core/
│   │   ├── extractor.js        # Main extraction logic (Playwright engine)
│   │   └── utils.js            # Shared utility helpers
│   ├── services/
│   │   ├── server.js           # Express.js + WebSocket server for dashboard
│   │   ├── dashboard.html      # Web-based user interface
│   │   └── style.css           # UI styling
│   ├── config/
│   │   └── extractor.config.js # Default configuration
│   └── index.js                # CLI entry point
│
├── output/                     # Saved extraction results
│   ├── locators_<timestamp>.json
│   └── copilot_prompts_<framework>_<timestamp>.txt
│
└── package.json
```

---

## ⚙️ Installation

```bash
# 1️⃣ Clone the repository
git clone https://github.com/<your-org>/locator-extractor-dashboard-v2.git
cd locator-extractor-dashboard-v2

# 2️⃣ Install dependencies
npm install

# 3️⃣ Run dashboard (Express + WebSocket)
npm run dashboard
```

Once started:
```
✅ Dashboard running at http://localhost:3000
```

> 💡 You can also customize the port:
> ```bash
> set PORT=4000
> npm run dashboard
> ```
> The dashboard will then be available at `http://localhost:4000`.

---

## 🖥️ Using the Dashboard (UI Mode)

1. Open your browser → [http://localhost:3000](http://localhost:3000)
2. Enter:
   - **Application URL** – e.g., `https://enterprise.company.com/home`
   - **Tag Filter** – e.g., `button,input,a,[data-test-id]`
   - **Automation Framework** – choose from dropdown
   - *(Optional)* If you choose **Custom Framework**, provide an example of how your elements are defined.
3. Check **Scan hidden elements** if needed.
4. Click **Start Extraction**.

You can now:
- Manually **Ctrl + Click** on elements to capture them.
- View captured items in real-time in the log console.
- When done, click **Stop Extraction**.

The browser will close automatically and your files will appear in:
```
output/
├── locators_2025-10-21_11-30-01.json
└── copilot_prompts_playwright_2025-10-21_11-30-01.txt
```

---

## ⚡ CLI Mode (Headless / Automation Mode)

You can run the extractor directly via command line without UI.

```bash
node src/index.js --url https://example.com   --framework playwright   --promptType locator   --scanHidden   --tagFilter button,input,a
```

### CLI Flags

| Flag | Description | Default |
|------|--------------|----------|
| `--url` | Target application URL | **Required** |
| `--framework` | Target automation framework (`playwright`, `selenium`, `cypress`, `robot`, `custom`) | `playwright` |
| `--promptType` | Type of AI prompt to generate (`locator`, `action`, `assertion`) | `locator` |
| `--scanHidden` | Whether to include hidden elements | `false` |
| `--tagFilter` | Comma-separated element tag/attribute filters | `null` |
| `--outputDir` | Folder for saving results | `output` |
| `--headless` | Run browser in headless mode | `false` |
| `--customExample` | Example locator syntax for custom frameworks | `""` |
| `--proxyUrl` | Optional proxy server (e.g., `http://proxy.corp.local:8080`) | `null` |
| `--proxyUser` | Proxy username (if required) | `null` |
| `--proxyPass` | Proxy password (if required) | `null` |

---

## 🌐 Proxy Usage (Optional)

Locator Extractor supports **optional proxy configuration** for users working inside corporate or restricted networks.  
If your environment requires routing traffic through a proxy, you can configure it easily.  
If not — just ignore this section. The tool will connect directly without any proxy.

---

### 🔹 1. Environment Variable Method (Recommended)

Set your proxy once in the terminal before starting the dashboard or CLI.

#### Windows (PowerShell)
```bash
set HTTPS_PROXY=http://proxy.corp.local:8080
set PROXY_USER=myusername
set PROXY_PASS=mypassword
npm run dashboard
```

#### macOS / Linux
```bash
export HTTPS_PROXY=http://proxy.corp.local:8080
export PROXY_USER=myusername
export PROXY_PASS=mypassword
npm run dashboard
```

> 💡 Tip: You can omit `PROXY_USER` and `PROXY_PASS` if your proxy does not require authentication.

---

### 🔹 2. CLI Argument Method

You can also pass proxy details directly when running the extractor CLI:

```bash
node src/index.js --url https://example.com   --proxyUrl http://proxy.corp.local:8080   --proxyUser alice   --proxyPass Secret123
```

**Notes:**
- All proxy parameters are **optional**.
- If both environment variables and CLI args are provided, **CLI args take priority**.
- Proxy credentials are **never logged or displayed**.

---

### 🔹 3. Quick Connectivity Test (Optional)

To verify your proxy before running the extractor, run:
```bash
node test-proxy.js
```

This checks that Playwright can reach `https://example.com` using your proxy configuration.

---

### 🔹 4. No Proxy Mode (Default)

If you’re on a normal unrestricted network, simply run:
```bash
node src/index.js --url https://example.com
```

No proxy setup is required — the tool automatically connects directly.

---

### ✅ Proxy Summary

| Mode | Proxy | Auth | How to Configure |
|------|--------|------|------------------|
| No Proxy | ❌ | – | *(default)* |
| Proxy (no auth) | ✅ | ❌ | `HTTPS_PROXY=http://proxy:8080` |
| Proxy (with auth) | ✅ | ✅ | Add `PROXY_USER`, `PROXY_PASS` |
| CLI Proxy | ✅ | ✅/❌ | `--proxyUrl`, `--proxyUser`, `--proxyPass` |
| Auto-detect | ✅ | ✅ | Reads environment automatically |

---

## 🧾 Logs

Logs are visible both in:
- **Dashboard UI (pre#log)** — live WebSocket stream  
- **Terminal Console** — server + extractor logs

Log levels:
- 🟢 `SUCCESS` → extraction complete or saved
- 🔵 `INFO` → progress messages
- 🟡 `WARN` → non-blocking issues
- 🔴 `ERROR` → serious issues or unhandled exceptions

---

## 🪶 File Output Format

| File | Description |
|-------|--------------|
| `locators_<timestamp>.json` | Structured JSON of all captured elements |
| `copilot_prompts_<framework>_<timestamp>.txt` | AI-ready prompts for GitHub Copilot, ChatGPT, or custom LLM integrations |

---

## ⚠️ Troubleshooting

| Issue | Cause | Fix |
|--------|--------|-----|
| “automationFramework is not defined” | Old reference in extractor | Ensure `attachPage()` destructures `automationFramework` and `customExample` |
| “Saved 0 prompts” | No elements captured | Make sure to **Ctrl + Click** elements or enable **Scan hidden elements** |
| “Cannot GET /” | Wrong static path | Ensure `dashboard.html` is in the same folder as `server.js` |
| “WebSocket connection lost” | Server restarted during session | Refresh browser, the dashboard auto-reconnects |
| “Navigation warning” | Invalid or internal URL | Ensure you use a valid `http` or `https` target |
| “Proxy connection failed” | Wrong proxy or credentials | Run `node test-proxy.js` to confirm connectivity |

---

## 🧩 Tech Stack

- **Playwright** (browser automation)
- **Express.js + WebSocket** (real-time communication)
- **Vanilla JS + HTML/CSS** (lightweight frontend)
- **Node.js** (backend runtime)

---

## 🏁 Example Workflow

1. `npm run dashboard`
2. Open `http://localhost:3000`
3. Enter your app URL (e.g., `https://enterprise.company.com`)
4. Ctrl + Click to capture elements
5. Stop extraction
6. View your saved results under `/output/`

```
[INFO] Saved 27 locators -> output/locators_2025-10-21_11-17-43.json
[INFO] Saved 27 prompts -> output/copilot_prompts_playwright_2025-10-21_11-17-43.txt
[SUCCESS] ✅ Extraction stopped and browser closed.
```

---

**Enjoy effortless locator generation and AI-assisted automation! 🎯**
