import { AbstractInputSuggest, App, Modal, PluginSettingTab, Setting } from "obsidian";
import type StrangePropertiesPlugin from "./main";

export interface PropertyClassRule {
  property: string;
  pattern: string;
  scope: "both" | "notes" | "properties";
  enabled: boolean;
}

export interface PropertySection {
  header: string;
  properties: string[];
}

export interface SectionHeaderRule {
  condition?: {
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
  hideEmptyEnabled: boolean;
  hideEmptyActive: boolean;
}

export const DEFAULT_SETTINGS: StrangePropertiesSettings = {
  propertyClasses: [
    { property: "tags", pattern: "tag-{value}", scope: "notes", enabled: true },
  ],
  sectionHeaders: [],
  injectPropertyValues: true,
  hideEmptyEnabled: true,
  hideEmptyActive: false,
};

// ─── Property name autocomplete ───────────────────────────────────────────────

class PropertySuggest extends AbstractInputSuggest<string> {
  private readonly el: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.el = inputEl;
  }

  getSuggestions(query: string): string[] {
    // getAllPropertyInfos() exists at runtime (Obsidian 1.4+) but predates the bundled type defs.
    const infos = (this.app.metadataCache as any).getAllPropertyInfos?.() ?? {};
    const q = query.toLowerCase();
    return (Object.keys(infos) as string[])
      .filter(p => p.toLowerCase().includes(q))
      .slice(0, 20);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(value);
    this.el.dispatchEvent(new Event("input"));
    this.close();
  }
}

// ─── Section → Properties modal ───────────────────────────────────────────────

class PropertySectionModal extends Modal {
  private section: PropertySection;
  private readonly onSave: (section: PropertySection) => void;

  constructor(app: App, section: PropertySection, onSave: (section: PropertySection) => void) {
    super(app);
    this.section = { ...section, properties: [...section.properties] };
    this.onSave = onSave;
  }

  onOpen(): void {
    this.setTitle("Edit section");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl)
      .setName("Header")
      .addText(t => t
        .setValue(this.section.header)
        .onChange(v => { this.section.header = v; }));

    new Setting(contentEl).setName("Properties").setHeading();

    for (let i = 0; i < this.section.properties.length; i++) {
      const idx = i;
      new Setting(contentEl)
        .addText(t => {
          t.setValue(this.section.properties[idx]);
          new PropertySuggest(this.app, t.inputEl);
          t.onChange(v => { this.section.properties[idx] = v; });
        })
        .addExtraButton(b => b
          .setIcon("arrow-up").setTooltip("Move up").setDisabled(idx === 0)
          .onClick(() => {
            [this.section.properties[idx - 1], this.section.properties[idx]] =
              [this.section.properties[idx], this.section.properties[idx - 1]];
            this.render();
          }))
        .addExtraButton(b => b
          .setIcon("arrow-down").setTooltip("Move down")
          .setDisabled(idx === this.section.properties.length - 1)
          .onClick(() => {
            [this.section.properties[idx + 1], this.section.properties[idx]] =
              [this.section.properties[idx], this.section.properties[idx + 1]];
            this.render();
          }))
        .addExtraButton(b => b
          .setIcon("trash").setTooltip("Remove")
          .onClick(() => {
            this.section.properties.splice(idx, 1);
            this.render();
          }));
    }

    new Setting(contentEl)
      .addButton(b => b.setButtonText("Add property").onClick(() => {
        this.section.properties.push("");
        this.render();
      }));

