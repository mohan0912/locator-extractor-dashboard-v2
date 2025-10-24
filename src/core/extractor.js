import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { getTimestamp, deduplicate, ensureDir, atomicWrite, getProxySettingsFrom } from "./utils.js";



/* Utilities */

function safeLog(wsBroadcast, level, msg) {
  const out = `[${new Date().toISOString()}] [${level}] ${msg}`;
  console.log(out);
  if (typeof wsBroadcast === "function") {
    try { wsBroadcast({ level, message: msg, timestamp: new Date().toISOString() }); } catch { }
  }
}

let activeBrowser = null;
let activeContext = null;
let stopRequested = false;
let resultsAlreadySaved = false;
let globalWsBroadcast = null;
let activeCDPClients = [];

// ============================================================================
// 🧠 Chrome DevTools Protocol (CDP) Helper - Advanced Metadata
// ============================================================================
async function getAdvancedMetadata(page, client, selector) {
  if (!selector || typeof selector !== "string" || selector.length === 0) return null;
  try {
    const { root } = await client.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) return null;

    // --- Computed CSS ---
    const { computedStyle } = await client.send("CSS.getComputedStyleForNode", { nodeId }).catch(() => ({ computedStyle: [] }));
    const styles = {};
    if (Array.isArray(computedStyle)) {
      for (const s of computedStyle) styles[s.name] = s.value;
    }

    // --- Accessibility info ---
    const { nodes } = await client.send("Accessibility.getPartialAXTree", { nodeId }).catch(() => ({ nodes: [] }));
    const accNode = Array.isArray(nodes) && nodes.length > 0 ? nodes[0] : {};
    const ariaRole = accNode.role?.value || null;
    const ariaName = accNode.name?.value || null;

    // --- Event listeners ---
    const { listeners } = await client.send("DOMDebugger.getEventListeners", { objectId: nodeId }).catch(() => ({ listeners: [] }));

    // --- Bounding Box ---
    const box = await page.evaluate(selector => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }, selector);

    // --- DOM Depth ---
    const domDepth = await page.evaluate(selector => {
      const el = document.querySelector(selector);
      if (!el) return 0;
      let depth = 0;
      let node = el;
      while (node.parentElement) {
        depth++;
        node = node.parentElement;
      }
      return depth;
    }, selector);

    // --- Data Attributes ---
    const dataAttributes = await page.evaluate(selector => {
      const el = document.querySelector(selector);
      if (!el) return {};
      const out = {};
      for (const attr of el.attributes) {
        if (attr.name.startsWith("data-") || attr.name.startsWith("qa-") || attr.name.startsWith("ng-")) {
          out[attr.name] = attr.value;
        }
      }
      return out;
    }, selector);

    // --- Framework Detection ---
    const frameworkType = await page.evaluate(() => {
      try {
        if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return "React";
        if (window.getAllAngularTestabilities) return "Angular";
        if (window.Vue) return "Vue";
        return "HTML";
      } catch {
        return "Unknown";
      }
    });

    return {
      zIndex: styles["z-index"] || null,
      opacity: styles["opacity"] || null,
      display: styles["display"] || null,
      visibility: styles["visibility"] || null,
      color: styles["color"] || null,
      font: styles["font-family"] || null,
      pointerEvents: styles["pointer-events"] || null,
      cursor: styles["cursor"] || null,
      backgroundColor: styles["background-color"] || null,
      ariaRole,
      ariaName,
      listeners: listeners?.map(l => l.type) || [],
      boundingBox: box,
      domDepth,
      dataAttributes,
      frameworkType
    };
  } catch (err) {
    return { error: err.message };
  }
}


/* Prompt builder */
function buildPrompt(
  payload,
  framework = "playwright",
  promptType = "locator",
  automationFramework = "",
  customExample = ""
) {
  const json = JSON.stringify(payload, null, 2);

  // 🧠 Case 1: Custom Framework (user-provided example)
  if (automationFramework === "custom" && customExample) {
    if (promptType === "action") {
      return `You are writing an automation step for a **custom framework**.
The user defines elements in this style:

${customExample}

Given this element:
${json}

Write a single test step that interacts with this element (click/type)
and includes a brief verification following the same coding pattern.
Return only the code.`;
    }

    if (promptType === "assertion") {
      return `You are writing an assertion for a **custom framework**.
The user defines elements in this style:

${customExample}

Given this element:
${json}

Write an assertion that validates visibility or expected state using the same style.
Return only the assertion code.`;
    }

    return `You are an automation engineer using a **custom test framework**.
The user defines elements in this style:

${customExample}

Given this element:
${json}

Generate the most stable locator or element definition consistent with that style.
Return only the code.`;
  }

  // 🧠 Case 2: Selenium (Java)
  if (framework === "selenium") {
    if (promptType === "action") {
      return `You are writing a Selenium WebDriver (Java) test step.
Given this element:
${json}

Write a single Java step that interacts with the element (click/type)
and includes a short verification. Return only the Java code.`;
    }
    if (promptType === "assertion") {
      return `You are writing a Selenium WebDriver (Java) assertion.
Given this element:
${json}

Write a Java assertion verifying visibility or expected state.
Return only the assertion code.`;
    }
    return `You are an automation expert using Selenium WebDriver (Java).
Generate the most stable locator (By.id, By.name, By.cssSelector, or By.xpath).

Element details:
${json}

Return only the Java locator statement (e.g. driver.findElement(By.cssSelector(...)));`;
  }

  // 🧠 Case 3: Playwright
  if (framework === "playwright") {
    if (promptType === "action") {
      return `You are writing an automation step in Playwright (TypeScript/JavaScript).
Given this element:
${json}

Write one Playwright line that interacts with the element (click/type)
and includes a simple verification. Return only the Playwright code.`;
    }
    if (promptType === "assertion") {
      return `You are writing an assertion in Playwright (TypeScript/JavaScript).
Given this element:
${json}

Write an assertion checking visibility or expected text/value.
Return only the Playwright assertion code.`;
    }
    return `You are an automation expert using Microsoft Playwright (TypeScript/JavaScript).
Generate the most stable Playwright locator using page.getByRole, page.getByTestId, or page.locator.

Element details:
${json}

Return only the Playwright locator statement (e.g. page.getByTestId(...));`;
  }

  // 🧠 Case 4: Cypress
  if (framework === "cypress") {
    if (promptType === "action") {
      return `You are writing an automation step using Cypress (JavaScript).
Given this element:
${json}

Write a single Cypress command (e.g. cy.get(...).click()) that interacts with the element
and includes a simple verification. Return only the Cypress code.`;
    }
    if (promptType === "assertion") {
      return `You are writing an assertion in Cypress (JavaScript).
Given this element:
${json}

Write a Cypress assertion validating visibility or expected state.
Return only the assertion line (e.g. cy.get(...).should('be.visible')).`;
    }
    return `You are an automation expert using Cypress (JavaScript).
Generate the most stable Cypress locator using cy.get(), cy.contains(), or custom selectors.

Element details:
${json}

Return only the Cypress locator statement (e.g. cy.get('[data-test="login"]')).`;
  }

  // 🧠 Case 5: Robot Framework
  if (framework === "robot") {
    if (promptType === "action") {
      return `You are writing a Robot Framework keyword test step.
Given this element:
${json}

Write a single Robot Framework line using SeleniumLibrary syntax (e.g. Click Element, Input Text)
that interacts with the element. Return only the test step line.`;
    }
    if (promptType === "assertion") {
      return `You are writing a Robot Framework assertion keyword.
Given this element:
${json}

Write a single assertion validating that the element is visible or contains expected text.
Return only the Robot Framework line.`;
    }
    return `You are an automation expert using Robot Framework (SeleniumLibrary).
Generate the most stable locator (id=, name=, css=, xpath=).

Element details:
${json}

Return only the locator string (e.g. xpath=//button[@id="login"]).`;
  }

  // 🧠 Case 6: BDD (Cucumber)
  if (framework === "bdd") {
    if (promptType === "action") {
      return `You are writing a Cucumber (BDD) Gherkin step for automation.
Given this element:
${json}

Write a single "When" or "Then" step describing an action that interacts with the element.
Return only the Gherkin step text (not implementation).`;
    }
    if (promptType === "assertion") {
      return `You are writing a Cucumber (BDD) Gherkin assertion step.
Given this element:
${json}

Write a "Then" step verifying visibility or expected state of the element.
Return only the Gherkin step text.`;
    }
    return `You are an automation expert writing BDD (Cucumber) test steps.
Generate a human-readable Gherkin step describing how to locate or interact with this element.

Element details:
${json}

Return only the Gherkin step.`;
  }

  // 🧠 Case 7: Generic Fallback
  return `You are an automation engineer writing tests in ${framework}.
Given this element:
${json}

Generate a robust locator or action step for this framework.
Return only the code.`;
}

