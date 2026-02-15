import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Store from "electron-store";
import * as pty from "node-pty";

type ExecutionMode = "sandboxed" | "system-wide" | "dual-stream";
type AgentRoute = "local" | "cloud";

interface VaultData {
  cloudApiKeyEncrypted: string;
  cloudApiBaseUrl: string;
  localModel: string;
  cloudModel: string;
  executionMode: ExecutionMode;
  systemWideAcknowledged: boolean;
}

const store = new Store<VaultData>({
  name: "vibe-clone-vault",
  defaults: {
    cloudApiKeyEncrypted: "",
    cloudApiBaseUrl: "https://api.openai.com/v1/chat/completions",
    localModel: "llama3.2",
    cloudModel: "gpt-4o",
    executionMode: "sandboxed",
    systemWideAcknowledged: false
  }
});

const ptySessions = new Map<string, pty.IPty>();
const paneShellExe = new Map<string, string>();
const activeAgentControllers = new Map<string, AbortController>();
let mainWindow: BrowserWindow | null = null;

function writeAppLog(level: "INFO" | "WARN" | "ERROR", message: string): void {
  try {
    const logDir = app.getPath("userData");
    const logPath = path.join(logDir, "vibe-clone.log");
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;
    fs.appendFileSync(logPath, line, "utf8");
  } catch {
    // Logging must not break app flow.
  }
}

function emitPtyData(paneId: string, chunk: string): void {
  mainWindow?.webContents.send("pty:data", { paneId, chunk });
}

function emitAgentRouted(paneId: string, route: AgentRoute): void {
  const cloudModel = getVault("cloudModel");
  mainWindow?.webContents.send("agent:routed", {
    paneId,
    route,
    model: route === "local" ? "Local" : "Cloud",
    modelName: route === "local" ? getVault("localModel") : cloudModel
  });
}

function getVault<K extends keyof VaultData>(key: K): VaultData[K] {
  return (store as unknown as { get: (k: K) => VaultData[K] }).get(key);
}

function setVault<K extends keyof VaultData>(key: K, value: VaultData[K]): void {
  (store as unknown as { set: (k: K, v: VaultData[K]) => void }).set(key, value);
}

function encryptKey(raw: string): string {
  if (!raw) return "";
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(raw).toString("base64");
  }
  return Buffer.from(raw, "utf8").toString("base64");
}

