import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { launchExtractor, stopExtractor } from "../core/extractor.js";
import { isValidUrl } from "../core/utils.js";

// Paths setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

let isRunning = false;
let activeClients = new Set();

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () =>
  console.log(`✅ Dashboard running at http://localhost:${PORT}`)
);

const wss = new WebSocketServer({ server });

function broadcastLog(messageObj) {
  const payload = JSON.stringify(messageObj);
  activeClients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
}

// REST endpoint to stop extraction (optional external trigger)
app.post("/stop", async (req, res) => {
  if (!isRunning)
    return res.status(400).json({ message: "No extraction running." });
  console.log("🛑 Stop requested via /stop endpoint");
  await stopExtractor();
  isRunning = false;
  broadcastLog({ type: "done", message: "✅ Extraction stopped via API." });
  res.json({ message: "✅ Extraction stopped successfully." });
});

// WebSocket handling for dashboard
wss.on("connection", (ws) => {
  activeClients.add(ws);
  console.log("🔗 Dashboard client connected. Active:", activeClients.size);
  ws.send(JSON.stringify({ type: "log", level: "INFO", message: "Connected to server." }));

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      // 🧩 START EXTRACTION — Browser launch (manual or auto mode)
      if (data.type === "start") {
        if (!isValidUrl(data.url)) {
          ws.send(JSON.stringify({ type: "error", message: `❌ Invalid or unsafe URL: ${data.url}` }));
          return;
        }

        if (isRunning) {
          console.warn("⚠️ Detected stale running flag — forcing reset before relaunch.");
          isRunning = false;
        }

        console.log("🚀 Launching browser for", data.url);
        isRunning = true;

        const tagFilterArray = data.tagFilter
          ? data.tagFilter.split(",").map((t) => t.trim()).filter(Boolean)
          : null;

        try {
          await launchExtractor({
            url: data.url,
            automationFramework: data.automationFramework || "playwright", // 🧩 ensure this comes before wsBroadcast
            wsBroadcast: (m) => broadcastLog({ type: "log", ...m }),
            headless: data.headless || false,
            scanHidden: data.scanHidden || false,
            autoTab: data.autoTab,
            onlyLaunch: data.onlyLaunch ?? true,
            customExample: data.customExample || "",
            tagFilter: tagFilterArray,
            generatePrompts: data.generatePrompts || false,
          });
          broadcastLog({
            type: "log",
            level: "INFO",
            message: "✅ Browser launched successfully — session active until stopped.",
          });
        } catch (err) {
          broadcastLog({ type: "error", message: err.message });
          isRunning = false;
        }
      }

      // 🧩 AUTO EXTRACTION — Triggered after user clicks "Start Auto Extraction"
      if (data.type === "autoExtract") {
        if (!isRunning) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "⚠️ No active session — please start extraction first.",
            })
          );
          return;
        }

        console.log("🤖 Triggering auto extraction on current page...");
        broadcastLog({ type: "log", level: "INFO", message: "🤖 Auto extraction started..." });

        try {
          const { triggerAutoExtract } = await import("../core/extractor.js");
          await triggerAutoExtract({
            wsBroadcast: (m) => broadcastLog({ type: "log", ...m }),
            automationFramework: data.automationFramework || "playwright",
            generatePrompts: data.generatePrompts || false,
            tagFilter: data.tagFilter,
            scanHidden: data.scanHidden || false,
            triggeredAutoExtract: data.triggeredAutoExtract || false, 
          });

          broadcastLog({
            type: "done",
            message: "✅ Auto extraction complete for current page. Browser remains active until stopped.",
          });

          broadcastLog({
            type: "log",
            level: "INFO",
            message: "🟢 Session remains active — click Stop Extraction to close browser.",
          });
        } catch (err) {
          broadcastLog({ type: "error", message: err.message });
        }
      }

      // 🧩 STOP EXTRACTION — Ends current session and closes browser
      if (data.type === "stop") {
        if (!isRunning) {
          ws.send(JSON.stringify({ type: "log", level: "INFO", message: "ℹ️ No extraction running — nothing to stop." }));
          return;
        }

        console.log("🛑 Stop requested by user (via WebSocket)");
        await stopExtractor();
        isRunning = false;

        broadcastLog({
          type: "log",
          level: "SUCCESS",
          message: "✅ Browser closed and session ended successfully.",
        });

        broadcastLog({ type: "done", message: "✅ Extraction stopped and browser closed." });
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: err.message }));
    }
  });

  ws.on("close", () => {
    activeClients.delete(ws);
    console.log("❌ Client disconnected. Active:", activeClients.size);
  });
});
