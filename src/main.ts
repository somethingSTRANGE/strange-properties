import { MarkdownView, normalizePath, Plugin, setIcon, setTooltip, TFile, WorkspaceLeaf } from "obsidian";
import {
    DEFAULT_SETTINGS,
    PropertyClassRule,
    PropertyEntry,
    PropertyGroup,
    PropertyRule,
    StrangePropertiesSettings,
    StrangePropertiesSettingTab,
} from "./settings";

declare const __BUILD_TIME__: string;

const CLASS_ATTR = "data-property-classes";
const CLASS_BLACKLIST = new Set(["view-content"]);

interface ResolvedEnumEntry {
    storedValue: string | number;
    displayLabel: string;
}

export default class StrangePropertiesPlugin extends Plugin {
    settings: StrangePropertiesSettings;
    fundingUrl: string | Record<string, string> | undefined;
    private enumCache = new Map<string, ResolvedEnumEntry[]>();
    private observers = new Map<WorkspaceLeaf, MutationObserver>();
    private enumClickHandlers = new Map<HTMLElement, (e: MouseEvent) => void>();
    private checkboxChangeHandlers = new Map<HTMLElement, (e: Event) => void>();
    // Keyed by contentEl → property key → { value, time }. After a checkbox click,
    // Obsidian calls synchronize() which rebuilds the element from the stale metadataCache.
    // This map lets injectPropertyValues use the user's actual click value (not the stale
    // DOM) for a grace period (~1500ms) until the cache catches up.
    private recentCheckboxValues = new Map<HTMLElement, Map<string, { value: boolean; time: number }>>();
    private enumSelect: HTMLSelectElement | null = null;
    private enumPickerCleanup: (() => void) | null = null;
    private sectionStyleEl: HTMLStyleElement | null = null;

    // Timestamp logging for diagnosing the 16 input/data-attr transitions across both views.
    // Set DEBUG = true temporarily; leave false in production.
    // Set DEBUG_CHECKBOX_ONLY = true to suppress non-checkbox IPV lines (reduces noise).
    private static readonly DEBUG = false;
    private static readonly DEBUG_CHECKBOX_ONLY = true;
    private dbg(msg: string, ...args: unknown[]) {
        if (StrangePropertiesPlugin.DEBUG)
            console.log(`[SP ${(Date.now() % 100_000).toString().padStart(5, '0')}ms]`, msg, ...args);
    }

