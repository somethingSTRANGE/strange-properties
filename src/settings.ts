import { AbstractInputSuggest, App, Modal, PluginSettingTab, sanitizeHTMLToDom, Setting, SettingGroup } from "obsidian";
import type StrangePropertiesPlugin from "./main";

export interface PropertyClassRule {
    enabled: boolean;
    property: string;
    template: string;
    scope: "both" | "notes" | "properties";
}

export interface PropertySection {
    header: string;
    properties: string[];
}

export interface SectionHeaderRule {
    enabled: boolean;
    condition?: {
        property: string;
        operator: "exists" | "is" | "contains" | "starts-with";
        value: string;
    };
    sections: PropertySection[];
}

export interface StrangePropertiesSettings {
    hideEmptyEnabled: boolean;
    hideEmptyActive: boolean;
    injectPropertyValues: boolean;
    propertyClasses: PropertyClassRule[];
    sectionHeaders: SectionHeaderRule[];
}

export const DEFAULT_SETTINGS: StrangePropertiesSettings = {
    hideEmptyEnabled: true,
    hideEmptyActive: false,
    injectPropertyValues: true,
    propertyClasses: [
        { enabled: true, property: "tags", template: "tag-{value}", scope: "notes" },
    ],
    sectionHeaders: [],
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

    onClose(): void {
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.classList.add("sp-settings-modal-level-2");
        contentEl.empty();

        new SettingGroup(contentEl)
            .addSetting((setting) => setting
                .setName("Section header")
                .addText(t => t
                    .setValue(this.section.header)
                    .onChange(v => { this.section.header = v; })
                )
            );

        const sections = new SettingGroup(contentEl)
            .addClass("sp-setting-section-properties")
            .setHeading("Properties")

        for (let i = 0; i < this.section.properties.length; i++) {
            const idx = i;
            sections.addSetting((setting) => setting
                .setClass("sp-setting-section-property")
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
                    .then(b => b.extraSettingsEl.style.marginInlineEnd = "24px")
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
                    })
                )
            );
        }

        sections.addSetting((setting) => setting
            .addButton(b => b.setButtonText("Add property").onClick(() => {
                    this.section.properties.push("");
                    this.render();
                })
            )
        );

        new Setting(contentEl)
            .then(s => s.settingEl.style.borderTop = "0")
            .addButton(b => b
                .setButtonText("Save")
                .setCta()
                .onClick(() => {
                    this.onSave(this.section);
                    this.close();
                })
            )
            .addButton(b => b
                .setButtonText("Cancel")
                .onClick(() => this.close())
            );
    }
}

// ─── Section header rule modal ─────────────────────────────────────────────────

class SectionHeaderRuleModal extends Modal {
    private rule: SectionHeaderRule;
    private conditionDraft: { property: string; operator: "exists" | "is" | "contains" | "starts-with"; value: string };
    private readonly onSave: (rule: SectionHeaderRule) => void;

    constructor(app: App, rule: SectionHeaderRule, onSave: (rule: SectionHeaderRule) => void) {
        super(app);
        this.rule = {
            ...rule,
            condition: rule.condition ? {
                ...rule.condition,
                operator: rule.condition.operator ?? "is",
            } : undefined,
            sections: rule.sections.map(s => ({ ...s, properties: [...s.properties] })),
        };
        this.conditionDraft = this.rule.condition
            ? { ...this.rule.condition }
            : { property: "", operator: "is", value: "" };
        this.onSave = onSave;
    }

    onClose(): void {
        this.contentEl.empty();
    }

