interface QuickActionBarProps {
  mode: string;
  activePaneId: string;
  runtimeNode: string;
  onOpenPalette: () => void;
  onOpenVault: () => void;
}

export default function QuickActionBar({ mode, activePaneId, runtimeNode, onOpenPalette, onOpenVault }: QuickActionBarProps) {
  return (
    <header className="workspace-topbar">
      <div className="workspace-brand">
        <h1>Vibe-Clone</h1>
        <span className={`workspace-pill ${mode}`}>{mode}</span>
        <span className="workspace-pill neutral">{`Node v${runtimeNode}`}</span>
      </div>
      <div className="workspace-actions">
        <span className="workspace-active-pane">{`Active ${activePaneId}`}</span>
        <button onClick={onOpenPalette}>Palette</button>
        <button onClick={onOpenVault}>Vault</button>
      </div>
    </header>
  );
}
