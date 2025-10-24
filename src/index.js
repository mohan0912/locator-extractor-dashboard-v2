#!/usr/bin/env node
import minimist from "minimist";
import { launchExtractor } from "./core/extractor.js";
import { isValidUrl } from "./core/utils.js";

const argv = minimist(process.argv.slice(2));

if (argv.help || argv.h) {
  console.log(`
Locator Extractor CLI - Usage:
  node src/index.js --url <URL> [options]

Run with --url to begin extraction.
Use --proxyUrl, --proxyUser, --proxyPass if you're behind a corporate proxy.
`);
  process.exit(0);
}

if (!isValidUrl(url)) {
  console.error(`❌ Invalid or unsafe URL provided: ${url}`);
  process.exit(1);
}

const url = argv.url || argv.u;

if (!url) {
  console.error(`
Usage:
  node src/index.js --url <URL>
  
Options:
  --framework <type>       Target automation framework
                           (playwright | selenium | cypress | robot | custom)
  --promptType <type>      AI prompt type (locator | action | assertion)
  --scanHidden             Include hidden elements in scan
  --tagFilter <list>       Comma-separated tags or attributes to filter (e.g. button,input,a,[data-test])
  --outputDir <path>       Folder to save results (default: "output")
  --headless <bool>        Run in headless mode (default: false)
  --customExample <text>   Example locator syntax for custom framework

Proxy Options (optional):
  --proxyUrl <url>         Proxy server (e.g. http://proxy.corp.local:8080)
  --proxyUser <username>   Proxy username (if required)
  --proxyPass <password>   Proxy password (if required)

Examples:
  node src/index.js --url https://example.com
  node src/index.js --url https://example.com --framework selenium --scanHidden
  node src/index.js --url https://example.com --proxyUrl http://proxy.corp.local:8080
  node src/index.js --url https://example.com --proxyUrl http://proxy.corp.local:8080 --proxyUser alice --proxyPass Secret123
`);
  process.exit(1);
}

// --- Boolean normalization helper ---
function parseBool(val, defaultVal = false) {
  if (val === undefined) return defaultVal;
  if (typeof val === "boolean") return val;
  return ["true", "1", "yes", "y"].includes(String(val).toLowerCase());
}

const options = {
  url,
  headless: parseBool(argv.headless, false),
  automationFramework: argv.framework || "playwright",
  customExample: argv.customExample || "",
  promptType: argv.promptType || "locator",
  scanHidden: parseBool(argv.scanHidden, false),
  tagFilter: argv.tagFilter
    ? argv.tagFilter.split(",").map((s) => s.trim()).filter(Boolean)
    : null,
  outputDir: argv.outputDir || "output",
  proxyUrl: argv.proxyUrl || null,
  proxyUser: argv.proxyUser || null,
  proxyPass: argv.proxyPass || null,
  useCDP: parseBool(argv.useCDP, false), // 🔹 NEW flag
};

(async () => {
  try {
    await launchExtractor(options);
  } catch (e) {
    console.error("❌ Extractor failed:", e);
    process.exit(1);
  }
})();