function decryptKey(encoded: string): string {
  if (!encoded) return "";
  try {
    const buf = Buffer.from(encoded, "base64");
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

function shellPath(): string {
  const candidates = [
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe"
  ];
  return candidates.find((file) => fs.existsSync(file)) ?? "C:\\Windows\\System32\\cmd.exe";
}

function getProjectRoot(): string {
  return path.resolve(process.cwd());
}

function destroyPtySession(paneId: string): void {
  const p = ptySessions.get(paneId);
  if (p) {
    p.kill();
  }
  ptySessions.delete(paneId);
  paneShellExe.delete(paneId);
}

function createPtySession(paneId: string): void {
  if (ptySessions.has(paneId)) return;

  const mode = getVault("executionMode");
  const cwd = mode === "system-wide" ? os.homedir() : getProjectRoot();
  const exe = shellPath();
  let p: pty.IPty;
  try {
    p = pty.spawn(exe, [], {
      cwd,
      cols: 100,
      rows: 28,
      name: "xterm-color",
      env: {
        ...process.env,
        VIBE_ADE_MODE: mode
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown spawn error";
    emitPtyData(paneId, `\r\n[Vibe-Clone] Failed to start shell: ${message}\r\n`);
    return;
  }

  p.onData((chunk) => {
    emitPtyData(paneId, chunk);
  });

  p.onExit(() => {
    // Ignore stale exits from previously destroyed/replaced sessions.
    if (ptySessions.get(paneId) !== p) {
      return;
    }
    ptySessions.delete(paneId);
    paneShellExe.delete(paneId);
    mainWindow?.webContents.send("pty:exit", { paneId });
  });

  ptySessions.set(paneId, p);
  paneShellExe.set(paneId, exe.toLowerCase());
}

function sanitizeCommandForMode(command: string, mode: ExecutionMode): string {
  if (mode !== "sandboxed") {
    return command;
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return command;
  }

  // High-risk operations blocked in project-only mode.
  const blockedPatterns = [
    /\b(remove-item|del|erase|rmdir|rd|format|shutdown|reboot)\b/i,
    /\b(reg\s+delete|takeown|icacls)\b/i
  ];
  for (const pattern of blockedPatterns) {
    if (pattern.test(trimmed)) {
      throw new Error("Blocked high-risk command in sandboxed mode.");
    }
  }

  // Block easy directory escapes from project root.
  if (/^(cd|chdir|set-location|sl|pushd)\s+\.\./i.test(trimmed)) {
    throw new Error("Directory traversal outside the project root is blocked in sandboxed mode.");
  }

  return command;
}

function normalizeShellCommandForExe(command: string, exe: string): string {
  if (!exe.endsWith("cmd.exe")) return command;
  const trimmed = command.trim();
  if (trimmed === "ls") return "dir";
  if (trimmed.startsWith("ls ")) return `dir ${trimmed.slice(3)}`;
  return command;
}

async function runLocalAgent(prompt: string): Promise<string> {
  return runLocalAgentWithSignal(prompt);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function combineSignals(external?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (!external) {
    return controller;
  }
  if (external.aborted) {
    controller.abort();
    return controller;
  }
  external.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function runLocalAgentWithSignal(prompt: string, externalSignal?: AbortSignal): Promise<string> {
  const model = getVault("localModel");
  const controller = combineSignals(externalSignal);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetchWithTimeout(
        "http://127.0.0.1:11434/api/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, stream: false }),
          signal: controller.signal
        },
        20000
      );
      if (!res.ok) {
        if (shouldRetryStatus(res.status) && attempt === 0) {
          continue;
        }
        throw new Error(`Ollama error: ${res.status}`);
      }
      const body = (await res.json()) as { response?: string };
      return body.response ?? "";
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Agent request was cancelled.");
      }
      lastError = error instanceof Error ? error : new Error("Unknown local agent error");
    }
  }
  throw lastError ?? new Error("Unknown local agent error");
}

async function runCloudAgent(prompt: string, mode: ExecutionMode): Promise<string> {
  return runCloudAgentWithSignal(prompt, mode);
}

async function runCloudAgentWithSignal(prompt: string, mode: ExecutionMode, externalSignal?: AbortSignal): Promise<string> {
  const apiKey = decryptKey(getVault("cloudApiKeyEncrypted"));
  if (!apiKey) {
    throw new Error("Cloud API key missing in Settings Vault. Add a key or use /local.");
  }

  const url = getVault("cloudApiBaseUrl");
  const model = getVault("cloudModel");
  const systemInstruction =
    mode === "dual-stream"
      ? "Return with two sections exactly: [THOUGHT] then [ACTION]. Include ANSI code blocks when useful."
      : "Answer with concise, ANSI-friendly markdown. Prefer fenced code blocks for commands.";

  const controller = combineSignals(externalSignal);
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemInstruction },
              { role: "user", content: prompt }
            ],
            temperature: 0.2
          }),
          signal: controller.signal
        },
        30000
      );
      if (!res.ok) {
        if (shouldRetryStatus(res.status) && attempt === 0) {
          continue;
        }
        throw new Error(`Cloud API error: ${res.status}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return json.choices?.[0]?.message?.content ?? "";
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Agent request was cancelled.");
      }
      lastError = error instanceof Error ? error : new Error("Unknown cloud agent error");
    }
  }
  throw lastError ?? new Error("Unknown cloud agent error");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    title: "Vibe-Clone",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    void mainWindow?.loadURL(
      `data:text/html,${encodeURIComponent(
        `<html><body style="background:#0d0d0d;color:#e7e7e7;font-family:Segoe UI;padding:20px">
        <h2>Vibe-Clone Startup Error</h2>
        <p>Renderer failed to load.</p>
        <p><b>Code:</b> ${code}</p>
        <p><b>Description:</b> ${description}</p>
        <p><b>URL:</b> ${url}</p>
        <p>Please reinstall with the latest build.</p>
        </body></html>`
      )}`
    );
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_START_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    return;
  }

  const packagedHtml = path.join(__dirname, "..", "dist", "index.html");
  const cwdHtml = path.join(process.cwd(), "dist", "index.html");
  const appPathHtml = path.join(app.getAppPath(), "dist", "index.html");
  const candidates = [packagedHtml, appPathHtml, cwdHtml];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      void mainWindow.loadFile(file);
      return;
    }
  }

  void mainWindow.loadURL("http://localhost:5173");
}

app.whenReady().then(() => {
  if (process.platform !== "win32") {
    app.quit();
    return;
  }

  createWindow();
  writeAppLog("INFO", "Application started.");

  ipcMain.handle("pane:create", (_, paneId: string) => {
    createPtySession(paneId);
    writeAppLog("INFO", `Pane created: ${paneId}`);
  });

  ipcMain.handle("pane:destroy", (_, paneId: string) => {
    destroyPtySession(paneId);
    activeAgentControllers.get(paneId)?.abort();
    activeAgentControllers.delete(paneId);
    writeAppLog("INFO", `Pane destroyed: ${paneId}`);
  });

  ipcMain.handle("pane:restart", (_, paneId: string) => {
    destroyPtySession(paneId);
    createPtySession(paneId);
    writeAppLog("INFO", `Pane restarted: ${paneId}`);
  });

  ipcMain.handle("pane:resize", (_, paneId: string, cols: number, rows: number) => {
    const p = ptySessions.get(paneId);
    if (p) {
      p.resize(cols, rows);
    }
  });

  ipcMain.handle("shell:line", (_, paneId: string, line: string) => {
    const p = ptySessions.get(paneId);
    if (line === "\u0003") {
      p?.write("\u0003");
      return;
    }
    const mode = getVault("executionMode");
    try {
      const sanitized = sanitizeCommandForMode(line, mode);
      const normalized = normalizeShellCommandForExe(sanitized, paneShellExe.get(paneId) ?? "");
      p?.write(`${normalized}\r`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command blocked";
      writeAppLog("WARN", `Blocked command in ${mode} mode on ${paneId}: ${message}`);
      emitPtyData(paneId, `\r\n[Vibe-Clone:${mode}] ${message}\r\n`);
    }
  });

  ipcMain.handle("shell:input", (_, paneId: string, input: string) => {
    const p = ptySessions.get(paneId);
    if (!p) {
      return;
    }
    p.write(input);
    writeAppLog("INFO", `Raw input forwarded to ${paneId} (${input.length} chars)`);
  });

  ipcMain.handle("agent:cancel", (_, paneId: string) => {
    const controller = activeAgentControllers.get(paneId);
    if (controller) {
      controller.abort();
      activeAgentControllers.delete(paneId);
    }
  });

  ipcMain.handle("agent:run", async (_, paneId: string, route: AgentRoute, prompt: string) => {
    const mode = getVault("executionMode");
    activeAgentControllers.get(paneId)?.abort();
    const controller = new AbortController();
    activeAgentControllers.set(paneId, controller);
    emitAgentRouted(paneId, route);
    try {
      let effectiveRoute = route;
      let text: string;
      if (route === "local") {
        text = await runLocalAgentWithSignal(prompt, controller.signal);
      } else {
        try {
          text = await runCloudAgentWithSignal(prompt, mode, controller.signal);
        } catch (cloudError) {
          const cloudMessage = cloudError instanceof Error ? cloudError.message : "Cloud route failed";
          if (controller.signal.aborted) {
            throw cloudError;
          }
          mainWindow?.webContents.send("agent:chunk", {
            paneId,
            chunk: `Cloud route failed: ${cloudMessage}\nFalling back to local model.\n`,
            stream: "action"
          });
          text = await runLocalAgentWithSignal(prompt, controller.signal);
          effectiveRoute = "local";
          emitAgentRouted(paneId, "local");
        }
      }

      if (mode === "dual-stream" && text.includes("[ACTION]")) {
        const [thoughtRaw, actionRaw] = text.split("[ACTION]");
        const thought = thoughtRaw.replace("[THOUGHT]", "").trim();
        const action = actionRaw.trim();
        mainWindow?.webContents.send("agent:chunk", { paneId, chunk: `${thought}\n`, stream: "thought" });
        mainWindow?.webContents.send("agent:chunk", {
          paneId,
          chunk: `${action}\n`,
          stream: "action",
          done: true
        });
      } else {
        const routePrefix = effectiveRoute === "local" ? `[Local:${getVault("localModel")}]\n` : `[Cloud:${getVault("cloudModel")}]\n`;
        mainWindow?.webContents.send("agent:chunk", {
          paneId,
          chunk: `${routePrefix}${text}\n`,
          stream: "action",
          done: true
        });
      }
    } catch (error) {
      writeAppLog("ERROR", `Agent run failed on ${paneId}: ${error instanceof Error ? error.message : "Unknown agent error"}`);
      mainWindow?.webContents.send("agent:chunk", {
        paneId,
        chunk: "",
        error: error instanceof Error ? error.message : "Unknown agent error",
        done: true
      });
    } finally {
      if (activeAgentControllers.get(paneId) === controller) {
        activeAgentControllers.delete(paneId);
      }
    }
  });

  ipcMain.handle("vault:get", () => {
    return {
      cloudApiKey: decryptKey(getVault("cloudApiKeyEncrypted")),
      cloudApiBaseUrl: getVault("cloudApiBaseUrl"),
      localModel: getVault("localModel"),
      cloudModel: getVault("cloudModel"),
      executionMode: getVault("executionMode"),
      systemWideAcknowledged: getVault("systemWideAcknowledged")
    };
  });

  ipcMain.handle("vault:set", (_, next: { cloudApiKey?: string; cloudApiBaseUrl?: string; localModel?: string; cloudModel?: string; executionMode?: ExecutionMode; systemWideAcknowledged?: boolean }) => {
    if (typeof next.systemWideAcknowledged === "boolean") {
      setVault("systemWideAcknowledged", next.systemWideAcknowledged);
    }
    if (next.executionMode === "system-wide" && !getVault("systemWideAcknowledged")) {
      throw new Error("System-Wide mode requires acknowledgement in Settings Vault.");
    }
    if (typeof next.cloudApiKey === "string") setVault("cloudApiKeyEncrypted", encryptKey(next.cloudApiKey));
    if (typeof next.cloudApiBaseUrl === "string") setVault("cloudApiBaseUrl", next.cloudApiBaseUrl);
    if (typeof next.localModel === "string") setVault("localModel", next.localModel);
    if (typeof next.cloudModel === "string") setVault("cloudModel", next.cloudModel);
    if (typeof next.executionMode === "string") setVault("executionMode", next.executionMode);
    return true;
  });

  ipcMain.handle("workspace:get", () => getProjectRoot());

  ipcMain.handle("runtime:get", () => {
    return {
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome
    };
  });
});

app.on("window-all-closed", () => {
  for (const p of ptySessions.values()) {
    p.kill();
  }
  for (const controller of activeAgentControllers.values()) {
    controller.abort();
  }
  activeAgentControllers.clear();
  ptySessions.clear();
  paneShellExe.clear();
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (error) => {
  writeAppLog("ERROR", `Uncaught exception: ${error.message}`);
});

process.on("unhandledRejection", (reason) => {
  const detail = reason instanceof Error ? reason.message : String(reason);
  writeAppLog("ERROR", `Unhandled rejection: ${detail}`);
});
