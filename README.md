<p align="center">
  <img src="assets/icon.png" width="128" alt="OMP Pet">
</p>

<div align="center">
  <h1>OMP Pet</h1>
  <p><b>A pixel desktop pet for Linux that reacts to your <a href="https://github.com/can1357/oh-my-pi">OMP (oh-my-pi)</a> coding sessions in real time.</b></p>
  <img src="https://img.shields.io/badge/platform-Linux-lightgrey?style=flat-square" alt="Platform: Linux">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License: AGPL-3.0"></a>
</div>

Start a long OMP task, walk away, and come back when the pet tells you it's done. It thinks while you prompt, types while tools run, sweeps while the context is compacted, celebrates when a turn finishes, and dozes off when you step away.

OMP Pet is a fork of [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) trimmed down to a single agent (OMP) and a single platform (Linux).

## Features

- **Live session status**: animated states driven by the OMP extension (idle, thinking, working, error, completion, compaction, sleep), plus eye tracking, click reactions and a mini mode that peeks from the screen edge
- **Sessions at a glance**: a HUD next to the pet, a Dashboard with every live OMP session and one-click jump to its terminal (wmctrl/xdotool, with tmux pane selection)
- **Local recap**: a private activity review stored on this machine only
- **Themes**: Clawd, Calico and Cloudling built in, or a theme of your own
- **Linux desktop integration**: tray icon, autostart, workspace-sticky windows, free roam with an optional fence
- **UI in English and Brazilian Portuguese**

The pet only reports state. It never approves, denies or changes anything in OMP.

## Requirements

- Linux with an X11 session (Wayland sessions work through XWayland; native Wayland is not supported)
- [OMP](https://github.com/can1357/oh-my-pi) installed and on `PATH`
- Node.js 22.12 or newer to run from source (the repository pins 24.18.0 in `.nvmrc`)
- Optional: `wmctrl` or `xdotool` for jumping to a session's terminal

## Quick start

```bash
git clone https://github.com/fberbert/omp-pet.git
cd omp-pet
npm install
npm start
```

On first launch the pet installs its extension into `~/.omp/agent/extensions/omp-pet/` (or the active OMP profile's extension directory). Start a new OMP session and the pet starts reacting. Settings → AI Coding Tools shows the integration status and lets you reinstall or remove the extension.

If Electron aborts with "The SUID sandbox helper binary was found, but is not configured correctly", your distribution blocks the Chromium sandbox (Ubuntu 23.10+ does this through AppArmor). Run `OMP_PET_DISABLE_SANDBOX=1 npm start`, or see the [setup guide](docs/guides/setup-guide.md) for other options.

### Run as a systemd user service

[`contrib/systemd/omp-pet.service`](contrib/systemd/omp-pet.service) starts the pet from a source checkout when you log in to the graphical session and restarts it if it crashes. It assumes the checkout is at `~/omp-pet` and node is at `/usr/bin/node`; edit `WorkingDirectory` and `ExecStart` if yours differ.

```bash
mkdir -p ~/.config/systemd/user
cp contrib/systemd/omp-pet.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now omp-pet
```

```bash
systemctl --user restart omp-pet    # after changing the code
systemctl --user stop omp-pet
systemctl --user disable omp-pet    # stop starting it at login
journalctl --user -u omp-pet -f     # logs
```

- Quitting from the tray stops the service until the next login or `systemctl --user start omp-pet`.
- Leave "Start on login" off in Settings: it adds an XDG autostart entry that races the service for the single-instance lock.
- While the service runs, `npm start` exits immediately because the service holds the single-instance lock. Stop the service first.
- On Ubuntu, uncomment `Environment=OMP_PET_DISABLE_SANDBOX=1` in the unit, for the sandbox reason above.

To build installable packages:

```bash
npm run build:linux:x64   # AppImage and .deb in dist/
```

More detail, including manual extension install and troubleshooting: [setup guide](docs/guides/setup-guide.md).

## Themes

<table>
  <tr>
    <td align="center"><img src="assets/gif/clawd-idle.gif" width="100"><br><sub>Clawd idle</sub></td>
    <td align="center"><img src="assets/gif/clawd-thinking.gif" width="100"><br><sub>Clawd thinking</sub></td>
    <td align="center"><img src="assets/gif/clawd-typing.gif" width="100"><br><sub>Clawd working</sub></td>
    <td align="center"><img src="assets/gif/clawd-building.gif" width="100"><br><sub>Clawd building</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/gif/calico-idle.gif" width="80"><br><sub>Calico idle</sub></td>
    <td align="center"><img src="assets/gif/calico-thinking.gif" width="80"><br><sub>Calico thinking</sub></td>
    <td align="center"><img src="assets/gif/calico-typing.gif" width="80"><br><sub>Calico working</sub></td>
    <td align="center"><img src="assets/gif/calico-building.gif" width="80"><br><sub>Calico building</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="assets/gif/cloudling-idle.gif" width="120"><br><sub>Cloudling idle</sub></td>
    <td align="center"><img src="assets/gif/cloudling-thinking.gif" width="120"><br><sub>Cloudling thinking</sub></td>
    <td align="center"><img src="assets/gif/cloudling-typing.gif" width="120"><br><sub>Cloudling working</sub></td>
    <td align="center"><img src="assets/gif/cloudling-building.gif" width="120"><br><sub>Cloudling building</sub></td>
  </tr>
</table>

To draw your own, run `npm run create-theme -- my-theme` and follow the [theme creation guide](docs/guides/guide-theme-creation.md). Which event plays which animation: [state mapping](docs/guides/state-mapping.md).

## Guides

| Guide | What it covers |
|---|---|
| [Features](docs/guides/features.md) | Every feature in detail |
| [Setup guide](docs/guides/setup-guide.md) | Install, extension management, troubleshooting |
| [Known limitations](docs/guides/known-limitations.md) | What the pet does not do |
| [Recap](docs/guides/recap.md) | Private local activity review |
| [Roam fence](docs/guides/roam-fence.md) | Free roam and the optional fence |
| [Theme creation](docs/guides/guide-theme-creation.md) | Build and validate your own theme |

## Development

```bash
npm start   # run the app from source
npm test    # Node's built-in test runner
```

Architecture notes for contributors live in [docs/project/](docs/project/agent-runtime-architecture.md); see also [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgments

- [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) by 鹿鹿 ([@rullerzhou-afk](https://github.com/rullerzhou-afk)) and its contributors, the project this fork is based on
- Clawd pixel art reference from [clawd-tank](https://github.com/marciogranzotto/clawd-tank) by [@marciogranzotto](https://github.com/marciogranzotto)

## License

Source code is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0), as in the upstream project.

**Artwork and bundled theme assets (including `assets/` and `themes/*/assets/`) are NOT covered by AGPL-3.0.** All rights are reserved by their respective copyright holders. See [assets/LICENSE](assets/LICENSE) for details.

- **Clawd** character is the property of [Anthropic](https://www.anthropic.com). This is an unofficial fan project, not affiliated with or endorsed by Anthropic.
- **Calico cat (三花猫)** artwork by 鹿鹿 ([@rullerzhou-afk](https://github.com/rullerzhou-afk)). All rights reserved.
- **Cloudling (云宝)** artwork by 鹿鹿 ([@rullerzhou-afk](https://github.com/rullerzhou-afk)). All rights reserved. Cloudling's visual direction includes an homage to the OpenAI Codex logo; Codex/OpenAI marks remain the property of OpenAI, and this project is not affiliated with or endorsed by OpenAI.
- **Third-party contributions**: copyright retained by respective artists.

Redistributing builds that include these themes needs permission from the artwork owners.
