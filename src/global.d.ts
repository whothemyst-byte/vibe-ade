import type { AgentChunkEvent, AgentRoutedEvent, ExecutionMode, PtyDataEvent, PtyExitEvent, RuntimeInfo, VaultSettings } from "./types";

interface VibeBridge {
  createPane: (paneId: string) => Promise<void>;
  destroyPane: (paneId: string) => Promise<void>;
  restartPane: (paneId: string) => Promise<void>;
  resizePane: (paneId: string, cols: number, rows: number) => Promise<void>;
  sendShellLine: (paneId: string, line: string) => Promise<void>;
  runAgent: (paneId: string, route: "local" | "cloud", prompt: string) => Promise<void>;
  cancelAgent: (paneId: string) => Promise<void>;
  getWorkspacePath: () => Promise<string>;
  getRuntime: () => Promise<RuntimeInfo>;
  getVault: () => Promise<VaultSettings>;
  setVault: (next: Partial<VaultSettings> & { executionMode?: ExecutionMode }) => Promise<boolean>;
  onPtyData: (handler: (event: PtyDataEvent) => void) => () => void;
  onPtyExit: (handler: (event: PtyExitEvent) => void) => () => void;
  onAgentChunk: (handler: (event: AgentChunkEvent) => void) => () => void;
  onAgentRouted: (handler: (event: AgentRoutedEvent) => void) => () => void;
}

declare global {
  interface Window {
    vibe: VibeBridge;
  }
}

export {};
