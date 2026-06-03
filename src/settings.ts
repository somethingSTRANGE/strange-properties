import { App, PluginSettingTab } from "obsidian";
import type StrangePropertiesPlugin from "./main";

export interface ConversionRule {
  property: string;
  pattern: string;
  scope: "both" | "notes" | "properties";
  enabled: boolean;
}

export interface StrangePropertiesSettings {
  rules: ConversionRule[];
  injectPropertyValues: boolean;
  sanitize: boolean;
  hideEmpty: boolean;
  hideEmptyStyle: "icon" | "icon-text" | "text";
  hideEmptyActive: boolean;
}

export const DEFAULT_SETTINGS: StrangePropertiesSettings = {
  rules: [
    { property: "tags", pattern: "tag-{value}", scope: "notes", enabled: true },
  ],
  injectPropertyValues: true,
  sanitize: true,
  hideEmpty: true,
  hideEmptyStyle: "icon-text",
  hideEmptyActive: false,
};

export class StrangePropertiesSettingTab extends PluginSettingTab {
  plugin: StrangePropertiesPlugin;

  constructor(app: App, plugin: StrangePropertiesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", { text: "Settings UI coming soon." });
  }
}
