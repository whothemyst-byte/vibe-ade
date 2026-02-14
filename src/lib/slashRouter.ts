import type { AgentRoute } from "../types";

export type ParsedInput =
  | { kind: "shell"; line: string }
  | { kind: "agent"; route: AgentRoute; prompt: string };

export function parseInputLine(line: string): ParsedInput {
  const trimmed = line.trim();
  if (!trimmed) {
    return { kind: "shell", line: "" };
  }

  if (trimmed.startsWith("/local")) {
    return { kind: "agent", route: "local", prompt: trimmed.replace("/local", "").trim() };
  }

  if (trimmed.startsWith("/cloud")) {
    return { kind: "agent", route: "cloud", prompt: trimmed.replace("/cloud", "").trim() };
  }

  return { kind: "shell", line };
}
