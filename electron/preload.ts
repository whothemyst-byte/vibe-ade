import { contextBridge, ipcRenderer } from "electron";

type ExecutionMode = "sandboxed" | "system-wide" | "dual-stream";

interface VaultSettings {
  cloudApiKey: string;
  cloudApiBaseUrl: string;
  localModel: string;
  cloudModel: string;
  executionMode: ExecutionMode;
}

interface AgentChunkEvent {
  paneId: string;
  chunk: string;
  done?: boolean;
  stream?: "thought" | "action";
  error?: string;
}

interface AgentRoutedEvent {
  paneId: string;
  model: "Local" | "GPT-4o";
  route: "local" | "cloud";
}

interface PtyDataEvent {
  paneId: string;
  chunk: string;
}

interface PtyExitEvent {
  paneId: string;
}

interface RuntimeInfo {
  node: string;
  electron: string;
  chrome: string;
}

const api = {
  createPane: (paneId: string) => ipcRenderer.invoke("pane:create", paneId),
  resizePane: (paneId: string, cols: number, rows: number) => ipcRenderer.invoke("pane:resize", paneId, cols, rows),
  sendShellLine: (paneId: string, line: string) => ipcRenderer.invoke("shell:line", paneId, line),
  runAgent: (paneId: string, route: "local" | "cloud", prompt: string) => ipcRenderer.invoke("agent:run", paneId, route, prompt),
  getRuntime: () => ipcRenderer.invoke("runtime:get") as Promise<RuntimeInfo>,
  getVault: () => ipcRenderer.invoke("vault:get") as Promise<VaultSettings>,
  setVault: (next: Partial<VaultSettings> & { executionMode?: ExecutionMode }) => ipcRenderer.invoke("vault:set", next),
  onPtyData: (handler: (event: PtyDataEvent) => void) => {
    const listener = (_: unknown, payload: PtyDataEvent) => handler(payload);
    ipcRenderer.on("pty:data", listener);
    return () => ipcRenderer.removeListener("pty:data", listener);
  },
  onPtyExit: (handler: (event: PtyExitEvent) => void) => {
    const listener = (_: unknown, payload: PtyExitEvent) => handler(payload);
    ipcRenderer.on("pty:exit", listener);
    return () => ipcRenderer.removeListener("pty:exit", listener);
  },
  onAgentChunk: (handler: (event: AgentChunkEvent) => void) => {
    const listener = (_: unknown, payload: AgentChunkEvent) => handler(payload);
    ipcRenderer.on("agent:chunk", listener);
    return () => ipcRenderer.removeListener("agent:chunk", listener);
  },
  onAgentRouted: (handler: (event: AgentRoutedEvent) => void) => {
    const listener = (_: unknown, payload: AgentRoutedEvent) => handler(payload);
    ipcRenderer.on("agent:routed", listener);
    return () => ipcRenderer.removeListener("agent:routed", listener);
  }
};

contextBridge.exposeInMainWorld("vibe", api);

declare global {
  interface Window {
    vibe: typeof api;
  }
}
