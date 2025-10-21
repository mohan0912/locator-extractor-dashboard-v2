#!/usr/bin/env node
import minimist from "minimist";
import { launchExtractor } from "./core/extractor.js";

const argv = minimist(process.argv.slice(2));

const url = argv.url || argv.u;
if (!url) {
  console.error(`
Usage:
  node src/index.js --url <URL>
  [--framework playwright|selenium|cypress|robot|bdd|custom]
  [--promptType locator|action|assertion]
  [--scanHidden]
  [--tagFilter button,input]
  [--outputDir output]
  [--headless false]
  [--customExample "<locator example>"]
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
};

(async () => {
  try {
    await launchExtractor(options);
  } catch (e) {
    console.error("❌ Extractor failed:", e);
    process.exit(1);
  }
})();
