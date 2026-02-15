import { useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { AnsiUp } from "ansi_up";

interface AgentResponseProps {
  rawText: string;
  streamType: "thought" | "action";
}

const ansi = new AnsiUp();

export default function AgentResponse({ rawText, streamType }: AgentResponseProps) {
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    if (!rawText) {
      setVisibleChars(0);
      return;
    }
    if (visibleChars > rawText.length) {
      setVisibleChars(0);
      return;
    }
    const timer = window.setInterval(() => {
      setVisibleChars((prev) => {
        if (prev >= rawText.length) return prev;
        return Math.min(prev + 2, rawText.length);
      });
    }, 8);
    return () => window.clearInterval(timer);
  }, [rawText, visibleChars]);

  const html = useMemo(() => {
    const slice = rawText.slice(0, visibleChars);
    const ansiHtml = ansi.ansi_to_html(slice);
    const mdHtml = marked.parse(ansiHtml, { breaks: true, gfm: true }) as string;
    return DOMPurify.sanitize(mdHtml);
  }, [rawText, visibleChars]);

  return (
    <div className={`agent-response ${streamType}`}>
      <div className="agent-response-label">{streamType === "thought" ? "Thought" : "Action"}</div>
      <div className="agent-response-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
