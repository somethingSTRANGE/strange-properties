import { MarkdownView, Plugin, setIcon, setTooltip, TFile, WorkspaceLeaf } from "obsidian";

declare const __BUILD_TIME__: string;
import {
  StrangePropertiesSettings,
  DEFAULT_SETTINGS,
  StrangePropertiesSettingTab,
  PropertyClassRule,
  PropertySection,
  SectionHeaderRule,
} from "./settings";

const CLASS_ATTR = "data-property-classes";
const CLASS_BLACKLIST = new Set(["view-content"]);

export default class StrangePropertiesPlugin extends Plugin {
  settings: StrangePropertiesSettings;
  private observers = new Map<WorkspaceLeaf, MutationObserver>();

  async onload() {
    console.log(`Strange Properties loaded — build ${__BUILD_TIME__}`);
    await this.loadSettings();
    this.addSettingTab(new StrangePropertiesSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.updateAllLeaves();
      this.setupObservers();
    });

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
    this.teardownObservers();
    this.app.workspace.iterateAllLeaves((leaf) => this.clearLeaf(leaf));
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateAllLeaves();
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
      this.injectPropertyValues(contentEl, frontmatter);
    }
    this.applyClasses(contentEl, this.resolveClasses(frontmatter, leafType));
    this.injectSectionHeaders(contentEl, frontmatter);
    this.markEmptyProperties(contentEl, frontmatter);
    this.updateHideEmptyContainer(contentEl);
    this.injectHideEmptyButton(contentEl);
  }

  private updateLeaf(leaf: WorkspaceLeaf) {
    const leafType = this.getLeafType(leaf);
    if (!leafType) return;

    const file = this.getFileForLeaf(leaf);
    const contentEl = this.getContentEl(leaf);
    if (!contentEl) return;

    if (!file) {
      this.clearLeaf(leaf);
      return;
    }

    const frontmatter =
      this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

    // Defer one animation frame so Obsidian can finish rendering property
    // elements before we query and modify them.
    activeWindow.requestAnimationFrame(() => {
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
      if (leaf.view.getViewType() !== "file-properties") return;
      if (this.observers.has(leaf)) return;

      const contentEl = this.getContentEl(leaf);
      if (!contentEl) return;

      const observer = new MutationObserver((mutations) => {
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
    let cls = rule.pattern
      .replace("{key}", rule.property)
      .replace("{value}", value);
    if (this.settings.sanitize) cls = cls.replace(/[^a-zA-Z0-9_-]/g, "-");
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

  private injectPropertyValues(
    contentEl: HTMLElement,
    frontmatter: Record<string, unknown>
  ) {
    const els = contentEl.querySelectorAll<HTMLElement>(
      ".metadata-property[data-property-key]"
    );
    for (const el of els) {
      const key = el.getAttribute("data-property-key")!;
      const normalized = this.normalizePropertyValue(frontmatter[key]);
      if (normalized !== null) {
        el.setAttribute("data-property-value", normalized);
      } else {
        el.removeAttribute("data-property-value");
      }
    }
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
    this.clearSectionHeaders(contentEl);

    const propertiesEl = contentEl.querySelector(".metadata-properties");
    if (!propertiesEl) return;

    const propertyEls = propertiesEl.querySelectorAll<HTMLElement>(
      ".metadata-property[data-property-key]"
    );
    if (!propertyEls.length) return;

    for (const rule of this.settings.sectionHeaders) {
      if (!rule.enabled) continue;
      if (!this.sectionHeaderRuleMatches(rule, frontmatter)) continue;

      const propertyToSection = new Map<string, PropertySection>();
      for (const section of rule.sections) {
        for (const prop of section.properties) {
          propertyToSection.set(prop, section);
        }
      }

      // When hiding empty properties, suppress headers whose section contains
      // only empty properties — they'd render as orphaned headers with nothing
      // visible beneath them.
      const hidingEmpty = this.settings.hideEmpty && this.settings.hideEmptyActive;
      const sectionsWithContent = new Set<PropertySection>();
      if (hidingEmpty) {
        for (const el of propertyEls) {
          const key = el.getAttribute("data-property-key")!;
          const section = propertyToSection.get(key);
          if (section && !this.isEmptyValue(frontmatter[key])) {
            sectionsWithContent.add(section);
          }
        }
      }

      let lastSection: PropertySection | null = null;

      for (const el of propertyEls) {
        const key = el.getAttribute("data-property-key")!;
        const section = propertyToSection.get(key) ?? null;

        if (section && section !== lastSection) {
          const visible = !hidingEmpty || sectionsWithContent.has(section);
          if (visible) {
            propertiesEl.insertBefore(this.createSectionHeaderEl(section.header), el);
          }
        }

        lastSection = section;
      }
    }
  }

  private sectionHeaderRuleMatches(
    rule: SectionHeaderRule,
    frontmatter: Record<string, unknown>
  ): boolean {
    if (!rule.condition) return true;
    const raw = frontmatter[rule.condition.property];
    const values = Array.isArray(raw) ? raw : [raw];
    return values.some((v) => String(v ?? "") === rule.condition!.value);
  }

  private createSectionHeaderEl(label: string): HTMLElement {
    const el = createEl("div", { cls: "sp-section-header" });
    el.setAttribute("data-sp-section", "");
    el.setAttribute("data-sp-section-label", this.sanitizeSectionLabel(label));
    el.textContent = label;
    return el;
  }

  private sanitizeSectionLabel(label: string): string {
    return label.toLowerCase().replace(/[\s/#]/g, "-").slice(0, 64);
  }

  private clearSectionHeaders(contentEl: HTMLElement) {
    contentEl.querySelectorAll("[data-sp-section]").forEach((el) => el.remove());
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
    const shouldHide = this.settings.hideEmpty && this.settings.hideEmptyActive;
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
    if (!this.settings.hideEmpty) {
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

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  private clearLeaf(leaf: WorkspaceLeaf) {
    const contentEl = this.getContentEl(leaf);
    if (!contentEl) return;
    this.clearClasses(contentEl);
    this.clearPropertyValues(contentEl);
    this.clearSectionHeaders(contentEl);
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

    if (this.settings.sanitize) {
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
    }

    return str || null;
  }
}
