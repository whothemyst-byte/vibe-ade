export type LayoutTemplate = 2 | 4 | 6;
export type ModelProvider = "Local" | "Cloud";
export type ExecutionMode = "sandboxed" | "system-wide" | "dual-stream";
export type PaneInputMode = "shell-line" | "interactive-passthrough";
export type AgentRoute = "local";
export type StreamType = "thought" | "action";
export type ActivityFilter = "all" | "system" | "agent" | "shell" | "error";
export type PaneActivityType = "system" | "agent" | "shell" | "error";

export interface PaneActivityItem {
  id: string;
  type: PaneActivityType;
  title: string;
  summary: string;
  details?: string;
  severity?: "info" | "warn" | "error";
  timestamp: number;
}

export type PaletteActionId =
  | "layout:2"
  | "layout:4"
  | "layout:6"
  | "vault:open"
  | "pane:restart"
  | "pane:clear"
  | "pane:mode:shell"
  | "pane:mode:interactive";

export interface PaletteAction {
  id: PaletteActionId;
  title: string;
  hint: string;
}

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