/* Capture script (injected) */
const CAPTURE_SCRIPT = `
(function(){
  if (window.__locator_installed) return;
  window.__locator_installed = true;

  function serializeAttributes(el){
    const attrs = {};
    if(!el || !el.getAttribute) return attrs;
    for (const a of el.attributes) attrs[a.name] = a.value;
    return attrs;
  }

  function cssPath(el){
    if(!(el instanceof Element)) return '';
    const path = [];
    while (el && el.nodeType === 1) {
      let sel = el.nodeName.toLowerCase();
      if (el.id) { sel += '#' + el.id; path.unshift(sel); break; }
      let sib = el, nth = 1;
      while (sib = sib.previousElementSibling) if (sib.nodeName.toLowerCase() === sel) nth++;
      if (nth !== 1) sel += ':nth-of-type(' + nth + ')';
      path.unshift(sel);
      el = el.parentNode;
    }
    return path.join(' > ');
  }

  function absoluteXPath(el){
    if(!(el instanceof Element)) return '';
    const comps = [];
    for (; el && el.nodeType === 1; el = el.parentNode) {
      let idx = 1;
      for (let sib = el.previousSibling; sib; sib = sib.previousSibling)
        if (sib.nodeType === 1 && sib.tagName === el.tagName) idx++;
      comps.unshift(el.tagName.toLowerCase() + "[" + idx + "]");
    }
    return "/" + comps.join("/");
  }

  function detectFramework() {
    try {
      if (window.getAllAngularTestabilities) return "Angular";
      if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return "React";
      if (window.Vue) return "Vue";
    } catch(e) {}
    return "HTML";
  }

  function getShadowHostChain(el) {
    const hosts = [];
    let node = el;
    while (node) {
      const root = node.getRootNode && node.getRootNode();
      if (root && root.host) {
        hosts.unshift(root.host.tagName.toLowerCase());
        node = root.host;
      } else break;
    }
    return hosts.join(" > ") || null;
  }

  function serializeElement(el){
    if(!el) return null;
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : null,
      id: el.id || null,
      name: el.getAttribute && el.getAttribute('name') || null,
      class: el.className || null,
      text: (el.innerText || "").trim().slice(0, 300),
      role: el.getAttribute && el.getAttribute('role') || null,
      ariaLabel: el.getAttribute && el.getAttribute('aria-label') || null,
      attributes: serializeAttributes(el),
      dataset: Object.assign({}, el.dataset),
      css: cssPath(el),
      xpath: absoluteXPath(el),
      shadowHostChain: getShadowHostChain(el),
      visible: (function(r){
        try {
          const s = window.getComputedStyle(r);
          return !(s && (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0'));
        } catch(e){ return true; }
      })(el),
      framework: detectFramework(),
      crossOrigin: window !== window.top
    };
  }

  function sendPayload(payload){
    try {
      if (window.__backendSend) window.__backendSend(payload);
      else console.log('ELEMENT_CAPTURED:' + JSON.stringify(payload));
    } catch(e) { console.error('__backendSend failed', e); }
  }

document.addEventListener('click', function(e){
  try {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();

    const el = e.target;

    // --- Highlight Handling ---
    if (!window.__highlightedElements) window.__highlightedElements = new WeakSet();

    if (window.__highlightedElements.has(el)) {
      // Element was already selected → toggle OFF highlight
      el.style.outline = '';
      el.style.boxShadow = '';
      window.__highlightedElements.delete(el);
    } else {
      // New selection → highlight in blue glow
      el.style.outline = '2px solid #1e90ff';
      el.style.boxShadow = '0 0 6px 2px rgba(30,144,255,0.5)';
      window.__highlightedElements.add(el);
    }

    const payload = serializeElement(el);
    sendPayload(payload);

  } catch (err) {
    console.error('capture error', err);
  }
}, true);

window.__locatorScanAll = function(tagFilterCsv) {
  const allowed = tagFilterCsv && typeof tagFilterCsv === 'string'
    ? tagFilterCsv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : null;
  const out = [];

  // 🔹 NEW FUNCTION: Smart Filter Matcher
  function elementMatchesFilter(el, filters) {
    if (!filters || !filters.length) return true;
    try {
      return filters.some(f => {
        if (f.startsWith(".")) {
          return el.classList.contains(f.slice(1)); // class selector
        }
        if (f.startsWith("#")) {
          return el.id === f.slice(1); // id selector
        }
        if (f.startsWith("[") && f.endsWith("]")) {
          const inside = f.slice(1, -1);
          const [attr, val] = inside.split("=");
          if (val) {
            return el.getAttribute(attr) === val.replace(/['"]/g, "");
          }
          return el.hasAttribute(attr);
        }
        // default fallback = tag name
        return el.tagName.toLowerCase() === f.toLowerCase();
      });
    } catch (e) {
      return false;
    }
  }

  // 🔹 DOM Tree Walker
  function walk(root) {
    const walker = root.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
    let node = walker.nextNode();
    while (node) {
      if (allowed && !elementMatchesFilter(node, allowed)) {
        node = walker.nextNode();
        continue;
      }
      out.push(serializeElement(node));
      if (node.shadowRoot) {
        try { walk(node.shadowRoot); } catch (e) {}
      }
      node = walker.nextNode();
    }
  }

  try { walk(document); } catch (e) {}
  return out;
};
})();`;