    onOpen(): void {
        this.setTitle("Edit section header rule");
        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.classList.add("sp-settings-modal-level-1");
        contentEl.empty();

        new SettingGroup(contentEl)
            .addSetting((setting) => setting
                .setName("Enabled")
                .addToggle(t => t
                    .setValue(this.rule.enabled)
                    .onChange(v => { this.rule.enabled = v; })
                )
            )
            .addSetting((setting) => setting
                .setName("Condition")
                .setDesc("Apply sections only when a property matches a specific value. When off, sections applies to all views.")
                .addToggle(t => t
                    .setValue(!!this.rule.condition)
                    .onChange(v => {
                        this.rule.condition = v ? { ...this.conditionDraft } : undefined;
                        this.render();
                    })
                )
            )
            .addSetting((setting) => setting
                .setName("Property")
                .setDesc("The property name to examine.")
                .addText(t => {
                    t.setValue(this.conditionDraft.property);
                    new PropertySuggest(this.app, t.inputEl);
                    t.onChange(v => {
                        this.conditionDraft.property = v;
                        if (this.rule.condition) this.rule.condition.property = v;
                    });
                })
                .then(s => s.settingEl
                    .toggleClass("sp-setting-disabled", !this.rule.condition)
                )
            )
            .addSetting((setting) => setting
                .setName("Operator")
                .setDesc("The property name to examine.")
                .addDropdown(d => d
                    .addOptions({ is: "is", contains: "contains", "starts-with": "starts with", exists: "exists" })
                    .setValue(this.conditionDraft.operator)
                    .onChange(v => {
                        this.conditionDraft.operator = v as "exists" | "is" | "contains" | "starts-with";
                        if (this.rule.condition) this.rule.condition.operator = this.conditionDraft.operator;
                        this.render();
                    })
                )
                .then(s => s.settingEl
                    .toggleClass("sp-setting-disabled", !this.rule.condition)
                )
            )
            .addSetting((setting) => setting
                .setName("Value")
                .addText(t => t
                    .setValue(this.conditionDraft.value)
                    .onChange(v => {
                        this.conditionDraft.value = v;
                        if (this.rule.condition) this.rule.condition.value = v;
                    })
                )
                .then(s => s.settingEl
                    .toggleClass("sp-setting-disabled", !this.rule.condition || this.conditionDraft.operator === "exists")
                )
            );

        const sections = new SettingGroup(contentEl)
            .setHeading("Sections");

        for (let i = 0; i < this.rule.sections.length; i++) {
            const idx = i;
            const section = this.rule.sections[idx];
            const n = section.properties.length;

            const name = section.header || "(unnamed)";
            const desc = `${n} propert${n === 1 ? "y" : "ies"}`;

            sections.addSetting((setting) => setting
                .setName(name)
                .setDesc(desc)
                .addExtraButton(b => b
                    .setIcon("pencil").setTooltip("Edit")
                    .onClick(() => {
                        new PropertySectionModal(this.app, section, updated => {
                            this.rule.sections[idx] = updated;
                            this.render();
                        }).open();
                    })
                )
                .addExtraButton(b => b
                    .setIcon("arrow-up").setTooltip("Move up").setDisabled(idx === 0)
                    .onClick(() => {
                        [this.rule.sections[idx - 1], this.rule.sections[idx]] =
                            [this.rule.sections[idx], this.rule.sections[idx - 1]];
                        this.render();
                    })
                )
                .addExtraButton(b => b
                    .setIcon("arrow-down").setTooltip("Move down")
                    .setDisabled(idx === this.rule.sections.length - 1)
                    .then(b => b.extraSettingsEl.style.marginInlineEnd = "24px")
                    .onClick(() => {
                        [this.rule.sections[idx + 1], this.rule.sections[idx]] =
                            [this.rule.sections[idx], this.rule.sections[idx + 1]];
                        this.render();
                    })
                )
                .addExtraButton(b => b
                    .setIcon("trash").setTooltip("Delete")
                    .onClick(() => {
                        new ConfirmModal(this.app, sanitizeHTMLToDom(`Are you sure you want to delete the following section header?<div class="sp-settings-delete-item"><div class="sp-setting-item-name">${name}</div><div class="setting-item-description">${desc}</div></div>`), async () => {
                            this.rule.sections.splice(idx, 1);
                            this.render();
                        }, 2).open();
                    })
                )
            );
        }

        sections.addSetting((setting) => setting
            .addButton(b => b.setButtonText("Add section").onClick(() => {
                    this.rule.sections.push({ header: "", properties: [] });
                    this.render();
                })
            )
        );

        new Setting(contentEl)
            .then(s => s.settingEl.style.borderTop = "0")
            .addButton(b => b
                .setButtonText("Save")
                .setCta()
                .onClick(() => {
                    this.onSave(this.rule);
                    this.close();
                })
            )
            .addButton(b => b
                .setButtonText("Cancel")
                .onClick(() => this.close()
                )
            );
    }
}

// ─── Confirmation modal ───────────────────────────────────────────────────────

class ConfirmModal extends Modal {
    private readonly message: string | DocumentFragment;
    private readonly onConfirm: () => void;
    private readonly level: 1 | 2 | 3;

