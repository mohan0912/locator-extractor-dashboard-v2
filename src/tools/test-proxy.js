#!/usr/bin/env node
/**
 * Proxy Connectivity Tester for Locator Extractor Dashboard
 * ---------------------------------------------------------
 * This script checks whether your proxy (if configured) allows outbound internet access.
 * It tests a simple HTTPS request through Playwright using the same proxy detection logic.
 */

import { chromium } from "playwright";
import { getProxySettingsFrom } from "./src/core/utils.js";

const testUrl = process.argv[2] || "https://example.com";

async function testProxy() {
  console.log("🌐 Locator Extractor Proxy Test");
  console.log("--------------------------------");

  const proxy = getProxySettingsFrom({
    proxyUrl: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null,
    proxyUser: process.env.PROXY_USER,
    proxyPass: process.env.PROXY_PASS,
  });

  if (proxy) {
    console.log(`✅ Proxy detected: ${proxy.server}`);
    if (proxy.username) console.log(`👤 Username: ${proxy.username}`);
    if (proxy.password) console.log(`🔒 Password: [hidden]`);
  } else {
    console.log("ℹ️ No proxy configuration detected — direct connection mode.");
  }

  try {
    console.log(`\n🚀 Launching headless browser to test: ${testUrl}`);

    const browser = await chromium.launch({
      headless: true,
      proxy, // Automatically ignored if null
    });

    const page = await browser.newPage();
    const response = await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

    if (response && response.ok()) {
      console.log(`✅ SUCCESS: Reached ${testUrl} (Status: ${response.status()})`);
    } else if (response) {
      console.log(`⚠️ WARNING: Got response ${response.status()} - may indicate restricted proxy.`);
    } else {
      console.log("❌ ERROR: No response received. Check proxy/firewall settings.");
    }

    await browser.close();
  } catch (err) {
    console.error(`\n❌ Connection failed: ${err.message}`);
    console.error("🔍 Tip: Check your HTTPS_PROXY or proxy URL/credentials.");
  }

  console.log("\n🏁 Test complete.");
}

testProxy();
