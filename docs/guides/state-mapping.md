# State Mapping

[Back to README](../../README.md)

The OMP extension translates OMP's native events into the pet's event vocabulary and POSTs them to `/state`. The pet then picks one state across all live sessions by priority.

## OMP events

| OMP event | Pet event | State |
|---|---|---|
| `session_start` | SessionStart | idle |
| `session_switch` / `session_branch` | SessionStart | idle (the session being left gets a synthetic SessionEnd) |
| `before_agent_start` | UserPromptSubmit | thinking |
| `tool_call` | PreToolUse | working |
| `tool_result` (ok) | PostToolUse | working |
| `tool_result` (`isError`) | PostToolUseFailure | error |
| `session_stop` candidate, then `agent_end` with `willContinue !== true` | Stop | attention |
| `session_before_compact` | PreCompact | sweeping |
| `session_compact` | PostCompact | attention |
| `session_shutdown` | SessionEnd | remove session; idle if no live sessions |

Three rules shape this mapping:

- **Completion is committed across `session_stop` and the following `agent_end`.** `session_stop` is a pre-settle hook: another extension can still request a hidden continuation after the pet's handler runs. The pet records a main-session candidate there and commits it only when the following `agent_end` does not carry `willContinue: true`. Scheduling pauses, built-in retries and extension continuations therefore do not play the finish cue.
- **`session_switch` and `session_branch` retire the session being left** with a synthetic `SessionEnd`. OMP can move an interactive terminal to another conversation without a shutdown for the old one, which would otherwise leave a HUD row nothing reports on again.
- **A `session_title` is always sent.** Several OMP sessions can share one working directory, and a folder-name fallback would make every row and jump target look the same.

The pet is state-only: it never intercepts permissions or adds confirmation prompts.

## Animations

| Trigger | State | Animation | Clawd | Calico | Cloudling |
|---|---|---|---|---|---|
| No activity | idle | Eye-tracking follow | <img src="../../assets/gif/clawd-idle.gif" width="160"> | <img src="../../assets/gif/calico-idle.gif" width="130"> | <img src="../../assets/gif/cloudling-idle.gif" width="140"> |
| No activity (random) | idle | Reading / patrol | <img src="../../assets/gif/clawd-idle-reading.gif" width="160"> | | <img src="../../assets/gif/cloudling-idle-reading.gif" width="140"> |
| Prompt submitted | thinking | Thought bubble | <img src="../../assets/gif/clawd-thinking.gif" width="160"> | <img src="../../assets/gif/calico-thinking.gif" width="130"> | <img src="../../assets/gif/cloudling-thinking.gif" width="140"> |
| Tool running (1 busy session) | working | Typing | <img src="../../assets/gif/clawd-typing.gif" width="160"> | <img src="../../assets/gif/calico-typing.gif" width="130"> | <img src="../../assets/gif/cloudling-typing.gif" width="140"> |
| Tool running (2 busy sessions) | working (2-session tier) | Headphones groove | <img src="../../assets/gif/clawd-headphones-groove.gif" width="160"> | <img src="../../assets/gif/calico-juggling.gif" width="130"> | <img src="../../assets/gif/cloudling-juggling.gif" width="140"> |
| Tool running (3+ busy sessions) | working (building) | Building | <img src="../../assets/gif/clawd-building.gif" width="160"> | <img src="../../assets/gif/calico-building.gif" width="130"> | <img src="../../assets/gif/cloudling-building.gif" width="140"> |
| Tool failed | error | Error | <img src="../../assets/gif/clawd-error.gif" width="160"> | <img src="../../assets/gif/calico-error.gif" width="130"> | <img src="../../assets/gif/cloudling-error.gif" width="140"> |
| Turn finished / compaction finished | attention | Happy | <img src="../../assets/gif/clawd-happy.gif" width="160"> | <img src="../../assets/gif/calico-happy.gif" width="130"> | <img src="../../assets/gif/cloudling-attention.gif" width="140"> |
| Compaction started | sweeping | Sweeping | <img src="../../assets/gif/clawd-sweeping.gif" width="160"> | <img src="../../assets/gif/calico-sweeping.gif" width="130"> | <img src="../../assets/gif/cloudling-sweeping.gif" width="140"> |
| 60 s mouse idle | sleeping | Sleep | <img src="../../assets/gif/clawd-sleeping.gif" width="160"> | <img src="../../assets/gif/calico-sleeping.gif" width="130"> | <img src="../../assets/gif/cloudling-sleeping.gif" width="140"> |
| Session ended | remove session; idle if no live sessions | No sleep transition | | | |

Themes can also declare `notification` (and its mini `mini-alert`), `juggling` and `carrying` animations. The OMP integration never triggers them; Settings → Animation & Sound still lists them.

The idle rows describe each theme's stock behavior. Settings → Animation & Sound → Animations can choose any idle visual the active theme declares as its resting look. This changes only what is shown while the state is `idle`; every other state still takes precedence and returns to the chosen look afterward. The choice is stored per theme and falls back to the theme default if the file disappears. Non-default idle visuals do not use cursor eye tracking or spin-to-dizzy.

The Clawd theme has an Outlaw idle easter egg: while both the Western cowboy hat and the cigarette accessories are selected, an eligible idle roll has a 50% chance to play `clawd-outlaw-bender.svg`, with a 30-minute cooldown. Hidden, low-power, mini, roaming, dragging, menu-open and non-idle periods do not consume the roll or the cooldown. The animation draws its own hat and cigarette, so the two accessory layers are hidden only for that file.

## Mini mode

Drag the pet to the right screen edge (or right-click → "Mini Mode") to enter mini mode: half the body stays visible at the edge and peeks out on hover.

| Trigger | Mini reaction | Clawd | Calico | Cloudling |
|---|---|---|---|---|
| Default | Breathing, blinking, eye tracking | <img src="../../assets/gif/clawd-mini-idle.gif" width="100"> | <img src="../../assets/gif/calico-mini-idle.gif" width="80"> | <img src="../../assets/gif/cloudling-mini-idle.gif" width="90"> |
| Hover | Peek out and wave | <img src="../../assets/gif/clawd-mini-peek.gif" width="100"> | <img src="../../assets/gif/calico-mini-peek.gif" width="80"> | <img src="../../assets/gif/cloudling-mini-peek.gif" width="90"> |
| Turn finished | Happy celebration | <img src="../../assets/gif/clawd-mini-happy.gif" width="100"> | <img src="../../assets/gif/calico-mini-happy.gif" width="80"> | <img src="../../assets/gif/cloudling-mini-happy.gif" width="90"> |

## Click reactions

Try double-clicking, four quick clicks, or poking the pet repeatedly to find the hidden reactions.
