# Features

[Back to README](../../README.md)

## Animations and interaction

- **Live state**: the OMP extension posts lifecycle events and the pet animates them (see [state mapping](state-mapping.md))
- **Animated states**: idle, thinking, working (with tiers for two and three or more busy sessions), error, completion, compaction (sweeping), sleeping
- **Eye tracking**: in idle the pet follows your cursor, with body lean and shadow stretch
- **Sleep sequence**: yawn, doze, collapse and sleep after 60 s idle; moving the mouse wakes it with a startle
- **Click reactions**: double-click for a poke, four clicks for a flail
- **Drag from any state**: grab the pet at any time and release to resume
- **Folder drop**: drop a folder on the pet to open a terminal in that directory
- **Mini mode**: drag the pet to the right edge or pick "Mini Mode" from the context menu; it hides at the screen edge, peeks on hover and pops out for alerts and celebrations

## Sessions

- **Multi-session tracking**: every live OMP session is tracked and the pet shows the highest-priority state among them
- **Session HUD**: a compact list next to the pet with the current live sessions; click a row to jump to its terminal
- **Dashboard**: right-click or tray, then "Open Dashboard", to see live sessions, recent events and aliases, and to jump to a terminal
- **Terminal jump**: uses `wmctrl` or `xdotool` to raise the terminal window, then selects the tmux pane when the session runs inside tmux
- **Process liveness**: the extension reports the OMP process PID, so sessions whose process exited are cleaned up
- **Private local recap**: Settings → Footprints (or right-click → "Open Footprints") reviews OMP activity by hour and day. See the [recap guide](recap.md)

The pet is state-only for OMP. It never approves, denies or changes anything inside OMP.

## System

- **Click-through**: transparent areas pass clicks to the windows below; only the pet's body is interactive
- **Position memory**: the pet remembers where you left it, including mini mode
- **Workspace sticky**: on X11 the pet stays visible on every workspace and never steals keyboard focus
- **Single instance**: a second launch focuses the running pet instead of opening another
- **Open at login**: tray or Settings → General writes an XDG autostart entry
- **Do Not Disturb**: right-click or tray, then "Sleep (Do Not Disturb)"; the pet stops reacting until you wake it
- **Sound effects**: a short cue when a turn completes, with a volume control and a 10 s cooldown, muted during Do Not Disturb
- **Global shortcut**: `Ctrl+Shift+Alt+C` shows or hides the pet by default; change it in Settings → Shortcuts
- **Discord Rich Presence**: optional, in Settings → Discord Presence
- **Free roam and fence**: let the pet wander, optionally inside an area you draw. See [roam fence](roam-fence.md)
- **Languages**: English and Brazilian Portuguese; switch in Settings → General

## Multi-display

Sizing follows the display the pet launches on, portrait monitors get a bounded size boost so the pet stays readable, and you can drag the pet across displays or send it to another one from the context menu.

<p align="center"><sub><a href="../../assets/videos/clawd-multi-monitor-demo.mp4">Multi-monitor demo video</a></sub></p>

## Themes

Clawd, Calico and Cloudling are built in. You can add your own character and animations.

1. Scaffold a theme:
   ```bash
   npm run create-theme -- my-theme
   ```
   Without an argument the script picks the next free `my-theme` name. The scaffold goes to `~/.config/omp-pet/themes/`.
2. Edit `theme.json` and add your assets (SVG, GIF, APNG, WebP, PNG, JPG or JPEG).
3. Open Settings → Theme and select it (restart the pet if it does not appear).

A minimal theme is one SVG (idle with eye tracking) plus seven GIF or APNG files (thinking, working, error, happy, notification, sleeping, waking). Turn off eye tracking to use any format for every state.

Validate a theme before sharing it:

```bash
node scripts/validate-theme.js path/to/your-theme
```

Theme cards in Settings → Theme show capability badges such as `Tracked idle`, `Static theme`, `Mini`, `Direct sleep` and `No reactions`. Third-party SVG files are sanitized on load.

The full format is in the [theme creation guide](guide-theme-creation.md).
