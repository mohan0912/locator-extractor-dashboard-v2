export const CONFIG = {
  url: "https://enterprise.company.com/home", // optional default
  headless: false,                            // default headless mode
  automationFramework: "playwright",          // aligns with dashboard & extractor.js
  customExample: "",                          // optional default for custom frameworks
  outputDir: "output",                        // output directory
  jsonPrefix: "locators",                     // locator file prefix
  promptPrefix: "copilot_prompts" ,            // prompt file prefix
  useCDP: false // 🔹 Future-ready CDP support (default off)
};
