export type LayoutTemplate = 2 | 4 | 6;
export type ModelProvider = "Local" | "Cloud";
export type ExecutionMode = "sandboxed" | "system-wide" | "dual-stream";
export type AgentRoute = "local" | "cloud";
export type StreamType = "thought" | "action";

export interface VaultSettings {
  cloudApiKey: string;
  cloudApiBaseUrl: string;
  localModel: string;
  cloudModel: string;
  executionMode: ExecutionMode;
  systemWideAcknowledged: boolean;
}

export interface AgentChunkEvent {
  paneId: string;
  chunk: string;
  done?: boolean;
  stream?: StreamType;
  error?: string;
}

export interface AgentRoutedEvent {
  paneId: string;
  model: ModelProvider;
  modelName: string;
  route: AgentRoute;
}

export interface PtyDataEvent {
  paneId: string;
  chunk: string;
}

export interface PtyExitEvent {
  paneId: string;
}

export interface RuntimeInfo {
  node: string;
  electron: string;
  chrome: string;
}
