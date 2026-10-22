# Troubleshooting

## "LaTeX toolchain not found"

Apps started from Finder or the Dock do not inherit your terminal's `PATH`. Verso asks your
login shell (zsh, bash or fish) for its `PATH` once at startup and additionally looks in:

- macOS: `/Library/TeX/texbin`, `/usr/local/texlive/*/bin/*`, `/opt/homebrew/bin`,
  `/usr/local/bin`
- Linux: `/usr/local/texlive/*/bin/*`
- Windows: the default MiKTeX folders and `C:\texlive\*\bin\windows`

If TeX is installed somewhere else, add that folder to the `PATH` exported by your login
shell, restart Verso and use **Settings → Compiler → Re-check**. On Windows, `latexmk`
also needs Perl (MiKTeX does not ship it), e.g. [Strawberry Perl](https://strawberryperl.com).

## A package is missing

The problems panel shows the missing `.sty` file and the matching command, e.g.
`tlmgr install siunitx` (TeX Live / MacTeX). With MiKTeX, install the package through the
MiKTeX Console or enable on-the-fly installation.

## Biber fails on macOS

With TeX Live 2026 on recent macOS versions the universal `biber` binary can exit
immediately with a `lipo` usage message, so bibliographies stay empty. Workaround: extract
the binary for your architecture and point latexmk at it.

```bash
mkdir -p ~/.local/bin
lipo "$(readlink -f "$(command -v biber)")" -thin arm64 -output ~/.local/bin/biber
echo '$biber = "$ENV{HOME}/.local/bin/biber";' >> ~/.latexmkrc
```

Use `-thin x86_64` on Intel Macs. Once a fixed TeX Live update is installed, delete
`~/.local/bin/biber` and the line in `~/.latexmkrc` again.

## Compiles fail strangely or never finish

- **Recompile from scratch** (`Cmd/Ctrl + Alt + Enter`) clears `.openleaf/build/` and runs
  `latexmk -gg`; this fixes most problems caused by stale auxiliary files.
- A compile is stopped after the timeout in **Settings → Compiler** (default 120 s).
  Long documents with many figures may need more.
- Packages that run external programs (e.g. `minted`) need `-shell-escape`. It is off by
  default for safety; enable it for new projects in **Settings → Compiler**, or for an
  existing project set `"shellEscape": true` in `.openleaf/project.json`.

## "File changed on disk"

Another program changed a file that has unsaved edits in Verso. The banner above the
editor lets you keep your version, load the version from disk, or compare both. Files
without unsaved edits reload silently.

## Restoring lost work

- **Version history** (`Cmd/Ctrl + Shift + H`) has snapshots from every project open,
  every successful compile and every few minutes of editing.
- After a crash, Verso offers the unsaved buffers of the previous session when the project
  is opened again.
- Files deleted from inside Verso go to the system trash.

## Where Verso keeps its data

| Data                                                  | Location                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| Project settings                                      | `<project>/.openleaf/project.json`                                |
| Build output (PDF, log, SyncTeX)                      | `<project>/.openleaf/build/` (gitignored)                         |
| App settings, project list, history, recovery, themes | the app data folder (below)                                       |
| Logs                                                  | `logs/` in the app data folder (Help menu → **Open Logs Folder**) |

The app data folder is `~/Library/Application Support/Verso` on macOS,
`%APPDATA%\Verso` on Windows and `~/.config/Verso` on Linux. Verso sends no telemetry; logs
stay on your machine.
