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
const PERSONAS_FILE = path.resolve(process.env.PERSONAS_FILE || "./PERSONAS.md");
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL || "86400000", 10);
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || "20", 10);
const WORK_DIR = process.env.WORK_DIR || process.cwd();
const DOC_DIR = process.env.DOC_DIR || "./docs";
const GIT_PERSONAS_URL = process.env.GIT_PERSONAS_URL || "https://raw.githubusercontent.com/sahonsrabon-os/missionbarisal/main/PERSONAS.md";

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
  try { fs.appendFileSync(logFile, entry + "\n"); } catch (e) {}
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
  const re = new RegExp("^-\\s*\\*{0,2}" + field + "\\*{0,2}\\s*:\\s*(.+)$", "m");
  const match = block.match(re);
  return match ? match[1].trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "") : null;
}

function extractPersona(block) {
  const match = block.match(/\*\*persona\*\*:\s*\|\s*\n([\s\S]*?)(?:^##\s|^---|$)/m);
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
function loadPersonas() {
  if (fs.existsSync(PERSONAS_FILE)) {
    try {
      const content = fs.readFileSync(PERSONAS_FILE, "utf8");
      const agents = parsePersonas(content);
      if (agents.length > 0) {
        log("INFO", "PERSONAS_LOADED", { source: "local", count: agents.length });
        return agents;
      }
    } catch (e) {
      log("WARN", "PERSONAS_PARSE_FAIL", { error: e.message });
    }
  }
  log("WARN", "PERSONAS_NOT_FOUND", { file: PERSONAS_FILE });
  // Auto-download from GitHub
  log("INFO", "PERSONAS_DOWNLOAD", { url: GIT_PERSONAS_URL });
  try {
    const https = require("https");
    return new Promise((resolve) => {
      https.get(GIT_PERSONAS_URL, { timeout: 10000 }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            if (!fs.existsSync(path.dirname(PERSONAS_FILE))) fs.mkdirSync(path.dirname(PERSONAS_FILE), { recursive: true });
            fs.writeFileSync(PERSONAS_FILE, data);
            const agents = parsePersonas(data);
            if (agents.length > 0) {
              log("INFO", "PERSONAS_DOWNLOADED", { count: agents.length });
              resolve(agents);
            } else { resolve([]); }
          } catch (e) { log("WARN", "PERSONAS_DOWNLOAD_FAIL", { error: e.message }); resolve([]); }
        });
      }).on("error", (e) => { log("WARN", "PERSONAS_DOWNLOAD_ERR", { error: e.message }); resolve([]); });
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
    const url = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query);
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
        const linkRegex = /<a[^>]*href="([^"]*)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
        
        // Try to parse DDG lite format
        const rows = data.split("<tr>");
        for (const row of rows) {
          const linkMatch = row.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
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
          const bodyText = data.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          resolve({ 
            success: true, 
            results: [{ title: "Search Result", snippet: bodyText.slice(0, 1000), link: "" }], 
            query 
          });
        }
      });
    });
    req.on("error", (err) => resolve({ success: false, error: err.message, query }));
    req.on("timeout", () => { req.destroy(); resolve({ success: false, error: "timeout", query }); });
    req.end();
  });
}

// ─── Formatted search for agents ─────────────────────────────
async function agentSearch(agent, query) {
  const result = await webSearch(query);
  if (result.success && result.results.length > 0) {
    return result.results.map((r, i) => 
      (i + 1) + ". [" + r.title + "](" + r.link + ")\n   " + r.snippet
    ).join("\n");
  }
  return null;
}
const AGENTS = loadPersonas();
const STATS = { totalRequests: 0, totalAgents: AGENTS.length, models: FREE_MODELS.length, startTime: Date.now() };

// ══════════════════════════════════════════════════════════════
//  💾 MEMORY SYSTEM
// ══════════════════════════════════════════════════════════════
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

function readSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8")) || []; }
  catch (e) { return []; }
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
  const sessions = readSessions().filter((s) => new Date(s.expires_at).getTime() > now);
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
    try { mem = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
  }
  mem.push({ role, content: String(content).slice(0, 4000), timestamp: new Date().toISOString() });
  if (mem.length > 50) mem = mem.slice(-50);
  fs.writeFileSync(file, JSON.stringify(mem, null, 2));
}

function getMemory(sessionId) {
  const file = path.join(DATA_DIR, "mem-" + sessionId + ".json");
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
  }
  return [];
}

// ══════════════════════════════════════════════════════════════
//  🔌 OPENCODE API CALL
// ══════════════════════════════════════════════════════════════
function callModel(model, messages, temperature) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ model, messages, stream: false, temperature: temperature || 0.7 });
    const url = new URL(OPENCODE_BASE + "/chat/completions");
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: "POST",
      timeout: 60000,
      headers: { "Content-Type": "application/json", "User-Agent": "MissionBarisal-v2" },
    };
    const proto = url.protocol === "http:" ? http : https;
    const req = proto.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content || parsed.content || data;
          resolve({ success: true, content, raw: parsed, model });
        } catch (e) { resolve({ success: false, error: e.message, raw: data, model }); }
      });
    });
    req.on("error", (err) => resolve({ success: false, error: err.message, model }));
    req.on("timeout", () => { req.destroy(); resolve({ success: false, error: "timeout", model }); });
    req.write(body);
    req.end();
  });
}

// ══════════════════════════════════════════════════════════════
//  🤖 EXECUTION ENGINE
// ══════════════════════════════════════════════════════════════

async function phase1_initialResponse(agents, userInput, context) {
  log("INFO", "PHASE1_START", { agents: agents.length });
  return await Promise.all(agents.map(async (agent) => {
    const sysMsg = { role: "system", content: agent.persona +      "\\n\\n⚠️ **শাওন ভাই সতর্কবার্তা:** ভুল তথ্য দিলে বা প্রমাণ ছাড়া কিছু বললে শাওন ভাইকে জানানো হবে!\\n      তোমার কাজের ডিরেক্টরি: " + WORK_DIR + "\\n      ডকুমেন্ট আউটপুট: " + DOC_DIR + "\\n      🔍 **প্রয়োজনে ওয়েব সার্চ করো** — নিজের জানার উপর নির্ভর না করে রিয়েল টাইম ডাটা আনো।\\n      মনে রাখ: শাওন ভাই সবকিছু জানতে পারেন — আকাম করলে ধরাই পড়বি!" }
    const usrMsg = { role: "user", content: "ইনপুট:\\n" + userInput + (context ? "\\n\\nকনটেক্সট:\\n" + context : "") +      "\\n\\n🔍 তুমি চাইলে ওয়েব সার্চ করতে পারো। সার্চ করতে চাইলে 'web_search: তোমার প্রশ্ন' লিখে দাও।\\n      কাজের ডিরেক্টরি: " + WORK_DIR + "\\n      আউটপুট ডিরেক্টরি: " + DOC_DIR + "\\n      তোমার দক্ষতা অনুযায়ী বিশ্লেষণ দাও। প্রমাণ সহ দাও। শাওন ভাই দেখছেন!" }
    const response = await callModel(agent.model, [sysMsg, usrMsg]);
    return { agent, response, challenged: false, challengeResponse: null };
  }));
}

