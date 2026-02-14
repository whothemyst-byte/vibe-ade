import { useEffect, useState } from "react";
import type { ExecutionMode, VaultSettings } from "../types";

interface SettingsVaultProps {
  open: boolean;
  onClose: () => void;
  onExecutionModeChanged: (mode: ExecutionMode) => void;
}

const defaultVault: VaultSettings = {
  cloudApiKey: "",
  cloudApiBaseUrl: "https://api.openai.com/v1/chat/completions",
  localModel: "llama3.2",
  cloudModel: "gpt-4o",
  executionMode: "sandboxed",
  systemWideAcknowledged: false
};

export default function SettingsVault({ open, onClose, onExecutionModeChanged }: SettingsVaultProps) {
  const [vault, setVault] = useState<VaultSettings>(defaultVault);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorText, setErrorText] = useState("");

  function validateVault(): string {
    if (!vault.cloudApiBaseUrl.trim()) {
      return "Cloud API URL is required.";
    }
    try {
      const parsed = new URL(vault.cloudApiBaseUrl);
      if (parsed.protocol !== "https:") {
        return "Cloud API URL must use https.";
      }
    } catch {
      return "Cloud API URL must be a valid URL.";
    }
    if (!vault.localModel.trim()) {
      return "Local model cannot be empty.";
    }
    if (!vault.cloudModel.trim()) {
      return "Cloud model cannot be empty.";
    }
    if (vault.executionMode === "system-wide" && !vault.systemWideAcknowledged) {
      return "You must acknowledge System-Wide mode risk before saving.";
    }
    return "";
  }

  useEffect(() => {
    if (!open) return;
    void window.vibe.getVault().then((value) => setVault(value));
  }, [open]);

  async function save(): Promise<void> {
    const validationError = validateVault();
    if (validationError) {
      setSaveState("error");
      setErrorText(validationError);
      return;
    }

    try {
      setSaveState("saving");
      setErrorText("");
      await window.vibe.setVault(vault);
      onExecutionModeChanged(vault.executionMode);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
    } catch (error) {
      setSaveState("error");
      setErrorText(error instanceof Error ? error.message : "Failed to save vault settings.");
    }
  }

  if (!open) return null;

  return (
    <div className="vault-backdrop">
      <div className="vault-card">
        <h2>Settings Vault</h2>

        <label>
          Cloud API Key
          <input
            type="password"
            value={vault.cloudApiKey}
            onChange={(e) => setVault((prev) => ({ ...prev, cloudApiKey: e.target.value }))}
          />
        </label>
        {!vault.cloudApiKey.trim() && <div className="vault-hint">Cloud key is empty. `/cloud` will fallback to local.</div>}

        <label>
          Cloud API URL
          <input
            value={vault.cloudApiBaseUrl}
            onChange={(e) => setVault((prev) => ({ ...prev, cloudApiBaseUrl: e.target.value }))}
          />
        </label>

        <label>
          Local Model (Ollama)
          <input value={vault.localModel} onChange={(e) => setVault((prev) => ({ ...prev, localModel: e.target.value }))} />
        </label>

        <label>
          Cloud Model
          <input value={vault.cloudModel} onChange={(e) => setVault((prev) => ({ ...prev, cloudModel: e.target.value }))} />
        </label>

        <div className="mode-group">
          <div>Execution Mode</div>
          <label>
            <input
              type="radio"
              name="mode"
              checked={vault.executionMode === "sandboxed"}
              onChange={() => setVault((prev) => ({ ...prev, executionMode: "sandboxed" }))}
            />
            Sandboxed (project-only)
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              checked={vault.executionMode === "system-wide"}
              onChange={() => setVault((prev) => ({ ...prev, executionMode: "system-wide" }))}
            />
            System-Wide (full OS access)
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              checked={vault.executionMode === "dual-stream"}
              onChange={() => setVault((prev) => ({ ...prev, executionMode: "dual-stream" }))}
            />
            Dual-Stream (thought/action split)
          </label>
        </div>
        {vault.executionMode === "system-wide" && (
          <label>
            <input
              type="checkbox"
              checked={vault.systemWideAcknowledged}
              onChange={(e) => setVault((prev) => ({ ...prev, systemWideAcknowledged: e.target.checked }))}
            />
            I understand System-Wide mode can run commands outside this project.
          </label>
        )}
        <div className="vault-hint">Mode applies to newly created shell sessions. Existing panes may require restart.</div>
        {errorText && <div className="vault-error">{errorText}</div>}

        <div className="vault-actions">
          <button onClick={onClose}>Close</button>
          <button onClick={() => void save()} disabled={saveState === "saving"}>
            {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save Vault"}
          </button>
        </div>
      </div>
    </div>
  );
}