    new Setting(contentEl)
      .addButton(b => b.setButtonText("Save").setCta().onClick(() => {
        this.onSave(this.section);
        this.close();
      }))
      .addButton(b => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ─── Section header rule modal ─────────────────────────────────────────────────

class SectionHeaderRuleModal extends Modal {
  private rule: SectionHeaderRule;
  private readonly onSave: (rule: SectionHeaderRule) => void;

  constructor(app: App, rule: SectionHeaderRule, onSave: (rule: SectionHeaderRule) => void) {
    super(app);
    this.rule = {
      ...rule,
      condition: rule.condition ? { ...rule.condition } : undefined,
      sections: rule.sections.map(s => ({ ...s, properties: [...s.properties] })),
    };
    this.onSave = onSave;
  }

  onOpen(): void {
    this.setTitle("Edit section header rule");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl)
      .setName("Enabled")
      .addToggle(t => t
        .setValue(this.rule.enabled)
        .onChange(v => { this.rule.enabled = v; }));

    new Setting(contentEl)
      .setName("Condition")
      .setDesc("Apply only when a property matches a specific value. When off, applies to all notes.")
      .addToggle(t => t
        .setValue(!!this.rule.condition)
        .onChange(v => {
          this.rule.condition = v ? { property: "", value: "" } : undefined;
          this.render();
        }));

    if (this.rule.condition) {
      new Setting(contentEl)
        .setName("Property")
        .addText(t => {
          t.setValue(this.rule.condition!.property);
          new PropertySuggest(this.app, t.inputEl);
          t.onChange(v => { this.rule.condition!.property = v; });
        });

      new Setting(contentEl)
        .setName("Value")
        .addText(t => t
          .setValue(this.rule.condition!.value)
          .onChange(v => { this.rule.condition!.value = v; }));
    }

    new Setting(contentEl).setName("Sections").setHeading();

    for (let i = 0; i < this.rule.sections.length; i++) {
      const idx = i;
      const section = this.rule.sections[idx];
      const n = section.properties.length;

      new Setting(contentEl)
        .setName(section.header || "(unnamed)")
        .setDesc(`${n} propert${n === 1 ? "y" : "ies"}`)
        .addExtraButton(b => b
          .setIcon("pencil").setTooltip("Edit")
          .onClick(() => {
            new PropertySectionModal(this.app, section, updated => {
              this.rule.sections[idx] = updated;
              this.render();
            }).open();
          }))
        .addExtraButton(b => b
          .setIcon("arrow-up").setTooltip("Move up").setDisabled(idx === 0)
          .onClick(() => {
            [this.rule.sections[idx - 1], this.rule.sections[idx]] =
              [this.rule.sections[idx], this.rule.sections[idx - 1]];
            this.render();
          }))
        .addExtraButton(b => b
          .setIcon("arrow-down").setTooltip("Move down")
          .setDisabled(idx === this.rule.sections.length - 1)
          .onClick(() => {
            [this.rule.sections[idx + 1], this.rule.sections[idx]] =
              [this.rule.sections[idx], this.rule.sections[idx + 1]];
            this.render();
          }))
        .addExtraButton(b => b
          .setIcon("trash").setTooltip("Delete")
          .onClick(() => {
            this.rule.sections.splice(idx, 1);
            this.render();
          }));
    }

    new Setting(contentEl)
      .addButton(b => b.setButtonText("Add section").onClick(() => {
        this.rule.sections.push({ header: "", properties: [] });
        this.render();
      }));

    new Setting(contentEl)
      .addButton(b => b.setButtonText("Save").setCta().onClick(() => {
        this.onSave(this.rule);
        this.close();
      }))
      .addButton(b => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ─── Property class rule modal ────────────────────────────────────────────────

class PropertyClassRuleModal extends Modal {
  private rule: PropertyClassRule;
  private readonly onSave: (rule: PropertyClassRule) => void;

  constructor(app: App, rule: PropertyClassRule, onSave: (rule: PropertyClassRule) => void) {
    super(app);
    this.rule = { ...rule };
    this.onSave = onSave;
  }

  onOpen(): void {
    this.setTitle("Edit class rule");
    const { contentEl } = this;

    new Setting(contentEl)
      .setName("Enabled")
      .addToggle(t => t
        .setValue(this.rule.enabled)
        .onChange(v => { this.rule.enabled = v; }));

    new Setting(contentEl)
      .setName("Property")
      .setDesc("The frontmatter key to read.")
      .addText(t => {
        t.setValue(this.rule.property);
        new PropertySuggest(this.app, t.inputEl);
        t.onChange(v => { this.rule.property = v; });
      });

    new Setting(contentEl)
      .setName("Pattern")
      .setDesc("Class name template. Use {property} for the key and {value} for the value.")
      .addText(t => t
        .setPlaceholder("{property}-{value}")
        .setValue(this.rule.pattern)
        .onChange(v => { this.rule.pattern = v; }));

    new Setting(contentEl)
      .setName("Scope")
      .setDesc("Which leaf types to inject the class into.")
      .addDropdown(d => d
        .addOptions({ both: "Both panels", notes: "Notes only", properties: "Properties panel" })
        .setValue(this.rule.scope)
        .onChange(v => { this.rule.scope = v as PropertyClassRule["scope"]; }));

    new Setting(contentEl)
      .addButton(b => b.setButtonText("Save").setCta().onClick(() => {
        this.onSave(this.rule);
        this.close();
      }))
      .addButton(b => b.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ─── Settings tab ──────────────────────────────────────────────────────────────

export class StrangePropertiesSettingTab extends PluginSettingTab {
  plugin: StrangePropertiesPlugin;

  constructor(app: App, plugin: StrangePropertiesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Global ────────────────────────────────────────────────────────────

    new Setting(containerEl)
      .setName("Inject property values")
      .setDesc("Add a data-property-value attribute to each property row, enabling CSS to target rows by value.")
      .addToggle(t => t
        .setValue(this.plugin.settings.injectPropertyValues)
        .onChange(async v => {
          this.plugin.settings.injectPropertyValues = v;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Hide empty button")
      .setDesc("Show a toggle button in the property footer to hide properties with no value.")
      .addToggle(t => t
        .setValue(this.plugin.settings.hideEmptyEnabled)
        .onChange(async v => {
          this.plugin.settings.hideEmptyEnabled = v;
          await this.plugin.saveSettings();
        }));

    // ── Property class rules ──────────────────────────────────────────────

    new Setting(containerEl).setName("Property class rules").setHeading();

    this.renderPropertyClassRules(containerEl);

    new Setting(containerEl)
      .addButton(b => b.setButtonText("Add rule").onClick(async () => {
        this.plugin.settings.propertyClasses.push({
          property: "", pattern: "", scope: "both", enabled: true,
        });
        await this.plugin.saveSettings();
        this.display();
      }));

    // ── Section header rules ──────────────────────────────────────────────

    new Setting(containerEl).setName("Section header rules").setHeading();

    this.renderSectionHeaderRules(containerEl);

    new Setting(containerEl)
      .addButton(b => b.setButtonText("Add rule").onClick(async () => {
        this.plugin.settings.sectionHeaders.push({ sections: [], enabled: true });
        await this.plugin.saveSettings();
        this.display();
      }));
  }

  private renderPropertyClassRules(containerEl: HTMLElement): void {
    const rules = this.plugin.settings.propertyClasses;
    const scopeLabel: Record<PropertyClassRule["scope"], string> = {
      both: "Both panels",
      notes: "Notes only",
      properties: "Properties panel",
    };

    for (let i = 0; i < rules.length; i++) {
      const idx = i;
      const rule = rules[idx];
      const name = rule.property
        ? `${rule.property} → ${rule.pattern || "(no pattern)"}`
        : "(new rule)";

      new Setting(containerEl)
        .setName(name)
        .setDesc(scopeLabel[rule.scope])
        .addToggle(t => t
          .setValue(rule.enabled)
          .onChange(async v => {
            rule.enabled = v;
            await this.plugin.saveSettings();
          }))
        .addExtraButton(b => b
          .setIcon("pencil").setTooltip("Edit rule")
          .onClick(() => {
            new PropertyClassRuleModal(this.app, rule, async updated => {
              rules[idx] = updated;
              await this.plugin.saveSettings();
              this.display();
            }).open();
          }))
        .addExtraButton(b => b
          .setIcon("arrow-up").setTooltip("Move up").setDisabled(idx === 0)
          .onClick(async () => {
            [rules[idx - 1], rules[idx]] = [rules[idx], rules[idx - 1]];
            await this.plugin.saveSettings();
            this.display();
          }))
        .addExtraButton(b => b
          .setIcon("arrow-down").setTooltip("Move down")
          .setDisabled(idx === rules.length - 1)
          .onClick(async () => {
            [rules[idx + 1], rules[idx]] = [rules[idx], rules[idx + 1]];
            await this.plugin.saveSettings();
            this.display();
          }))
        .addExtraButton(b => b
          .setIcon("trash").setTooltip("Delete rule")
          .onClick(async () => {
            rules.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
          }));
    }
  }

  private renderSectionHeaderRules(containerEl: HTMLElement): void {
    const rules = this.plugin.settings.sectionHeaders;
    for (let i = 0; i < rules.length; i++) {
      const idx = i;
      const rule = rules[idx];

      const conditionText = rule.condition
        ? `${rule.condition.property} = "${rule.condition.value}"`
        : "All notes";
      const n = rule.sections.length;
      const name = `${conditionText} — ${n} section${n !== 1 ? "s" : ""}`;

      new Setting(containerEl)
        .setName(name)
        .addToggle(t => t
          .setValue(rule.enabled)
          .onChange(async v => {
            rule.enabled = v;
            await this.plugin.saveSettings();
          }))
        .addExtraButton(b => b
          .setIcon("pencil").setTooltip("Edit rule")
          .onClick(() => {
            new SectionHeaderRuleModal(this.app, rule, async updated => {
              rules[idx] = updated;
              await this.plugin.saveSettings();
              this.display();
            }).open();
          }))
        .addExtraButton(b => b
          .setIcon("arrow-up").setTooltip("Move up").setDisabled(idx === 0)
          .onClick(async () => {
            [rules[idx - 1], rules[idx]] = [rules[idx], rules[idx - 1]];
            await this.plugin.saveSettings();
            this.display();
          }))
        .addExtraButton(b => b
          .setIcon("arrow-down").setTooltip("Move down")
          .setDisabled(idx === rules.length - 1)
          .onClick(async () => {
            [rules[idx + 1], rules[idx]] = [rules[idx], rules[idx + 1]];
            await this.plugin.saveSettings();
            this.display();
          }))
        .addExtraButton(b => b
          .setIcon("trash").setTooltip("Delete rule")
          .onClick(async () => {
            rules.splice(idx, 1);
            await this.plugin.saveSettings();
            this.display();
          }));
    }
  }
}
