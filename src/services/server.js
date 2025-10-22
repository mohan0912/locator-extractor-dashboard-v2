import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { launchExtractor, stopExtractor } from "../core/extractor.js";
import { isValidUrl } from "../core/utils.js";

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

// Broadcast logs to all connected clients
function broadcastLog(messageObj) {
  const payload = JSON.stringify(messageObj);
  activeClients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
}

// Optional REST endpoint to stop extraction
app.post("/stop", async (req, res) => {
  if (!isRunning)
    return res.status(400).json({ message: "No extraction running." });
  console.log("🛑 Stop requested via /stop endpoint");
  await stopExtractor();
  isRunning = false;
  broadcastLog({ type: "done", message: "✅ Extraction stopped via API." });
  res.json({ message: "✅ Extraction stopped successfully." });
});

// WebSocket logic
wss.on("connection", (ws) => {
  activeClients.add(ws);
  console.log("🔗 Dashboard client connected. Active:", activeClients.size);
  ws.send(JSON.stringify({ type: "log", level: "INFO", message: "Connected to server." }));

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      // Start Extraction
      if (data.type === "start") {
        if (!isValidUrl(data.url)) {
          ws.send(JSON.stringify({ type: "error", message: `❌ Invalid or unsafe URL: ${data.url}` }));
          return;
        }
        if (isRunning) {
          ws.send(JSON.stringify({ type: "error", message: "⚠️ Extraction already in progress." }));
          return;
        }

        console.log("🚀 Launching extraction for", data.url);
        isRunning = true;

        const tagFilterArray = data.tagFilter
          ? data.tagFilter.split(",").map((t) => t.trim()).filter(Boolean)
          : null;

        try {
          await launchExtractor({
            url: data.url,
            wsBroadcast: (m) => broadcastLog({ type: "log", ...m }),
            headless: data.headless || false,
            scanHidden: data.scanHidden || false,
            automationFramework: data.automationFramework || "playwright",
            customExample: data.customExample || "",
            tagFilter: tagFilterArray,
          });

          broadcastLog({
            type: "done",
            message: "✅ Extraction completed and saved successfully.",
          });
        } catch (err) {
          broadcastLog({ type: "error", message: err.message });
        } finally {
          await stopExtractor();
          isRunning = false;
          console.log("🧹 Cleanup complete after extraction.");
        }
      }

      // Stop Extraction
      if (data.type === "stop") {
        if (!isRunning) {
          ws.send(JSON.stringify({ type: "log", level: "WARN", message: "No extraction running." }));
          return;
        }
        console.log("🛑 Stop requested by user (via WebSocket)");
        await stopExtractor();
        isRunning = false;
        broadcastLog({
          type: "log",
          level: "INFO",
          message: `✅ Results saved in 'output' folder. Check locators_*.json and copilot_prompts_*.txt`,
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