async function phase2_crossVerify(agents, results, userInput, context) {
  const qaAgent = agents.find((a) => a.role === "quality") || agents[agents.length - 1];
  let verified = false;
  let round = 0;
  let challenges = [];

  while (!verified && round < MAX_DEBATE_ROUNDS) {
    round++;
    const valid = results.filter((r) => r.response.success);
    if (valid.length < 2) break;

    const summary = valid.map((r) => "[" + r.agent.id + "] " + r.agent.name + ":\n" + (r.response.content || "").slice(0, 1500)).join("\n\n---\n\n");

    const qaResult = await callModel(qaAgent.model, [
      { role: "system", content: qaAgent.persona + "\n\nতোমার কাজ: বাকি সব এজেন্টের উত্তর চেক করা। দেখো কেউ ভুল বলছে কিনা। যদি ভুল পাও, CHALLENGE করো। সব ঠিক থাকলে VERIFIED বলো।\n\nCHALLENGE ফরম্যাট: [এজেন্ট_আইডি] => [কারণ]" },
      { role: "user", content: "ইনপুট:\n" + userInput + (context ? "\n" + context : "") + "\n\nসব উত্তর:\n" + summary + (round > 1 ? "\n\nআগের চ্যালেঞ্জ:\n" + challenges.map((c) => "[" + c.from + "] → [" + c.to + "]: " + c.challenge + "\nউত্তর: " + c.response).join("\n") : "") + "\n\nচেক করে VERIFIED বা CHALLENGE দাও।" },
    ]);

    const qaContent = qaResult.content || "";
    if (qaContent.includes("VERIFIED") && !qaContent.includes("CHALLENGE")) { verified = true; break; }

    const lines = qaContent.split("\n").filter((l) => l.includes("=>") || l.includes("CHALLENGE"));
    if (lines.length === 0) { verified = true; break; }

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
        { role: "system", content: target.agent.persona + "\n\nতোমাকে চ্যালেঞ্জ করা হয়েছে। প্রমাণ সহ উত্তর রক্ষা করো বা ভুল স্বীকার করো।" },
        { role: "user", content: "চ্যালেঞ্জ: " + challengeText + "\n\nতোমার উত্তর:\n" + target.response.content + "\n\nপ্রমাণ সহ উত্তর দাও।" },
      ]);
      challenges.push({ from: qaAgent.id, to: targetId, challenge: challengeText, response: defense.success ? defense.content : "উত্তর দিতে ব্যর্থ" });
      if (defense.success) { target.challenged = true; target.challengeResponse = defense.content; }
    }
  }
  return { verified, challenges, rounds: round };
}

async function phase3_combinedOutput(agents, results, userInput, context, verification) {
  const qaAgent = agents.find((a) => a.role === "quality") || agents[agents.length - 1];
  const valid = results.filter((r) => r.response.success);
  if (valid.length === 0) return { success: false, combined: "কোনো এজেন্টই উত্তর দিতে পারেনি ভাইয়া! 🤷" };

  const reports = valid.map((r) => {
    let c = r.response.content || "";
    if (r.challenged && r.challengeResponse) c += "\n\n[চ্যালেঞ্জের উত্তর]\n" + r.challengeResponse;
    return "━━━ " + r.agent.name + " ━━━\nভূমিকা: " + r.agent.role + "\nমডেল: " + r.agent.model + "\n\n" + c.slice(0, 2000);
  }).join("\n\n");

  const challengeLog = verification.challenges.length > 0
    ? "\n\nচ্যালেঞ্জ ও সমাধান:\n" + verification.challenges.map((c) => "→ " + c.from + " চ্যালেঞ্জ " + c.to + " কে:\n  " + c.challenge + "\n  উত্তর: " + (c.response || "").slice(0, 500)).join("\n")
    : "\n\n✅ কোনো চ্যালেঞ্জ নেই — সব উত্তর ভেরিফাইড।";

  const finalResult = await callModel(qaAgent.model, [
    { role: "system", content: qaAgent.persona + "\n\nতুমি ফাইনাল আউটপুট তৈরি করবে। সব এজেন্টের উত্তর একত্রিত করে প্রমাণ-ভিত্তিক উত্তর দাও। বারিশালি স্টাইলে শুরু করো, কিন্তু পেশাদার এবং সম্পূর্ণ উত্তর দাও।" },
    { role: "user", content: "ইনপুট:\n" + userInput + (context ? "\n" + context : "") + "\n\nসব এজেন্ট:\n" + reports + challengeLog },
  ]);

  return {
    success: true,
    combined: finalResult.success ? finalResult.content : "কম্বাইন্ড আউটপুট তৈরি করতে ব্যর্থ।",
    agents: valid.map((r) => ({ agent: r.agent.name, role: r.agent.role, model: r.agent.model, challenged: r.challenged })),
    verification: { verified: verification.verified, rounds: verification.rounds, challenges: verification.challenges.length },
    stats: { totalAgents: agents.length, responded: valid.length, failed: results.filter((r) => !r.response.success).length, debateRounds: verification.rounds },
  };
}

