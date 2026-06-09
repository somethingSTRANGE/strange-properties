# Strange Properties

Strange Properties upgrades Obsidian's property panel with dropdown value pickers, section grouping, contextual help text, empty-property filtering, and CSS value targeting — built for notes with many structured properties.

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

Some notes, especially those based on templates, might contain many unused properties. When this feature is enabled, a simple toggle is added to the bottom of the properties section that allows empty or value-less properties to be hidden.

The toggle is global and affects the File Properties sidebar and all notes.

When a new file property is added to a note, it's valueless by default and would disappear immediately while empty properties are hidden. Show all properties before adding a new one.

### Property-Derived Note Classes

Define rules that inject custom CSS classes onto the note view based on property values. A `type` property set to `character` can inject a `sp-type-character` class or a `draft` property, regardless of value, can inject a `sp-draft` class  — giving CSS snippets and themes a precise, conflict-free handle for scoping styles to specific note types.

### Property Value Attributes

Obsidian identifies each property row with an attribute containing the property's name, but provides no equivalent for its value. This feature adds a value attribute to every property row — enabling CSS snippets and themes to style rows based on both their name and their current value. For example, a `status` property could be highlighted only when set to `overdue`.

### Property Enhancements

Properties can be enhanced in a few ways, and those enhancements may be applied globally or isolated to specific notes based on whether the note has a specific property and what its value might be.

You can isolate enhancements to notes that have a specific property defined, such as `type`. You can further isolate enhancements based on the value of that property, such as `type: character`. Any property not enhanced by an isolation rule can be enhanced globally.

#### Property Dropdowns with Value Options

Text and Number properties may be assigned a pre-set list of value options that become accessible through a dropdown button added to the right side of the input field. Selecting an item from the menu will populate the field with a specific value, decreasing the chance of entering the wrong data.

The pre-set lists can be defined in settings and even generated dynamically based on existing notes in the vault.

#### Property Groups

Properties can be assigned a group, and if that group has a title, a header may appear above the property in the File Properties sidebar and notes while in Preview and Read modes. Consecutive properties that share a group assignment will also share a header.

#### Property Help Popups

Properties may be assigned help text that might define the property's usage or provide examples. When help is assigned to a property an icon will appear to its right. Hovering over the icon will show a popup containing the help text.

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
