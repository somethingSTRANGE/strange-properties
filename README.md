# Strange Properties

Strange Properties expands Obsidian's property panel with curated dropdown value pickers, property grouping, contextual help text, empty-property filtering, and CSS targeting based on property values. It's designed for vaults that rely heavily on structured metadata and notes with large numbers of properties.

## Features

- [Hide Empty Properties](#hide-empty-properties)
- [Property-Derived Note Classes](#property-derived-note-classes)
- [Property Value Attributes](#property-value-attributes)
- [Property Enhancements](#property-enhancements)
  - [Property Dropdowns with Value Options](#property-dropdowns-with-value-options)
  - [Property Groups](#property-groups)
  - [Property Help Popups](#property-help-popup)

---

### Hide Empty Properties

Template-based notes often contain dozens of properties that may never receive a value. When enabled, this feature adds a toggle to the bottom of the properties section that hides empty or valueless properties, allowing you to focus only on information that is actually in use.

The toggle is global and affects both the File Properties sidebar and note properties throughout the vault.

Because newly created properties begin without a value, they will immediately disappear while empty properties are hidden. Temporarily show all properties before adding a new one.

### Property-Derived Note Classes

Define rules that inject custom CSS classes onto the note view based on property presence or property values.

For example, a `type` property set to `character` can inject an `sp-type-character` class, while a `draft` property can inject an `sp-draft` class regardless of its value.

These generated classes give themes, CSS snippets, and other customizations a precise, conflict-free way to target specific categories of notes without relying on file paths, tags, or manual class assignments.

### Property Value Attributes

Obsidian identifies each property row using an attribute that contains the property's name, but it provides no equivalent identifier for the property's value.

This feature adds a value attribute to every property row, allowing CSS snippets and themes to react to both the property's name and its current value.

For example, a `status` property could be styled normally in most cases, but highlighted only when its value is `overdue`.

### Property Enhancements

Properties can be enhanced in several ways. Enhancements may be applied globally across all notes or scoped to specific note types based on property presence and property values.

For example, you might apply enhancements only to notes that contain a `type` property, or further restrict them to notes where `type: character`.

Any property not matched by an isolation rule may still be enhanced globally.

#### Property Dropdowns with Value Options

Text and Number properties can be assigned a predefined set of allowed values. A dropdown button is added beside the property field, allowing users to select from those values directly.

Unlike Obsidian's autocomplete, these options are explicitly configured and can be tailored to the property's intended purpose. This makes available values immediately visible, encourages consistency, and reduces accidental variations caused by manual entry.

Value lists can be defined manually in settings or generated dynamically from existing notes in the vault.

#### Property Groups

Properties can be assigned to groups. When a group has a title, a header can be displayed above matching properties in the File Properties sidebar and within notes while in Reading and Preview modes.

Consecutive properties assigned to the same group share a single header, making large collections of metadata easier to navigate and understand.

#### Property Help Popups

Properties can be assigned help text that explains their purpose, documents expected values, or provides examples.

When help text exists, an icon appears beside the property. Hovering over the icon displays a popup containing the associated documentation.

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
