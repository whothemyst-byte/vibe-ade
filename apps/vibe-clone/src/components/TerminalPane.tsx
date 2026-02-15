import { useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionMode } from "../types";
import { parseInputLine } from "../lib/slashRouter";

type FeedItem = {
  id: string;
  tone: "neutral" | "good" | "warn";
  title: string;
  sub?: string;
};

interface TerminalPaneProps {
  paneId: string;
  filePath: string;
  mode: ExecutionMode;
}

export default function TerminalPane({ paneId, filePath, mode }: TerminalPaneProps) {
  const [commandText, setCommandText] = useState("");
  const [lastPrompt, setLastPrompt] = useState("review the project and prepare to assist me");
  const [feed, setFeed] = useState<FeedItem[]>([
    { id: "f-1", tone: "neutral", title: "I'll quickly explore the monorepo structure to orient myself." },
    { id: "f-2", tone: "good", title: "Read 1 file", sub: "(ctrl+o to expand)" },
    { id: "f-3", tone: "neutral", title: "Bash(git -C ~/Desktop/bridgemind log --oneline -10)", sub: "Waiting..." }
  ]);
  const [thinking, setThinking] = useState(false);
  const idRef = useRef(4);

  function pushItem(item: Omit<FeedItem, "id">): void {
    idRef.current += 1;
    setFeed((prev) => [...prev.slice(-18), { id: `f-${idRef.current}`, ...item }]);
  }

  useEffect(() => {
    void window.vibe.createPane(paneId);
    return () => {
      void window.vibe.destroyPane(paneId);
    };
  }, [paneId]);

  useEffect(() => {
    const off = window.vibe.onPtyExit(({ paneId: target }) => {
      if (target !== paneId) return;
      pushItem({ tone: "warn", title: "Process exited", sub: "Use RESTART from command if needed." });
    });
    return off;
  }, [paneId]);

  useEffect(() => {
    const off = window.vibe.onAgentChunk((payload) => {
      if (payload.paneId !== paneId) return;
      if (payload.error) {
        setThinking(false);
        pushItem({ tone: "warn", title: payload.error });
        return;
      }
      if (payload.done) {
        setThinking(false);
        const preview = payload.chunk.trim().replace(/\s+/g, " ").slice(0, 120);
        pushItem({ tone: "neutral", title: preview || "Assistant responded." });
      }
    });
    return off;
  }, [paneId]);

  async function submit(): Promise<void> {
    const line = commandText.trim();
    if (!line) return;
    setCommandText("");
    setLastPrompt(line);
    setThinking(true);

    const parsed = parseInputLine(line);
    if (parsed.kind === "agent") {
      pushItem({ tone: "good", title: `Routing ${parsed.route} prompt...` });
      await window.vibe.runAgent(paneId, parsed.route, parsed.prompt);
      return;
    }

    pushItem({ tone: "neutral", title: `Bash(${parsed.line})`, sub: "Waiting..." });
    await window.vibe.sendShellLine(paneId, parsed.line);
    setThinking(false);
  }

  const modeLabel = useMemo(() => {
    if (mode === "dual-stream") return "Claude Max";
    if (mode === "system-wide") return "System Wide";
    return "Sandboxed";
  }, [mode]);

  return (
    <section className="assistant-panel">
      <div className="assistant-subtitle">Project Review Assistance</div>
      <div className="assistant-head">
        <div className="assistant-avatar" />
        <div className="assistant-meta">
          <div className="assistant-title">
            Claude Code <span>v2.1.39</span>
          </div>
          <div>Opus 4.6</div>
          <div>{modeLabel}</div>
          <div className="assistant-path">{filePath}</div>
        </div>
      </div>

      <div className="prompt-preview">{lastPrompt}</div>

      <div className="feed">
        {feed.map((item) => (
          <div key={item.id} className={`feed-item ${item.tone}`}>
            <span className="dot" />
            <div>
              <div className="feed-title">{item.title}</div>
              {item.sub && <div className="feed-sub">{item.sub}</div>}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="feed-item warn">
            <span className="dot" />
            <div className="feed-title">Clauding... (thinking)</div>
          </div>
        )}
      </div>

      <div className="prompt-line">
        <span>&gt;</span>
        <input
          value={commandText}
          onChange={(event) => setCommandText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Type a command or /local, /cloud..."
        />
      </div>

      <div className="permission-hint">&gt;&gt; bypass permissions on (shift+tab to cycle)</div>

      <div className="bottom-actions">
        <button>File explorer</button>
        <button>View changes</button>
      </div>
    </section>
  );
}
