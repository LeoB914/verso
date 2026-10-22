# Releasing Verso

## Build installers locally

```bash
npm run dist
```

Builds for the current OS into `dist/`:

- macOS: `.dmg` (arm64 + x64)
- Windows: NSIS `.exe`
- Linux: `.AppImage`, `.deb`

The installers are currently **not code-signed**. See the README for how to open an
unsigned build on macOS and Windows.

## Code signing & notarization (macOS)

Signing is skipped automatically when the environment variables are absent.
To enable it, set:

```bash
export CSC_LINK=/path/to/DeveloperIDApplication.p12
export CSC_KEY_PASSWORD=…
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX
```

`electron-builder` then signs with the hardened runtime and notarizes with
notarytool using the entitlements in `build/entitlements.mac.plist`
(JIT enabled, unsigned memory allowed, network client for AI and DOI/arXiv imports,
user-selected files).

## Windows / Linux

Windows NSIS installs per-user with an optional desktop shortcut and a `.tex`
file association. Linux ships an AppImage and a `.deb` with a desktop entry
(`application/x-tex` MIME type).
