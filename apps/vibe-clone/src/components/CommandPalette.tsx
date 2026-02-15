import { useMemo, useState } from "react";
import type { PaletteAction } from "../types";

interface CommandPaletteProps {
  open: boolean;
  actions: PaletteAction[];
  onClose: () => void;
  onSelect: (id: PaletteAction["id"]) => void;
}

export default function CommandPalette({ open, actions, onClose, onSelect }: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((action) => `${action.title} ${action.hint}`.toLowerCase().includes(q));
  }, [actions, query]);

  if (!open) return null;

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-card" onClick={(event) => event.stopPropagation()}>
        <div className="palette-label">Command Palette</div>
        <input
          className="palette-input"
          autoFocus
          placeholder="Type an action..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && filtered[0]) {
              onSelect(filtered[0].id);
              onClose();
            }
          }}
        />
        <div className="palette-list">
          {filtered.map((action) => (
            <button
              key={action.id}
              className="palette-item"
              onClick={() => {
                onSelect(action.id);
                onClose();
              }}
            >
              <span>{action.title}</span>
              <span>{action.hint}</span>
            </button>
          ))}
          {!filtered.length && <div className="palette-empty">No matching action.</div>}
        </div>
      </div>
    </div>
  );
}
