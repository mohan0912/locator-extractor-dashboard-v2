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

## 🧠 JSON Output Example

```json
[
  {
    "tag": "button",
    "id": "submit",
    "class": "btn primary",
    "text": "Login",
    "css": "form > button#submit",
    "xpath": "/html/body/div[2]/form/button[1]",
    "ariaLabel": null,
    "visible": true,
    "framework": "React",
    "pageUrl": "https://enterprise.company.com/login"
  }
]
```

---

## 🤖 AI Prompt Output Example (`copilot_prompts_playwright_*.txt`)

```
You are an automation expert using Microsoft Playwright (TypeScript/JavaScript).
Generate the most stable Playwright locator using page.getByRole, page.getByTestId, or page.locator.

Element details:
{
  "tag": "button",
  "id": "submit",
  "text": "Login",
  "css": "form > button#submit"
}

Return only the Playwright locator statement (e.g. page.getByTestId('login-button'));
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

---

## 🧰 Advanced Options

### 🔹 Custom Framework Mode
Select **“Custom Framework”** from the dropdown and enter an example such as:
```js
this.loginButton = page.findElement("[data-test=login]");
```
The AI prompt generator will adapt to your syntax when generating element definitions.

---

## 🧩 Architecture Overview

| Component | Responsibility |
|------------|----------------|
| `dashboard.html` | Frontend UI for user interaction and log streaming |
| `style.css` | Styled UI (inline toggle alignment, light design) |
| `server.js` | Express + WebSocket layer to communicate between frontend and Playwright extractor |
| `extractor.js` | Main Playwright engine handling element capture, frame injection, XPath/CSS computation, and prompt building |
| `utils.js` | Shared file helpers: timestamp, deduplication, directory creation, atomic writes |
| `index.js` | CLI entrypoint (headless automation mode) |

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
| “`automationFramework is not defined`” | Old reference in extractor | Ensure `attachPage()` destructures `automationFramework` and `customExample` |
| “Saved 0 prompts” | No elements captured | Make sure to **Ctrl + Click** elements or enable **Scan hidden elements** |
| “Cannot GET /” | Wrong static path | Ensure `dashboard.html` is in the same folder as `server.js` |
| “WebSocket connection lost” | Server restarted during session | Refresh browser, the dashboard auto-reconnects |

---

## 🧩 Tech Stack

- **Playwright** (browser automation)
- **Express.js + WebSocket** (real-time communication)
- **Vanilla JS + HTML/CSS** (lightweight frontend)
- **Node.js** (backend runtime)

---


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
