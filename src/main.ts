import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
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

    // Defer DOM mutations one animation frame to allow Obsidian to finish
    // rendering property elements before we query for them.
    activeWindow.requestAnimationFrame(() => {
      if (this.settings.injectPropertyValues) {
        this.injectPropertyValues(contentEl, frontmatter);
      }
      this.applyClasses(contentEl, this.resolveClasses(frontmatter, leafType));
      this.injectSectionHeaders(contentEl, frontmatter);
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
        // Ignore mutations caused entirely by our own section header elements
        // to prevent an inject → observe → inject loop.
        const isOwnMutation = mutations.every((m) =>
          [...m.addedNodes, ...m.removedNodes].every(
            (n) => n instanceof HTMLElement && n.hasAttribute("data-sp-section")
          )
        );
        if (!isOwnMutation) this.updateLeaf(leaf);
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

      let lastSection: PropertySection | null = null;

      for (const el of propertyEls) {
        const key = el.getAttribute("data-property-key")!;
        const section = propertyToSection.get(key) ?? null;

        if (section && section !== lastSection) {
          propertiesEl.insertBefore(this.createSectionHeaderEl(section.header), el);
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

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  private clearLeaf(leaf: WorkspaceLeaf) {
    const contentEl = this.getContentEl(leaf);
    if (!contentEl) return;
    this.clearClasses(contentEl);
    this.clearPropertyValues(contentEl);
    this.clearSectionHeaders(contentEl);
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
