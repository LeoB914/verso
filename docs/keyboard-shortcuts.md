# Keyboard shortcuts

`Cmd` on macOS, `Ctrl` on Windows and Linux. Every shortcut can be changed in
**Settings → Keyboard**; changes apply immediately to the keyboard, the menu and the
command palette (`Cmd/Ctrl + Shift + P`), which lists every command.

The table below is generated from the command registry (`src/shared/commands.ts`) —
run `npm run docs:shortcuts` after changing a default shortcut.

<!-- SHORTCUTS:BEGIN -->

| Command                | Shortcut                      |
| ---------------------- | ----------------------------- |
| **App**                |                               |
| Settings…              | `Cmd/Ctrl` + ,                |
| **Compile**            |                               |
| Compile                | `Cmd/Ctrl` + Enter            |
| Recompile from Scratch | `Cmd/Ctrl` + Alt + Enter      |
| **Edit**               |                               |
| Bold                   | `Cmd/Ctrl` + B                |
| Italic                 | `Cmd/Ctrl` + I                |
| Toggle Comment         | `Cmd/Ctrl` + /                |
| Undo                   | `Cmd/Ctrl` + Z                |
| Redo                   | `Cmd/Ctrl` + Shift + Z        |
| **File**               |                               |
| Open Folder…           | `Cmd/Ctrl` + O                |
| New File…              | `Cmd/Ctrl` + N                |
| New Folder…            | `Cmd/Ctrl` + Shift + N        |
| Save                   | `Cmd/Ctrl` + S                |
| Save All               | `Cmd/Ctrl` + Shift + S        |
| Close Tab              | `Cmd/Ctrl` + W                |
| **Go**                 |                               |
| Jump to PDF (SyncTeX)  | `Cmd/Ctrl` + Alt + ArrowRight |
| Go to File…            | `Cmd/Ctrl` + P                |
| Go to Section…         | `Cmd/Ctrl` + R                |
| Command Palette        | `Cmd/Ctrl` + Shift + P        |
| Search in Project      | `Cmd/Ctrl` + Shift + F        |
| **History**            |                               |
| Version History        | `Cmd/Ctrl` + Shift + H        |
| **Insert**             |                               |
| Insert Citation…       | `Cmd/Ctrl` + Shift + C        |
| **View**               |                               |
| Toggle Sidebar         | `Cmd/Ctrl` + Shift + E        |
| Toggle PDF Pane        | `Cmd/Ctrl` + Shift + D        |
| Toggle Visual Mode     | `Cmd/Ctrl` + Shift + V        |
| Focus Mode             | `Cmd/Ctrl` + Shift + Enter    |
| Toggle AI Chat         | `Cmd/Ctrl` + Shift + L        |

<!-- SHORTCUTS:END -->

## Editor keys

These come from the editor itself and are not listed above:

- `Tab` / `Shift + Tab` — next / previous snippet field; indent
- `Enter` after `\begin{…}` — inserts the matching `\end{…}`
- `Cmd/Ctrl + F` — find and replace in the current file
- `Esc` — closes the topmost dialog, palette or overlay; leaves focus mode
