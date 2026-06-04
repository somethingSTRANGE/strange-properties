# Strange Properties

An Obsidian plugin that enhances the property panel with value-based CSS targeting, configurable class injection, section headers, and empty-property filtering.

---

## Features

- **`data-property-value` injection** — adds a `data-property-value` attribute to every property row in both the inline note properties and the File Properties sidebar panel, enabling CSS to target rows by both key *and* value
- **Class injection** — injects CSS classes onto the `view-content` element based on configurable rules, allowing vault-wide styles to be scoped to specific note types
- **Section headers** — injects visible section headers into the property list, grouped by note type
- **Hide empty properties** — toggle button to hide property rows with no value

---

## Why This Exists

Obsidian's property panel renders each frontmatter entry as a `div.metadata-property` element with a `data-property-key` attribute, but no `data-property-value`. This means CSS can detect *which* properties exist on a note, but not *what value* they hold.

The most common workaround is a sentinel property — a key that exists exclusively on notes of the target type, whose mere presence can be detected via `:has()`. This is fragile: it requires each note type to have at least one unique key found nowhere else in the vault, and it adds properties whose only purpose is to satisfy a CSS selector.

Strange Properties solves this by injecting `data-property-value` onto every property row, and by injecting derived CSS classes onto `view-content` based on property values. A single shared `type` property with values like `character`, `location`, and `faction` is enough to drive precise, conflict-free CSS scoping across your entire vault.

---

## Use Cases

### Scoping styles to a note type

With Strange Properties injecting `data-property-value`, CSS can target property rows by both key and value:

```css
/* Style only the "status" property on character notes */
.metadata-properties:has([data-property-key="type"][data-property-value="character"])
  [data-property-key="status"] { ... }
```

Class injection gives you the same control at the view level. A rule mapping `type` → `property-{property}-{value}` injects `property-type-character` onto the `view-content` element of any character note:

```css
/* Scope any style to character notes without a sentinel key */
.view-content.property-type-character { ... }
```

### Section headers in the property list

Obsidian's property list is flat. When a note has many properties, they render as an undifferentiated block with no visual grouping. CSS `::before` pseudo-elements can inject header labels above specific properties — but without value-based scoping, those headers appear on every note in the vault.

With class injection, section headers are trivially scoped to a note type:

```css
/* "General Information" header above "name", character notes only */
.view-content.property-type-character
  .metadata-properties [data-property-key="name"]::before {
  content: 'General Information';
  display: block;
  font-weight: 600;
  padding: 0.5em 0 0.2em;
  opacity: 0.6;
}
```

The plugin also has a built-in section headers feature that injects DOM elements directly, styled via `styles.css`, without requiring any user-authored CSS.

### Multi-value properties

For list properties (like `tags`), Strange Properties space-joins the normalized values into a single attribute. CSS `~=` targets individual entries:

```css
/* Match a note tagged with "fiction", regardless of other tags */
.metadata-properties [data-property-key="tags"][data-property-value~="fiction"] { ... }
```

---

## Configuration

_Full settings UI documentation to follow once the settings tab is complete._

Settings are stored in `.obsidian/plugins/strange-properties/data.json`. The current structure:

```json
{
  "propertyClasses": [
    {
      "property": "type",
      "pattern": "property-{property}-{value}",
      "scope": "both",
      "enabled": true
    }
  ],
  "sectionHeaders": [],
  "injectPropertyValues": true,
  "hideEmptyEnabled": true,
  "hideEmptyActive": false
}
```

### Class injection patterns

Each rule in `propertyClasses` maps a frontmatter property to a class name pattern on `view-content`. Two tokens are available:

| Token | Resolves to |
|---|---|
| `{property}` | The frontmatter property name (matches the `property` field of the rule) |
| `{value}` | The frontmatter property value |

**Scope** controls which leaf types the rule applies to: `"notes"`, `"properties"` (File Properties panel), or `"both"`.

### Value normalization

`data-property-value` is always normalized for safe use in CSS selectors:

- Wikilinks `[[target|display]]` resolve to the display text; `[[target]]` resolves to the leaf filename
- Values are lowercased
- Spaces, `/`, and `#` are replaced with `-`
- Truncated at 64 characters

---

## License

MIT
