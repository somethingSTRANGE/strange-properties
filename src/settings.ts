import { App, PluginSettingTab } from "obsidian";
import type StrangePropertiesPlugin from "./main";

export interface PropertyClassRule {
  property: string;
  pattern: string;
  scope: "both" | "notes" | "properties";
  enabled: boolean;
}

export interface PropertySection {
  header: string;        // display label, e.g. "General Information"
  properties: string[];  // property keys that start a new run of this section
}

export interface SectionHeaderRule {
  condition?: {          // omit to apply to all notes
    property: string;
    value: string;
  };
  sections: PropertySection[];
  enabled: boolean;
}

export interface StrangePropertiesSettings {
  propertyClasses: PropertyClassRule[];
  sectionHeaders: SectionHeaderRule[];
  injectPropertyValues: boolean;
  sanitize: boolean;
  hideEmpty: boolean;
  hideEmptyActive: boolean;
}

export const DEFAULT_SETTINGS: StrangePropertiesSettings = {
  propertyClasses: [
    { property: "tags", pattern: "tag-{value}", scope: "notes", enabled: true },
  ],
  sectionHeaders: [],
  injectPropertyValues: true,
  sanitize: true,
  hideEmpty: true,
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
