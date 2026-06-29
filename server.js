#!/usr/bin/env node
//╔══════════════════════════════════════════════════════════════╗
//║  Mission Barisal v2 — Multi-Agent Code Platform            ║
//║  Zero dependency · Single file · OpenCode Free Models      ║
//║  Owner: Sahon Srabon · Developer Zone · Dhaka, Bangladesh  ║
//║  Personas loaded from: PERSONAS.md                         ║
//╚══════════════════════════════════════════════════════════════╝

const http = require("http");
const https = require("https");
const { URL } = require("url");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ─── Config ──────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "7788", 10);
const OPENCODE_BASE = process.env.OPENCODE_BASE || "https://opencode.ai/zen/v1";
const MAX_DEBATE_ROUNDS = parseInt(process.env.MAX_DEBATE_ROUNDS || "3", 10);
const LOG_DIR = path.resolve(process.env.LOG_DIR || "./logs");
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const PERSONAS_FILE = path.resolve(
  process.env.PERSONAS_FILE || "./PERSONAS.md",
);
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL || "86400000", 10);
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || "20", 10);
const WORK_DIR = process.env.WORK_DIR || process.cwd();
const DOC_DIR = process.env.DOC_DIR || "./docs";
const GIT_PERSONAS_URL =
  process.env.GIT_PERSONAS_URL ||
  "https://raw.githubusercontent.com/sahonsrabon-os/missionbarisal/main/PERSONAS.md";

// ─── Pusher Config (optional — zero-dep, built-in crypto) ────
const PUSHER_APP_ID = process.env.PUSHER_APP_ID || "2171810";
const PUSHER_KEY = process.env.PUSHER_KEY || "b99355f977e758d4ec15";
const PUSHER_SECRET = process.env.PUSHER_SECRET || "9bc97706077a2defa16e";
const PUSHER_CLUSTER = process.env.PUSHER_CLUSTER || "ap2";
const PUSHER_ENABLED = !!(PUSHER_APP_ID && PUSHER_KEY && PUSHER_SECRET);

// ─── Free Models from OpenCode ───────────────────────────────
const FREE_MODELS = [
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
  "north-mini-code-free",
  "nemotron-3-ultra-free",
  "big-pickle",
];

// ─── Logging & Dirs ──────────────────────────────────────────
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function log(level, category, data) {
  const ts = new Date().toISOString();
  const entry = `[${ts}] [${level}] [${category}] ${typeof data === "string" ? data : JSON.stringify(data)}`;
  console.log(entry);
  const logFile = path.join(LOG_DIR, `${ts.slice(0, 10)}.log`);
  try {
    fs.appendFileSync(logFile, entry + "\n");
  } catch (e) {}
}

// ══════════════════════════════════════════════════════════════
//  📜 PERSONAS PARSER — markdown → agent definitions
// ══════════════════════════════════════════════════════════════
function parsePersonas(mdContent) {
  const agents = [];
  const blocks = mdContent.split(/^## agent:/m).slice(1);

  for (const block of blocks) {
    const idMatch = block.match(/^\s*([^\n]+)/);
    const id = idMatch ? idMatch[1].trim() : "";
    if (!id) continue;

    const name = extractField(block, "name") || id;
    const model = extractField(block, "model") || "deepseek-v4-flash-free";
    const role = extractField(block, "role") || "general";
    const expertise = extractField(block, "expertise") || "";
    const priority = parseInt(extractField(block, "priority") || "99", 10);
    const persona = extractPersona(block);

    if (model && persona) {
      agents.push({ id, name, model, role, expertise, priority, persona });
    }
  }

  agents.sort((a, b) => (a.priority || 99) - (b.priority || 99));
  return agents;
}

function extractField(block, field) {
  const re = new RegExp(
    "^-\\s*\\*{0,2}" + field + "\\*{0,2}\\s*:\\s*(.+)$",
    "m",
  );
  const match = block.match(re);
  return match
    ? match[1].trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "")
    : null;
}

function extractPersona(block) {
  const match = block.match(
    /\*\*persona\*\*:\s*\|\s*\n([\s\S]*?)(?:^##\s|^---|$)/m,
  );
  if (match) {
    return match[1]
      .split("\n")
      .map((l) => l.replace(/^\s{2}/, "").trim())
      .filter((l) => l && !l.startsWith("- "))
      .join("\n");
  }
  return null;
}

// ─── Load Personas ────────────────────────────────────────────
async function loadPersonas() {
  if (fs.existsSync(PERSONAS_FILE)) {
    try {
      const content = fs.readFileSync(PERSONAS_FILE, "utf8");
      const agents = parsePersonas(content);
      if (agents.length > 0) {
        log("INFO", "PERSONAS_LOADED", {
          source: "local",
          count: agents.length,
        });
        return Promise.resolve(agents);
      }
    } catch (e) {
      log("WARN", "PERSONAS_PARSE_FAIL", { error: e.message });
    }
  }
  log("WARN", "PERSONAS_NOT_FOUND", { file: PERSONAS_FILE });
  log("INFO", "PERSONAS_DOWNLOAD", { url: GIT_PERSONAS_URL });
  try {
    const https = require("https");
    return new Promise((resolve) => {
      https
        .get(GIT_PERSONAS_URL, { timeout: 10000 }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              if (!fs.existsSync(path.dirname(PERSONAS_FILE)))
                fs.mkdirSync(path.dirname(PERSONAS_FILE), { recursive: true });
              fs.writeFileSync(PERSONAS_FILE, data);
              const agents = parsePersonas(data);
              if (agents.length > 0) {
                log("INFO", "PERSONAS_DOWNLOADED", { count: agents.length });
                resolve(agents);
              } else {
                resolve([]);
              }
            } catch (e) {
              log("WARN", "PERSONAS_DOWNLOAD_FAIL", { error: e.message });
              resolve([]);
            }
          });
        })
        .on("error", (e) => {
          log("WARN", "PERSONAS_DOWNLOAD_ERR", { error: e.message });
          resolve([]);
        });
    });
  } catch (e) {
    log("ERROR", "PERSONAS_DOWNLOAD_EXCEPTION", { error: e.message });
    return [];
  }
  return [];
}

