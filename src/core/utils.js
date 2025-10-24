import fs from "fs";
import path from "path";

/**
 * Returns an ISO-safe timestamp string for filenames.
 * Example: 2025-10-21_08-42-31
 */
export function getTimestamp() {
  return new Date().toISOString().replace(/T/, "_").replace(/:/g, "-").replace(/\..+/, "");
}

/**
 * Deduplicate locator entries based on a combination of key attributes.
 * Prevents saving duplicates when scanning or capturing repeatedly.
 */
export function deduplicate(arr = []) {
  const seen = new Set();
  return arr.filter(item => {
    const keyParts = [
      item.pageUrl || "",
      item.tag || "",
      item.id || "",
      item.name || "",
      item.css || "",
      item.xpath || ""
    ];
    const key = keyParts.join("|").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Ensure the directory exists, creating recursively if needed.
 */
export function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn("⚠️ ensureDir failed:", e.message);
  }
}

/**
 * Atomically write a file to avoid partial writes or corruption.
 */
export function atomicWrite(file, data) {
  const tmp = file + ".tmp";
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error(`❌ atomicWrite failed for ${file}:`, e.message);
  }
}

// --- Add this near the top of utils.js ---
export function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    const allowedProtocols = ["http:", "https:"];
    if (!allowedProtocols.includes(parsed.protocol)) return false;
    if (parsed.hostname === "localhost" || parsed.hostname.match(/^[a-z0-9.-]+$/i)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Detects and builds proxy configuration for Playwright if provided.
 * Supports both CLI/environment-based configuration.
 */
export function getProxySettingsFrom(options = {}) {
  const proxyUrl =
    options.proxyUrl ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    null;

  if (!proxyUrl) return null;

  const proxy = { server: proxyUrl.trim() };

  if (options.proxyUser || process.env.PROXY_USER)
    proxy.username = options.proxyUser || process.env.PROXY_USER;

  if (options.proxyPass || process.env.PROXY_PASS)
    proxy.password = options.proxyPass || process.env.PROXY_PASS;

  return proxy;
}

