import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ModelProvider } from "../types";
import AgentResponse from "./AgentResponse";
import { parseInputLine } from "../lib/slashRouter";

interface TerminalPaneProps {
  paneId: string;
  model: ModelProvider;
  filePath: string;
  active: boolean;
  onActivate: (paneId: string) => void;
  onModelChange: (paneId: string, next: ModelProvider) => void;
}

export default function TerminalPane({ paneId, model, filePath, active, onActivate, onModelChange }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [commandText, setCommandText] = useState("");
  const [agentThought, setAgentThought] = useState("");
  const [agentAction, setAgentAction] = useState("");
  const [sessionStatus, setSessionStatus] = useState<"ready" | "exited">("ready");
  const onModelChangeRef = useRef(onModelChange);

  useEffect(() => {
    onModelChangeRef.current = onModelChange;
  }, [onModelChange]);

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
      if (targetId === paneId) term.write(chunk);
    });
    const onExitDispose = window.vibe.onPtyExit(({ paneId: targetId }) => {
      if (targetId === paneId) {
        setSessionStatus("exited");
        term.writeln("\r\n[process exited]");
      }
    });
    const onAgentDispose = window.vibe.onAgentChunk((payload) => {
      if (payload.paneId !== paneId) return;
      if (payload.error) {
        appendCapped(setAgentAction, `\u001b[31m${payload.error}\u001b[0m`);
        return;
      }
      if (payload.stream === "thought") {
        appendCapped(setAgentThought, payload.chunk);
      } else {
        appendCapped(setAgentAction, payload.chunk);
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
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [paneId]);

  async function handleLineSubmit(line: string): Promise<void> {
    const parsed = parseInputLine(line);
    if (parsed.kind === "agent") {
      if (!parsed.prompt) return;
      setAgentThought("");
      setAgentAction("");
      await window.vibe.runAgent(paneId, parsed.route, parsed.prompt);
      return;
    }
    if (parsed.line.trim()) {
      await window.vibe.sendShellLine(paneId, parsed.line);
    }
  }

  async function submitCommand(): Promise<void> {
    const line = commandText.trim();
    if (!line) return;
    setCommandText("");
    await handleLineSubmit(line);
  }

  const hasAgentResponse = useMemo(() => agentThought.length > 0 || agentAction.length > 0, [agentThought, agentAction]);

  return (
    <section className={`terminal-pane ${active ? "active" : ""}`} onMouseDown={() => onActivate(paneId)}>
      <div className="terminal-card-header">
        <div className="terminal-filepath">{filePath}</div>
        <div className="status-label">{model}</div>
      </div>
      <div className={`session-label ${sessionStatus}`}>{sessionStatus === "ready" ? "Ready" : "Exited"}</div>
      <div ref={hostRef} className="terminal-host" />
      {hasAgentResponse && (
        <div className="agent-overlay">
          {agentThought && <AgentResponse rawText={agentThought} streamType="thought" />}
          {agentAction && <AgentResponse rawText={agentAction} streamType="action" />}
        </div>
      )}
      <div className="pane-prompt-shell">
        <span className="pane-prompt-mark">&gt;</span>
        <input
          className="pane-prompt-input"
          value={commandText}
          placeholder="Type a command, /local, or /cloud..."
          onChange={(e) => setCommandText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitCommand();
            }
          }}
        />
        <div className="pane-prompt-actions">
          <button onClick={() => setCommandText("")}>CLR</button>
          <button onClick={() => void window.vibe.sendShellLine(paneId, "\u0003")}>STOP</button>
          <button onClick={() => void submitCommand()}>RUN</button>
        </div>
      </div>
    </section>
  );
}
