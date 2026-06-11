import { AbstractInputSuggest, App, Modal, PluginSettingTab, sanitizeHTMLToDom, Setting, SettingGroup } from "obsidian";
import Sortable from "sortablejs";
import type StrangePropertiesPlugin from "./main";

// ─── Property class rule ──────────────────────────────────────────────────────

export interface PropertyClassRule {
    enabled: boolean;
    property: string;
    template: string;
    scope: "both" | "notes" | "properties";
}

// ─── Property rule ───────────────────────────────────────────────────────────

export interface PropertyGroup {
    id: string;
    title: string;
}

export interface PropertyEntry {
    property: string;
    group: string | null;
    enum: { id: string; storeAs: "text" | "number" } | null;
    help: string | null;
}

export interface PropertyRule {
    enabled: boolean;
    condition?: {
        property: string;
        operator: "exists" | "is" | "contains" | "starts-with";
        value: string;
    };
    groups: PropertyGroup[];
    properties: PropertyEntry[];
}

export interface DefaultPropertyRule {
    groups: PropertyGroup[];
    properties: PropertyEntry[];
}

// ─── Static enum ─────────────────────────────────────────────────────────────

export interface StaticEnumEntry {
    enum_text?: string;
    enum_number?: number;
    enum_label?: string;
}

