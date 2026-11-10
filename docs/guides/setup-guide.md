# Setup Guide

[Back to README](../../README.md)

## Requirements

- Linux with an X11 session. Wayland sessions work through XWayland (see [known limitations](known-limitations.md)); native Wayland is not supported.
- [OMP (oh-my-pi)](https://github.com/can1357/oh-my-pi) installed, with `omp` on `PATH` or an existing `~/.omp/agent/` directory.
- Optional: `wmctrl` or `xdotool` for jumping to a session's terminal (`sudo apt install wmctrl`).

## Run from source

Use Node.js 24.18.0 (the repository `.nvmrc`). Electron's installer needs Node.js 22.12.0 or newer. Node 24.16.x and 24.17.x have a stream regression that can silently truncate ZIP extraction ([nodejs/node#63487](https://github.com/nodejs/node/issues/63487)), so 24.18.0 is the supported baseline.

```bash
git clone https://github.com/fberbert/omp-pet.git
cd omp-pet
npm install
npm start
```

The Electron sandbox is on by default. If your environment fails chrome-sandbox initialization, `OMP_PET_DISABLE_SANDBOX=1 npm start` is a temporary workaround.

If Electron reports a missing distribution or its integrity check fails, remove the whole package and reinstall; do not create only `path.txt`:

```bash
rm -rf node_modules/electron
npm install
```

For a custom development distribution, `ELECTRON_OVERRIDE_DIST_PATH` falls back to the `electron` executable at the override root when `path.txt` is absent.

## Packages

```bash
npm run build:linux:x64   # AppImage and .deb in dist/
```

After installing the `.deb`, the app appears in the desktop's application menu. The AppImage runs from anywhere; see [known limitations](known-limitations.md) for its temporary-space needs. There is no in-app updater: replace the AppImage or reinstall the `.deb` to update.

## OMP extension

On every launch the pet syncs its extension into the active OMP agent directory:

```text
~/.omp/agent/extensions/omp-pet/
  omp-extension.ts
  omp-extension-core.js
  .omp-pet-managed.json
```

The marker file `.omp-pet-managed.json` is how the pet recognizes its own copy. A directory with that name but without the marker is never overwritten or removed.

OMP loads extensions when a session starts. Sessions that were already running pick up a new or updated extension only after they are restarted.

### Which directory

The installer follows OMP's own rules for the process environment:

| Variable | Effect |
|---|---|
| none | `~/.omp/agent/` |
| `OMP_PROFILE` (or `PI_PROFILE` when `OMP_PROFILE` is unset) | `~/.omp/profiles/<name>/agent/`; `default` or an empty value selects the default profile |
| `PI_CONFIG_DIR` | replaces `.omp` as the config root under your home directory |
| `PI_CODING_AGENT_DIR` | relocates the profile-less default agent directory |

The pet manages one directory: the one it resolves from its own environment. To cover another profile, run the installer in that profile's environment:

```bash
OMP_PROFILE=work npm run install:omp-extension
```

Doctor lists other profiles found on disk that the pet does not manage.

### Manage it

- **Settings → AI Coding Tools** shows the integration status. **Install** installs and enables it; **Uninstall** removes only the pet-managed directory and turns the integration off. Turning the switch off without uninstalling stops event intake and leaves the files in place.
- From a checkout:
  ```bash
  npm run install:omp-extension     # node hooks/omp-install.js
  npm run uninstall:omp-extension   # node hooks/omp-install.js --uninstall
  ```

If neither the agent directory nor the `omp` command exists, the installer skips registration and says so.

## How events reach the pet

The extension POSTs each lifecycle event to `http://127.0.0.1:<port>/state`. The port comes from `~/.omp-pet/runtime.json`, which the pet writes when its server starts; the extension falls back to scanning 23533 to 23537. See [state mapping](state-mapping.md) for which event plays which animation.

To check that the pet is listening and play a state by hand:

```bash
bash test-oneshot-gate.sh attention     # also: error, sweeping, all
bash test-demo.sh 2                     # cycles through every state
```

## Troubleshooting

| Symptom | What to check |
|---|---|
| The pet never reacts | Settings → Doctor. Confirm the extension directory exists under the agent directory OMP actually uses, then start a **new** OMP session. |
| The pet reacts to one profile but not another | Install into the other profile with `OMP_PROFILE=<name> npm run install:omp-extension`. |
| Clicking a session does nothing | Install `wmctrl` or `xdotool`. Details for each attempt are in `~/.config/omp-pet/focus-debug.log`. |
| The pet cannot be dragged or appears centered | You are on native Wayland. Log in to an X11 session, or let the pet relaunch under XWayland (the default when an X server is available). |
| A port conflict | The pet picks another port and records it in `~/.omp-pet/runtime.json`; the extension reads it from there. |

Logs and settings live in `~/.config/omp-pet/` (`omp-pet-prefs.json`, `omp-pet-main.log`, `session-debug.log`, `focus-debug.log`). Runtime discovery data lives in `~/.omp-pet/`.
