import { chromium } from "playwright";

async function getAdvancedMetadata(page, client, selector) {
  try {
    const { root } = await client.send("DOM.getDocument", { depth: -1 });
    const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) return null;

    const { computedStyle } = await client.send("CSS.getComputedStyleForNode", { nodeId });
    const styles = {};
    for (const s of computedStyle) styles[s.name] = s.value;

    const { nodes } = await client.send("Accessibility.getPartialAXTree", { nodeId });
    const accNode = nodes?.[0] || {};
    const ariaRole = accNode.role?.value || null;
    const ariaName = accNode.name?.value || null;

    const { listeners } = await client.send("DOMDebugger.getEventListeners", { objectId: nodeId }).catch(() => ({ listeners: [] }));

    const box = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, selector);

    const domDepth = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) return 0;
      let d = 0, n = el;
      while (n.parentElement) { d++; n = n.parentElement; }
      return d;
    }, selector);

    const dataAttributes = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) return {};
      const out = {};
      for (const a of el.attributes) {
        if (a.name.startsWith("data-") || a.name.startsWith("qa-") || a.name.startsWith("ng-")) {
          out[a.name] = a.value;
        }
      }
      return out;
    }, selector);

    const frameworkType = await page.evaluate(() => {
      if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return "React";
      if (window.getAllAngularTestabilities) return "Angular";
      if (window.Vue) return "Vue";
      return "HTML";
    });

    return {
      zIndex: styles["z-index"],
      opacity: styles["opacity"],
      display: styles["display"],
      visibility: styles["visibility"],
      pointerEvents: styles["pointer-events"],
      cursor: styles["cursor"],
      backgroundColor: styles["background-color"],
      ariaRole,
      ariaName,
      listeners: listeners?.map(l => l.type) || [],
      boundingBox: box,
      domDepth,
      dataAttributes,
      frameworkType,
    };
  } catch (err) {
    console.error("❌ CDP error:", err.message);
    return null;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("🌐 Opening test site...");
  await page.goto("https://example.com");
  console.log("✅ Main page loaded.");

  // --- Main page CDP session
  const client = await context.newCDPSession(page);
  const metadata = await getAdvancedMetadata(page, client, "h1");
  console.log("🧠 CDP Metadata (Main Page):", metadata);

  // --- Popup / new tab test
  const popupPromise = context.waitForEvent("page");
  await page.evaluate(() => window.open("https://example.com", "_blank"));
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");

  const popupClient = await context.newCDPSession(popup);
  const popupMetadata = await getAdvancedMetadata(popup, popupClient, "h1");
  console.log("🧩 CDP Metadata (Popup):", popupMetadata);

  await browser.close();
  console.log("🏁 Test complete.");
})();