export interface StaticEnum {
    id: string;
    name: string;
    allowOther: boolean;
    entries: StaticEnumEntry[];
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface StrangePropertiesSettings {
    hideEmptyEnabled: boolean;
    hideEmptyActive: boolean;
    injectPropertyValues: boolean;
    propertyClasses: PropertyClassRule[];
    propertyRules: PropertyRule[];
    defaultRule: DefaultPropertyRule;
    staticEnums: StaticEnum[];
}

export const DEFAULT_SETTINGS: StrangePropertiesSettings = {
    hideEmptyEnabled: true,
    hideEmptyActive: false,
    injectPropertyValues: true,
    propertyClasses: [],
    propertyRules: [],
    defaultRule: { groups: [], properties: [] },
    staticEnums: [],
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugifyGroupId(title: string, existingIds: string[]): string {
    const base = title.toLowerCase()
                     .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
                 || 'group';
    if (!existingIds.includes(base)) return base;
    let n = 2;
    while (existingIds.includes(`${base}-${n}`)) n++;
    return `${base}-${n}`;
}

// ─── Property group modal ─────────────────────────────────────────────────────

class EditGroupModal extends Modal {
    private draft: PropertyGroup;
    private readonly existingIds: string[];
    private readonly onSave: (group: PropertyGroup) => void;

    constructor(app: App, group: PropertyGroup, existingIds: string[], onSave: (group: PropertyGroup) => void) {
        super(app);
        this.draft = { ...group };
        this.existingIds = existingIds;
        this.onSave = onSave;
    }

    onOpen(): void {
        this.setTitle(this.draft.id ? "Edit group" : "Add group");
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.classList.add("sp-settings-modal-level-3");
        contentEl.empty();

        new SettingGroup(contentEl)
            .addSetting(s => s
                .setName("Group title")
                .setDesc("Heading text displayed above the group's properties.")
                .addText(t => {
                    t.setValue(this.draft.title);
                    t.onChange(v => { this.draft.title = v; });
                    setTimeout(() => t.inputEl.blur(), 0);
                })
            );

        new Setting(contentEl)
            .then(s => s.settingEl.style.borderTop = "0")
            .addButton(b => b.setButtonText("Apply").setCta().onClick(() => {
                if (!this.draft.id)
                    this.draft.id = slugifyGroupId(this.draft.title, this.existingIds);
                this.onSave(this.draft);
                this.close();
            }))
            .addButton(b => b.setButtonText("Cancel").onClick(() => this.close()));
    }
}

// ─── Property entry modal ─────────────────────────────────────────────────────

class EditPropertyModal extends Modal {
    private entry: PropertyEntry;
    private readonly groups: PropertyGroup[];
    private readonly staticEnums: StaticEnum[];
    private readonly onSave: (entry: PropertyEntry) => void;

    constructor(app: App, entry: PropertyEntry, groups: PropertyGroup[], staticEnums: StaticEnum[], onSave: (entry: PropertyEntry) => void) {
        super(app);
        this.entry = { ...entry, enum: entry.enum ? { ...entry.enum } : null };
        this.groups = groups;
        this.staticEnums = staticEnums;
        this.onSave = onSave;
    }

    onOpen(): void {
        this.setTitle("Edit property");
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.classList.add("sp-settings-modal-level-3");
        contentEl.empty();

        const groupOptions: Record<string, string> = { '': '(no group)' };
        for (const g of this.groups) groupOptions[g.id] = g.title || `(${g.id})`;

        const enumOptions: Record<string, string> = { '': '(no enum)' };
        for (const e of this.staticEnums) enumOptions[e.id] = e.name || e.id;

        const fields = new SettingGroup(contentEl)
            .addSetting(s => s
                .setName("Property")
                .addText(t => {
                    t.setValue(this.entry.property);
                    new PropertySuggest(this.app, t.inputEl);
                    t.onChange(v => { this.entry.property = v; });
                    setTimeout(() => t.inputEl.blur(), 0);
                })
            )
            .addSetting(s => s
                .setName("Group")
                .setDesc("The group this property belongs to.")
                .addDropdown(d => d
                    .addOptions(groupOptions)
                    .setValue(this.entry.group ?? '')
                    .onChange(v => { this.entry.group = v || null; })
                )
            )
            .addSetting(s => s
                .setName("Enum")
                .setDesc("A pre-set list of value options for this property.")
                .addDropdown(d => d
                    .addOptions(enumOptions)
                    .setValue(this.entry.enum?.id ?? '')
                    .onChange(v => {
                        this.entry.enum = v ? { id: v, storeAs: this.entry.enum?.storeAs ?? 'text' } : null;
                        this.render();
                    })
                )
            );

        if (this.entry.enum) {
            fields.addSetting(s => s
                .setName("Store as")
                .setDesc("Whether to store the selected value as text or a number.")
                .addDropdown(d => d
                    .addOptions({ text: "Text", number: "Number" })
                    .setValue(this.entry.enum!.storeAs)
                    .onChange(v => {
                        if (this.entry.enum) this.entry.enum.storeAs = v as "text" | "number";
                    })
                )
            );
        }

        fields.addSetting(s => s
            .setName("Help")
            .setDesc("Usage notes shown when hovering over the help icon.")
            .addTextArea(t => t
                .setValue(this.entry.help ?? '')
                .onChange(v => { this.entry.help = v || null; })
            )
        );

        new Setting(contentEl)
            .then(s => s.settingEl.style.borderTop = "0")
            .addButton(b => b.setButtonText("Apply").setCta().onClick(() => {
                this.onSave(this.entry);
                this.close();
            }))
            .addButton(b => b.setButtonText("Cancel").onClick(() => this.close()));
    }
}

// ─── Property groups modal ───────────────────────────────────────────────────

class EditGroupsModal extends Modal {
    private readonly entries: PropertyGroup[];
    private readonly properties: PropertyEntry[];
    private readonly onUpdate: () => void;

    constructor(app: App, groups: PropertyGroup[], properties: PropertyEntry[], onUpdate: () => void) {
        super(app);
        this.entries = groups;
        this.properties = properties;
        this.onUpdate = onUpdate;
    }

    onOpen(): void {
        this.setTitle("Edit groups");
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
        this.onUpdate();
    }

    private render(scrollTo?: number): void {
        const { contentEl } = this;
        const scroll = scrollTo ?? contentEl.querySelector<HTMLElement>('.setting-items')?.scrollTop ?? 0;
        contentEl.classList.add("sp-settings-modal-level-2");
        contentEl.empty();

        const reorderableList = new SettingGroup(contentEl)
            .addClass("sp-reorderable-list");

        reorderableList.listEl.classList.add("sp-scroll-shadows");

        if (this.entries.length === 0) {
            reorderableList.addSetting(s => s.setName("No groups defined.")
                .then(b => { b.settingEl.addClass("sp-empty-list"); })
            );
        } else {
            for (const entry of this.entries) {
                let handleEl: HTMLElement;
                const openEdit = () => {
                    const idx = this.entries.indexOf(entry);
                    new EditGroupModal(this.app, entry,
                        this.entries.filter(g => g !== entry).map(g => g.id),
                        updated => {
                            this.entries[idx] = updated;
                            this.render();
                        }
                    ).open();
                };
                reorderableList.addSetting(s => s
                    .setName(entry.title || "(untitled)")
                    .setDesc(entry.id)
                    .setClass("sp-row-clickable")
                    .setClass("sp-reorderable-list-item")
                    .addExtraButton(b => {
                        b.setIcon("grip-vertical").setTooltip("Drag to reorder");
                        b.extraSettingsEl.addClass("sp-drag-handle");
                        b.extraSettingsEl.addEventListener("click", e => e.stopPropagation());
                        handleEl = b.extraSettingsEl;
                    })
                    .addExtraButton(b => b
                        .setIcon("trash")
                        .setTooltip("Delete")
                        .then(b => {
                            b.extraSettingsEl.addClass("sp-delete-button");
                            b.extraSettingsEl.addEventListener("click", e => e.stopPropagation());
                        })
                        .onClick(() => {
                            new ConfirmModal(this.app,
                                sanitizeHTMLToDom(`Delete group entry for <code>${entry.title || "(unnamed)"}</code>?`),
                                () => {
                                    const idx = this.entries.indexOf(entry);
                                    this.properties.forEach(p => { if (p.group === entry.id) p.group = null; });
                                    this.entries.splice(idx, 1);
                                    this.render();
                                },
                                3
                            ).open();
                        })
                    )
                    .addExtraButton(b => b
                        .setIcon("chevron-right")
                        .setTooltip("Edit")
                        .then(b => {
                            b.extraSettingsEl.addClass("sp-chevron-icon");
                        })
                        .setDisabled(true)
                    )
                    .then(s => {
                        s.settingEl.insertBefore(handleEl, s.settingEl.querySelector(".setting-item-info"));
                        s.settingEl.addEventListener("click", openEdit);
                    })
                );
            }

            Sortable.create(reorderableList.listEl, {
                handle: ".sp-drag-handle",
                animation: 150,
                ghostClass: "sp-sortable-ghost",
                onEnd: ({ oldIndex, newIndex }) => {
                    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
                    const [moved] = this.entries.splice(oldIndex, 1);
                    this.entries.splice(newIndex, 0, moved);
                    this.render();
                },
            });
        }

        reorderableList.listEl.scrollTop = scroll;

        const footer = new Setting(contentEl)
            .then(s => {
                s.settingEl.style.borderTop = "0";
                s.settingEl.addClass("sp-modal-footer");
            })
            .addButton(b => b.setButtonText("Done").setCta().onClick(() => this.close()));

        footer.addButton(b => b
            .setIcon("plus")
            .setClass("sp-list-add-button")
            .then(b => b.buttonEl.createSpan({ text: "Add group" }))
            .then(b => footer.settingEl.prepend(b.buttonEl))
            .onClick(() => {
                new EditGroupModal(this.app, { id: '', title: '' },
                    this.entries.map(g => g.id),
                    added => {
                        this.entries.push(added);
                        this.render(Number.MAX_SAFE_INTEGER);
                    }
                ).open();
            })
        );
    }
}

// ─── Property entries modal ───────────────────────────────────────────────────

class EditPropertiesModal extends Modal {
    private readonly groups: PropertyGroup[];
    private readonly entries: PropertyEntry[];
    private readonly staticEnums: StaticEnum[];
    private readonly onUpdate: () => void;

    constructor(app: App, groups: PropertyGroup[], properties: PropertyEntry[], staticEnums: StaticEnum[], onUpdate: () => void) {
        super(app);
        this.groups = groups;
        this.entries = properties;
        this.staticEnums = staticEnums;
        this.onUpdate = onUpdate;
    }

    onOpen(): void {
        this.setTitle("Edit properties");
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
        this.onUpdate();
    }

    private render(scrollTo?: number): void {
        const { contentEl } = this;
        const scroll = scrollTo ?? contentEl.querySelector<HTMLElement>('.setting-items')?.scrollTop ?? 0;
        contentEl.classList.add("sp-settings-modal-level-2");
        contentEl.empty();

        const reorderableList = new SettingGroup(contentEl)
            .addClass("sp-reorderable-list");

        reorderableList.listEl.classList.add("sp-scroll-shadows");

        if (this.entries.length === 0) {
            reorderableList.addSetting(s => s.setName("No properties defined.")
                .then(b => { b.settingEl.addClass("sp-empty-list"); })
            );
        } else {
            for (const entry of this.entries) {
                const groupTitle = entry.group
                    ? (this.groups.find(g => g.id === entry.group)?.title ?? entry.group)
                    : null;
                const enumLabel = entry.enum
                    ? (this.staticEnums.find(e => e.id === entry.enum!.id)?.name ?? entry.enum.id)
                    : null;
                const badges = [groupTitle, enumLabel].filter(Boolean).join(", ");

                let handleEl: HTMLElement;
                const openEdit = () => {
                    const idx = this.entries.indexOf(entry);
                    new EditPropertyModal(this.app, entry, this.groups, this.staticEnums,
                        updated => {
                            this.entries[idx] = updated;
                            this.render();
                        }
                    ).open();
                };
                reorderableList.addSetting(s => s
                    .setName(entry.property || "(unnamed)")
                    .setDesc(badges || " ")
                    .setClass("sp-row-clickable")
                    .setClass("sp-reorderable-list-item")
                    .addExtraButton(b => {
                        b.setIcon("grip-vertical").setTooltip("Drag to reorder");
                        b.extraSettingsEl.addClass("sp-drag-handle");
                        b.extraSettingsEl.addEventListener("click", e => e.stopPropagation());
                        handleEl = b.extraSettingsEl;
                    })
                    .addExtraButton(b => b
                        .setIcon("trash")
                        .setTooltip("Delete")
                        .then(b => {
                            b.extraSettingsEl.addClass("sp-delete-button");
                            b.extraSettingsEl.addEventListener("click", e => e.stopPropagation());
                        })
                        .onClick(() => {
                            new ConfirmModal(this.app,
                                sanitizeHTMLToDom(`Delete property entry for <code>${entry.property || "(unnamed)"}</code>?`),
                                () => {
                                    const idx = this.entries.indexOf(entry);
                                    this.entries.splice(idx, 1);
                                    this.render();
                                },
                                3
                            ).open();
                        })
                    )
                    .addExtraButton(b => b
                        .setIcon("chevron-right")
                        .setTooltip("Edit")
                        .then(b => {
                            b.extraSettingsEl.addClass("sp-chevron-icon");
                        })
                        .setDisabled(true)
                    )
                    .then(s => {
                        s.settingEl.insertBefore(handleEl, s.settingEl.querySelector(".setting-item-info"));
                        s.settingEl.addEventListener("click", openEdit);
                    })
                );
            }

            Sortable.create(reorderableList.listEl, {
                handle: ".sp-drag-handle",
                animation: 150,
                ghostClass: "sp-sortable-ghost",
                onEnd: ({ oldIndex, newIndex }) => {
                    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
                    const [moved] = this.entries.splice(oldIndex, 1);
                    this.entries.splice(newIndex, 0, moved);
                    this.render();
                },
            });
        }

        reorderableList.listEl.scrollTop = scroll;

        const footer = new Setting(contentEl)
            .then(s => {
                s.settingEl.style.borderTop = "0";
                s.settingEl.addClass("sp-modal-footer");
            })
            .addButton(b => b.setButtonText("Done").setCta().onClick(() => this.close()));

        footer.addButton(b => b
            .setIcon("plus")
            .setClass("sp-list-add-button")
            .then(b => b.buttonEl.createSpan({ text: "Add property" }))
            .then(b => footer.settingEl.prepend(b.buttonEl))
            .onClick(() => {
                new EditPropertyModal(this.app,
                    { property: '', group: null, enum: null, help: null },
                    this.groups, this.staticEnums,
                    added => {
                        this.entries.push(added);
                        this.render(Number.MAX_SAFE_INTEGER);
                    }
                ).open();
            })
        );
    }
}

// ─── Property rule modal ──────────────────────────────────────────────────────

class PropertyRuleModal extends Modal {
    private rule: PropertyRule;
    private conditionDraft: { property: string; operator: "exists" | "is" | "contains" | "starts-with"; value: string };
    private readonly staticEnums: StaticEnum[];
    private readonly onSave: (rule: PropertyRule) => void;

    constructor(app: App, rule: PropertyRule, staticEnums: StaticEnum[], onSave: (rule: PropertyRule) => void) {
        super(app);
        this.rule = {
            ...rule,
            condition: rule.condition ? { ...rule.condition } : undefined,
            groups: rule.groups.map(g => ({ ...g })),
            properties: rule.properties.map(p => ({ ...p, enum: p.enum ? { ...p.enum } : null })),
        };
        this.conditionDraft = this.rule.condition
            ? { ...this.rule.condition }
            : { property: "", operator: "is", value: "" };
        this.staticEnums = staticEnums;
        this.onSave = onSave;
    }

    onOpen(): void {
        this.setTitle("Edit property rule");
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.classList.add("sp-settings-modal-level-1");
        contentEl.empty();

        new SettingGroup(contentEl)
            .addSetting(s => s
                .setName("Enabled")
                .addToggle(t => t
                    .setValue(this.rule.enabled)
                    .onChange(v => { this.rule.enabled = v; })
                )
            )
            .addSetting(s => s
                .setName("Condition")
                .setDesc("Apply this rule only when a property matches a specific value. When off, this rule applies to all notes.")
                .addToggle(t => t
                    .setValue(!!this.rule.condition)
                    .onChange(v => {
                        this.rule.condition = v ? { ...this.conditionDraft } : undefined;
                        this.render();
                    })
                )
            )
            .addSetting(s => s
                .setName("Property")
                .addText(t => {
                    t.setValue(this.conditionDraft.property);
                    new PropertySuggest(this.app, t.inputEl);
                    t.onChange(v => {
                        this.conditionDraft.property = v;
                        if (this.rule.condition) this.rule.condition.property = v;
                    });
                })
                .then(s => s.settingEl.toggleClass("sp-setting-disabled", !this.rule.condition))
            )
            .addSetting(s => s
                .setName("Operator")
                .addDropdown(d => d
                    .addOptions({ is: "is", contains: "contains", "starts-with": "starts with", exists: "exists" })
                    .setValue(this.conditionDraft.operator)
                    .onChange(v => {
                        this.conditionDraft.operator = v as "exists" | "is" | "contains" | "starts-with";
                        if (this.rule.condition) this.rule.condition.operator = this.conditionDraft.operator;
                        this.render();
                    })
                )
                .then(s => s.settingEl.toggleClass("sp-setting-disabled", !this.rule.condition))
            )
            .addSetting(s => s
                .setName("Value")
                .addText(t => t
                    .setValue(this.conditionDraft.value)
                    .onChange(v => {
                        this.conditionDraft.value = v;
                        if (this.rule.condition) this.rule.condition.value = v;
                    })
                )
                .then(s => s.settingEl.toggleClass("sp-setting-disabled", !this.rule.condition || this.conditionDraft.operator === "exists"))
            );

        const ng = this.rule.groups.length;
        const np = this.rule.properties.length;
        new SettingGroup(contentEl)
            .addSetting(s => s
                .setName("Groups")
                .setDesc(`${ng} group${ng !== 1 ? 's' : ''}`)
                .addButton(b => b.setButtonText("Edit groups").onClick(() => {
                    new EditGroupsModal(this.app, this.rule.groups, this.rule.properties, () => this.render()).open();
                }))
            )
            .addSetting(s => s
                .setName("Properties")
                .setDesc(`${np} propert${np !== 1 ? 'ies' : 'y'}`)
                .addButton(b => b.setButtonText("Edit properties").onClick(() => {
                    new EditPropertiesModal(this.app, this.rule.groups, this.rule.properties, this.staticEnums, () => this.render()).open();
                }))
            );

        new Setting(contentEl)
            .then(s => s.settingEl.style.borderTop = "0")
            .addButton(b => b.setButtonText("Save").setCta().onClick(() => {
                this.onSave(this.rule);
                this.close();
            }))
            .addButton(b => b.setButtonText("Cancel").onClick(() => this.close()));
    }
}

// ─── Default property rule modal ──────────────────────────────────────────────

class DefaultPropertyRuleModal extends Modal {
    private rule: DefaultPropertyRule;
    private readonly staticEnums: StaticEnum[];
    private readonly onSave: (rule: DefaultPropertyRule) => void;

    constructor(app: App, rule: DefaultPropertyRule, staticEnums: StaticEnum[], onSave: (rule: DefaultPropertyRule) => void) {
        super(app);
        this.rule = {
            groups: rule.groups.map(g => ({ ...g })),
            properties: rule.properties.map(p => ({ ...p, enum: p.enum ? { ...p.enum } : null })),
        };
        this.staticEnums = staticEnums;
        this.onSave = onSave;
    }

    onOpen(): void {
        this.setTitle("Edit global defaults");
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.classList.add("sp-settings-modal-level-1");
        contentEl.empty();

        const ng = this.rule.groups.length;
        const np = this.rule.properties.length;
        new SettingGroup(contentEl)
            .addSetting(s => s
                .setName("Groups")
                .setDesc(`${ng} group${ng !== 1 ? 's' : ''}`)
                .addButton(b => b.setButtonText("Edit groups").onClick(() => {
                    new EditGroupsModal(this.app, this.rule.groups, this.rule.properties, () => this.render()).open();
                }))
            )
            .addSetting(s => s
                .setName("Properties")
                .setDesc(`${np} propert${np !== 1 ? 'ies' : 'y'}`)
                .addButton(b => b.setButtonText("Edit properties").onClick(() => {
                    new EditPropertiesModal(this.app, this.rule.groups, this.rule.properties, this.staticEnums, () => this.render()).open();
                }))
            );

        new Setting(contentEl)
            .then(s => s.settingEl.style.borderTop = "0")
            .addButton(b => b.setButtonText("Save").setCta().onClick(() => {
                this.onSave(this.rule);
                this.close();
            }))
            .addButton(b => b.setButtonText("Cancel").onClick(() => this.close()));
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

        // ── Property rules ────────────────────────────────────────────────────

        this.renderPropertyRules(containerEl);

        // ── Global defaults ───────────────────────────────────────────────────

        const defaultRuleGroup = new SettingGroup(containerEl);
        this.renderDefaultRule(defaultRuleGroup);
    }

    private renderPropertyClassRules(classRules: SettingGroup): void {
        const rules = this.plugin.settings.propertyClasses;
        const scopeLabel: Record<PropertyClassRule["scope"], string> = {
            both: "notes and File Properties panel",
            notes: "notes only",
            properties: "File Properties panel",
        };

        for (const rule of rules) {
            const name = rule.property
                ? `<code>${rule.property}</code> → <code>${rule.template.replace("{name}", rule.property) || "(no template)"}</code>`
                : `<code>(new rule)</code>`;
            const desc = `Apply to ${scopeLabel[rule.scope]}`;

            let handleEl: HTMLElement;
            classRules.addSetting((setting) => setting
                .setClass("sp-class-rule-card")
                .setName(sanitizeHTMLToDom(name))
                .setDesc(sanitizeHTMLToDom(desc))
                .addExtraButton(b => {
                    b.setIcon("grip-vertical").setTooltip("Drag to reorder");
                    b.extraSettingsEl.addClass("sp-drag-handle");
                    handleEl = b.extraSettingsEl;
                })
                .addExtraButton(bEdit => bEdit
                    .setIcon("pencil").setTooltip("Edit rule")
                    .onClick(() => {
                        new PropertyClassRuleModal(this.app, rule, async updated => {
                            const idx = rules.indexOf(rule);
                            rules[idx] = updated;
                            await this.plugin.saveSettings();
                            this.display();
                        }).open();
                    })
                )
                .addExtraButton(bDelete => bDelete
                    .setIcon("trash").setTooltip("Delete rule")
                    .then(b => b.extraSettingsEl.style.marginInlineEnd = "24px")
                    .onClick(() => {
                        new ConfirmModal(this.app, sanitizeHTMLToDom(`Are you sure you want to delete the following property class rule?<div class="sp-settings-delete-item"><div class="sp-setting-item-name">${name}</div><div class="setting-item-description">${desc}</div></div>`), async () => {
                            const idx = rules.indexOf(rule);
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
                .then(s => s.settingEl.insertBefore(handleEl, s.settingEl.querySelector(".setting-item-info")))
            );
        }

        if (rules.length > 0) {
            Sortable.create(classRules.listEl, {
                draggable: ".sp-class-rule-card",
                handle: ".sp-drag-handle",
                animation: 150,
                ghostClass: "sp-sortable-ghost",
                onEnd: ({ oldIndex, newIndex }) => {
                    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
                    const [moved] = rules.splice(oldIndex, 1);
                    rules.splice(newIndex, 0, moved);
                    this.plugin.saveSettings().then(() => this.display());
                },
            });
        }
    }

    private renderPropertyRules(containerEl: HTMLElement): void {
        const rules = this.plugin.settings.propertyRules;
        const group = new SettingGroup(containerEl).setHeading("Property rules");

        if (rules.length === 0) {
            group.addSetting(s => s.setDesc("No property rules configured."));
        } else {
            for (const rule of rules) {
                const cond = rule.condition;
                const name = cond
                    ? `<code>${cond.property}</code> ${cond.operator} <code>${cond.value}</code>`
                    : "All notes";
                const gc = rule.groups.length;
                const pc = rule.properties.length;
                const desc = `${gc} group${gc !== 1 ? 's' : ''} and ${pc} propert${pc !== 1 ? 'ies' : 'y'}`;
                let handleEl: HTMLElement;
                group.addSetting(s => s
                    .setClass("sp-rule-card")
                    .setName(sanitizeHTMLToDom(name))
                    .setDesc(sanitizeHTMLToDom(desc))
                    .addExtraButton(b => {
                        b.setIcon("grip-vertical").setTooltip("Drag to reorder");
                        b.extraSettingsEl.addClass("sp-drag-handle");
                        handleEl = b.extraSettingsEl;
                    })
                    .addExtraButton(b => b
                        .setIcon("pencil").setTooltip("Edit rule")
                        .onClick(() => {
                            const idx = rules.indexOf(rule);
                            new PropertyRuleModal(this.app, rule, this.plugin.settings.staticEnums, async updated => {
                                rules[idx] = updated;
                                await this.plugin.saveSettings();
                                this.display();
                            }).open();
                        })
                    )
                    .addExtraButton(b => b
                        .setIcon("trash").setTooltip("Delete rule")
                        .then(b => b.extraSettingsEl.style.marginInlineEnd = "24px")
                        .onClick(() => {
                            new ConfirmModal(this.app, sanitizeHTMLToDom(`Are you sure you want to delete the following property rule?<div class="sp-settings-delete-item"><div class="sp-setting-item-name">${name}</div><div class="setting-item-description">${desc}</div></div>`), async () => {
                                const idx = rules.indexOf(rule);
                                rules.splice(idx, 1);
                                await this.plugin.saveSettings();
                                this.display();
                            }).open();
                        })
                    )
                    .addToggle(t => t.setValue(rule.enabled).onChange(async v => {
                        rule.enabled = v;
                        await this.plugin.saveSettings();
                    }))
                    .then(s => s.settingEl.insertBefore(handleEl, s.settingEl.querySelector(".setting-item-info")))
                );
            }

            Sortable.create(group.listEl, {
                draggable: ".sp-rule-card",
                handle: ".sp-drag-handle",
                animation: 150,
                ghostClass: "sp-sortable-ghost",
                onEnd: ({ oldIndex, newIndex }) => {
                    if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
                    const [moved] = rules.splice(oldIndex, 1);
                    rules.splice(newIndex, 0, moved);
                    this.plugin.saveSettings().then(() => this.display());
                },
            });
        }

        group.addSetting(s => s
            .addButton(b => b.setButtonText("Add rule").onClick(async () => {
                this.plugin.settings.propertyRules.push({ enabled: true, groups: [], properties: [] });
                await this.plugin.saveSettings();
                this.display();
            }))
        );
    }

    private renderDefaultRule(group: SettingGroup): void {
        const gc = this.plugin.settings.defaultRule.groups.length;
        const pc = this.plugin.settings.defaultRule.properties.length;
        group.addSetting(s => s
            .setName("Default global rule")
            .setDesc(`${gc} group${gc !== 1 ? 's' : ''} and ${pc} propert${pc !== 1 ? 'ies' : 'y'}`)
            .addButton(b => b
                .setIcon("pencil")
                .setButtonText("Edit rule")
                .setTooltip("Edit rule")
                .onClick(() => {
                    new DefaultPropertyRuleModal(this.app, this.plugin.settings.defaultRule, this.plugin.settings.staticEnums, async updated => {
                        this.plugin.settings.defaultRule = updated;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                })
            )
        );
    }

    private addBanner(containerEl: HTMLElement) {
        const url = "https://github.com/somethingSTRANGE/strange-properties"; // this.plugin.manifest.authorUrl;
        const desc = `<div class="sp-settings-banner-meta">Version: ${this.plugin.manifest.version}</div>`
                     + `<div class="sp-settings-banner-meta">By ${this.plugin.manifest.author}</div>`
                     + `<div class="sp-settings-banner-meta">Repository: <a target="_blank" rel="noopener" href="${url}">${url}</a></div>`
                     + `<div class="sp-settings-banner-desc">${this.plugin.manifest.description}</div>`;

        const rawFunding = this.plugin.fundingUrl;

        const fundingLinks: { label: string; url: string }[] =
            !rawFunding ? [] :
                typeof rawFunding === 'string' ? [{
                        label: `Donate to support ${this.plugin.manifest.name}`,
                        url: rawFunding
                    }] :
                    Object.entries(rawFunding).map(([label, url]) => ({ label, url }));

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