// ══════════════════════════════════════════════════════════════
//  🔍 REAL-TIME WEB SEARCH (zero dependency)
// ══════════════════════════════════════════════════════════════
function webSearch(query) {
  return new Promise((resolve) => {
    const url =
      "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query);
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      timeout: 15000,
      headers: { "User-Agent": "MissionBarisal-v2/1.0" },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        // Extract text from HTML result
        const results = [];
        const linkRegex =
          /<a[^>]*href="([^"]*)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRegex =
          /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

        // Try to parse DDG lite format
        const rows = data.split("<tr>");
        for (const row of rows) {
          const linkMatch = row.match(
            /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i,
          );
          const textMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
          if (linkMatch && textMatch) {
            results.push({
              link: linkMatch[1].replace(/&amp;/g, "&"),
              title: linkMatch[2].replace(/<[^>]*>/g, "").trim(),
              snippet: textMatch[1].replace(/<[^>]*>/g, "").trim(),
            });
          }
        }

        if (results.length > 0) {
          resolve({ success: true, results: results.slice(0, 5), query });
        } else {
          // Fallback: try to extract any text content
          const bodyText = data
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          resolve({
            success: true,
            results: [
              {
                title: "Search Result",
                snippet: bodyText.slice(0, 1000),
                link: "",
              },
            ],
            query,
          });
        }
      });
    });
    req.on("error", (err) =>
      resolve({ success: false, error: err.message, query }),
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false, error: "timeout", query });
    });
    req.end();
  });
}

// ─── Formatted search for agents ─────────────────────────────
async function agentSearch(agent, query) {
  const result = await webSearch(query);
  if (result.success && result.results.length > 0) {
    return result.results
      .map(
        (r, i) =>
          i + 1 + ". [" + r.title + "](" + r.link + ")\n   " + r.snippet,
      )
      .join("\n");
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  📡 PUSHER REAL-TIME EVENTS (zero-dep, REST API)
// ══════════════════════════════════════════════════════════════
function triggerPusherEvent(channel, eventName, data) {
  return new Promise((resolve) => {
    if (!PUSHER_ENABLED) {
      resolve({ success: false, reason: "Pusher not configured" });
      return;
    }

    const body = JSON.stringify({
      data: JSON.stringify(data),
      name: eventName,
      channel: channel,
    });
    const bodyMd5 = crypto.createHash("md5").update(body).digest("hex");
    const timestamp = Math.floor(Date.now() / 1000);

    const authString =
      "POST\n/apps/" +
      PUSHER_APP_ID +
      "/events\n" +
      "auth_key=" +
      PUSHER_KEY +
      "&auth_timestamp=" +
      timestamp +
      "&auth_version=1.0&body_md5=" +
      bodyMd5;
    const signature = crypto
      .createHmac("sha256", PUSHER_SECRET)
      .update(authString)
      .digest("hex");

    const url =
      "https://api-" +
      PUSHER_CLUSTER +
      ".pusher.com/apps/" +
      PUSHER_APP_ID +
      "/events?" +
      "body_md5=" +
      bodyMd5 +
      "&auth_version=1.0&auth_key=" +
      PUSHER_KEY +
      "&auth_timestamp=" +
      timestamp +
      "&auth_signature=" +
      signature;

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      timeout: 10000,
      headers: { "Content-Type": "application/json" },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({
          success: res.statusCode === 202 || res.statusCode === 200,
          status: res.statusCode,
          data,
        }),
      );
    });
    req.on("error", (err) => resolve({ success: false, error: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false, error: "timeout" });
    });
    req.write(body);
    req.end();
  });
}

// ─── Push mission events in real-time ────────────────────────
async function pushLog(type, message) {
  if (!PUSHER_ENABLED) return;
  await triggerPusherEvent("mission-barisal", "mission-log", {
    type,
    message,
    time: new Date().toISOString(),
  });
}
async function pushAgentStatus(agentId, status) {
  if (!PUSHER_ENABLED) return;
  await triggerPusherEvent("mission-barisal", "agent-status", {
    agent: agentId,
    status,
    time: new Date().toISOString(),
  });
}
async function pushOutput(output) {
  if (!PUSHER_ENABLED) return;
  await triggerPusherEvent("mission-barisal", "mission-output", {
    output,
    time: new Date().toISOString(),
  });
}
async function pushDone(stats) {
  if (!PUSHER_ENABLED) return;
  await triggerPusherEvent("mission-barisal", "mission-done", {
    stats,
    time: new Date().toISOString(),
  });
}
async function agentSearch(agent, query) {
  const result = await webSearch(query);
  if (result.success && result.results.length > 0) {
    return result.results
      .map(
        (r, i) =>
          i + 1 + ". [" + r.title + "](" + r.link + ")\n   " + r.snippet,
      )
      .join("\n");
  }
  return null;
}
let AGENTS = [];
const STATS = {
  totalRequests: 0,
  totalAgents: AGENTS.length,
  models: FREE_MODELS.length,
  startTime: Date.now(),
};

// ══════════════════════════════════════════════════════════════
//  💾 MEMORY SYSTEM
// ══════════════════════════════════════════════════════════════
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

function readSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")) || [];
  } catch (e) {
    return [];
  }
}

function writeSessions(sessions) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function createSession(clientId) {
  const sessions = readSessions();
  const now = Date.now();
  const session = {
    id: crypto.randomUUID(),
    client_id: clientId || "anonymous",
    messages: 0,
    status: "active",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  sessions.push(session);
  writeSessions(sessions);
  return session;
}

function getSession(id) {
  const now = Date.now();
  const sessions = readSessions().filter(
    (s) => new Date(s.expires_at).getTime() > now,
  );
  return sessions.find((s) => s.id === id && s.status === "active") || null;
}

function updateSession(id, data) {
  const sessions = readSessions();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  Object.assign(sessions[idx], data);
  writeSessions(sessions);
}

function saveMemory(sessionId, role, content) {
  const file = path.join(DATA_DIR, "mem-" + sessionId + ".json");
  let mem = [];
  if (fs.existsSync(file)) {
    try {
      mem = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {}
  }
  mem.push({
    role,
    content: String(content).slice(0, 4000),
    timestamp: new Date().toISOString(),
  });
  if (mem.length > 50) mem = mem.slice(-50);
  fs.writeFileSync(file, JSON.stringify(mem, null, 2));
}

function getMemory(sessionId) {
  const file = path.join(DATA_DIR, "mem-" + sessionId + ".json");
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {}
  }
  return [];
}

// ══════════════════════════════════════════════════════════════
//  🔌 OPENCODE API CALL
// ══════════════════════════════════════════════════════════════

// ─── Streaming model call (SSE) ─────────────────────────────
function callModelStream(model, messages, temperature, onChunk) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: temperature || 0.7,
    });
    const url = new URL(OPENCODE_BASE + "/chat/completions");
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: "POST",
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "MissionBarisal-v2",
      },
    };
    const proto = url.protocol === "http:" ? http : https;
    const req = proto.request(options, (res) => {
      let fullContent = "";
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content || "";
            if (delta) {
              fullContent += delta;
              if (onChunk) onChunk(delta, parsed);
            }
          } catch (e) { /* skip partial */ }
        }
      });
      res.on("end", () => {
        resolve({ success: true, content: fullContent, model });
      });
    });
    req.on("error", (err) => resolve({ success: false, error: err.message, model }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false, error: "timeout", model });
    });
    req.write(body);
    req.end();
  });
}