    async onload() {
        console.log(`Strange Properties loaded — build ${__BUILD_TIME__}`);
        await this.loadSettings();
        await this.loadFundingUrl();
        this.buildEnumCache();
        this.addSettingTab(new StrangePropertiesSettingTab(this.app, this));
        this.updateSectionStylesheet();

        this.app.workspace.onLayoutReady(() => {
            this.updateAllLeaves();
            this.setupObservers();
        });

        // Shared invisible select used to open OS-native pickers for enum properties.
        const sel = document.createElement('select');
        sel.setAttribute('tabindex', '-1');
        sel.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:0;left:0;width:0;height:0;';
        document.body.appendChild(sel);
        this.enumSelect = sel;

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => {
                this.updateAllLeaves();
                this.setupObservers();
            })
        );

        this.registerEvent(
            this.app.workspace.on("file-open", () => {
                this.updateAllLeaves();
            })
        );

        this.registerEvent(
            this.app.metadataCache.on("changed", (file) => {
                this.dbg("metadataCache.changed", file.path);
                this.updateLeavesForFile(file);
            })
        );

        this.registerEvent(
            this.app.metadataCache.on("resolved", () => {
                this.updateAllLeaves();
            })
        );
    }

    onunload() {
        this.enumPickerCleanup?.();
        this.enumSelect?.remove();
        this.enumSelect = null;
        this.teardownObservers();
        this.app.workspace.iterateAllLeaves((leaf) => this.clearLeaf(leaf));
        this.sectionStyleEl?.remove();
        this.sectionStyleEl = null;
    }

    // ─── Settings ─────────────────────────────────────────────────────────────

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.buildEnumCache();
        this.updateSectionStylesheet();
        this.updateAllLeaves();
    }

    private async loadFundingUrl() {
        try {
            const raw = await this.app.vault.adapter.read(
                normalizePath(`${this.manifest.dir}/manifest.json`)
            );
            this.fundingUrl = JSON.parse(raw).fundingUrl;
        } catch {
        }
    }

    private findPropertyEntry(property: string): PropertyEntry | undefined {
        for (const rule of this.settings.propertyRules) {
            const entry = rule.properties.find(p => p.property === property);
            if (entry) return entry;
        }
        return this.settings.defaultRule.properties.find(p => p.property === property);
    }

    private buildEnumCache() {
        this.enumCache.clear();
        const seen = new Set<string>();
        const allRules: Array<{ properties: PropertyEntry[] }> = [
            ...this.settings.propertyRules,
            this.settings.defaultRule,
        ];
        for (const rule of allRules) {
            for (const entry of rule.properties) {
                if (seen.has(entry.property) || !entry.enum) continue;
                seen.add(entry.property);
                const def = this.settings.staticEnums.find(e => e.id === entry.enum!.id);
                if (!def) continue;
                const entries: ResolvedEnumEntry[] = [];
                for (const e of def.entries) {
                    if (entry.enum!.storeAs === 'text' && e.enum_text !== undefined) {
                        entries.push({
                            storedValue: e.enum_text,
                            displayLabel: e.enum_label ?? e.enum_text,
                        });
                    } else if (entry.enum!.storeAs === 'number' && e.enum_number !== undefined) {
                        entries.push({
                            storedValue: e.enum_number,
                            displayLabel: e.enum_label ?? String(e.enum_number),
                        });
                    }
                }
                if (entries.length > 0) this.enumCache.set(entry.property, entries);
            }
        }
    }

    private generateSectionStyles(): string {
        const lines: string[] = [];
        const seen = new Set<string>();
        const allRules: Array<{ groups: PropertyGroup[] }> = [
            ...this.settings.propertyRules,
            this.settings.defaultRule,
        ];
        for (const rule of allRules) {
            for (const group of rule.groups) {
                if (seen.has(group.id)) continue;
                seen.add(group.id);
                lines.push(
                    `.metadata-container.sp-hide-empty .sp-sec-${group.id}:not(:has(~ .sp-sec-${group.id}-prop:not(.sp-empty))) { display: none; }`
                );
            }
        }
        return lines.join("\n");
    }

    private updateSectionStylesheet() {
        if (!this.sectionStyleEl) {
            this.sectionStyleEl = document.createElement("style");
            this.sectionStyleEl.id = "sp-section-styles";
            document.head.appendChild(this.sectionStyleEl);
        }
        this.sectionStyleEl.textContent = this.generateSectionStyles();
    }

    // ─── Leaf helpers ─────────────────────────────────────────────────────────

    private getLeafType(leaf: WorkspaceLeaf): "notes" | "properties" | null {
        if (leaf.view instanceof MarkdownView) return "notes";
        if (leaf.view.getViewType() === "file-properties") return "properties";
        return null;
    }

    private getFileForLeaf(leaf: WorkspaceLeaf): TFile | null {
        if (leaf.view instanceof MarkdownView) return leaf.view.file;
        if (leaf.view.getViewType() === "file-properties") {
            return this.app.workspace.getActiveFile();
        }
        return null;
    }

    private getContentEl(leaf: WorkspaceLeaf): HTMLElement | null {
        return (leaf.view as unknown as { contentEl?: HTMLElement }).contentEl ?? null;
    }

    // ─── Update loop ──────────────────────────────────────────────────────────

    private applyLeafUpdates(
        contentEl: HTMLElement,
        frontmatter: Record<string, unknown>,
        leafType: "notes" | "properties"
    ) {
        if (this.settings.injectPropertyValues) {
            this.injectPropertyValues(contentEl, frontmatter, leafType);
            this.setupCheckboxHandler(contentEl);
        }
        this.applyClasses(contentEl, this.resolveClasses(frontmatter, leafType));
        this.injectSectionHeaders(contentEl, frontmatter);
        this.injectEnumDropdowns(contentEl, frontmatter);
        this.markEmptyProperties(contentEl, frontmatter);
        this.updateHideEmptyContainer(contentEl);
        this.injectHideEmptyButton(contentEl);
    }

    private updateLeaf(leaf: WorkspaceLeaf) {
        const leafType = this.getLeafType(leaf);
        if (!leafType) return;

        const contentEl = this.getContentEl(leaf);
        if (!contentEl) return;

        // Synchronous clear when there is no file to show.
        if (!this.getFileForLeaf(leaf)) {
            this.clearLeaf(leaf);
            return;
        }

        // Read file and frontmatter inside the RAF so we always get the freshest
        // metadataCache state at execution time, not at queue time. Obsidian may
        // re-render the property panel before updating the cache (triggering our
        // observer), so the cache can still be stale when updateLeaf is called.
        activeWindow.requestAnimationFrame(() => {
            const file = this.getFileForLeaf(leaf);
            if (!file) {
                this.clearLeaf(leaf);
                return;
            }
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
            this.applyLeafUpdates(contentEl, frontmatter, leafType);
        });
    }

    private updateAllLeaves() {
        this.app.workspace.iterateAllLeaves((leaf) => this.updateLeaf(leaf));
    }

    private updateLeavesForFile(file: TFile) {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (this.getFileForLeaf(leaf)?.path === file.path) this.updateLeaf(leaf);
        });
    }

    // ─── MutationObserver (file-properties timing) ────────────────────────────

    private setupObservers() {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (!this.getLeafType(leaf)) return;
            if (this.observers.has(leaf)) return;

            const contentEl = this.getContentEl(leaf);
            if (!contentEl) return;

            const observer = new MutationObserver((mutations) => {
                // For MarkdownView: skip mutations outside .metadata-container so
                // CodeMirror editor changes don't trigger re-injection on every keystroke.
                if (leaf.view instanceof MarkdownView) {
                    const inMetadata = mutations.some(m =>
                        m.target instanceof HTMLElement &&
                        m.target.closest('.metadata-container') !== null
                    );
                    if (!inMetadata) return;
                }

                // Ignore mutations caused entirely by our own injected elements.
                const isOwnMutation = (() => {
                    // If our wrapper was ADDED in this batch, every mutation is ours —
                    // the wrapper creation always accompanies .metadata-add-button being
                    // moved, which would otherwise fail the per-node check below.
                    // We only check addedNodes: Obsidian removing our wrapper during a
                    // panel re-render must NOT be treated as own, or we'd skip re-injection.
                    const wrapperWasAdded = mutations.some((m) =>
                        [...m.addedNodes].some(
                            (n) =>
                                n instanceof HTMLElement &&
                                n.hasAttribute("data-sp-hide-empty-wrapper")
                        )
                    );
                    if (wrapperWasAdded) return true;

                    // Section headers: treat as own only when we ADDED headers in this
                    // batch. A batch of pure removals means Obsidian cleaned up our
                    // elements — we must re-inject. Same reasoning as wrapperWasAdded:
                    // only addedNodes, never removedNodes.
                    const headerWasAdded = mutations.some((m) =>
                        [...m.addedNodes].some(
                            (n) =>
                                n instanceof HTMLElement && n.hasAttribute("data-sp-section")
                        )
                    );
                    if (headerWasAdded) {
                        return mutations.every(
                            (m) =>
                                (m.target instanceof HTMLElement &&
                                 m.target.closest("[data-sp-hide-empty-wrapper]") !== null) ||
                                [...m.addedNodes, ...m.removedNodes].every(
                                    (n) =>
                                        n instanceof HTMLElement && n.hasAttribute("data-sp-section")
                                )
                        );
                    }

                    // No wrapper addition, no header addition: own only if all mutations
                    // are internal to our wrapper (button re-renders, attribute tweaks).
                    return mutations.every(
                        (m) =>
                            m.target instanceof HTMLElement &&
                            m.target.closest("[data-sp-hide-empty-wrapper]") !== null
                    );
                })();
                if (isOwnMutation) return;

                // Obsidian's metadataEditor.synchronize() has just finished updating
                // the panel DOM (that's what triggered this observer). Apply our
                // updates synchronously — no RAF — so there's no paint gap between
                // Obsidian's render and our injected headers/classes.
                const file = this.getFileForLeaf(leaf);
                const observerContentEl = this.getContentEl(leaf);
                const leafType = this.getLeafType(leaf);
                if (file && observerContentEl && leafType) {
                    this.dbg("observer fired", leafType, file.path);
                    const frontmatter =
                        this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
                    this.applyLeafUpdates(observerContentEl, frontmatter, leafType);
                }
            });
            observer.observe(contentEl, { childList: true, subtree: true });
            this.observers.set(leaf, observer);
        });
    }

    private teardownObservers() {
        for (const observer of this.observers.values()) observer.disconnect();
        this.observers.clear();
    }

    // ─── Class injection ──────────────────────────────────────────────────────

    private resolveClasses(
        frontmatter: Record<string, unknown>,
        leafType: "notes" | "properties"
    ): Set<string> {
        const classes = new Set<string>();

        for (const rule of this.settings.propertyClasses) {
            if (!rule.enabled) continue;
            if (rule.scope !== "both" && rule.scope !== leafType) continue;

            const raw = frontmatter[rule.property];
            const values = Array.isArray(raw) ? raw : [raw];

            for (const val of values) {
                if (val === null || val === undefined || val === "") continue;
                const cls = this.buildClassName(rule, String(val));
                if (cls) classes.add(cls);
            }
        }

        return classes;
    }

    private buildClassName(rule: PropertyClassRule, value: string): string {
        let cls = rule.template
            .replace("{name}", rule.property)
            .replace("{value}", value);
        cls = cls.replace(/[^a-zA-Z0-9_-]/g, "-");
        return cls;
    }

    private applyClasses(el: HTMLElement, newClasses: Set<string>) {
        const prev = new Set(
            (el.getAttribute(CLASS_ATTR) ?? "").split(" ").filter(Boolean)
        );

        for (const cls of prev) {
            if (!newClasses.has(cls) && !CLASS_BLACKLIST.has(cls))
                el.classList.remove(cls);
        }
        for (const cls of newClasses) el.classList.add(cls);

        if (newClasses.size > 0) {
            el.setAttribute(CLASS_ATTR, [...newClasses].join(" "));
        } else {
            el.removeAttribute(CLASS_ATTR);
        }
    }

    private clearClasses(el: HTMLElement) {
        const tracked = (el.getAttribute(CLASS_ATTR) ?? "")
            .split(" ")
            .filter(Boolean);
        for (const cls of tracked) {
            if (!CLASS_BLACKLIST.has(cls)) el.classList.remove(cls);
        }
        el.removeAttribute(CLASS_ATTR);
    }

    // ─── data-property-value injection ───────────────────────────────────────

    private static readonly CHECKBOX_GRACE_MS = 2000;

    private injectPropertyValues(
        contentEl: HTMLElement,
        frontmatter: Record<string, unknown>,
        leafType: "notes" | "properties"
    ) {
        const els = contentEl.querySelectorAll<HTMLElement>(
            ".metadata-property[data-property-key]"
        );
        const recentForEl = this.recentCheckboxValues.get(contentEl);
        for (const el of els) {
            const key = el.getAttribute("data-property-key")!;

            // After a checkbox click, Obsidian calls synchronize() which rebuilds the
            // element from the stale metadataCache. Use the value from our change handler
            // (stored in recentCheckboxValues) for a grace period so the observer doesn't
            // overwrite with the stale DOM value before the cache catches up.
            const recentCb = recentForEl?.get(key);
            let normalized: string | null;
            if (recentCb && Date.now() - recentCb.time < StrangePropertiesPlugin.CHECKBOX_GRACE_MS) {
                normalized = this.normalizePropertyValue(recentCb.value);
            } else {
                // Prefer DOM read: Obsidian synchronizes the panel DOM before updating
                // the metadataCache, so the DOM has the committed value sooner. Fall
                // back to cache for complex types (tags, multitext) where DOM structure
                // doesn't map cleanly to a single value.
                normalized =
                    this.readDOMPropertyValue(el) ??
                    this.normalizePropertyValue(frontmatter[key]);
            }

            if (StrangePropertiesPlugin.DEBUG) {
                const isCheckbox = !!el.querySelector('input[type="checkbox"]');
                if (!StrangePropertiesPlugin.DEBUG_CHECKBOX_ONLY || isCheckbox)
                    this.dbg(`IPV [${leafType}]: set`, key, "→", normalized);
            }

            if (normalized !== null) {
                el.setAttribute("data-property-value", normalized);
            } else {
                el.removeAttribute("data-property-value");
            }
        }
    }

    private readDOMPropertyValue(propEl: HTMLElement): string | null | undefined {
        // Returns undefined  → caller should fall back to metadataCache
        // Returns null       → value is empty; remove the attribute
        // Returns string     → use this normalized value

        // Contenteditable (text, number-as-text, internal link, etc.)
        const ce = propEl.querySelector<HTMLElement>(
            '.metadata-input-longtext[contenteditable="true"]'
        );
        if (ce) {
            if (ce === document.activeElement || ce.contains(document.activeElement))
                return undefined; // mid-edit — don't read draft
            return this.normalizePropertyValue(ce.textContent?.trim() || null);
        }

        // Single native input (number, date, datetime, checkbox, etc.)
        const input = propEl.querySelector<HTMLInputElement>(
            'input:not(.metadata-property-key-input)'
        );
        if (input) {
            if (input === document.activeElement) return undefined; // mid-edit
            if (input.type === 'checkbox') {
                // Obsidian replaces the checkbox <input> element on toggle, which fires
                // a childList mutation and lets us read the new checked state promptly.
                // Cross-panel propagation (e.g. FileProps → Note) is still gated on the
                // metadataCache round-trip (~1-2s) — that latency is Obsidian's own.
                return this.normalizePropertyValue(input.checked);
            }
            // number inputs: Obsidian does not replace the <input type="number"> element
            // on value changes — it updates the value property in place, which does NOT
            // fire a childList mutation. So non-enum number edits wait for the metadataCache
            // round-trip (~1-2s). Enum selections are handled with a direct attribute write
            // in the onChange handler, bypassing this path.
            return this.normalizePropertyValue(input.value || null);
        }

        // tags, multitext, aliases: pill-based structure has no single value node to read.
        // data-property-value for these types always updates on the metadataCache round-trip
        // (~1-2s). Known limitation — improving this would require parsing the pill DOM or
        // hooking Obsidian's internal list-editing events.
        return undefined;
    }

    private clearPropertyValues(contentEl: HTMLElement) {
        const els = contentEl.querySelectorAll<HTMLElement>(
            ".metadata-property[data-property-value]"
        );
        for (const el of els) el.removeAttribute("data-property-value");
    }

    // ─── Section headers ─────────────────────────────────────────────────────

    private injectSectionHeaders(
        contentEl: HTMLElement,
        frontmatter: Record<string, unknown>
    ) {
        const propertiesEl = contentEl.querySelector(".metadata-properties");
        if (!propertiesEl) {
            this.clearSectionHeaders(contentEl);
            return;
        }

        const propertyEls = propertiesEl.querySelectorAll<HTMLElement>(
            ".metadata-property[data-property-key]"
        );

        // Build property→group map. Walk propertyRules (first enabled+matching rule wins),
        // then defaultRule as the fallback. Group IDs are stable strings, not positional ints.
        const propertyToGroup = new Map<string, { id: string; title: string }>();
        const claimedKeys = new Set<string>();

        type RuleCandidate = { enabled: boolean; condition?: PropertyRule["condition"]; groups: PropertyGroup[]; properties: PropertyEntry[] };
        const rulesToCheck: RuleCandidate[] = [
            ...this.settings.propertyRules,
            { enabled: true, groups: this.settings.defaultRule.groups, properties: this.settings.defaultRule.properties },
        ];

        for (const rule of rulesToCheck) {
            if (!rule.enabled) continue;
            if (rule.condition && !this.propertyRuleMatches(rule.condition, frontmatter)) continue;
            const groupMap = new Map(rule.groups.map(g => [g.id, g.title]));
            for (const entry of rule.properties) {
                if (claimedKeys.has(entry.property) || !entry.group) continue;
                const title = groupMap.get(entry.group);
                if (title === undefined) continue;
                claimedKeys.add(entry.property);
                propertyToGroup.set(entry.property, { id: entry.group, title });
            }
        }

        // Compute which headers would be injected in DOM order.
        const expectedHeaders: Array<{ id: string; title: string }> = [];
        let lastId: string | null = null;
        for (const el of propertyEls) {
            const grp = propertyToGroup.get(el.getAttribute("data-property-key")!) ?? null;
            if (grp && grp.id !== lastId) expectedHeaders.push({ id: grp.id, title: grp.title });
            lastId = grp ? grp.id : null;
        }

        // Skip clear+reinject if the DOM already has the right headers in order.
        // This prevents a visible flash when frontmatter changes don't affect groups.
        const existingHeaders = [...propertiesEl.querySelectorAll<HTMLElement>("[data-sp-section]")];
        const alreadyCurrent =
            expectedHeaders.length === existingHeaders.length &&
            expectedHeaders.every((h, i) =>
                existingHeaders[i].textContent === h.title &&
                existingHeaders[i].classList.contains(`sp-sec-${h.id}`)
            );
        if (alreadyCurrent) return;

        this.clearSectionHeaders(contentEl);
        if (expectedHeaders.length === 0) return;

        // Walk properties in DOM order: inject a header at each group start and
        // mark every member property with its group class for hide-empty CSS.
        lastId = null;
        for (const el of propertiesEl.querySelectorAll<HTMLElement>(
            ".metadata-property[data-property-key]"
        )) {
            const grp = propertyToGroup.get(el.getAttribute("data-property-key")!) ?? null;
            if (grp) {
                el.classList.add(`sp-sec-${grp.id}-prop`);
                if (grp.id !== lastId) {
                    propertiesEl.insertBefore(this.createSectionHeaderEl(grp.title, grp.id), el);
                }
            }
            lastId = grp ? grp.id : null;
        }
    }

    private propertyRuleMatches(
        condition: NonNullable<PropertyRule["condition"]>,
        frontmatter: Record<string, unknown>
    ): boolean {
        const { property, operator, value } = condition;
        const raw = frontmatter[property];

        if (operator === "exists") return raw !== undefined && raw !== null;

        const values = Array.isArray(raw) ? raw : [raw];
        return values.some((v) => {
            const str = String(v ?? "");
            if (operator === "contains") return str.includes(value);
            if (operator === "starts-with") return str.startsWith(value);
            return str === value;
        });
    }

    private createSectionHeaderEl(title: string, groupId: string): HTMLElement {
        const el = createEl("div", { cls: `sp-section-header sp-sec-${groupId}` });
        el.setAttribute("data-sp-section", "");
        el.textContent = title;
        return el;
    }

    private clearSectionHeaders(contentEl: HTMLElement) {
        contentEl.querySelectorAll("[data-sp-section]").forEach((el) => el.remove());
        for (const el of contentEl.querySelectorAll<HTMLElement>(".metadata-property[data-property-key]")) {
            for (const cls of [...el.classList]) {
                if (/^sp-sec-.+-prop$/.test(cls)) el.classList.remove(cls);
            }
        }
    }

    // ─── Hide empty properties ────────────────────────────────────────────────

    private isEmptyValue(val: unknown): boolean {
        if (val === null || val === undefined) return true;
        if (typeof val === "boolean") return false;
        if (typeof val === "number") return false;
        if (typeof val === "string") return val.trim() === "";
        if (Array.isArray(val))
            return val.length === 0 || val.every((v) => v === null || v === undefined || v === "");
        return false;
    }

    private markEmptyProperties(
        contentEl: HTMLElement,
        frontmatter: Record<string, unknown>
    ) {
        const els = contentEl.querySelectorAll<HTMLElement>(
            ".metadata-property[data-property-key]"
        );
        for (const el of els) {
            const key = el.getAttribute("data-property-key")!;
            el.classList.toggle("sp-empty", this.isEmptyValue(frontmatter[key]));
        }
    }

    private clearEmptyMarks(contentEl: HTMLElement) {
        contentEl
            .querySelectorAll<HTMLElement>(".metadata-property.sp-empty")
            .forEach((el) => el.classList.remove("sp-empty"));
    }

    private updateHideEmptyContainer(contentEl: HTMLElement) {
        const containerEl =
            contentEl.querySelector<HTMLElement>(".metadata-container") ?? contentEl;
        const shouldHide = this.settings.hideEmptyEnabled && this.settings.hideEmptyActive;
        const wasHidden = containerEl.classList.contains("sp-hide-empty");
        containerEl.classList.toggle("sp-hide-empty", shouldHide);
        // Force a synchronous layout flush so Electron paints the change immediately.
        void containerEl.offsetWidth;
        // On the visible→hidden transition, scroll the footer into view after the
        // layout settles. This also triggers CodeMirror to recalculate scroll height,
        // fixing the stale scrollbar position.
        if (shouldHide && !wasHidden) {
            activeWindow.requestAnimationFrame(() => {
                contentEl
                    .querySelector<HTMLElement>("[data-sp-hide-empty-wrapper]")
                    ?.scrollIntoView({ block: "nearest" });
            });
        }
    }

    private injectHideEmptyButton(contentEl: HTMLElement) {
        if (!this.settings.hideEmptyEnabled) {
            this.clearHideEmptyButton(contentEl);
            return;
        }

        // Wrapper already present — just refresh the button appearance.
        const existingWrapper = contentEl.querySelector<HTMLElement>(
            "[data-sp-hide-empty-wrapper]"
        );
        if (existingWrapper) {
            const btn = existingWrapper.querySelector<HTMLElement>(".sp-hide-empty-btn");
            if (btn) this.renderHideEmptyButton(btn);
            return;
        }

        const addButton = contentEl.querySelector<HTMLElement>(".metadata-add-button");
        if (!addButton) return;

        const wrapper = createEl("div", { cls: "sp-property-footer" });
        wrapper.setAttribute("data-sp-hide-empty-wrapper", "");

        addButton.parentElement!.insertBefore(wrapper, addButton);
        wrapper.appendChild(addButton);

        const btn = createEl("div", {
            cls: "metadata-add-button text-icon-button sp-hide-empty-btn",
        });
        btn.setAttribute("tabindex", "0");
        btn.addEventListener("click", () => {
            this.settings.hideEmptyActive = !this.settings.hideEmptyActive;
            this.saveSettings();
        });
        wrapper.appendChild(btn);
        // Append btn before rendering so btn.closest("[data-sp-hide-empty-wrapper]")
        // resolves correctly when renderHideEmptyButton searches for the add button.
        this.renderHideEmptyButton(btn);
    }

    private renderHideEmptyButton(btn: HTMLElement) {
        btn.empty();
        const active = this.settings.hideEmptyActive;
        const iconSpan = createEl("span", { cls: "text-button-icon" });
        setIcon(iconSpan, active ? "eye-off" : "eye");
        btn.appendChild(iconSpan);
        setTooltip(btn, active ? "Show empty properties" : "Hide empty properties");

        // Disable the native "Add property" button while empty properties are
        // hidden — a newly created property would be empty and immediately vanish.
        const wrapper = btn.closest<HTMLElement>("[data-sp-hide-empty-wrapper]");
        const addBtn = wrapper?.querySelector<HTMLElement>(
            ".metadata-add-button:not(.sp-hide-empty-btn)"
        );
        if (addBtn) {
            addBtn.toggleClass("sp-add-disabled", active);
            addBtn.setAttribute("aria-disabled", String(active));
        }
    }

    private clearHideEmptyButton(contentEl: HTMLElement) {
        const wrapper = contentEl.querySelector<HTMLElement>(
            "[data-sp-hide-empty-wrapper]"
        );
        if (!wrapper) return;
        const addButton = wrapper.querySelector<HTMLElement>(
            ".metadata-add-button:not(.sp-hide-empty-btn)"
        );
        if (addButton) {
            addButton.removeClass("sp-add-disabled");
            addButton.removeAttribute("aria-disabled");
            wrapper.parentElement?.insertBefore(addButton, wrapper);
        }
        wrapper.remove();
    }

    // ─── Enum dropdowns ──────────────────────────────────────────────────────

    // ─── Enum dropdowns ──────────────────────────────────────────────────────

    private injectEnumDropdowns(contentEl: HTMLElement, frontmatter: Record<string, unknown>) {
        if (this.enumCache.size === 0) return;

        // One delegated mousedown listener per contentEl, registered once.
        if (!this.enumClickHandlers.has(contentEl)) {
            const handler = (e: MouseEvent) => {
                const target = e.target as Element;
                if (!target.closest('.metadata-property-value')) return;
                const propEl = target.closest<HTMLElement>(
                    '.metadata-property[data-sp-enum][data-property-key]'
                );
                if (!propEl) return;

                // Only intercept clicks in the right chevron zone — left zone edits natively.
                const valueEl = propEl.querySelector<HTMLElement>('.metadata-property-value');
                if (!valueEl) return;
                const rect = valueEl.getBoundingClientRect();
                if (e.clientX < rect.right - 28) return;

                const leaf = [...this.observers.keys()].find(
                    l => this.getContentEl(l) === contentEl
                ) ?? null;
                if (!leaf) return;
                const file = this.getFileForLeaf(leaf);
                if (!file) return;

                const key = propEl.dataset.propertyKey!;
                const entries = this.enumCache.get(key);
                const propEntry = this.findPropertyEntry(key);
                if (!entries || !propEntry?.enum) return;

                // Blur active element to dismiss any autocomplete popup before opening picker.
                (document.activeElement as HTMLElement)?.blur();
                e.preventDefault();
                e.stopPropagation();
                this.openEnumPicker(valueEl, key, entries, propEntry.enum.storeAs, file);
            };
            contentEl.addEventListener('mousedown', handler, true);
            this.enumClickHandlers.set(contentEl, handler);
        }

        for (const propEl of contentEl.querySelectorAll<HTMLElement>(
            '.metadata-property[data-property-key]'
        )) {
            const key = propEl.dataset.propertyKey!;
            if (!this.enumCache.has(key)) continue;

            const currentRaw = frontmatter[key];
            const currentValue = currentRaw != null ? String(currentRaw) : '';
            const entries = this.enumCache.get(key)!;
            const matched = entries.find(e => String(e.storedValue) === currentValue);

            propEl.setAttribute('data-sp-enum', '');
            if (!matched && currentValue) {
                propEl.setAttribute('data-sp-enum-stale', '');
            } else {
                propEl.removeAttribute('data-sp-enum-stale');
            }
        }
    }

    private openEnumPicker(
        triggerEl: HTMLElement,
        key: string,
        entries: ResolvedEnumEntry[],
        storeAs: 'text' | 'number',
        file: TFile
    ) {
        const sel = this.enumSelect;
        if (!sel) return;

        // blur may not fire reliably on a showPicker()-driven select with tabindex="-1",
        // so handlers can accumulate. Always discard the previous session explicitly.
        this.enumPickerCleanup?.();

        const rect = triggerEl.getBoundingClientRect();
        const currentRaw = this.app.metadataCache.getFileCache(file)?.frontmatter?.[key];
        const currentValue = currentRaw != null ? String(currentRaw) : '';

        // Populate and position the shared select over the trigger element.
        sel.innerHTML = '';
        for (const entry of entries) {
            const opt = document.createElement('option');
            opt.value = String(entry.storedValue);
            opt.textContent = entry.displayLabel;
            sel.appendChild(opt);
        }
        sel.value = currentValue;
        sel.style.cssText =
            `position:fixed;opacity:0;pointer-events:none;` +
            `top:${rect.top}px;left:${rect.left}px;` +
            `width:${rect.width}px;height:${rect.height}px;`;

        const cleanup = () => {
            sel.removeEventListener('change', onChange);
            sel.removeEventListener('blur', onBlur);
            this.enumPickerCleanup = null;
        };
        const onChange = async () => {
            cleanup();
            const val = storeAs === 'number' ? Number(sel.value) : sel.value;
            const strVal = String(val);
            const escapedKey = CSS.escape(key);
            this.dbg("enum onChange", key, "→", strVal, `(storeAs:${storeAs})`);

            // Update only MarkdownView (notes) leaves: set textContent so Obsidian's
            // blur handler reads the new value, then fire synthetic blur. Obsidian's
            // blur → ctx.onChange updates Note's in-memory model and propagates to
            // File Properties via Obsidian's native cross-panel sync — fast, no file
            // round-trip. We deliberately do not touch File Properties' native input:
            // setting textContent there triggers Obsidian to re-synchronise it from
            // the stale metadataCache, causing a visible value flicker.
            for (const leaf of this.observers.keys()) {
                if (this.getFileForLeaf(leaf)?.path !== file.path) continue;
                if (this.getLeafType(leaf) !== 'notes') continue;
                const leafContentEl = this.getContentEl(leaf);
                if (!leafContentEl) continue;
                const leafPropEl = leafContentEl.querySelector<HTMLElement>(
                    `.metadata-property[data-property-key="${escapedKey}"]`
                );
                const nativeInput =
                    leafPropEl?.querySelector<HTMLElement>('.metadata-input-longtext[contenteditable="true"]')
                    ?? leafPropEl?.querySelector<HTMLElement>('input:not(.metadata-property-key-input)');
                if (!nativeInput) {
                    this.dbg("enum onChange: notes input NOT FOUND for", key, "— visual update skipped");
                    continue;
                }
                if (nativeInput.isContentEditable) {
                    this.dbg("enum onChange: notes input contenteditable, setting textContent");
                    nativeInput.textContent = strVal;
                    nativeInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
                } else {
                    this.dbg("enum onChange: notes input type=" + (nativeInput as HTMLInputElement).type + ", setting value");
                    (nativeInput as HTMLInputElement).value = strVal;
                    nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                break; // first notes leaf is sufficient; cross-panel sync handles the rest
            }

            // Immediately stamp data-property-value on every leaf for this file.
            // Text enum: the contenteditable textContent= above fires a childList mutation
            // so the observer will update the attribute anyway — this is a harmless second
            // write. Number enum: input.value= does NOT fire a childList mutation, so the
            // observer never sees the change until the metadataCache round-trip (~1-2s);
            // this write is the only fast path for number-typed properties.
            // File Properties leaves are covered here too, since we never touch their input.
            const normalizedVal = this.normalizePropertyValue(val);
            for (const leaf of this.observers.keys()) {
                if (this.getFileForLeaf(leaf)?.path !== file.path) continue;
                const leafContentEl = this.getContentEl(leaf);
                if (!leafContentEl) continue;
                const leafPropEl = leafContentEl.querySelector<HTMLElement>(
                    `.metadata-property[data-property-key="${escapedKey}"]`
                );
                if (!leafPropEl) continue;
                this.dbg("enum onChange: direct data-property-value write", this.getLeafType(leaf), key, "→", normalizedVal);
                if (normalizedVal !== null) {
                    leafPropEl.setAttribute('data-property-value', normalizedVal);
                } else {
                    leafPropEl.removeAttribute('data-property-value');
                }
            }

            this.dbg("enum onChange: calling processFrontMatter", key, "→", val);
            await this.app.fileManager.processFrontMatter(file, fm => { fm[key] = val; });
            this.dbg("enum onChange: processFrontMatter complete", key);
        };
        const onBlur = () => cleanup();

        sel.addEventListener('change', onChange);
        sel.addEventListener('blur', onBlur);
        this.enumPickerCleanup = cleanup;

        (sel as any).showPicker();
    }

    private clearEnumDropdowns(contentEl: HTMLElement) {
        const handler = this.enumClickHandlers.get(contentEl);
        if (handler) {
            contentEl.removeEventListener('mousedown', handler, true);
            this.enumClickHandlers.delete(contentEl);
        }
        for (const el of contentEl.querySelectorAll<HTMLElement>('[data-sp-enum]')) {
            el.removeAttribute('data-sp-enum');
            el.removeAttribute('data-sp-enum-stale');
        }
    }

    // ─── Checkbox data-property-value handler ────────────────────────────────

    // Checkbox clicks toggle input.checked in place — no element replacement, so
    // no childList mutation and the observer never fires. A delegated change listener
    // gives us the new checked state synchronously, before the file write.
    //
    // The value is stored in recentCheckboxValues keyed by contentEl + property key.
    // injectPropertyValues reads from this store (not the DOM) for ~1500ms after a click,
    // because Obsidian's synchronize() rebuilds the element from the stale metadataCache
    // within that window, which would otherwise overwrite our correct value with stale data.
    private setupCheckboxHandler(contentEl: HTMLElement) {
        if (this.checkboxChangeHandlers.has(contentEl)) return;
        const handler = (e: Event) => {
            if (!this.settings.injectPropertyValues) return;
            const target = e.target as HTMLElement;
            if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
            const propEl = target.closest<HTMLElement>('.metadata-property[data-property-key]');
            if (!propEl) return;
            const key = propEl.dataset.propertyKey!;
            const value = target.checked;
            // Store the authoritative click value for ALL leaves showing the same file,
            // not just the one that was clicked. The active-leaf-change RAF fires ~1 frame
            // after any click and calls injectPropertyValues on all leaves. Without this,
            // the sister leaf reads a stale DOM value during that first RAF pass.
            const clickedLeaf = [...this.observers.keys()]
                .find(l => this.getContentEl(l) === contentEl) ?? null;
            const clickedFile = clickedLeaf ? this.getFileForLeaf(clickedLeaf) : null;
            const now = Date.now();
            for (const leaf of this.observers.keys()) {
                if (clickedFile && this.getFileForLeaf(leaf)?.path !== clickedFile.path) continue;
                const leafEl = this.getContentEl(leaf);
                if (!leafEl) continue;
                let m = this.recentCheckboxValues.get(leafEl);
                if (!m) { m = new Map(); this.recentCheckboxValues.set(leafEl, m); }
                m.set(key, { value, time: now });
            }
            const normalized = this.normalizePropertyValue(value);
            this.dbg("checkbox handler", key, "→", normalized);
            if (normalized !== null) {
                propEl.setAttribute('data-property-value', normalized);
            } else {
                propEl.removeAttribute('data-property-value');
            }
        };
        contentEl.addEventListener('change', handler, true);
        this.checkboxChangeHandlers.set(contentEl, handler);
    }

    private clearCheckboxHandler(contentEl: HTMLElement) {
        const handler = this.checkboxChangeHandlers.get(contentEl);
        if (handler) {
            contentEl.removeEventListener('change', handler, true);
            this.checkboxChangeHandlers.delete(contentEl);
        }
        this.recentCheckboxValues.delete(contentEl);
    }

    // ─── Cleanup ──────────────────────────────────────────────────────────────

    private clearLeaf(leaf: WorkspaceLeaf) {
        const contentEl = this.getContentEl(leaf);
        if (!contentEl) return;
        this.clearClasses(contentEl);
        this.clearPropertyValues(contentEl);
        this.clearSectionHeaders(contentEl);
        this.clearEnumDropdowns(contentEl);
        this.clearCheckboxHandler(contentEl);
        this.clearEmptyMarks(contentEl);
        this.clearHideEmptyButton(contentEl);
        const containerEl =
            contentEl.querySelector<HTMLElement>(".metadata-container") ?? contentEl;
        containerEl.classList.remove("sp-hide-empty");
    }

    // ─── Value normalization ──────────────────────────────────────────────────

    private normalizePropertyValue(raw: unknown): string | null {
        if (raw === null || raw === undefined) return null;
        if (typeof raw === "boolean") return String(raw);
        if (typeof raw === "number") return String(raw);

        if (Array.isArray(raw)) {
            const entries = raw
                .map((v) => this.normalizeSingleValue(v))
                .filter((v): v is string => v !== null);
            return entries.length > 0 ? entries.join(" ") : null;
        }

        return this.normalizeSingleValue(raw);
    }

    private normalizeSingleValue(raw: unknown): string | null {
        if (raw === null || raw === undefined) return null;
        if (typeof raw === "boolean") return String(raw);
        if (typeof raw === "number") return String(raw);

        let str = String(raw).trim();
        if (!str) return null;

        // [[target|display]] → display
        str = str.replace(
            /\[\[[^\]|#]*(?:#[^\]|]*)?\|([^\]]+)\]\]/g,
            "$1"
        );
        // [[target#anchor]] or [[target]] → last path segment
        str = str.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]/g, (_, t: string) =>
            t.split("/").pop() ?? t
        );
        str = str.replace(/\[\[|\]\]/g, "");
        str = str.toLowerCase();
        str = str.replace(/[\s/#]/g, "-");
        str = str.slice(0, 64);

        return str || null;
    }
}