async function executeMission(userInput, context, sessionId) {
  const startTime = Date.now();
  log("INFO", "MISSION_START", {});
  if (AGENTS.length === 0) return { success: false, combined: "কোনো এজেন্ট পাওয়া যায়নি!" };
  const phase1Results = await phase1_initialResponse(AGENTS, userInput, context);
  const verification = await phase2_crossVerify(AGENTS, phase1Results, userInput, context);
  const output = await phase3_combinedOutput(AGENTS, phase1Results, userInput, context, verification);
  if (sessionId) {
    if (userInput) saveMemory(sessionId, "user", userInput);
    if (output.combined) saveMemory(sessionId, "assistant", output.combined);
    updateSession(sessionId, { messages: (getSession(sessionId)?.messages || 0) + 1 });
  }
  log("INFO", "MISSION_COMPLETE", { elapsed: Date.now() - startTime });
  return { ...output, timing: { elapsed: Date.now() - startTime }, timestamp: new Date().toISOString(), session_id: sessionId };
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
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "*" });
  res.end(body);
}

function identityPage() {
  const uptime = Math.floor((Date.now() - STATS.startTime) / 1000);
  const aHtml = AGENTS.map((a) => `<div class="agent"><b>${a.name}</b><br><small>${a.role} · ${a.model}</small></div>`).join("");
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

// ─── Request Handler ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  try {
    const url = req.url.split("?")[0];

    if (url === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(identityPage());
      return;
    }

    if (url === "/health") {
      jsonResponse(res, 200, { healthy: true, version: "2.0.0", agents: AGENTS.length, models: FREE_MODELS.length, uptime: Math.floor((Date.now() - STATS.startTime) / 1000) });
      return;
    }

    if (url === "/api/agents") {
      jsonResponse(res, 200, { count: AGENTS.length, source: "PERSONAS.md", agents: AGENTS.map((a) => ({ id: a.id, name: a.name, role: a.role, model: a.model })) });
      return;
    }

    if (url === "/api/models") {
      jsonResponse(res, 200, { models: FREE_MODELS.map((m) => ({ id: m, object: "model", owned_by: "opencode-zen-free" })) });
      return;
    }

    // ═══ POST /api/mission ═══════════════════════
    if (url === "/api/mission" && req.method === "POST") {
      STATS.totalRequests++;
      if (AGENTS.length === 0) {
        jsonResponse(res, 400, { error: "কোনো এজেন্ট লোড হয়নি! PERSONAS.md চেক করুন।" });
        return;
      }

      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { jsonResponse(res, 400, { error: "Invalid JSON" }); return; }

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
        const history = mem.filter((m) => m.role === "user" || m.role === "assistant").slice(-MAX_HISTORY);
        parsed.messages = [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userInput }
        ];
        log("INFO", "MEMORY_LOADED", { session: sessionId.slice(0, 8), count: history.length });
      }

      if (!userInput) {
        jsonResponse(res, 400, { error: "ইনপুট দেন ভাইয়া!" });
        return;
      }

      log("INFO", "REQUEST", { session: sessionId.slice(0, 8) });
      const result = await executeMission(userInput, context, sessionId);
      jsonResponse(res, result.success ? 200 : 500, { ...result, session_id: sessionId });
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  } catch (err) {
    log("ERROR", "SERVER", { error: err.message });
    jsonResponse(res, 500, { error: err.message });
  }
});

// ─── Start ──────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  log("INFO", "START", { port: PORT, agents: AGENTS.length });
  console.log("\n🎭 মিশন বরিশাল v2 · http://localhost:" + PORT + " · " + AGENTS.length + " agents from PERSONAS.md\n");
});

process.on("SIGINT", () => { log("INFO", "SHUTDOWN", {}); server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { log("INFO", "SHUTDOWN", {}); server.close(() => process.exit(0)); });