// ─── Non-streaming model call ───────────────────────────────
function callModel(model, messages, temperature) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model,
      messages,
      stream: false,
      temperature: temperature || 0.7,
    });
    const url = new URL(OPENCODE_BASE + "/chat/completions");
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: "POST",
      timeout: 60000,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "MissionBarisal-v2",
      },
    };
    const proto = url.protocol === "http:" ? http : https;
    const req = proto.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const content =
            parsed.choices?.[0]?.message?.content || parsed.content || data;
          resolve({ success: true, content, raw: parsed, model });
        } catch (e) {
          resolve({ success: false, error: e.message, raw: data, model });
        }
      });
    });
    req.on("error", (err) =>
      resolve({ success: false, error: err.message, model }),
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false, error: "timeout", model });
    });
    req.write(body);
    req.end();
  });
}

// ─── Tool: auto-execute web_search in agent responses ──────
async function autoWebSearch(agent, response, userInput, context) {
  const content = response.content || "";
  const searchMatch = content.match(/web_search\s*:\s*(.+?)(?:\n|$)/i);
  if (!searchMatch) return response;

  const query = searchMatch[1].trim();
  // Skip fake/instruction queries
  const skipPatterns = [
    /তোমার প্রশ্ন/i, /আপনার প্রশ্ন/i, /লিখে দাও/i, /লিখে জানান/i,
    /উদাহরণ/i, /প্রয়োজনে/i, /যেকোনো/i, /enter.*query/i, /your.*question/i,
  ];
  if (query.length > 100 || skipPatterns.some(p => p.test(query))) {
    log("INFO", "WEB_SEARCH_SKIP", { agent: agent.id, reason: "instruction-like query" });
    return response;
  }

  log("INFO", "WEB_SEARCH_AUTO", { agent: agent.id, query });

  const searchResult = await webSearch(query);
  let searchText = "";
  if (searchResult.success && searchResult.results.length > 0) {
    searchText = "🔍 **ওয়েব সার্চ ফলাফল (" + query + "):**\n" +
      searchResult.results.map((r, i) =>
        i + 1 + ". **" + (r.title || "লিংক") + "**\n   " + (r.snippet || "")
      ).join("\n");
  } else {
    searchText = "🔍 ওয়েব সার্চ থেকে কোনো ফলাফল পাওয়া যায়নি।";
  }

  // Call the model again with search results
  const refined = await callModel(agent.model, [
    {
      role: "system",
      content: agent.persona + "\n\nতুমি ওয়েব সার্চ করেছিলে। এখন সার্চ ফলাফল ব্যবহার করে তোমার উত্তর আপডেট করো। প্রমাণ সহ দাও।"
    },
    {
      role: "user",
      content: "ইনপুট:\n" + userInput +
        (context ? "\n\nকনটেক্সট:\n" + context : "") +
        "\n\nতোমার আগের উত্তর:\n" + content +
        "\n\nওয়েব সার্চ ফলাফল:\n" + searchText +
        "\n\nএখন সার্চ ফলাফলের ভিত্তিতে তোমার উত্তর আপডেট করো।"
    }
  ]);

  return {
    ...response,
    content: refined.success
      ? searchText + "\n\n" + refined.content
      : content + "\n\n⚠️ সার্চ ফলাফল প্রসেস করতে ব্যর্থ।",
    webSearchUsed: true,
    searchQuery: query,
  };
}

// ══════════════════════════════════════════════════════════════
//  🤖 EXECUTION ENGINE
// ══════════════════════════════════════════════════════════════

async function phase1_initialResponse(agents, userInput, context) {
  log("INFO", "PHASE1_START", { agents: agents.length });
  await pushLog("phase", "Phase 1 শুরু: " + agents.length + " এজেন্ট কাজ করছে");
  return await Promise.all(
    agents.map(async (agent) => {
      await pushAgentStatus(agent.id, "working");
      await pushLog("agent", "🔍 " + agent.name + " কাজ শুরু করেছে");
      const sysMsg = {
        role: "system",
        content:
          agent.persona +
          "\n\n⚠️ **শাওন ভাই সতর্কবার্তা:** ভুল তথ্য দিলে বা প্রমাণ ছাড়া কিছু বললে শাওন ভাইকে জানানো হবে!\n      তোমার কাজের ডিরেক্টরি: " +
          WORK_DIR +
          "\n      ডকুমেন্ট আউটপুট: " +
          DOC_DIR +
          "\n      🔍 **প্রয়োজনে ওয়েব সার্চ করো** — নিজের জানার উপর নির্ভর না করে রিয়েল টাইম ডাটা আনো।\n      ওয়েব সার্চ করতে চাইলে 'web_search: তোমার প্রশ্ন' লিখে দাও — আমি নিজেই সার্চ করে ফলাফল এনে দেব!\n      মনে রাখ: শাওন ভাই সবকিছু জানতে পারেন — আকাম করলে ধরাই পড়বি!",
      };
      const usrMsg = {
        role: "user",
        content:
          "ইনপুট:\n" +
          userInput +
          (context ? "\n\nকনটেক্সট:\n" + context : "") +
          "\n\n🔍 তুমি চাইলে ওয়েব সার্চ করতে পারো। সার্চ করতে চাইলে 'web_search: তোমার প্রশ্ন' লিখে দাও — আমি নিজেই সার্চ করে ফলাফল এনে দেব!\n      কাজের ডিরেক্টরি: " +
          WORK_DIR +
          "\n      আউটপুট ডিরেক্টরি: " +
          DOC_DIR +
          "\n      তোমার দক্ষতা অনুযায়ী বিশ্লেষণ দাও। প্রমাণ সহ দাও। শাওন ভাই দেখছেন!",
      };
      let response = await callModel(agent.model, [sysMsg, usrMsg]);

      // 🔧 Auto-execute web_search tool if agent requested it
      response = await autoWebSearch(agent, response, userInput, context);
      if (response.webSearchUsed) {
        await pushLog("agent", "🌐 " + agent.name + " ওয়েব সার্চ করেছে: " + response.searchQuery);
      }

      return { agent, response, challenged: false, challengeResponse: null };
    }),
  );
}

