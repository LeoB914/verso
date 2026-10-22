# Contributing to Verso

Thanks for helping! Bug reports, ideas, documentation fixes and pull requests are all
welcome.

## Reporting bugs and ideas

Open an issue using the **Bug report** or **Feature request** template. For bugs, the
most useful details are: operating system, Verso version, TeX distribution and version
(`latexmk -v`), the steps to reproduce, and — for compile problems — a minimal `.tex`
file that shows the issue.

Security problems: please follow [SECURITY.md](SECURITY.md) instead of opening a public
issue.

## Development setup

```bash
npm install
npm run dev
```

You need Node.js 22+, Git and a TeX distribution with `latexmk` and `biber`. All scripts
and the test setup are described in [docs/development.md](docs/development.md); the code
structure in [docs/architecture.md](docs/architecture.md).

## Making a change

1. Create a branch from `main`.
2. Keep the change focused — one bug fix or feature per pull request.
3. Add or update tests: unit tests for logic in `src/shared/` and `src/main/`, an E2E test
   in `tests/e2e/` for user-visible flows. A bug fix comes with a test that fails without
   the fix.
4. Run the full check before pushing:

   ```bash
   npm run typecheck && npm run lint && npm test && npm run test:e2e
   ```

   If you touched templates or the compile pipeline, also run `npm run verify:templates`.

5. Update the documentation in `docs/` when behaviour, settings or shortcuts change
   (`npm run docs:shortcuts` regenerates the shortcut table).

## Code guidelines

- TypeScript in strict mode; small, focused modules; pure logic outside React/Electron.
- The renderer talks to the main process only through the typed IPC contract in
  `src/shared/ipc.ts`; file paths always go through `resolveInProject`.
- User-facing text goes in `src/renderer/strings.ts`, colors only through the CSS design
  tokens, shortcuts only through the command registry (`src/shared/commands.ts`).
- New dependencies need a good reason and a permissive license (MIT, BSD, Apache-2.0,
  ISC).

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org):

```
feat(editor): continue lists with Enter in visual mode
fix(history): keep image blobs when pruning snapshots
docs: explain the Biber workaround on macOS
```

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
