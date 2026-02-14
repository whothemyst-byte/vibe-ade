import type { LayoutTemplate, ModelProvider } from "../types";

export class EnvironmentManager {
  private template: LayoutTemplate = 2;
  private modelByPane = new Map<string, ModelProvider>();
  private paneIds: string[] = [];

  constructor() {
    this.applyTemplate(2);
  }

  applyTemplate(template: LayoutTemplate): string[] {
    this.template = template;
    const nextPaneIds = Array.from({ length: template }, (_, i) => `pane-${i + 1}`);
    this.paneIds = nextPaneIds;

    for (const paneId of nextPaneIds) {
      if (!this.modelByPane.has(paneId)) {
        this.modelByPane.set(paneId, "Local");
      }
    }

    for (const key of Array.from(this.modelByPane.keys())) {
      if (!nextPaneIds.includes(key)) {
        this.modelByPane.delete(key);
      }
    }

    return [...this.paneIds];
  }

  getTemplate(): LayoutTemplate {
    return this.template;
  }

  getPaneIds(): string[] {
    return [...this.paneIds];
  }

  setModel(paneId: string, model: ModelProvider): void {
    this.modelByPane.set(paneId, model);
  }

  getModel(paneId: string): ModelProvider {
    return this.modelByPane.get(paneId) ?? "Local";
  }
}