async function phase2_crossVerify(agents, results, userInput, context) {
  const qaAgent =
    agents.find((a) => a.role === "quality") || agents[agents.length - 1];
  let verified = false;
  let round = 0;
  let challenges = [];

  while (!verified && round < MAX_DEBATE_ROUNDS) {
    round++;
    const valid = results.filter((r) => r.response.success);
    if (valid.length < 2) break;

    const summary = valid
      .map(
        (r) =>
          "[" +
          r.agent.id +
          "] " +
          r.agent.name +
          ":\n" +
          (r.response.content || "").slice(0, 1500),
      )
      .join("\n\n---\n\n");

    const qaResult = await callModel(qaAgent.model, [
      {
        role: "system",
        content:
          qaAgent.persona +
          "\n\nতোমার কাজ: বাকি সব এজেন্টের উত্তর চেক করা। দেখো কেউ ভুল বলছে কিনা। যদি ভুল পাও, CHALLENGE করো। সব ঠিক থাকলে VERIFIED বলো।\n\nCHALLENGE ফরম্যাট: [এজেন্ট_আইডি] => [কারণ]",
      },
      {
        role: "user",
        content:
          "ইনপুট:\n" +
          userInput +
          (context ? "\n" + context : "") +
          "\n\nসব উত্তর:\n" +
          summary +
          (round > 1
            ? "\n\nআগের চ্যালেঞ্জ:\n" +
              challenges
                .map(
                  (c) =>
                    "[" +
                    c.from +
                    "] → [" +
                    c.to +
                    "]: " +
                    c.challenge +
                    "\nউত্তর: " +
                    c.response,
                )
                .join("\n")
            : "") +
          "\n\nচেক করে VERIFIED বা CHALLENGE দাও।",
      },
    ]);

    const qaContent = qaResult.content || "";
    if (qaContent.includes("VERIFIED") && !qaContent.includes("CHALLENGE")) {
      verified = true;
      break;
    }

    const lines = qaContent
      .split("\n")
      .filter((l) => l.includes("=>") || l.includes("CHALLENGE"));
    if (lines.length === 0) {
      verified = true;
      break;
    }

    for (const line of lines) {
      const colonIdx = line.indexOf("=>");
      if (colonIdx < 0) continue;
      const beforeArrow = line.substring(0, colonIdx).trim();
      const challengeText = line.substring(colonIdx + 2).trim();
      const bracketMatch = beforeArrow.match(/\[([^\]]+)\]/);
      const targetId = bracketMatch ? bracketMatch[1].trim() : beforeArrow;
      const target = results.find((r) => r.agent.id === targetId);
      if (!target || !target.response.success) continue;

      const defense = await callModel(target.agent.model, [
        {
          role: "system",
          content:
            target.agent.persona +
            "\n\nতোমাকে চ্যালেঞ্জ করা হয়েছে। প্রমাণ সহ উত্তর রক্ষা করো বা ভুল স্বীকার করো।",
        },
        {
          role: "user",
          content:
            "চ্যালেঞ্জ: " +
            challengeText +
            "\n\nতোমার উত্তর:\n" +
            target.response.content +
            "\n\nপ্রমাণ সহ উত্তর দাও।",
        },
      ]);
      challenges.push({
        from: qaAgent.id,
        to: targetId,
        challenge: challengeText,
        response: defense.success ? defense.content : "উত্তর দিতে ব্যর্থ",
      });
      if (defense.success) {
        target.challenged = true;
        target.challengeResponse = defense.content;
      }
    }
  }
  return { verified, challenges, rounds: round };
}

async function phase3_combinedOutput(
  agents,
  results,
  userInput,
  context,
  verification,
) {
  const qaAgent =
    agents.find((a) => a.role === "quality") || agents[agents.length - 1];
  const valid = results.filter((r) => r.response.success);
  if (valid.length === 0)
    return {
      success: false,
      combined: "কোনো এজেন্টই উত্তর দিতে পারেনি ভাইয়া! 🤷",
    };

  const reports = valid
    .map((r) => {
      let c = r.response.content || "";
      if (r.challenged && r.challengeResponse)
        c += "\n\n[চ্যালেঞ্জের উত্তর]\n" + r.challengeResponse;
      return (
        "━━━ " +
        r.agent.name +
        " ━━━\nভূমিকা: " +
        r.agent.role +
        "\nমডেল: " +
        r.agent.model +
        "\n\n" +
        c.slice(0, 2000)
      );
    })
    .join("\n\n");

  const challengeLog =
    verification.challenges.length > 0
      ? "\n\nচ্যালেঞ্জ ও সমাধান:\n" +
        verification.challenges
          .map(
            (c) =>
              "→ " +
              c.from +
              " চ্যালেঞ্জ " +
              c.to +
              " কে:\n  " +
              c.challenge +
              "\n  উত্তর: " +
              (c.response || "").slice(0, 500),
          )
          .join("\n")
      : "\n\n✅ কোনো চ্যালেঞ্জ নেই — সব উত্তর ভেরিফাইড।";

  const finalResult = await callModel(qaAgent.model, [
    {
      role: "system",
      content:
        qaAgent.persona +
        "\n\nতুমি ফাইনাল আউটপুট তৈরি করবে। সব এজেন্টের উত্তর একত্রিত করে প্রমাণ-ভিত্তিক উত্তর দাও। বারিশালি স্টাইলে শুরু করো, কিন্তু পেশাদার এবং সম্পূর্ণ উত্তর দাও।",
    },
    {
      role: "user",
      content:
        "ইনপুট:\n" +
        userInput +
        (context ? "\n" + context : "") +
        "\n\nসব এজেন্ট:\n" +
        reports +
        challengeLog,
    },
  ]);

  return {
    success: true,
    combined: finalResult.success
      ? finalResult.content
      : "কম্বাইন্ড আউটপুট তৈরি করতে ব্যর্থ।",
    agents: valid.map((r) => ({
      agent: r.agent.name,
      role: r.agent.role,
      model: r.agent.model,
      challenged: r.challenged,
    })),
    verification: {
      verified: verification.verified,
      rounds: verification.rounds,
      challenges: verification.challenges.length,
    },
    stats: {
      totalAgents: agents.length,
      responded: valid.length,
      failed: results.filter((r) => !r.response.success).length,
      debateRounds: verification.rounds,
    },
  };
}

