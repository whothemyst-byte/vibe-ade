import type { ActivityFilter, PaneActivityItem } from "../types";

interface PaneActivityStreamProps {
  items: PaneActivityItem[];
  filter: ActivityFilter;
}

function formatTime(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

export default function PaneActivityStream({ items, filter }: PaneActivityStreamProps) {
  const visible = filter === "all" ? items : items.filter((item) => item.type === filter);
  if (!visible.length) {
    return <div className="activity-empty">No activity yet. Run a command to begin.</div>;
  }

  return (
    <div className="activity-stream">
      {visible.map((item) => (
        <article key={item.id} className={`activity-item ${item.type} ${item.severity ?? "info"}`}>
          <div className="activity-meta">
            <span className="activity-title">{item.title}</span>
            <span className="activity-time">{formatTime(item.timestamp)}</span>
          </div>
          <div className="activity-summary">{item.summary}</div>
          {item.details && <pre className="activity-details">{item.details}</pre>}
        </article>
      ))}
    </div>
  );
}
