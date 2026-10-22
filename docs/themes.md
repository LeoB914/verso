# Editor themes

Custom editor themes are JSON files in the app's `themes/` folder
(**Settings → Appearance → Open themes folder**). Verso ships Verso Light/Dark,
Solarized Light/Dark, Dracula, Nord, GitHub Light and One Dark; your own themes appear
next to them.

## Schema

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "dark": false,
  "colors": {
    "background": "#ffffff",
    "foreground": "#1d1d1f",
    "gutterForeground": "#aeaeb2",
    "gutterBorder": "rgba(0,0,0,0.12)",
    "activeLine": "rgba(0,0,0,0.035)",
    "selection": "rgba(10,132,255,0.2)",
    "cursor": "#0a84ff",
    "matchingBracket": "rgba(10,132,255,0.15)",
    "searchMatch": "rgba(255,204,0,0.35)",
    "searchMatchSelected": "rgba(255,149,0,0.5)"
  },
  "tokens": {
    "comment": "#6e7681",
    "keyword": "#a626a4",
    "command": "#0184bc",
    "math": "#b76b01",
    "string": "#50a14f",
    "number": "#b76b01",
    "heading": "#e45649",
    "meta": "#4078f2",
    "invalid": "#e45649"
  }
}
```

All fields are required. Colors may be hex (`#rrggbb`), `rgba(...)` or any
CSS color. `id` must be unique; `dark` selects which slot ("theme in light
mode" vs "theme in dark mode" in Settings → Appearance) the theme appears in.

Invalid files are skipped with a readable error shown in the theme picker —
they never crash the app.
