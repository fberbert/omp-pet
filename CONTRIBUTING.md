# Contributing to OMP Pet

OMP Pet is a fork of [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) that supports only the OMP (oh-my-pi) agent on Linux. Issues and pull requests go to [fberbert/omp-pet](https://github.com/fberbert/omp-pet).

Before starting anything larger than a small fix, open an issue so the approach can be agreed first.

## Run from source

Requirements: Linux with X11 (or XWayland), Node.js 24.18.0 (`.nvmrc`; 22.12 is the minimum Electron accepts), git, and OMP for real end-to-end checks.

```bash
git clone https://github.com/fberbert/omp-pet.git
cd omp-pet
npm install
npm start
```

Useful commands:

```bash
npm test                         # full suite (node --test); run it before every PR
npm run audit:assets             # after adding or changing artwork
npm run create-theme -- my-theme # scaffold a theme
bash test-demo.sh 2              # cycle every animation against the running app
bash test-oneshot-gate.sh error  # post one state
```

`AGENTS.md` is the operational entry point (commands, core files, constraints), and `docs/project/` holds the architecture notes.

## Translations

The UI ships in English and Brazilian Portuguese. Strings live in two files:

- `src/i18n.js`: menu, pet and notification strings
- `src/settings-i18n.js`: the Settings window

Edit both locales together and keep placeholders such as `{n}` exactly as in English. `test/i18n.test.js` fails if a key is missing, out of order, or has different placeholders from `en`. Adding another language means adding it to `SUPPORTED_LANGS` in `src/i18n.js`, adding a full locale block to both files, a `lang...` display-name entry in `src/settings-i18n.js`, and updating the small per-file tables in `src/roam-fence-picker-renderer.js`, `src/settings-animation-overrides-main.js`, `src/settings-tab-recap.js` and `src/tutorial-renderer.js`.

## The OMP integration

The extension lives in `hooks/omp-extension.ts` (transport) and `hooks/omp-extension-core.js` (event semantics), and is installed by `hooks/omp-install.js`. These files are copied into OMP's agent directory, so they may only use Node built-ins and each other. Changes to the event path need a real OMP session to verify; a hand-written `curl` payload is not enough. See [docs/project/agent-runtime-architecture.md](docs/project/agent-runtime-architecture.md).

## Themes

See the [theme creation guide](docs/guides/guide-theme-creation.md). Built-in artwork changes need separate review because the artwork is not AGPL-licensed.

## Pull requests

1. Branch from `main`, one responsibility per PR.
2. Run `npm test` locally.
3. Describe the problem, what changed, what you actually ran to validate it, and what you did not test. Add a screenshot or short recording for UI changes.
4. Remove tokens, private prompts and personal data from logs and screenshots.

Using an AI coding agent is fine, as long as you ran and understood the result and describe the validation honestly.

Commit messages follow a light conventional style, for example `fix(state): ...`, `feat(theme): ...`, `docs: ...`.

## Security

Do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on the repository.

## License

Source code contributions are licensed under the [GNU AGPL v3](LICENSE). Artwork uses its own terms; see the [README license notes](README.md#license). Third-party materials added to the repository must be listed in `NOTICE.md`.