    constructor(app: App, message: string | DocumentFragment, onConfirm: () => void, level: 1 | 2 | 3 = 1) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
        this.level = level;
    }

    onOpen(): void {
        this.contentEl.classList.add(`sp-settings-modal-level-${this.level}`);
        this.setTitle("Confirm deletion");
        this.contentEl.createEl("p", { text: this.message });
        new Setting(this.contentEl)
            .addButton(b => b.setButtonText("Delete").setWarning().onClick(() => {
                this.onConfirm();
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

    onClose(): void {
        this.contentEl.empty();
    }

    onOpen(): void {
        this.setTitle("Edit class rule");
        const { contentEl } = this;
        contentEl.classList.add("sp-settings-modal-level-1");

        new SettingGroup(contentEl)
            .addSetting((setting) => setting
                .setName("Enabled")
                .addToggle(t => t
                    .setValue(this.rule.enabled)
                    .onChange(v => { this.rule.enabled = v; })
                )
            )
            .addSetting((setting) => setting
                .setName("Property")
                .setDesc("The property name to examine.")
                .addText(t => {
                    t.setValue(this.rule.property);
                    new PropertySuggest(this.app, t.inputEl);
                    t.onChange(v => { this.rule.property = v; });
                })
            )
            .addSetting((setting) => setting
                .setName("Template")
                .setDesc(sanitizeHTMLToDom("The class name template. Use <code>{name}</code> for the property name and <code>{value}</code> for the property value."))
                .addText(t => t
                    .setPlaceholder("{name}-{value}")
                    .setValue(this.rule.template)
                    .onChange(v => { this.rule.template = v; })
                )
            )
            .addSetting((setting) => setting
                .setName("Scope")
                .setDesc("Which view types to inject the class into.")
                .addDropdown(d => d
                    .addOptions({ both: "Both panels", notes: "Notes only", properties: "Properties panel" })
                    .setValue(this.rule.scope)
                    .onChange(v => { this.rule.scope = v as PropertyClassRule["scope"]; })
                )
            );

        new Setting(this.contentEl)
            .then(s => s.settingEl.style.borderTop = "0")
            .addButton(b => b
                .setButtonText("Save")
                .setCta()
                .onClick(() => {
                    this.onSave(this.rule);
                    this.close();
                })
            )
            .addButton(b => b
                .setButtonText("Cancel")
                .onClick(() => this.close())
            );
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

        this.addBanner(containerEl);

        // ── Global ────────────────────────────────────────────────────────────

        new SettingGroup(containerEl)
            .setHeading("Empty properties")
            .addSetting((setting) => setting
                .setName("Show button on property footer")
                .setDesc("Add a toggle button that allows properties with no value to be hidden.")
                .addToggle(t => t
                    .setValue(this.plugin.settings.hideEmptyEnabled)
                    .onChange(async v => {
                        this.plugin.settings.hideEmptyEnabled = v;
                        await this.plugin.saveSettings();
                        this.display();
                    })
                )
            )
            .addSetting((setting) => setting
                .setName("Hide empty properties")
                .setDesc("When enabled, empty properties will be hidden.")
                .addToggle(t => t
                    .setValue(this.plugin.settings.hideEmptyActive)
                    .onChange(async v => {
                        this.plugin.settings.hideEmptyActive = v;
                        await this.plugin.saveSettings();
                    })
                )
                .then(s => s.settingEl
                    .toggleClass("sp-setting-disabled", !this.plugin.settings.hideEmptyEnabled)
                )
            );

        new SettingGroup(containerEl)
            .setHeading("Property value attributes")
            .addSetting((setting) => setting
                .setName("Inject property values")
                .setDesc(sanitizeHTMLToDom("Add a <code>data-property-value</code> attribute to each property, enabling CSS to target properties by their value."))
                .addToggle(t => t
                    .setValue(this.plugin.settings.injectPropertyValues)
                    .onChange(async v => {
                        this.plugin.settings.injectPropertyValues = v;
                        await this.plugin.saveSettings();
                    })
                )
            );

        // ── Property class rules ──────────────────────────────────────────────

        const classRules = new SettingGroup(containerEl)
            .setHeading("Property class rules");

        this.renderPropertyClassRules(classRules);

        classRules.addSetting((setting) => setting
            .addButton(b => b.setButtonText("Add rule").onClick(async () => {
                    this.plugin.settings.propertyClasses.push({
                        property: "", template: "", scope: "both", enabled: true,
                    });
                    await this.plugin.saveSettings();
                    this.display();
                })
            )
        );

        // ── Section header rules ──────────────────────────────────────────────

        const sectionRules = new SettingGroup(containerEl)
            .setHeading("Section header rules");

        this.renderSectionHeaderRules(sectionRules);

        sectionRules.addSetting((setting) => setting
            .addButton(b => b.setButtonText("Add rule").onClick(async () => {
                    this.plugin.settings.sectionHeaders.push({ sections: [], enabled: true });
                    await this.plugin.saveSettings();
                    this.display();
                })
            )
        );
    }

    private renderPropertyClassRules(classRules: SettingGroup): void {
        const rules = this.plugin.settings.propertyClasses;
        const scopeLabel: Record<PropertyClassRule["scope"], string> = {
            both: "notes and File Properties panel",
            notes: "notes only",
            properties: "File Properties panel",
        };

        for (let i = 0; i < rules.length; i++) {
            const idx = i;
            const rule = rules[idx];
            const name = rule.property
                ? `<code>${rule.property}</code> → <code>${rule.template.replace("{name}", rule.property) || "(no template)"}</code>`
                : `<code>(new rule)</code>`;
            const desc = `Apply to ${scopeLabel[rule.scope]}`;

            classRules.addSetting((setting) => setting
                .setName(sanitizeHTMLToDom(name))
                .setDesc(desc)
                .addExtraButton(bEdit => bEdit
                    .setIcon("pencil").setTooltip("Edit rule")
                    .onClick(() => {
                        new PropertyClassRuleModal(this.app, rule, async updated => {
                            rules[idx] = updated;
                            await this.plugin.saveSettings();
                            this.display();
                        }).open();
                    })
                )
                .addExtraButton(bMoveUp => bMoveUp
                    .setIcon("arrow-up").setTooltip("Move up").setDisabled(idx === 0)
                    .onClick(async () => {
                        [rules[idx - 1], rules[idx]] = [rules[idx], rules[idx - 1]];
                        await this.plugin.saveSettings();
                        this.display();
                    })
                )
                .addExtraButton(bMoveDown => bMoveDown
                    .setIcon("arrow-down").setTooltip("Move down")
                    .setDisabled(idx === rules.length - 1)
                    .then(b => b.extraSettingsEl.style.marginInlineEnd = "24px")
                    .onClick(async () => {
                        [rules[idx + 1], rules[idx]] = [rules[idx], rules[idx + 1]];
                        await this.plugin.saveSettings();
                        this.display();
                    })
                )
                .addExtraButton(bDelete => bDelete
                    .setIcon("trash").setTooltip("Delete rule")
                    .then(b => b.extraSettingsEl.style.marginInlineEnd = "24px")
                    .onClick(() => {
                        new ConfirmModal(this.app, sanitizeHTMLToDom(`Are you sure you want to delete the following property class rule?<div class="sp-settings-delete-item"><div class="sp-setting-item-name">${name}</div><div class="setting-item-description">${desc}</div></div>`), async () => {
                            rules.splice(idx, 1);
                            await this.plugin.saveSettings();
                            this.display();
                        }).open();
                    }))
                .addToggle(t => t
                    .setValue(rule.enabled)
                    .onChange(async v => {
                        rule.enabled = v;
                        await this.plugin.saveSettings();
                    }))
            );
        }
    }

    private renderSectionHeaderRules(sectionRules: SettingGroup): void {
        const rules = this.plugin.settings.sectionHeaders;
        for (let i = 0; i < rules.length; i++) {
            const idx = i;
            const rule = rules[idx];

            const condition = (() => {
                const c = rule.condition;
                if (!c) return null;
                const property = `<code>${c.property}</code>`;
                const value = `<code>${c.value}</code>`;
                switch (c.operator) {
                    case "exists":
                        return `${property} exists`;
                    case "contains":
                        return `${property} contains ${value}`;
                    case "starts-with":
                        return `${property} starts with ${value}`;
                    default:
                        return `${property} is ${value}`;
                }
            })();
            const name = condition ? condition : "All property lists";

            const n = rule.sections.length;
            const desc = `Defines ${n} section${n !== 1 ? "s" : ""}`;

            sectionRules.addSetting((setting) => setting
                .setName(sanitizeHTMLToDom(name))
                .setDesc(desc)
                .addExtraButton(b => b
                    .setIcon("pencil").setTooltip("Edit rule")
                    .onClick(() => {
                        new SectionHeaderRuleModal(this.app, rule, async updated => {
                            rules[idx] = updated;
                            await this.plugin.saveSettings();
                            this.display();
                        }).open();
                    })
                )
                .addExtraButton(b => b
                    .setIcon("arrow-up").setTooltip("Move up").setDisabled(idx === 0)
                    .onClick(async () => {
                        [rules[idx - 1], rules[idx]] = [rules[idx], rules[idx - 1]];
                        await this.plugin.saveSettings();
                        this.display();
                    })
                )
                .addExtraButton(b => b
                    .setIcon("arrow-down").setTooltip("Move down")
                    .setDisabled(idx === rules.length - 1)
                    .then(b => b.extraSettingsEl.style.marginInlineEnd = "24px")
                    .onClick(async () => {
                        [rules[idx + 1], rules[idx]] = [rules[idx], rules[idx + 1]];
                        await this.plugin.saveSettings();
                        this.display();
                    })
                )
                .addExtraButton(b => b
                    .setIcon("trash").setTooltip("Delete rule")
                    .then(b => b.extraSettingsEl.style.marginInlineEnd = "24px")
                    .onClick(async () => {
                        new ConfirmModal(this.app, sanitizeHTMLToDom(`Are you sure you want to delete the following section header rule?<div class="sp-settings-delete-item"><div class="sp-setting-item-name">${name}</div><div class="setting-item-description">${desc}</div></div>`), async () => {
                            rules.splice(idx, 1);
                            await this.plugin.saveSettings();
                            this.display();
                        }).open();
                    })
                )
                .addToggle(t => t
                    .setValue(rule.enabled)
                    .onChange(async v => {
                        rule.enabled = v;
                        await this.plugin.saveSettings();
                    })
                )
            );
        }
    }

    private addBanner(containerEl: HTMLElement) {
        const url = "https://github.com/somethingSTRANGE/strange-properties"; // this.plugin.manifest.authorUrl;
        const desc = `<div class="sp-settings-banner-meta">Version: ${this.plugin.manifest.version}</div>`
                     + `<div class="sp-settings-banner-meta">By ${this.plugin.manifest.author}</div>`
                     + `<div class="sp-settings-banner-meta">Repository: <a target="_blank" rel="noopener" href="${url}">${url}</a></div>`
                     + `<div class="sp-settings-banner-desc">${this.plugin.manifest.description}</div>`;

        const rawFunding = this.plugin.fundingUrl;
        console.log(rawFunding);

        const fundingLinks: { label: string; url: string }[] =
            !rawFunding ? [] :
                typeof rawFunding === 'string' ? [{
                        label: `Donate to support ${this.plugin.manifest.name}`,
                        url: rawFunding
                    }] :
                    Object.entries(rawFunding).map(([label, url]) => ({ label, url }));
        console.log(fundingLinks);

        const banner = new Setting(containerEl)
            .setClass("sp-settings-banner")
            .setName(this.plugin.manifest.name)
            .setDesc(sanitizeHTMLToDom(desc));

        banner.addExtraButton(b => b
                .setIcon("refresh-cw").setTooltip(`Reload plugin`)
                .onClick(() => {
                    const id = this.plugin.manifest.id;
                    const plugins = (this.app as any).plugins;
                    plugins.disablePlugin(id)
                        .then(() => plugins.enablePlugin(id))
                        .then(() => (this.app as any).setting.openTabById(id));
                })
            )
            .addExtraButton(b => b
                .setIcon("folder-open").setTooltip(`Open plugin folder`)
                .onClick(() => {
                    (this.app as any).showInFolder(
                        this.plugin.manifest.dir + "/manifest.json"
                    );
                })
            );

        fundingLinks.forEach(({ label, url }, i) => {
            console.log(label, url);
            banner.addExtraButton(b => {
                b.setIcon("heart").setTooltip(label)
                    .then(b => b.extraSettingsEl.classList.add('sp-funding-button'))
                    .onClick(() => window.open(url, '_blank'));
            });
        });


        if (fundingLinks.length > 0) {
            const first = banner.controlEl.querySelector('.sp-funding-button');
            const wrapper = banner.controlEl.createDiv({ cls: 'sp-funding-buttons' });
            wrapper.innerText = "Give support";
            first!.before(wrapper);
            banner.controlEl.querySelectorAll('.sp-funding-button').forEach(b => wrapper.appendChild(b));
        }
    }
}