/* Main export */
export async function launchExtractor(options = {}) {
  const {
    url,
    headless = false,
    wsBroadcast = null,
    automationFramework = "playwright",
    customExample = "",
    promptType = "locator",
    scanHidden = false,
    autoTab = false,
    onlyLaunch = false,
    outputDir = "output",
    tagFilter = null,
    proxyUrl = null,
    proxyUser = null,
    proxyPass = null
  } = options;
  const isManual = !autoTab; // manual mode when auto extract not enabled
  const generatePrompts = options.generatePrompts ?? false;

  if (options.useCDP)
    safeLog(wsBroadcast, "INFO", "✅ CDP Mode enabled — collecting advanced DOM metadata.");
  else
    safeLog(wsBroadcast, "INFO", "ℹ️ CDP disabled (standard Playwright mode).");

  if (!url) throw new Error("url is required");
  ensureDir(outputDir);
  const proxy = getProxySettingsFrom({ proxyUrl, proxyUser, proxyPass });
  if (proxy) safeLog(wsBroadcast, "INFO", `Using proxy server: ${proxy.server}`);

  if (onlyLaunch) safeLog(wsBroadcast, "INFO", "Launching browser in 'launch-only' mode (no auto extraction yet).");
  safeLog(wsBroadcast, "INFO", `Starting extraction for ${url} (headless=${headless})`);
  if (autoTab && !onlyLaunch)
    safeLog(wsBroadcast, "INFO", "⚙️ Auto Extract All enabled — starting full-page scan immediately after load.");
  else if (autoTab && onlyLaunch)
    safeLog(wsBroadcast, "INFO", "⚙️ Auto Extract All enabled — will wait for manual trigger.");

  let browser;
  const allLocators = []; // ✅ store for all found elements
  const allPrompts = [];  // optional, used for prompt files later
  try {
    const launchOptions = {
      headless,
      args: ["--disable-dev-shm-usage"],
    };

    // ✅ Only include proxy if defined
    if (proxy) launchOptions.proxy = proxy;
    // 🧹 Ensure no stale browser session remains before new launch
    if (activeBrowser) {
      try {
        safeLog(wsBroadcast, "WARN", "⚠️ Old browser session detected — closing before new launch...");
        await activeBrowser.close();
      } catch (e) {
        safeLog(wsBroadcast, "WARN", `⚠️ Could not close stale browser: ${e.message}`);
      }
      activeBrowser = null;
      activeContext = null;
    }

    globalWsBroadcast = wsBroadcast;
    browser = await chromium.launch(launchOptions);
    activeBrowser = browser;
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    activeContext = context;

    const page = await context.newPage();
    let client = null;
    if (options.useCDP) {
      try {
        client = await context.newCDPSession(page);
        activeCDPClients.push(client); // ✅ track main page client
        safeLog(wsBroadcast, "INFO", "🧠 CDP session connected (advanced metadata ready).");
      } catch (e) {
        safeLog(wsBroadcast, "WARN", `⚠️ CDP session failed: ${e.message}`);
      }
    }

    // Handle new tabs/popups (multi-page sessions)
    context.on("page", async (newPage) => {
      try {
        const newUrl = newPage.url() || "about:blank";
        safeLog(wsBroadcast, "INFO", `🆕 New page opened: ${newUrl}`);

        let popupClient = null;
        if (options.useCDP) {
          try {
            popupClient = await context.newCDPSession(newPage);
            activeCDPClients.push(popupClient); // ✅ track popup CDP client
            safeLog(wsBroadcast, "INFO", `🧠 CDP session attached to popup: ${newUrl}`);
          } catch (e) {
            safeLog(wsBroadcast, "WARN", `⚠️ CDP not available for popup (${newUrl}): ${e.message}`);
          }
        }

        await attachPage(newPage, { ...options, client: popupClient });
      } catch (err) {
        safeLog(wsBroadcast, "WARN", `⚠️ Failed to attach new page: ${err.message}`);
      }
    });

    await attachPage(page, { wsBroadcast, automationFramework, promptType, scanHidden, outputDir, tagFilter, customExample, isManual, onlyLaunch, client });

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      safeLog(wsBroadcast, "INFO", `✅ Page loaded: ${url}`);

      // Wait for UI stabilization
      await page.waitForFunction(() => document.readyState === "complete");
      await page.waitForTimeout(3000);
      // 🆕 Early exit if this is only the launch phase
      if (onlyLaunch) {
        safeLog(wsBroadcast, "INFO", "🕓 Browser launched — waiting for manual navigation and 'Start Auto Extraction'.");
        return; // do not extract yet
      }
      safeLog(wsBroadcast, "INFO", "📄 Page is fully interactive, starting extraction...");

      // ------------------------------------------------------------
      // 🔍 scanHidden: full DOM traversal (after navigation)
      // ------------------------------------------------------------
      if (scanHidden) {
        try {
          const results = await page.evaluate((tf) => {
            try { return window.__locatorScanAll(tf || null); } catch (e) { return []; }
          }, tagFilter ? tagFilter.join(",") : null);

          if (Array.isArray(results)) {
            safeLog(wsBroadcast, "INFO", `Hidden-scan collected ${results.length} elements on ${page.url()}`);
          } else {
            safeLog(wsBroadcast, "WARN", "Hidden scan returned no elements.");
          }
        } catch (e) {
          safeLog(wsBroadcast, "WARN", `Hidden scan failed on ${page.url()}: ${e.message}`);
        }
      }

      // ------------------------------------------------------------
      // 🧭 autoTab (Smart DOM Walker): enterprise-ready version
      // ------------------------------------------------------------
      if (autoTab && options.triggeredAutoExtract) {
        try {
          safeLog(wsBroadcast, "INFO", "🔁 Starting automatic Tab-based element extraction (Smart DOM Walker)...");
          safeLog(wsBroadcast, "INFO", `🔍 Active filter: ${tagFilter && tagFilter.length ? tagFilter.join(",") : "none"}`);

          const tabbedElements = await page.evaluate(
            ({ filtersCsv, scanHidden }) => {
              // ---------- Normalize Filters ----------
              const filters = filtersCsv
                ? filtersCsv.split(",").map(f => f.trim()).filter(Boolean).map(f => f.toLocaleLowerCase())
                : null;

              // ---------- Utility Helpers ----------
              function normalize(val) {
                return val == null ? null : String(val).toLocaleLowerCase();
              }

              function matchesFilter(el) {
                if (!filters || !filters.length) return true;
                const tag = (el.tagName || "").toLocaleLowerCase();

                return filters.some(f => {
                  if (f.startsWith("[")) {
                    // [attr] or [attr=value]
                    const inside = f.slice(1, -1);
                    const [attr, rawVal] = inside.split("=");
                    const val = rawVal ? rawVal.replace(/^['"]|['"]$/g, "") : null;
                    const attrVal = el.getAttribute && el.getAttribute(attr);
                    if (val !== null) return normalize(attrVal) === val.toLocaleLowerCase();
                    return el.hasAttribute(attr);
                  }
                  // plain tag match
                  return tag === f;
                });
              }

              function isVisible(el) {
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  style.visibility !== "hidden" &&
                  style.display !== "none" &&
                  style.opacity !== "0"
                );
              }

              function isInteractable(el) {
                if (!el || !el.tagName) return false;
                const tag = el.tagName.toLowerCase();
                if (["button", "input", "a", "select", "textarea"].includes(tag)) return true;
                if (el.hasAttribute("role")) return true;
                if (el.onclick || el.getAttribute("onclick")) return true;
                if (!isNaN(Number(el.tabIndex)) && el.tabIndex >= 0) return true;
                if (el.getAttribute("aria-label")) return true;
                return false;
              }

              // ---------- Locator Builders ----------
              function cssPath(el) {
                try {
                  if (!(el instanceof Element)) return null;
                  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1)
                    return `#${CSS.escape(el.id)}`;

                  const dataAttrs = Array.from(el.attributes).filter(a =>
                    a.name.startsWith("data-") && a.value && a.value.length < 100
                  );
                  if (dataAttrs.length > 0) {
                    const stable = dataAttrs.find(a => /test|qa|id/i.test(a.name)) || dataAttrs[0];
                    const selector = `[${stable.name}="${CSS.escape(stable.value)}"]`;
                    if (document.querySelectorAll(selector).length === 1) return selector;
                  }

                  const nameAttr = el.getAttribute("name");
                  if (
                    nameAttr &&
                    document.querySelectorAll(
                      `${el.tagName.toLowerCase()}[name="${CSS.escape(nameAttr)}"]`
                    ).length === 1
                  )
                    return `${el.tagName.toLowerCase()}[name="${CSS.escape(nameAttr)}"]`;

                  const ariaLabel = el.getAttribute("aria-label");
                  if (
                    ariaLabel &&
                    document.querySelectorAll(`[aria-label="${CSS.escape(ariaLabel)}"]`).length === 1
                  )
                    return `[aria-label="${CSS.escape(ariaLabel)}"]`;

                  const path = [];
                  let node = el;
                  while (node && node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() !== "html") {
                    let selector = node.tagName.toLowerCase();
                    const siblings = Array.from(node.parentNode ? node.parentNode.children : []);
                    const index = siblings.indexOf(node) + 1;
                    selector += `:nth-child(${index})`;
                    path.unshift(selector);

                    if (node.parentNode && node.parentNode.id) {
                      path.unshift(`#${CSS.escape(node.parentNode.id)}`);
                      break;
                    }
                    node = node.parentNode;
                  }
                  return path.join(" > ");
                } catch (e) {
                  return null;
                }
              }

              function absoluteXPath(el) {
                try {
                  if (el === document.body) return "/html/body";
                  let ix = 0;
                  for (let sib = el.previousSibling; sib; sib = sib.previousSibling) {
                    if (sib.nodeType === 1 && sib.tagName === el.tagName) ix++;
                  }
                  return (
                    absoluteXPath(el.parentNode) + "/" + el.tagName.toLowerCase() + "[" + (ix + 1) + "]"
                  );
                } catch {
                  return null;
                }
              }

              function serialize(el, hidden = false) {
                try {
                  const rect = el.getBoundingClientRect();
                  const attrs = {};
                  for (const a of el.attributes) attrs[a.name] = a.value;

                  return {
                    tag: el.tagName.toLowerCase(),
                    id: el.id || null,
                    name: el.getAttribute("name") || null,
                    class: el.className || null,
                    type: el.getAttribute("type") || null,
                    placeholder: el.getAttribute("placeholder") || null,
                    value: el.value || null,
                    href: el.getAttribute("href") || null,
                    title: el.getAttribute("title") || null,
                    role: el.getAttribute("role") || null,
                    ariaLabel: el.getAttribute("aria-label") || null,
                    text: (el.innerText || el.value || "").trim().slice(0, 300),
                    visible: isVisible(el),
                    hidden,
                    css: (() => { try { return cssPath(el); } catch { return null; } })(),
                    xpath: (() => { try { return absoluteXPath(el); } catch { return null; } })(),
                    attributes: attrs,
                    dataset: Object.assign({}, el.dataset),
                    x: rect.x,
                    y: rect.y,
                  };
                } catch {
                  return null;
                }
              }

              // ---------- Core Walker ----------
              const results = [];
              const seen = new Set();

              const elements = Array.from(document.querySelectorAll("*"));
              for (const el of elements) {
                try {
                  if (!isVisible(el)) continue;
                  if (!isInteractable(el)) continue;
                  if (!matchesFilter(el)) continue;
                  if (seen.has(el)) continue;
                  seen.add(el);
                  const s = serialize(el, false);
                  if (s) results.push(s);
                } catch (err) { }
              }

              // ---------- Hidden Scan (if enabled) ----------
              if (scanHidden) {
                const hiddenElems = Array.from(document.querySelectorAll("*")).filter(
                  el => !isVisible(el) && matchesFilter(el)
                );
                for (const h of hiddenElems) {
                  const s = serialize(h, true);
                  if (s) results.push(s);
                }
              }

              return results;
            },
            {
              filtersCsv: tagFilter ? tagFilter.join(",") : null,
              scanHidden,
            }
          );

          // ✅ Store results and log summary
          if (Array.isArray(tabbedElements) && tabbedElements.length > 0) {
            for (const el of tabbedElements) {
              el.pageUrl = page.url();
              el.timestamp = new Date().toISOString();
              if (options.useCDP && client && el.css) {
                const meta = await getAdvancedMetadata(page, client, el.css);
                if (meta) el.advanced = meta;
              }
              allLocators.push(el);

              if (generatePrompts) {
                allPrompts.push(
                  buildPrompt(el, automationFramework, promptType, automationFramework, customExample)
                );
              }
            }

            safeLog(
              wsBroadcast,
              "SUCCESS",
              `✅ AutoTab (Smart DOM Walker) extracted ${tabbedElements.length} elements from ${page.url()}`
            );
          } else {
            safeLog(wsBroadcast, "WARN", "No interactable elements found via Smart DOM Walker.");
          }
        } catch (err) {
          safeLog(wsBroadcast, "WARN", `AutoTab extraction failed: ${err.message}`);
        }
      }


      // ------------------------------------------------------------
      // 💾 Save combined results
      // ------------------------------------------------------------
      if (allLocators.length > 0) {
        const unique = deduplicate(allLocators);
        const ts = getTimestamp();
        const jsonFile = `${outputDir}/locators_${ts}.json`;
        atomicWrite(jsonFile, JSON.stringify(unique, null, 2));
        if (generatePrompts && allPrompts.length > 0) {
          const txtFile = `${outputDir}/copilot_prompts_${automationFramework}_${ts}.txt`;
          atomicWrite(txtFile, allPrompts.join("\n\n========================\n\n"));
          safeLog(wsBroadcast, "INFO", `📄 Prompt file: ${txtFile}`);
        }

        safeLog(wsBroadcast, "SUCCESS", `💾 Saved ${unique.length} unique locators → ${jsonFile}`);
        resultsAlreadySaved = true;
      } else {
        safeLog(wsBroadcast, "WARN", "No elements captured — nothing to save.");
      }

      // ------------------------------------------------------------
      // 🤖 Auto Extract Mode: End early and close browser
      // ------------------------------------------------------------
      // if (autoTab) {
      //   safeLog(wsBroadcast, "INFO", "🤖 Auto Extract All mode complete — closing browser automatically...");
      //   try { await activeBrowser?.close(); } catch { }
      //   activeBrowser = null;
      //   activeContext = null;
      //   if (typeof wsBroadcast === "function") {
      //     wsBroadcast({
      //       level: "SUCCESS",
      //       message: "✅ Auto Extract All completed — browser closed automatically. You can now start a new extraction."
      //     });
      //     // Notify server that run is finished
      //     wsBroadcast({ type: "done", message: "AUTO_DONE" });
      //   }
      //   return; // skip stopExtractor() to avoid double save
      // }

      safeLog(wsBroadcast, "INFO", "🟢 Session remains active — use Stop Extraction to end.");

      // ------------------------------------------------------------
      // ✅ Ready for manual capture (Ctrl/Cmd + Click)
      // ------------------------------------------------------------
      if (!options.autoTab && options.isManual) {
      safeLog(wsBroadcast, "INFO", "Ready. Please log in if required and use Ctrl/Cmd + Click to capture elements.");
      }
    } catch (err) {
      safeLog(wsBroadcast, "ERROR", `Extraction failed: ${err.message}`);
    }

    // process.once("SIGINT", async () => {
    //   safeLog(wsBroadcast, "INFO", "SIGINT received - finishing and saving...");
    //   await finishAndSave(context, outputDir, automationFramework, wsBroadcast);
    //   try { await browser.close(); } catch (e) { };
    //   safeLog(wsBroadcast, "INFO", "Shutdown complete.");
    //   process.exit(0);
    // });

    // process.on("unhandledRejection", async (reason) => {
    //   safeLog(wsBroadcast, "ERROR", `Unhandled rejection: ${String(reason)}`);
    //   try { await finishAndSave(context, outputDir, automationFramework, wsBroadcast); } catch (e) { };
    //   try { await browser.close(); } catch (e) { };
    //   process.exit(1);
    // });

    // 🧭 Keep browser open until stop is triggered
    // await new Promise((resolve) => {
    //   stopResolver = resolve;
    //   const checkInterval = setInterval(() => {
    //     if (stopRequested) {
    //       clearInterval(checkInterval);
    //       resolve();
    //     }
    //   }, 500);
    // });


  } catch (err) {
    safeLog(wsBroadcast, "ERROR", `Extraction failed: ${err.stack || err.message}`);
    if (browser) try { await browser.close(); } catch (e) { };
    throw err;
  }
}
// ============================================================================
// 🧠 Reuse session: Trigger Auto Extraction on the existing active page
// ============================================================================
export async function triggerAutoExtract(options = {}) {
  const {
    wsBroadcast = null,
    automationFramework = "playwright",
    generatePrompts = true,
    tagFilter = null,
  } = options;

  // 🧩 Normalize tagFilter (ensure it's always an array)
  const normalizedTagFilter = Array.isArray(tagFilter)
    ? tagFilter.map(t => t.trim()).filter(Boolean)
    : (typeof tagFilter === "string" && tagFilter.length > 0
      ? tagFilter.split(",").map((t) => t.trim()).filter(Boolean)
      : null);

  if (!activeContext || !activeBrowser) {
    safeLog(wsBroadcast, "ERROR", "❌ No active browser session found for auto extraction.");
    return;
  }

  try {
    const pages = activeContext.pages();
    if (!pages.length) {
      safeLog(wsBroadcast, "ERROR", "❌ No active page found in browser context.");
      return;
    }

    const page = pages[pages.length - 1];
    // ----------------------
    // Hidden-scan pre-step (before Smart DOM Walker)
    // ----------------------
    if (options.scanHidden) {
      try {
        safeLog(wsBroadcast, "INFO", "🔍 Running hidden-element scan before Smart DOM Walker...");
        const hiddenResults = await page.evaluate((filtersCsv) => {
          const filters = filtersCsv
            ? filtersCsv.split(",").map(f => f.trim()).filter(Boolean).map(f => f.toLocaleLowerCase())
            : null;

          // ---------- Shared Helpers ----------
          function normalize(val) { return val == null ? null : String(val).toLocaleLowerCase(); }

          function matchesFilter(el) {
            if (!filters || !filters.length) return true;
            const tag = (el.tagName || "").toLocaleLowerCase();
            return filters.some(f => {
              if (f.startsWith("[")) {
                const inside = f.slice(1, -1);
                const [attr, rawVal] = inside.split("=");
                const val = rawVal ? rawVal.replace(/^['"]|['"]$/g, "") : null;
                const attrVal = el.getAttribute && el.getAttribute(attr);
                if (val !== null) return normalize(attrVal) === val.toLocaleLowerCase();
                return el.hasAttribute(attr);
              }
              return tag === f;
            });
          }

          function serializeHidden(el) {
            try {
              const rect = el.getBoundingClientRect();
              const attrs = {};
              for (const a of el.attributes) attrs[a.name] = a.value;
              return {
                tag: el.tagName.toLowerCase(),
                id: el.id || null,
                name: el.getAttribute("name") || null,
                class: el.className || null,
                type: el.getAttribute("type") || null,
                placeholder: el.getAttribute("placeholder") || null,
                value: el.value || null,
                role: el.getAttribute("role") || null,
                ariaLabel: el.getAttribute("aria-label") || null,
                text: (el.innerText || el.value || "").trim().slice(0, 300),
                visible: !((window.getComputedStyle(el).display === "none") ||
                  (window.getComputedStyle(el).visibility === "hidden") ||
                  (window.getComputedStyle(el).opacity === "0") ||
                  (el.offsetWidth === 0 && el.offsetHeight === 0)),
                hidden: true,
                attributes: attrs,
                dataset: Object.assign({}, el.dataset)
              };
            } catch (e) { return null; }
          }

          const out = [];
          const all = Array.from(document.querySelectorAll("*"));
          for (const el of all) {
            try {
              if (!matchesFilter(el)) continue;
              const s = serializeHidden(el);
              if (s) out.push(s);
            } catch (e) { }
          }
          return out;
        }, normalizedTagFilter ? normalizedTagFilter.join(",") : null);

        // ✅ Merge hidden elements into the main data arrays
        if (Array.isArray(hiddenResults) && hiddenResults.length > 0) {
          for (const h of hiddenResults) {
            h.pageUrl = page.url();
            h.timestamp = new Date().toISOString();

            // Merge into locator + prompt store
            allLocators.push(h);
            if (generatePrompts) {
              allPrompts.push(buildPrompt(h, automationFramework, promptType, automationFramework, customExample));
            }
          }

          safeLog(wsBroadcast, "INFO", `📦 Hidden-scan collected ${hiddenResults.length} elements.`);
        } else {
          safeLog(wsBroadcast, "INFO", "📦 Hidden-scan collected 0 elements.");
        }
      } catch (err) {
        safeLog(wsBroadcast, "WARN", `Hidden-scan failed: ${err.message}`);
      }
    }


    safeLog(wsBroadcast, "INFO", `🤖 Running Smart DOM Walker on current page: ${page.url()}`);
    if (normalizedTagFilter)
      safeLog(wsBroadcast, "INFO", `🔍 Filter active: ${normalizedTagFilter.join(", ")}`);

    const elements = await page.evaluate((filtersCsv) => {
      const filters = filtersCsv
        ? filtersCsv.split(",").map(f => f.trim().toLowerCase()).filter(Boolean)
        : null;
      const results = [];
      const seen = new Set();

      function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          style.opacity !== "0"
        );
      }

      function isInteractable(el) {
        if (!el.tagName) return false;
        const tag = el.tagName.toLowerCase();
        if (["button", "input", "a", "select", "textarea"].includes(tag)) return true;
        if (el.hasAttribute("role")) return true;
        if (el.onclick || el.getAttribute("onclick")) return true;
        if (el.tabIndex >= 0) return true;
        if (el.getAttribute("aria-label")) return true;
        return false;
      }

      function serialize(el, hidden = false) {
        try {
          const rect = el.getBoundingClientRect();
          const attrs = {};
          for (const a of el.attributes) attrs[a.name] = a.value;

          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            name: el.getAttribute("name") || null,
            class: el.className || null,
            type: el.getAttribute("type") || null,
            placeholder: el.getAttribute("placeholder") || null,
            value: el.value || null,
            href: el.getAttribute("href") || null,
            title: el.getAttribute("title") || null,
            role: el.getAttribute("role") || null,
            ariaLabel: el.getAttribute("aria-label") || null,
            text: (el.innerText || el.value || "").trim().slice(0, 300),
            visible: isVisible(el),
            hidden,
            css: (() => { try { return cssPath(el); } catch { return null; } })(),
            xpath: (() => { try { return absoluteXPath(el); } catch { return null; } })(),
            attributes: attrs,
            dataset: Object.assign({}, el.dataset),
            x: rect.x,
            y: rect.y,
          };
        } catch (e) {
          return null;
        }
      }


      for (const el of document.querySelectorAll("*")) {
        if (!isVisible(el) || !isInteractable(el)) continue;

        // 🧩 Tag / Attribute Filter check
        if (filters && filters.length) {
          const tag = el.tagName.toLowerCase();
          const passes = filters.some(f => {
            if (f.startsWith("[")) {
              const inside = f.slice(1, -1);
              const [attr, val] = inside.split("=");
              if (val) return el.getAttribute(attr) === val.replace(/['"]/g, "");
              return el.hasAttribute(attr);
            }
            return tag === f.toLowerCase();
          });
          if (!passes) continue;
        }
        if (seen.has(el)) continue;
        seen.add(el);
        results.push(serialize(el));
      }

      return results;
    }, normalizedTagFilter ? normalizedTagFilter.join(",") : null);

    if (!elements.length) {
      safeLog(wsBroadcast, "WARN", "⚠️ No interactable elements found on the current page.");
      return;
    }

    const unique = deduplicate(elements);
    const ts = getTimestamp();
    const jsonFile = `output/locators_${ts}.json`;
    const txtFile = `output/copilot_prompts_${automationFramework}_${ts}.txt`;

    atomicWrite(jsonFile, JSON.stringify(unique, null, 2));

    if (generatePrompts && unique.length > 0) {
      const prompts = unique.map((el) =>
        buildPrompt(
          el,
          automationFramework,
          "locator",
          automationFramework,
          ""
        )
      );
      atomicWrite(txtFile, prompts.join("\n\n========================\n\n"));
      safeLog(wsBroadcast, "INFO", `📄 Prompt file: ${txtFile}`);
    } else {
      safeLog(wsBroadcast, "INFO", "ℹ️ AI prompt generation disabled — skipping .txt file creation.");
    }
    safeLog(wsBroadcast, "SUCCESS", `💾 Auto extraction completed — ${unique.length} locators saved.`);
    safeLog(wsBroadcast, "INFO", `📁 JSON file: ${jsonFile}`);
    if (generatePrompts && unique.length > 0)
      safeLog(wsBroadcast, "INFO", `📄 Prompt file: ${txtFile}`);

    // 🧩 Close reused browser session to allow next run
    // try {
    //   safeLog(wsBroadcast, "INFO", "🤖 Auto extraction complete — closing reused browser session...");
    //   if (activeBrowser) await activeBrowser.close();
    //   activeBrowser = null;
    //   activeContext = null;
    //   safeLog(wsBroadcast, "SUCCESS", "✅ Browser closed automatically after auto extraction.");
    //   // Notify backend to reset immediately
    //   if (typeof wsBroadcast === "function") {
    //     wsBroadcast({ type: "done", message: "AUTO_DONE" });
    //   }
    // } catch (err) {
    //   safeLog(wsBroadcast, "WARN", `⚠️ Failed to close browser automatically: ${err.message}`);
    // }
    safeLog(wsBroadcast, "INFO", "🟢 Session remains active — use Stop Extraction to end.");
    resultsAlreadySaved = true;
  } catch (err) {
    safeLog(wsBroadcast, "ERROR", `Auto extraction failed: ${err.message}`);
  }
}

export async function stopExtractor() {
  try {
    console.log("🛑 Stop requested by user.");
    if (activeBrowser) {
      console.log("🧹 Closing browser and saving results...");
      try {
        if (!resultsAlreadySaved) {
          await finishAndSave(activeContext, "output", globalWsBroadcast);
        } else {
          console.log("ℹ️ Skipping duplicate save — results already saved during extraction.");
        }
      } catch (err) {
        console.warn("⚠️ Failed to save results:", err.message);
      }

      // ✅ Detach all tracked CDP clients
      if (Array.isArray(activeCDPClients) && activeCDPClients.length > 0) {
        console.log(`🔌 Detaching ${activeCDPClients.length} CDP session(s)...`);
        for (const c of activeCDPClients) {
          try { await c.detach(); } 
          catch (err) { console.warn(`⚠️ CDP detach failed: ${err.message}`); }
        }
        activeCDPClients = [];
      }

      // ✅ Close the Playwright browser
      try {
        await activeBrowser.close();
        console.log("✅ Browser closed successfully.");
      } catch (err) {
        console.error("❌ Browser close failed:", err.message);
      }
    } else {
      console.log("ℹ️ No active browser instance found.");
    }
  } catch (err) {
    console.error("❌ stopExtractor failed:", err.message);
  } finally {
    activeBrowser = null;
    activeContext = null;
    stopRequested = false;
    resultsAlreadySaved = false;
    activeCDPClients = [];
    console.log("✅ Session ended cleanly.");
  }
}

/* attachPage */
async function attachPage(page, options) {
  const { wsBroadcast, automationFramework, promptType, scanHidden, outputDir, tagFilter, customExample, isManual, onlyLaunch, client } = options;
  if (!page._locatorStore) page._locatorStore = { locators: [], prompts: [] };
  const store = page._locatorStore;

  try {
    if (isManual) {
      await page.addInitScript({ content: CAPTURE_SCRIPT });
      safeLog(wsBroadcast, "INFO", "🖱️ Manual mode active — use Ctrl/Cmd + Click to capture elements.");
    } else {
      safeLog(wsBroadcast, "INFO", "🤖 Auto Extract All mode — manual selection disabled.");
    }

    await injectIntoAllFrames(page);

    await page.exposeFunction("__backendSend", async (payload) => {
      try {
        if (tagFilter && Array.isArray(tagFilter) && payload) {
          const allowed = tagFilter.map(t => t.toLowerCase());

          // --- Smart filter matcher (same logic as in scanAll) ---
          const matchesFilter = (elData, filters) => {
            if (!filters || !filters.length) return true;
            try {
              return filters.some(f => {
                if (f.startsWith('.')) {
                  const cls = elData.class || '';
                  return cls.split(/\s+/).includes(f.slice(1)); // class filter
                }
                if (f.startsWith('#')) {
                  return elData.id === f.slice(1); // id filter
                }
                if (f.startsWith('[') && f.endsWith(']')) {
                  const inside = f.slice(1, -1);
                  const [attr, val] = inside.split('=');
                  if (val) {
                    return (
                      elData.attributes &&
                      elData.attributes[attr] === val.replace(/['"]/g, '')
                    );
                  }
                  return elData.attributes && attr in elData.attributes;
                }
                // default = tag filter
                return elData.tag && elData.tag.toLowerCase() === f.toLowerCase();
              });
            } catch (e) {
              return false;
            }
          };

          if (!matchesFilter(payload, allowed)) return;
        }

        payload.pageUrl = page.url();
        payload.timestamp = new Date().toISOString();
        if (options?.useCDP && client && payload.css) {
          const meta = await getAdvancedMetadata(page, client, payload.css);
          if (meta) payload.advanced = meta;
        }
        store.locators.push(payload);
        store.prompts.push(
          buildPrompt(payload, automationFramework, promptType, automationFramework, customExample)
        );
        safeLog(wsBroadcast, "INFO", `Captured element: <${payload.tag}> ${payload.css || ''}`);
      } catch (e) {
        safeLog(wsBroadcast, "WARN", `payload handling failed: ${e.message}`);
      }
    });

    page.on("console", async msg => {
      try {
        const txt = msg.text();
        if (txt && txt.startsWith("ELEMENT_CAPTURED:")) {
          const raw = txt.slice("ELEMENT_CAPTURED:".length);
          const payload = JSON.parse(raw);
          if (tagFilter && Array.isArray(tagFilter) && payload) {
            const allowed = tagFilter.map(t => t.toLowerCase());

            // --- Smart filter matcher (same logic as in scanAll) ---
            const matchesFilter = (elData, filters) => {
              if (!filters || !filters.length) return true;
              try {
                return filters.some(f => {
                  if (f.startsWith('.')) {
                    const cls = elData.class || '';
                    return cls.split(/\s+/).includes(f.slice(1)); // class filter
                  }
                  if (f.startsWith('#')) {
                    return elData.id === f.slice(1); // id filter
                  }
                  if (f.startsWith('[') && f.endsWith(']')) {
                    const inside = f.slice(1, -1);
                    const [attr, val] = inside.split('=');
                    if (val) {
                      return (
                        elData.attributes &&
                        elData.attributes[attr] === val.replace(/['"]/g, '')
                      );
                    }
                    return elData.attributes && attr in elData.attributes;
                  }
                  // default = tag filter
                  return elData.tag && elData.tag.toLowerCase() === f.toLowerCase();
                });
              } catch (e) {
                return false;
              }
            };

            if (!matchesFilter(payload, allowed)) return;
          }

          payload.pageUrl = page.url();
          payload.timestamp = new Date().toISOString();
          if (options?.useCDP && client && payload.css) {
            const meta = await getAdvancedMetadata(page, client, payload.css);
            if (meta) payload.advanced = meta;
          }
          store.locators.push(payload);
          store.prompts.push(
            buildPrompt(payload, automationFramework, promptType, automationFramework, customExample)
          );
          safeLog(wsBroadcast, "INFO", `Captured (console) element: <${payload.tag}>`);
        }
      } catch (e) { }
    });

    if (scanHidden) {
      try {
        const results = await page.evaluate((tf) => {
          try { return window.__locatorScanAll(tf || null); } catch (e) { return []; }
        }, tagFilter ? tagFilter.join(",") : null);
        for (const p of results) {
          if (tagFilter && Array.isArray(tagFilter) && p && p.tag) {
            const allowed = tagFilter.map(t => t.toLowerCase());
            if (!allowed.includes(p.tag.toLowerCase())) continue;
          }
          p.pageUrl = page.url();
          p.timestamp = new Date().toISOString();
          store.locators.push(p);
          store.prompts.push(
            buildPrompt(p, automationFramework, promptType, automationFramework, customExample)
          );
        }
        safeLog(wsBroadcast, "INFO", `Hidden-scan collected ${results.length} elements on ${page.url()}`);
      } catch (e) {
        safeLog(wsBroadcast, "WARN", `Hidden scan failed on ${page.url()}: ${e.message}`);
      }
    }

    page.on("frameattached", async frame => { try { await injectIntoFrame(frame); } catch (e) { } });
    page.on("popup", async popup => { safeLog(wsBroadcast, "INFO", `Popup opened: ${popup.url()}`); await attachPage(popup, options); });

  } catch (err) {
    safeLog(wsBroadcast, "WARN", `attachPage error: ${err.message}`);
  }
}

/* inject helpers */
async function injectIntoAllFrames(page) {
  try {
    await page.evaluate(() => { });
    await page.evaluate((src) => {
      try {
        if (!window.__locator_installed) {
          const s = document.createElement('script');
          s.type = 'text/javascript';
          s.text = src;
          document.documentElement.appendChild(s);
        }
      } catch (e) { }
    }, CAPTURE_SCRIPT);
    for (const frame of page.frames()) {
      try { await frame.evaluate(() => { }); } catch (e) { continue; }
      try { await frame.evaluate((src) => { if (!window.__locator_installed) { const s = document.createElement('script'); s.text = src; document.documentElement.appendChild(s); } }, CAPTURE_SCRIPT); } catch (e) { }
    }
  } catch (e) { }
}

async function injectIntoFrame(frame) {
  try {
    await frame.evaluate((src) => {
      try {
        if (!window.__locator_installed) {
          const s = document.createElement('script');
          s.text = src;
          document.documentElement.appendChild(s);
        }
      } catch (e) { }
    }, CAPTURE_SCRIPT);
  } catch (e) { }
}

/* ✅ Unified finish and save (manual + auto) */
async function finishAndSave(context, outputDir = "output", automationFramework = "playwright", wsBroadcast = null) {
  try {
    if (!context) {
      safeLog(wsBroadcast, "WARN", "⚠️ No active browser context found — nothing to save.");
      return;
    }

    const pages = context.pages();
    let allLocators = [];
    let allPrompts = [];

    for (const p of pages) {
      try {
        if (p._locatorStore) {
          allLocators = allLocators.concat(p._locatorStore.locators || []);
          allPrompts = allPrompts.concat(p._locatorStore.prompts || []);
        } else {
          // fallback if no local store present
          const pageData = await p.evaluate(() => window.__locatorStore || null);
          if (pageData) {
            allLocators = allLocators.concat(pageData.locators || []);
            allPrompts = allPrompts.concat(pageData.prompts || []);
          }
        }
      } catch (err) {
        safeLog(wsBroadcast, "WARN", `⚠️ Skipped page due to read error: ${err.message}`);
      }
    }

    const unique = deduplicate(allLocators);
    ensureDir(outputDir);
    const ts = getTimestamp();
    const jsonFile = path.join(outputDir, `locators_${ts}.json`);
    const safeFramework =
      typeof automationFramework === "string"
        ? automationFramework.replace(/[^a-z0-9_-]/gi, "")
        : "playwright";

    const promptFile = path.join(
      outputDir,
      `copilot_prompts_${safeFramework}_${ts}.txt`
    );
    atomicWrite(jsonFile, JSON.stringify(unique, null, 2));
    atomicWrite(promptFile, allPrompts.join("\n\n========================\n\n"));

    // 📊 Summarize hidden vs visible counts
    const hiddenCount = unique.filter(el => el.hidden).length;
    const visibleCount = unique.length - hiddenCount;
    safeLog(wsBroadcast, "INFO", `📊 Summary: ${visibleCount} visible / ${hiddenCount} hidden elements saved.`);

    // ✅ Consistent dashboard updates
    safeLog(wsBroadcast, "SUCCESS", `💾 Saved ${unique.length} locators → ${jsonFile}`);
    safeLog(wsBroadcast, "INFO", `📁 JSON file: ${jsonFile}`);
    safeLog(wsBroadcast, "INFO", `📄 Prompt file: ${promptFile}`);

  } catch (e) {
    if (typeof wsBroadcast === "function") {
      safeLog(wsBroadcast, "ERROR", `❌ Failed to save results: ${e.message}`);
    } else {
      console.error(`❌ Failed to save results: ${e.message}`);
    }
  }
}
