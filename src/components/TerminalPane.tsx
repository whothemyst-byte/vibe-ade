import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ActivityFilter, ModelProvider, PaneActivityItem, PaneActivityType, PaneInputMode } from "../types";
import PaneActivityStream from "./PaneActivityStream";
import PaneContextHeader from "./PaneContextHeader";
import { parseInputLine } from "../lib/slashRouter";

interface TerminalPaneProps {
  paneId: string;
  model: ModelProvider;
  filePath: string;
  active: boolean;
  onActivate: (paneId: string) => void;
  inputMode: PaneInputMode;
  restartSignal: number;
  clearSignal: number;
  onInputModeChange: (paneId: string, next: PaneInputMode) => void;
  onModelChange: (paneId: string, next: ModelProvider) => void;
}

export default function TerminalPane({
  paneId,
  model,
  filePath,
  active,
  onActivate,
  inputMode,
  restartSignal,
  clearSignal,
  onInputModeChange,
  onModelChange
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [commandText, setCommandText] = useState("");
  const [agentThought, setAgentThought] = useState("");
  const [agentAction, setAgentAction] = useState("");
  const [sessionStatus, setSessionStatus] = useState<"ready" | "exited">("ready");
  const [hasUserInput, setHasUserInput] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [activities, setActivities] = useState<PaneActivityItem[]>([]);
  const hasUserInputRef = useRef(false);
  const onModelChangeRef = useRef(onModelChange);
  const activityIdRef = useRef(0);

  useEffect(() => {
    onModelChangeRef.current = onModelChange;
  }, [onModelChange]);

  useEffect(() => {
    hasUserInputRef.current = hasUserInput;
  }, [hasUserInput]);

  function addActivity(type: PaneActivityType, title: string, summary: string, details?: string, severity?: "info" | "warn" | "error"): void {
    activityIdRef.current += 1;
    setActivities((prev) =>
      [...prev, { id: `${paneId}-${activityIdRef.current}`, type, title, summary, details, severity, timestamp: Date.now() }].slice(-120)
    );
  }

  function appendCapped(setter: Dispatch<SetStateAction<string>>, chunk: string): void {
    setter((prev) => {
      const next = prev + chunk;
      const maxChars = 12000;
      return next.length > maxChars ? next.slice(next.length - maxChars) : next;
    });
  }

  useEffect(() => {
    let disposed = false;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
      fontSize: 13,
      theme: { background: "#101010", foreground: "#d4d4d4", cursor: "#8bffc4" }
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    if (hostRef.current) {
      term.open(hostRef.current);
    }

    const safeResize = (): void => {
      if (disposed || !terminalRef.current || !fitAddonRef.current) return;
      try {
        fitAddonRef.current.fit();
        const cols = Math.max(2, terminalRef.current.cols || 80);
        const rows = Math.max(2, terminalRef.current.rows || 24);
        void window.vibe.resizePane(paneId, cols, rows);
      } catch {
        // Ignore transient xterm resize races during mount/unmount.
      }
    };

    void window.vibe.createPane(paneId);
    window.requestAnimationFrame(() => safeResize());

    const onDataDispose = window.vibe.onPtyData(({ paneId: targetId, chunk }) => {
      if (targetId === paneId) {
        setSessionStatus("ready");
        if (!hasUserInputRef.current) return;
        term.write(chunk);
      }
    });
    const onExitDispose = window.vibe.onPtyExit(({ paneId: targetId }) => {
      if (targetId === paneId) {
        setSessionStatus("exited");
        term.writeln("\r\n[process exited]");
        addActivity("error", "Process Exited", "Shell process exited. Restart to continue.", "", "error");
      }
    });
    const onAgentDispose = window.vibe.onAgentChunk((payload) => {
      if (payload.paneId !== paneId) return;
      if (payload.error) {
        appendCapped(setAgentAction, `\u001b[31m${payload.error}\u001b[0m`);
        addActivity("error", "Agent Error", payload.error, "", "error");
        return;
      }
      if (payload.stream === "thought") {
        appendCapped(setAgentThought, payload.chunk);
      } else {
        appendCapped(setAgentAction, payload.chunk);
        if (payload.done) {
          const preview = payload.chunk.trim().slice(0, 200);
          addActivity("agent", "Agent Response", preview || "Received response.", payload.chunk.trim());
        }
      }
    });
    const onRoutedDispose = window.vibe.onAgentRouted((payload) => {
      if (payload.paneId !== paneId) return;
      onModelChangeRef.current(paneId, payload.model);
    });

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(() => safeResize());
    });
    if (hostRef.current) observer.observe(hostRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      onDataDispose();
      onExitDispose();
      onAgentDispose();
      onRoutedDispose();
      void window.vibe.cancelAgent(paneId);
      void window.vibe.destroyPane(paneId);
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [paneId]);

  useEffect(() => {
    if (restartSignal <= 0) return;
    void restartSession();
  }, [restartSignal]);

  useEffect(() => {
    if (clearSignal <= 0) return;
    setAgentThought("");
    setAgentAction("");
    setActivities([]);
    terminalRef.current?.clear();
    addActivity("system", "Pane Cleared", "Terminal output and compact history were cleared.");
  }, [clearSignal]);

  async function handleLineSubmit(line: string): Promise<void> {
    setHasUserInput(true);
    if (inputMode === "interactive-passthrough") {
      await window.vibe.sendShellInput(paneId, `${line}\r`);
      addActivity("shell", "Interactive Input", line.trim() || "(empty line)");
      return;
    }

    const parsed = parseInputLine(line);
    if (parsed.kind === "agent") {
      if (!parsed.prompt) return;
      setAgentThought("");
      setAgentAction("");
      addActivity("agent", "Agent Request", `/${parsed.route} ${parsed.prompt}`.trim());
      await window.vibe.runAgent(paneId, parsed.route, parsed.prompt);
      return;
    }
    if (parsed.line.trim()) {
      addActivity("shell", "Shell Command", parsed.line.trim());
      await window.vibe.sendShellLine(paneId, parsed.line);
    }
  }

  async function submitCommand(): Promise<void> {
    const line = commandText;
    if (inputMode === "shell-line" && !line.trim()) return;
    setCommandText("");
    await handleLineSubmit(line);
  }

  async function restartSession(): Promise<void> {
    await window.vibe.restartPane(paneId);
    setSessionStatus("ready");
    setHasUserInput(false);
    setAgentThought("");
    setAgentAction("");
    terminalRef.current?.clear();
    addActivity("system", "Pane Restarted", "PTY session restarted and ready.");
  }

  return (
    <section className={`terminal-pane ${active ? "active" : ""}`} onMouseDown={() => onActivate(paneId)}>
      <PaneContextHeader filePath={filePath} model={model} inputMode={inputMode} sessionStatus={sessionStatus} />
      <div className="pane-console-shell">
        <div className="pane-filter-row">
          <button className={activityFilter === "all" ? "filter-btn active" : "filter-btn"} onClick={() => setActivityFilter("all")}>
            All
          </button>
          <button className={activityFilter === "shell" ? "filter-btn active" : "filter-btn"} onClick={() => setActivityFilter("shell")}>
            Shell
          </button>
          <button className={activityFilter === "agent" ? "filter-btn active" : "filter-btn"} onClick={() => setActivityFilter("agent")}>
            Agent
          </button>
          <button className={activityFilter === "error" ? "filter-btn active" : "filter-btn"} onClick={() => setActivityFilter("error")}>
            Errors
          </button>
        </div>
        <PaneActivityStream items={activities} filter={activityFilter} />
      </div>
      <div ref={hostRef} className="terminal-host" />
      <div className="pane-prompt-shell">
        <span className="pane-prompt-mark">&gt;</span>
        <input
          className="pane-prompt-input"
          value={commandText}
          placeholder="Type a command or /local..."
          onChange={(e) => setCommandText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitCommand();
            }
          }}
        />
        <div className="pane-prompt-actions">
          <button
            className={inputMode === "shell-line" ? "mode-btn active" : "mode-btn"}
            onClick={() => onInputModeChange(paneId, "shell-line")}
          >
            SHELL
          </button>
          <button
            className={inputMode === "interactive-passthrough" ? "mode-btn active" : "mode-btn"}
            onClick={() => onInputModeChange(paneId, "interactive-passthrough")}
          >
            INTERACTIVE
          </button>
          <button onClick={() => setCommandText("")}>CLR</button>
          <button
            onClick={() => {
              void window.vibe.cancelAgent(paneId);
              void window.vibe.sendShellLine(paneId, "\u0003");
            }}
          >
            STOP
          </button>
          {sessionStatus === "exited" && <button onClick={() => void restartSession()}>RESTART</button>}
          <button onClick={() => void submitCommand()}>RUN</button>
        </div>
      </div>
    </section>
  );
}
