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
let stopResolver = null;


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
    outputDir = "output",
    tagFilter = null,
    proxyUrl = null,
    proxyUser = null,
    proxyPass = null
  } = options;

  const proxy = getProxySettingsFrom({ proxyUrl, proxyUser, proxyPass });
  if (proxy) safeLog(wsBroadcast, "INFO", `Using proxy server: ${proxy.server}`); l̥
  if (!url) throw new Error("url is required");

  safeLog(wsBroadcast, "INFO", `Starting extraction for ${url} (headless=${headless})`);
  let browser;
  try {
    browser = await chromium.launch({ headless, args: ["--disable-dev-shm-usage"], proxy, });
    activeBrowser = browser;
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    activeContext = context;

    context.on("page", async page => {
      safeLog(wsBroadcast, "INFO", `New page opened: ${page.url()}`);
      await attachPage(page, { wsBroadcast, automationFramework, promptType, scanHidden, outputDir, tagFilter, customExample });
    });


    const page = await context.newPage();
    await attachPage(page, { wsBroadcast, automationFramework, promptType, scanHidden, outputDir, tagFilter, customExample });

    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch (e) { safeLog(wsBroadcast, "WARN", `Navigation warning: ${e.message}`); }
    safeLog(wsBroadcast, "INFO", "Ready. Please log in if required and use Ctrl/Cmd + Click to capture elements.");

    process.once("SIGINT", async () => {
      safeLog(wsBroadcast, "INFO", "SIGINT received - finishing and saving...");
      await finishAndSave(context, outputDir, automationFramework, wsBroadcast);
      try { await browser.close(); } catch (e) { };
      safeLog(wsBroadcast, "INFO", "Shutdown complete.");
      process.exit(0);
    });

    process.on("unhandledRejection", async (reason) => {
      safeLog(wsBroadcast, "ERROR", `Unhandled rejection: ${String(reason)}`);
      try { await finishAndSave(context, outputDir, automationFramework, wsBroadcast); } catch (e) { };
      try { await browser.close(); } catch (e) { };
      process.exit(1);
    });

    // 🧭 Keep browser open until stop is triggered
    await new Promise((resolve) => {
      stopResolver = resolve;
      const checkInterval = setInterval(() => {
        if (stopRequested) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });


  } catch (err) {
    safeLog(wsBroadcast, "ERROR", `Extraction failed: ${err.stack || err.message}`);
    if (browser) try { await browser.close(); } catch (e) { };
    throw err;
  }
}
export async function stopExtractor() {
  try {
    console.log("🛑 Stop requested by user.");
    stopRequested = true;
    if (stopResolver) stopResolver(); // unblock the waiting promise

    if (activeContext) {
      console.log("🧹 Saving partial results before stop...");
      await finishAndSave(activeContext, "output");
    }
    if (activeBrowser) {
      console.log("🛑 Closing browser...");
      await activeBrowser.close();
    }
  } catch (e) {
    console.warn("⚠️ Stop error:", e.message);
  } finally {
    activeBrowser = null;
    activeContext = null;
    stopRequested = false;
    stopResolver = null;
  }
}


/* attachPage */
async function attachPage(page, options) {
  const { wsBroadcast, automationFramework, promptType, scanHidden, outputDir, tagFilter, customExample } = options;
  if (!page._locatorStore) page._locatorStore = { locators: [], prompts: [] };
  const store = page._locatorStore;

  try {
    await page.addInitScript({ content: CAPTURE_SCRIPT });
    await injectIntoAllFrames(page);

    await page.exposeFunction("__backendSend", (payload) => {
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
            buildPrompt(payload, automationFramework, promptType, automationFramework, customExample)
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

/* finish and save */
async function finishAndSave(context, outputDir = "output", automationFramework = "playwright", wsBroadcast = null) {
  try {
    const pages = context.pages();
    let allLocators = [];
    let allPrompts = [];
    for (const p of pages) {
      if (p._locatorStore) {
        allLocators = allLocators.concat(p._locatorStore.locators || []);
        allPrompts = allPrompts.concat(p._locatorStore.prompts || []);
      }
    }
    const unique = deduplicate(allLocators);
    ensureDir(outputDir);
    const ts = getTimestamp();
    const jsonFile = path.join(outputDir, `locators_${ts}.json`);
    const promptFile = path.join(outputDir, `copilot_prompts_${automationFramework}_${ts}.txt`);
    atomicWrite(jsonFile, JSON.stringify(unique, null, 2));
    atomicWrite(promptFile, allPrompts.join("\n\n========================\n\n"));
    safeLog(wsBroadcast, "INFO", `✅ Saved ${unique.length} locators -> ${jsonFile}`);
    safeLog(wsBroadcast, "INFO", `✅ Saved ${allPrompts.length} prompts -> ${promptFile}`);

  } catch (e) {
    safeLog(null, "ERROR", `Failed to save results: ${e.message}`);
  }
}
