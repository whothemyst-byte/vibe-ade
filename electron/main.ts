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
}

const store = new Store<VaultData>({
  name: "vibe-ade-vault",
  defaults: {
    cloudApiKeyEncrypted: "",
    cloudApiBaseUrl: "https://api.openai.com/v1/chat/completions",
    localModel: "llama3.2",
    cloudModel: "gpt-4o",
    executionMode: "sandboxed"
  }
});

const ptySessions = new Map<string, pty.IPty>();
const paneShellExe = new Map<string, string>();
let mainWindow: BrowserWindow | null = null;

function emitPtyData(paneId: string, chunk: string): void {
  mainWindow?.webContents.send("pty:data", { paneId, chunk });
}

function emitAgentRouted(paneId: string, route: AgentRoute): void {
  mainWindow?.webContents.send("agent:routed", {
    paneId,
    route,
    model: route === "local" ? "Local" : "GPT-4o"
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
    emitPtyData(paneId, `\r\n[Vibe-ADE] Failed to start shell: ${message}\r\n`);
    return;
  }

  p.onData((chunk) => {
    emitPtyData(paneId, chunk);
  });

  p.onExit(() => {
    ptySessions.delete(paneId);
    paneShellExe.delete(paneId);
    mainWindow?.webContents.send("pty:exit", { paneId });
  });

  ptySessions.set(paneId, p);
  paneShellExe.set(paneId, exe.toLowerCase());
}

function sanitizeCommandForMode(command: string, mode: ExecutionMode): string {
  // V1 beta mode: allow full shell command surface in every execution mode.
  // Mode still controls starting cwd and agent behavior, not command filtering.
  void mode;
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
  const model = getVault("localModel");
  const res = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false })
  });
  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status}`);
  }
  const body = (await res.json()) as { response?: string };
  return body.response ?? "";
}

async function runCloudAgent(prompt: string, mode: ExecutionMode): Promise<string> {
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

  const res = await fetch(url, {
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
    })
  });

  if (!res.ok) {
    throw new Error(`Cloud API error: ${res.status}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    title: "Vibe-ADE",
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
        <h2>Vibe-ADE Startup Error</h2>
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

  ipcMain.handle("pane:create", (_, paneId: string) => {
    createPtySession(paneId);
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
      emitPtyData(paneId, `\r\n[Vibe-ADE:${mode}] ${message}\r\n`);
    }
  });

  ipcMain.handle("agent:run", async (_, paneId: string, route: AgentRoute, prompt: string) => {
    const mode = getVault("executionMode");
    emitAgentRouted(paneId, route);
    try {
      let effectiveRoute = route;
      let text: string;
      if (route === "local") {
        text = await runLocalAgent(prompt);
      } else {
        try {
          text = await runCloudAgent(prompt, mode);
        } catch (cloudError) {
          const cloudMessage = cloudError instanceof Error ? cloudError.message : "Cloud route failed";
          mainWindow?.webContents.send("agent:chunk", {
            paneId,
            chunk: `Cloud route failed: ${cloudMessage}\nFalling back to local model.\n`,
            stream: "action"
          });
          text = await runLocalAgent(prompt);
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
        const routePrefix = effectiveRoute === "local" ? "[Local]\n" : "[GPT-4o]\n";
        mainWindow?.webContents.send("agent:chunk", {
          paneId,
          chunk: `${routePrefix}${text}\n`,
          stream: "action",
          done: true
        });
      }
    } catch (error) {
      mainWindow?.webContents.send("agent:chunk", {
        paneId,
        chunk: "",
        error: error instanceof Error ? error.message : "Unknown agent error",
        done: true
      });
    }
  });

  ipcMain.handle("vault:get", () => {
    return {
      cloudApiKey: decryptKey(getVault("cloudApiKeyEncrypted")),
      cloudApiBaseUrl: getVault("cloudApiBaseUrl"),
      localModel: getVault("localModel"),
      cloudModel: getVault("cloudModel"),
      executionMode: getVault("executionMode")
    };
  });

  ipcMain.handle("vault:set", (_, next: { cloudApiKey?: string; cloudApiBaseUrl?: string; localModel?: string; cloudModel?: string; executionMode?: ExecutionMode }) => {
    if (typeof next.cloudApiKey === "string") setVault("cloudApiKeyEncrypted", encryptKey(next.cloudApiKey));
    if (typeof next.cloudApiBaseUrl === "string") setVault("cloudApiBaseUrl", next.cloudApiBaseUrl);
    if (typeof next.localModel === "string") setVault("localModel", next.localModel);
    if (typeof next.cloudModel === "string") setVault("cloudModel", next.cloudModel);
    if (typeof next.executionMode === "string") setVault("executionMode", next.executionMode);
    return true;
  });

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
  ptySessions.clear();
  paneShellExe.clear();
  if (process.platform !== "darwin") app.quit();
});
