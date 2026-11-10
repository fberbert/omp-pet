# Local Activity Footprints

[Back to README](../../README.md)

OMP Pet can keep private, local footprints of the OMP activity it actually receives. Open **Settings → Footprints**, or choose **Open Footprints** from the pet's right-click menu.

Footprints is a companion-style review, not a time tracker or productivity score. It has four fixed views:

- **Today**: 24 local-hour bars, linearly scaled against that day's busiest hour
- **This week**: seven rows of 24 local-hour cells
- **This month**: a Monday-first calendar
- **This year**: 12 rows with up to 31 day cells

Hover or focus the agent row to highlight it. Click the row, or press Enter or Space, to lock the highlight; press Escape to unlock it. Hover an activity bar or cell to see that period's numbers. The timeline is one keyboard stop: use the arrow keys, Home and End to move between periods.

While Footprints is open, newly accepted activity refreshes the visible range automatically. Short event bursts are coalesced so the page does not rebuild for every signal.

## What the numbers mean

Footprints counts accepted activity signals. It never guesses work time from process uptime or idle thresholds.

| Value | Meaning |
|---|---|
| Agents seen | Whether OMP produced accepted activity in the selected range |
| Turns completed | Accepted `Stop` events, which the extension sends only after the `session_stop` / `agent_end` completion check (see [state mapping](state-mapping.md)) |
| Tool calls | Accepted tool starts (`PreToolUse`) |
| Activity bar or cell | Accepted activity signals in that local hour or day |

A dash (`-`) means the value cannot be measured reliably, which is different from `0`. The views do not show tokens, cost, models, reasoning level, skills, work or coding duration, streaks, longest sessions, peak days, rankings or productivity scores.

## Recorded, not recorded, and clock changes

A quiet period means something only while the pet was able to record, so Footprints stores coverage separately from activity:

- a covered empty cell means the pet was running and recording but received no accepted signal;
- an uncovered period means the pet was closed, the computer was suspended, or recording was off;
- dates before Footprints was first enabled are marked as not started and are never backfilled;
- Do Not Disturb still records accepted activity; it suppresses animation, not observation;
- a daylight-saving hour that never existed is marked as a gap;
- when the clock repeats an hour, both real intervals stay distinct in storage and share one marked cell;
- events keep the local date, time zone and offset from when they were accepted, so travelling later does not move old activity to another day.

The extension's events carry no timestamp of their own, so the pet uses the desktop clock at the moment it accepts each event.

## Local storage and privacy

Recording is on by default. It creates only local files under `~/.omp-pet/recap-v1/`:

```text
meta.json                         local salt, frozen recording start, retention settings
events/YYYY-MM-DD.jsonl          minimized event tickets for 14 local days
daily-YYYY-MM.json               daily aggregates retained for 400 local days
coverage-YYYY-MM.json            recording coverage retained for 400 local days
coverage-open.json               crash-safe heartbeat for the current coverage interval
quarantine/                      bounded recovery copies of rejected managed files
```

The tickets contain a timestamp, frozen local time fields, the agent id, a scope class, metric flags, and HMAC identifiers used for short-term deduplication. The pet never writes prompt or response text, commands, tool names or arguments, tool output, paths, file names, project or repository names, branches, session titles, working directories, account identifiers, raw session, event, turn or tool identifiers, or the original event name into recap storage.

Footprints adds no telemetry, network requests, export, sharing, notifications or automatic posting.

Malformed managed files and unsupported schemas are rejected. When possible they move into `quarantine/`, which is pruned after seven days and capped at 16 files and 1 MiB in total. **Clear footprint data** removes the quarantine together with the rest of the recap history.

If the pet recovered damaged preferences or could not use them safely, Footprints stays paused even when recording is on, and the page explains why. Review Settings and turn the recording switch off and on to resume once Settings can be saved; unreadable preferences must be repaired and the pet restarted first.

Turn off **Record footprints** to stop new tickets and close the current coverage interval. **Clear footprint data** removes the recap history and rotates the local HMAC salt; it cannot be undone.

## Maintainer invariants

- Record only after the agent gate, deduplication and completion handling have accepted the event. Entry into `updateSession()` is not an acceptance boundary.
- Metric support comes from the explicit table in `src/recap-metrics.js`; do not infer it from registry capabilities or event names.
- Keep ephemeral ingress identities separate from the persisted data. Persist only HMAC values when a stable identity is needed.
- Preserve `null` for unsupported metrics. Never render or aggregate it as zero.
- Do Not Disturb must not stop coverage. Suspend, process shutdown and the recording preference do.
- Journal before updating the aggregate so retained tickets can rebuild interrupted writes. Keep the 14-day ticket and 400-day daily/coverage retention bounded.
- Rebuild retained journal history by streaming tickets into a separate daily projection in bounded batches, then swap it in synchronously. Hydration must not hold the retained tickets in memory.
- Historical civil dates are frozen at acceptance time. Preserve epoch time, IANA time zone, UTC offset, local date and local hour.
- Footprints does not show a "Sessions started" count: OMP's `SessionStart` carries no fresh-start signal. The daily aggregate still stores `sessionsStarted` and `sessionsStartedPartial`; keep those fields until a schema change is planned.
- Do not add tokens, duration, cost, streaks, scores, export or sharing, network delivery, raw content, or long-lived linkable identities without a new privacy review.
