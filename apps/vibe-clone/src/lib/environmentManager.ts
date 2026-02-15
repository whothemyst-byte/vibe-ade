import type { LayoutTemplate, ModelProvider } from "../types";

interface EnvironmentSnapshot {
  template: LayoutTemplate;
  modelByPane: Record<string, ModelProvider>;
}

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

  getSnapshot(): EnvironmentSnapshot {
    const modelByPane: Record<string, ModelProvider> = {};
    for (const paneId of this.paneIds) {
      modelByPane[paneId] = this.getModel(paneId);
    }
    return {
      template: this.template,
      modelByPane
    };
  }

  loadSnapshot(snapshot: EnvironmentSnapshot): string[] {
    const paneIds = this.applyTemplate(snapshot.template);
    for (const paneId of paneIds) {
      const model = snapshot.modelByPane[paneId];
      if (model === "Local" || model === "Cloud") {
        this.modelByPane.set(paneId, model);
      }
    }
    return paneIds;
  }
}
