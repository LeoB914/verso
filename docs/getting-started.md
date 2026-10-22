# Getting started

## 1. Install a TeX distribution

Verso compiles with the TeX installation already on your machine; nothing TeX-related is
bundled.

| System  | Distribution                                                         | Notes                                       |
| ------- | -------------------------------------------------------------------- | ------------------------------------------- |
| macOS   | [MacTeX](https://www.tug.org/mactex/) (`brew install --cask mactex`) | includes `latexmk`, `biber`, `texcount`     |
| Linux   | [TeX Live](https://tug.org/texlive/)                                 | install the full scheme or `latexmk`        |
| Windows | [MiKTeX](https://miktex.org) or TeX Live                             | `latexmk` needs Perl (e.g. Strawberry Perl) |

On first start the welcome sheet checks for `latexmk` and a TeX engine. You can re-run
the check any time in **Settings → Compiler**.

## 2. Create or open a project

A project is any folder. The start screen offers:

- **New Project** — pick a template (Blank, Article, Report/Thesis, Beamer, Letter, CV,
  your own templates) and a location.
- **Open Folder…** (`Cmd/Ctrl + O`) — use an existing folder, e.g. a cloned Git repo.
- **Import ZIP** — e.g. a project downloaded from Overleaf; you can also drop the ZIP on
  the start screen.
- **Open sample project** on the welcome sheet — a short tour document with sections,
  math, a figure, a table and a bibliography.

Double-clicking a `.tex` file in Finder/Explorer (with the installed app) opens its folder
as a project.

Verso stores per-project settings in `<project>/.openleaf/project.json` and build output in
`<project>/.openleaf/build/`; the build folder is added to the project's `.gitignore`.

## 3. Write and compile

- The main file (badge **Main** in the file tree) is detected from `\documentclass`;
  change it via the file's context menu → **Set as Main File**.
- **Compile** with `Cmd/Ctrl + Enter` or the toolbar button. Choose pdfLaTeX, XeLaTeX or
  LuaLaTeX in the toolbar; the choice is saved per project. latexmk runs BibTeX/Biber
  automatically.
- **Auto** in the toolbar recompiles after you stop typing (delay in Settings → Compiler).
- The **problems panel** below the editor lists errors and warnings with plain-language
  explanations; click one to jump to the line. Missing packages show the
  `tlmgr install …` command.
- Files save automatically (Settings → General); `Cmd/Ctrl + S` saves immediately.

## 4. Editor and PDF

- **SyncTeX:** `Cmd/Ctrl + Alt + →` jumps from the cursor to the PDF; clicking in the PDF
  jumps to the source line. Turn on text selection in the PDF toolbar to copy text instead.
- **Visual mode** (`Cmd/Ctrl + Shift + V`, or Source | Visual above the editor) renders
  headings, formatting, lists, math, figures, tables and citations while the LaTeX source
  stays the single source of truth.
- **Autocomplete** covers commands, environments, labels (`\ref{`), citation keys
  (`\cite{`) and file paths; spellcheck supports English and German per project.
- **Open PDF in new window** in the toolbar detaches the PDF, e.g. for a second monitor.

## 5. Bibliography, tables, math

- **Refs** in the sidebar lists all `.bib` entries: search, insert citations, add entries
  by DOI, arXiv id or ISBN, paste BibTeX or fill in a form, find duplicates and unused
  entries. `Cmd/Ctrl + Shift + C` opens the cite picker at the cursor.
- **Insert → Table…** opens a spreadsheet-like table editor (paste from Excel works).
- Hover over math to see it rendered; **Symbols** in the sidebar inserts symbols.

## 6. History and Git

- **Version history** (`Cmd/Ctrl + Shift + H`) keeps snapshots independent of Git: on
  open, after every successful compile, every few minutes while you work and before
  restores. Compare any two versions, restore a single file or the whole project, save a
  labelled version, or export a version as ZIP.
- The **Git** sidebar panel stages, commits, pulls, pushes and fetches using your normal
  Git credentials (SSH agent / credential helper), switches and creates branches and
  shows the changes of each commit.

## 7. AI chat (optional)

`Cmd/Ctrl + Shift + L` opens a chat panel. Configure the provider in **Settings → AI**:
a local [Ollama](https://ollama.com) model (default, works offline), any
OpenAI-compatible endpoint, or Anthropic. API keys are stored encrypted and are only used
by the app's main process.

## Next

- [Keyboard shortcuts](keyboard-shortcuts.md)
- [Editor themes](themes.md)
- [Troubleshooting](troubleshooting.md)