async function executeMission(userInput, context, sessionId) {
  const startTime = Date.now();
  log("INFO", "MISSION_START", {});
  if (AGENTS.length === 0)
    return { success: false, combined: "কোনো এজেন্ট পাওয়া যায়নি!" };
  const phase1Results = await phase1_initialResponse(
    AGENTS,
    userInput,
    context,
  );
  const verification = await phase2_crossVerify(
    AGENTS,
    phase1Results,
    userInput,
    context,
  );
  const output = await phase3_combinedOutput(
    AGENTS,
    phase1Results,
    userInput,
    context,
    verification,
  );
  if (sessionId) {
    if (userInput) saveMemory(sessionId, "user", userInput);
    if (output.combined) saveMemory(sessionId, "assistant", output.combined);
    updateSession(sessionId, {
      messages: (getSession(sessionId)?.messages || 0) + 1,
    });
  }
  const elapsed = Date.now() - startTime;
  log("INFO", "MISSION_COMPLETE", { elapsed });
  await pushLog("phase", "Phase 3 সম্পন্ন ✅");
  await pushOutput(output.combined);
  await pushDone(output.stats);
  return {
    ...output,
    timing: { elapsed },
    timestamp: new Date().toISOString(),
    session_id: sessionId,
  };
}

// ══════════════════════════════════════════════════════════════
//  🌐 HTTP SERVER
// ══════════════════════════════════════════════════════════════
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

function jsonResponse(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  });
  res.end(body);
}

function identityPage() {
  const uptime = Math.floor((Date.now() - STATS.startTime) / 1000);
  const aHtml = AGENTS.map(
    (a) =>
      `<div class="agent"><b>${a.name}</b><br><small>${a.role} · ${a.model}</small></div>`,
  ).join("");
  return `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><title>মিশন বরিশাল v2</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0e14;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:linear-gradient(135deg,#131a24,#1a2332);border:1px solid #1e293b;border-radius:20px;padding:40px;max-width:700px;width:100%;text-align:center}
h1{color:#f59e0b}.agents{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin:16px 0}
.agent{background:#1e293b;border-radius:10px;padding:12px;text-align:left;color:#94a3b8;font-size:0.85em}
.agent b{color:#f59e0b}.tag{display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.75em;margin:2px;background:#1e293b;color:#94a3b8}
.ok{background:#064e3b;color:#34d399}td{padding:6px 8px;color:#94a3b8}td:last-child{color:#e2e8f0}
.footer{color:#475569;font-size:0.8em;margin-top:20px;border-top:1px solid #1e293b;padding-top:16px}
</style></head><body><div class="card">
<div style="font-size:3em">🎭</div><h1>মিশন বরিশাল v2</h1>
<p style="color:#94a3b8">Multi-Agent · Zero Dependency · PERSONAS.md</p>
<div><span class="tag ok">zero dep</span><span class="tag">v2.0.0</span><span class="tag">${AGENTS.length} agents</span></div>
<table style="width:100%;margin:12px 0;text-align:left;font-size:0.85em">
<tr><td>Uptime</td><td>${uptime}s</td></tr>
<tr><td>Requests</td><td>${STATS.totalRequests}</td></tr>
<tr><td>Source</td><td>PERSONAS.md</td></tr></table>
<div class="agents">${aHtml}</div>
<div class="footer">Sahon Srabon · Developer Zone · Dhaka<br>🏴 "বরিশালের দুষ্টুমি আর কোডের কঠোরতা"</div>
</div></body></html>`;
}

