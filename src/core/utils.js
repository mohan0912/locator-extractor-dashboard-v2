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
