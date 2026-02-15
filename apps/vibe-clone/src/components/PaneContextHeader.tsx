import type { PaneInputMode, ModelProvider } from "../types";

interface PaneContextHeaderProps {
  filePath: string;
  model: ModelProvider;
  inputMode: PaneInputMode;
  sessionStatus: "ready" | "exited";
}

export default function PaneContextHeader({ filePath, model, inputMode, sessionStatus }: PaneContextHeaderProps) {
  return (
    <div className="pane-context-header">
      <div className="pane-context-path">{filePath}</div>
      <div className="pane-context-pills">
        <span className="context-pill">{model}</span>
        <span className={`context-pill ${inputMode === "interactive-passthrough" ? "interactive" : "shell"}`}>
          {inputMode === "interactive-passthrough" ? "INTERACTIVE" : "SHELL"}
        </span>
        <span className={`context-pill ${sessionStatus === "exited" ? "error" : "ready"}`}>
          {sessionStatus === "ready" ? "READY" : "EXITED"}
        </span>
      </div>
    </div>
  );
}