function chatPage() {
  const aHtml = AGENTS.map(
    (a) =>
      `<div class="agent-tag" id="atag-${a.id}" title="${a.name} — ${a.role}">${a.name.replace(/^.{1,2}/, "")}</div>`,
  ).join("");
  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
<title>🎭 Mission Barisal — Chat</title>
<script src="https://js.pusher.com/8.4.0/pusher.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,'Noto Sans Bengali','Segoe UI',sans-serif;background:#0a0e14;color:#e2e8f0;height:100vh;display:flex;flex-direction:column;overflow:hidden}

/* ─── Header ─── */
.header{background:linear-gradient(135deg,#131a24,#1a2332);border-bottom:1px solid #1e293b;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.header h1{font-size:1.1em;color:#f59e0b;display:flex;align-items:center;gap:8px}
.header h1 span{font-size:0.6em;color:#64748b;font-weight:400}
.header .nav-links a{color:#64748b;text-decoration:none;font-size:0.75em;padding:4px 10px;border:1px solid #1e293b;border-radius:6px;transition:all .2s}
.header .nav-links a:hover{color:#f59e0b;border-color:#f59e0b;background:#1e293b}
.header .conn-status{font-size:0.7em;padding:3px 10px;border-radius:10px;display:inline-block}

/* ─── Agent Bar ─── */
.agent-bar{background:#0d1117;border-bottom:1px solid #1e293b;padding:6px 20px;display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0}
.agent-tag{font-size:0.7em;padding:2px 10px;border-radius:10px;background:#1e293b;color:#64748b;border:1px solid transparent;transition:all .3s;cursor:default}
.agent-tag.working{color:#fbbf24;border-color:#fbbf24;background:#1a1a0e;animation:pulse 1s infinite}
.agent-tag.done{color:#34d399;border-color:#34d399;background:#064e3b}
.agent-tag.error{color:#f87171;border-color:#f87171;background:#4c1d1d}

/* ─── Chat ─── */
.chat-area{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:12px;scroll-behavior:smooth}
.chat-area::-webkit-scrollbar{width:6px}
.chat-area::-webkit-scrollbar-thumb{background:#1e293b;border-radius:3px}
.chat-area::-webkit-scrollbar-track{background:transparent}

.message{max-width:85%;padding:10px 16px;border-radius:14px;font-size:0.9em;line-height:1.6;animation:fadeIn .3s ease;white-space:pre-wrap;word-wrap:break-word}
.message.user{background:#1e3a5f;color:#e2e8f0;align-self:flex-end;border-bottom-right-radius:4px}
.message.assistant{background:#131a24;color:#e2e8f0;align-self:flex-start;border-bottom-left-radius:4px;border:1px solid #1e293b}
.message.system{background:#1a1a0e;color:#fbbf24;align-self:center;font-size:0.8em;border-radius:8px;border:1px solid #78350f;text-align:center}
.message .msg-time{font-size:0.65em;color:#475569;margin-top:4px;display:block}

/* ─── Typing ─── */
.typing-indicator{display:none;align-self:flex-start;background:#131a24;padding:12px 18px;border-radius:14px;border:1px solid #1e293b;gap:4px;border-bottom-left-radius:4px}
.typing-indicator.show{display:flex;animation:fadeIn .3s ease}
.typing-dot{width:7px;height:7px;border-radius:50%;background:#64748b;animation:typingBounce 1.4s infinite}
.typing-dot:nth-child(2){animation-delay:.2s}
.typing-dot:nth-child(3){animation-delay:.4s}
@keyframes typingBounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}

/* ─── Input ─── */
.input-area{background:#131a24;border-top:1px solid #1e293b;padding:12px 20px;display:flex;gap:10px;align-items:flex-end;flex-shrink:0}
.input-area textarea{flex:1;padding:10px 14px;border-radius:12px;border:1px solid #1e293b;background:#0d1117;color:#e2e8f0;font-size:0.9em;font-family:inherit;resize:none;outline:none;min-height:44px;max-height:120px;transition:border-color .2s}
.input-area textarea:focus{border-color:#f59e0b}
.input-area button{width:44px;height:44px;border-radius:12px;border:none;background:#f59e0b;color:#0a0e14;font-size:1.2em;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.input-area button:hover{background:#d97706;transform:scale(1.05)}
.input-area button:disabled{background:#1e293b;color:#475569;cursor:not-allowed;transform:none}

/* ─── Welcome ─── */
.welcome{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;gap:16px;color:#475569}
.welcome .icon{font-size:4em}
.welcome h2{color:#64748b;font-weight:400}
.welcome p{font-size:0.85em;max-width:400px;line-height:1.6}

/* ─── Fade ─── */
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%{opacity:1}50%{opacity:0.4}100%{opacity:1}}

/* ─── Mobile ─── */
@media(max-width:600px){.message{max-width:92%;font-size:0.85em}.header h1{font-size:0.9em}.header .nav-links a{font-size:0.65em;padding:3px 6px}}
</style>
</head>
<body>

<div class="header">
  <h1>🎭 মিশন বরিশাল <span>v2</span></h1>
  <div style="display:flex;align-items:center;gap:8px">
    <span class="conn-status" id="connBadge">🔌 সংযোগ হচ্ছে...</span>
    <div class="nav-links"><a href="/dashboard">📊 ড্যাশবোর্ড</a><a href="/status">ℹ️ স্ট্যাটাস</a><a href="/health">💚 হেলথ</a></div>
  </div>
</div>

<div class="agent-bar">${aHtml}</div>

<div class="chat-area" id="chatArea">
  <div class="welcome" id="welcome">
    <div class="icon">🎭</div>
    <h2>বরিশালের দুষ্টুমি আর কোডের কঠোরতা — একসাথে!</h2>
    <p>৬ জন এজেন্ট তোমার জন্য অপেক্ষা করছে। নিচে তোমার প্রশ্ন লেখো — বাকিটা তারা দেখবে।</p>
  </div>
  <div class="typing-indicator" id="typing"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>
</div>

<div class="input-area">
  <textarea id="inp" rows="1" placeholder="বলেন ভাইয়া কী করবেন? (Enter পাঠাতে, Shift+Enter নতুন লাইন)" onkeydown="handleKey(event)"></textarea>
  <button id="sendBtn" onclick="send()" title="পাঠান">➤</button>
</div>

<script>
const API = window.location.origin;
let sessionId = localStorage.getItem("mb_session") || null;
let isLoading = false;

const inp = document.getElementById("inp");
const chat = document.getElementById("chatArea");
const typing = document.getElementById("typing");
const welcome = document.getElementById("welcome");
const sendBtn = document.getElementById("sendBtn");
const connBadge = document.getElementById("connBadge");

// Auto-resize textarea
inp.addEventListener("input", () => {
  inp.style.height = "auto";
  inp.style.height = Math.min(inp.scrollHeight, 120) + "px";
});

function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
}

function el(id){ return document.getElementById(id) }

function scrollBottom() {
  requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
}

function addMessage(role, content) {
  welcome.style.display = "none";
  const div = document.createElement("div");
  div.className = "message " + role;
  const time = new Date().toLocaleTimeString();
  div.innerHTML = content.replace(/\\n/g, "<br>") + '<span class="msg-time">' + time + "</span>";
  chat.insertBefore(div, typing);
  scrollBottom();
}

function setAgentStatus(id, status) {
  const tag = document.getElementById("atag-" + id);
  if (!tag) return;
  tag.className = "agent-tag " + status;
}

function resetAgentTags() {
  document.querySelectorAll(".agent-tag").forEach((t) => (t.className = "agent-tag"));
}

function setLoading(v) {
  isLoading = v;
  inp.disabled = v;
  sendBtn.disabled = v;
  typing.classList.toggle("show", v);
  if (v) { scrollBottom(); }
}

function showError(msg) {
  const div = document.createElement("div");
  div.className = "message system";
  div.textContent = "❌ " + msg;
  chat.insertBefore(div, typing);
  scrollBottom();
}

// ─── Send ───
async function send() {
  const text = inp.value.trim();
  if (!text || isLoading) return;

  addMessage("user", text);
  inp.value = "";
  inp.style.height = "auto";
  setLoading(true);
  resetAgentTags();

  try {
    const res = await fetch(API + "/api/mission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text,
        session_id: sessionId
      })
    });

    const data = await res.json();

    if (data.session_id) {
      sessionId = data.session_id;
      try { localStorage.setItem("mb_session", sessionId); } catch(e) {}
    }

    // Show agent statuses
    if (data.agents) {
      data.agents.forEach((a) => {
        const id = AGENT_IDS[a.agent] || null;
        if (id) setAgentStatus(id, a.challenged ? "error" : "done");
      });
    }

    if (data.combined) {
      addMessage("assistant", data.combined);
    } else if (data.error) {
      showError(data.error);
    }

  } catch (e) {
    showError("সার্ভারে সংযোগ ব্যর্থ! " + e.message);
  }

  setLoading(false);
}

// ─── Agent ID mapping ───
const AGENT_IDS = ${JSON.stringify(
    Object.fromEntries(AGENTS.map((a) => [a.name, a.id])),
  )};

// ─── MCP / OpenAI Connection Check ───
async function checkConnection() {
  try {
    const res = await fetch(API + "/v1/models", { method: "GET" });
    const data = await res.json();
    if (data.object === "list" && data.data && data.data.length > 0) {
      connBadge.textContent = "✅ MCP সংযুক্ত (" + data.data.length + " মডেল)";
      connBadge.style.color = "#34d399";
      connBadge.style.background = "#064e3b";
    } else {
      connBadge.textContent = "⚠️ MCP ত্রুটি";
      connBadge.style.color = "#fbbf24";
      connBadge.style.background = "#78350f";
    }
  } catch (e) {
    connBadge.textContent = "❌ MCP বিচ্ছিন্ন";
    connBadge.style.color = "#f87171";
    connBadge.style.background = "#4c1d1d";
  }
}
checkConnection();

// ─── Pusher real-time listener ────────────────────────────
(function initPusher() {
  const PUSHER_KEY = 'b99355f977e758d4ec15';
  const CLUSTER = 'ap2';
  if (typeof Pusher !== 'undefined') {
    try {
      const pusher = new Pusher(PUSHER_KEY, { cluster: CLUSTER });
      const ch = pusher.subscribe('mission-barisal');
      ch.bind('mission-log', (d) => {
        const msg = d.message || '';
        if (d.type === 'phase') log('phase', msg);
        else log('system', msg);
      });
      ch.bind('agent-status', (d) => {
        const id = d.agent || '';
        const status = d.status || '';
        if (id && AGENT_IDS[id]) setAgentStatus(AGENT_IDS[id], status);
        log('system', '🤖 ' + id + ': ' + status);
      });
      ch.bind('mission-output', (d) => {
        if (d.output) {
          welcome.style.display = "none";
          const existing = document.getElementById('stream-output');
          if (!existing) {
            const div = document.createElement('div');
            div.id = 'stream-output';
            div.className = 'message assistant';
            div.style.borderLeft = '3px solid #f59e0b';
            chat.insertBefore(div, typing);
          }
          const el = document.getElementById('stream-output');
          el.innerHTML = d.output.replace(/\\n/g, '<br>') + '<span class="msg-time">🔴 লাইভ</span>';
          scrollBottom();
        }
      });
      ch.bind('mission-done', () => {
        const el = document.getElementById('stream-output');
        if (el) {
          const time = new Date().toLocaleTimeString();
          el.innerHTML = el.innerHTML.replace('🔴 লাইভ', time);
          el.style.borderLeftColor = '#34d399';
        }
      });
      log('system', '📡 Pusher রিয়েল-টাইম সংযুক্ত');
    } catch(e) {
      console.log('Pusher init error:', e.message);
    }
  }
})();

// ─── Load history if session exists ───
if (sessionId) {
  // Try to restore welcome message with session info
  welcome.querySelector("p").textContent = "পূর্বের সেশন পুনরুদ্ধার করা হয়েছে। নতুন প্রশ্ন করুন!";
}

console.log("🎭 Mission Barisal Chat · " + AGENTS.length + " agents");
</script>
</body>
</html>`;
}

// ─── Request Handler ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = req.url.split("?")[0];

    if (url === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(chatPage());
      return;
    }

    if (url === "/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(identityPage());
      return;
    }

    if (url === "/health") {
      jsonResponse(res, 200, {
        healthy: true,
        version: "2.0.0",
        agents: AGENTS.length,
        models: FREE_MODELS.length,
        pusher: PUSHER_ENABLED,
        uptime: Math.floor((Date.now() - STATS.startTime) / 1000),
      });
      return;
    }

    if (url === "/api/agents") {
      jsonResponse(res, 200, {
        count: AGENTS.length,
        source: "PERSONAS.md",
        agents: AGENTS.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          model: a.model,
        })),
      });
      return;
    }

    if (url === "/api/models") {
      jsonResponse(res, 200, {
        models: FREE_MODELS.map((m) => ({
          id: m,
          object: "model",
          owned_by: "opencode-zen-free",
        })),
      });
      return;
    }

    // ═══ OpenAI-compatible: GET /v1/models ═══════════════════
    if (url === "/v1/models" && req.method === "GET") {
      jsonResponse(res, 200, {
        object: "list",
        data: FREE_MODELS.map((m) => ({
          id: m,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "opencode-zen-free",
        })),
      });
      return;
    }

    // ═══ OpenAI-compatible: POST /v1/chat/completions ════════
    if (url === "/v1/chat/completions" && req.method === "POST") {
      STATS.totalRequests++;
      if (AGENTS.length === 0) {
        jsonResponse(res, 400, {
          error: "কোনো এজেন্ট লোড হয়নি! PERSONAS.md চেক করুন।",
        });
        return;
      }

      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        jsonResponse(res, 400, { error: "Invalid JSON" });
        return;
      }

      const model = parsed.model || FREE_MODELS[0];
      const messages = parsed.messages || [];
      const temperature = parsed.temperature || 0.7;
      const stream = parsed.stream || false;

      // OpenAI format: extract user input from messages
      const userMsg = messages.filter((m) => m.role === "user").pop();
      const sysMsg = messages.filter((m) => m.role === "system").pop();
      const userInput = userMsg ? userMsg.content : "";
      const context = sysMsg ? sysMsg.content : "";

      // Find the right agent for this model, or use first available
      let targetAgent = AGENTS.find((a) => a.model === model);
      if (!targetAgent) {
        // Try to match by partial name
        targetAgent = AGENTS.find(
          (a) => model.includes(a.model) || a.model.includes(model),
        );
      }
      if (!targetAgent) {
        // Use the first agent as fallback
        targetAgent = AGENTS[0];
      }

      if (stream) {
        // ─── SSE Streaming Response ───
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        const responseId = "chatcmpl-" + crypto.randomUUID().replace(/-/g, "");
        let fullContent = "";

        await callModelStream(targetAgent.model, messages, temperature, (delta) => {
          fullContent += delta;
          const sseData = JSON.stringify({
            id: responseId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [
              {
                index: 0,
                delta: { content: delta },
                finish_reason: null,
              },
            ],
          });
          res.write("data: " + sseData + "\n\n");
        });

        // Send final [DONE] chunk
        const doneData = JSON.stringify({
          id: responseId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
            completion_tokens: Math.ceil(fullContent.length / 4),
            total_tokens: Math.ceil(
              (JSON.stringify(messages).length + fullContent.length) / 4,
            ),
          },
        });
        res.write("data: " + doneData + "\n\n");
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const result = await callModel(targetAgent.model, messages, temperature);

      if (!result.success) {
        jsonResponse(res, 502, {
          error: {
            message: result.error || "Model call failed",
            type: "server_error",
          },
          model: model,
        });
        return;
      }

      // Save to memory if we have a session context
      const respContent = result.content || "";

      jsonResponse(res, 200, {
        id: "chatcmpl-" + crypto.randomUUID().replace(/-/g, ""),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: respContent,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
          completion_tokens: Math.ceil(respContent.length / 4),
          total_tokens: Math.ceil(
            (JSON.stringify(messages).length + respContent.length) / 4,
          ),
        },
      });
      return;
    }

    // ═══ POST /api/mission (with optional SSE streaming) ═══
    if (url === "/api/mission" && req.method === "POST") {
      STATS.totalRequests++;
      if (AGENTS.length === 0) {
        jsonResponse(res, 400, {
          error: "কোনো এজেন্ট লোড হয়নি! PERSONAS.md চেক করুন।",
        });
        return;
      }

      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        jsonResponse(res, 400, { error: "Invalid JSON" });
        return;
      }

      const userInput = parsed.input || parsed.query || parsed.prompt || "";
      const context = parsed.context || parsed.system || "";
      let sessionId = parsed.session_id;

      if (!sessionId || !getSession(sessionId)) {
        const session = createSession(parsed.client_id || "anonymous");
        sessionId = session.id;
      }

      // Load conversation memory
      const mem = getMemory(sessionId);
      if (mem.length > 0) {
        const history = mem
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-MAX_HISTORY);
        parsed.messages = [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userInput },
        ];
        log("INFO", "MEMORY_LOADED", {
          session: sessionId.slice(0, 8),
          count: history.length,
        });
      }

      if (!userInput) {
        jsonResponse(res, 400, { error: "ইনপুট দেন ভাইয়া!" });
        return;
      }

      log("INFO", "REQUEST", { session: sessionId.slice(0, 8) });

      // ─── SSE Streaming mode ───
      const wantsSSE = req.headers.accept && req.headers.accept.includes("text/event-stream");
      if (wantsSSE) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        // Override push functions to write SSE events
        const originalPushLog = pushLog;
        const originalPushAgent = pushAgentStatus;
        const originalPushOutput = pushOutput;
        const originalPushDone = pushDone;

        pushLog = async (type, message) => {
          const sse = JSON.stringify({ type, message, time: new Date().toISOString() });
          res.write("event: log\ndata: " + sse + "\n\n");
          // Also try Pusher
          await originalPushLog(type, message);
        };
        pushAgentStatus = async (agentId, status) => {
          const sse = JSON.stringify({ agent: agentId, status, time: new Date().toISOString() });
          res.write("event: agent-status\ndata: " + sse + "\n\n");
          await originalPushAgent(agentId, status);
        };
        pushOutput = async (output) => {
          const sse = JSON.stringify({ output, time: new Date().toISOString() });
          res.write("event: output\ndata: " + sse + "\n\n");
          await originalPushOutput(output);
        };
        pushDone = async (stats) => {
          const sse = JSON.stringify({ stats, time: new Date().toISOString() });
          res.write("event: done\ndata: " + sse + "\n\n");
          await originalPushDone(stats);
        };

        const result = await executeMission(userInput, context, sessionId);

        // Restore originals
        pushLog = originalPushLog;
        pushAgentStatus = originalPushAgent;
        pushOutput = originalPushOutput;
        pushDone = originalPushDone;

        // Send final result
        const finalSSE = JSON.stringify({ ...result, session_id: sessionId });
        res.write("event: complete\ndata: " + finalSSE + "\n\n");
        res.end();
        return;
      }

      // ─── Normal JSON mode (no SSE) ───
      const result = await executeMission(userInput, context, sessionId);
      jsonResponse(res, result.success ? 200 : 500, {
        ...result,
        session_id: sessionId,
      });
      return;
    }

    // ═══ POST /api/pusher/trigger — manual Pusher event ═════
    if (url === "/api/pusher/trigger" && req.method === "POST") {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        jsonResponse(res, 400, { error: "Invalid JSON" });
        return;
      }
      if (!PUSHER_ENABLED) {
        jsonResponse(res, 400, {
          error:
            "Pusher not configured. Set PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET",
        });
        return;
      }
      const result = await triggerPusherEvent(
        parsed.channel || "mission-barisal",
        parsed.event || "custom-event",
        parsed.data || { message: "triggered" },
      );
      jsonResponse(res, result.success ? 200 : 502, result);
      return;
    }

    // ═══ GET /dashboard — Interactive HTML Dashboard ═══════════
    if (url === "/dashboard") {
      const dashboardPath = path.join(__dirname, "dashboard.html");
      if (fs.existsSync(dashboardPath)) {
        const html = fs.readFileSync(dashboardPath, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else {
        // Fallback: inline minimal dashboard
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!DOCTYPE html><html><head><title>Dashboard</title></head><body><h1>📊 Dashboard</h1><p>dashboard.html not found. Create it or run from the project directory.</p><p>Pusher: ${PUSHER_ENABLED ? "✅" : "❌"} | Agents: ${AGENTS.length}</p></body></html>`,
        );
      }
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  } catch (err) {
    log("ERROR", "SERVER", { error: err.message });
    jsonResponse(res, 500, { error: err.message });
  }
});

// ─── Start ──────────────────────────────────────────────────
async function init() {
  AGENTS = await loadPersonas();
  if (AGENTS.length === 0) {
    log("WARN", "START_NO_AGENTS", {});
  }
  server.listen(PORT, "0.0.0.0", () => {
    log("INFO", "START", { port: PORT, agents: AGENTS.length });
    console.log(
      "\n🎭 মিশন বরিশাল v2 · http://localhost:" +
        PORT +
        " · " +
        AGENTS.length +
        " agents" +
        (AGENTS.length > 0 ? " from PERSONAS.md" : " ⚠️ NO AGENTS") +
        "\n",
    );
  });
}
init();

process.on("SIGINT", () => {
  log("INFO", "SHUTDOWN", {});
  server.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  log("INFO", "SHUTDOWN", {});
  server.close(() => process.exit(0));
});
