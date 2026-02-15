import type { AgentRoute } from "../types";

export type ParsedInput =
  | { kind: "shell"; line: string }
  | { kind: "agent"; route: AgentRoute; prompt: string };

export function parseInputLine(line: string): ParsedInput {
  const trimmed = line.trim();
  if (!trimmed) {
    return { kind: "shell", line: "" };
  }

  const localMatch = trimmed.match(/^\/local(?:\s+(.*))?$/);
  if (localMatch) {
    return { kind: "agent", route: "local", prompt: (localMatch[1] ?? "").trim() };
  }

  return { kind: "shell", line };
}
