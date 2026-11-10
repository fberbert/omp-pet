# Release Process

OMP Pet ships Linux x64 AppImage and `.deb` packages. There is no auto-updater, no signing and no package-repository publishing.

## Before tagging

1. Start from a clean `main` with the release changes merged.
2. Bump `version` in `package.json` (and `package-lock.json` through `npm version <x.y.z> --no-git-tag-version`).
3. Run the checks locally:
   ```bash
   npm ci
   npm test
   npm run audit:assets
   ```
4. Build and smoke-test the packages:
   ```bash
   npm run build:linux:x64
   ```
   - Launch the AppImage and the extracted `dist/linux-unpacked/omp-pet` on an X11 session.
   - Confirm the server answers (`bash test-oneshot-gate.sh attention`) and the pet reacts.
   - Start a new OMP session and confirm thinking, working, completion and session end appear in the HUD and Dashboard.
   - Open Settings → AI Coding Tools and confirm the OMP integration shows as installed; run Uninstall and Install once.
   - Click a session in the Dashboard and confirm the terminal is raised.
   - Install the `.deb` on a test machine and confirm the menu entry and launch.
5. Write release notes: user-visible changes, fixes, and any new known limitations.

## Tag and build

Pushing a `v*` tag runs `.github/workflows/build.yml` on `ubuntu-latest`:

1. `npm ci`
2. `xvfb-run -a npm test`
3. `electron-builder --linux --publish never`
4. `scripts/verify-appimage-apprun.js` checks the final AppRun search paths and the launcher guard.
5. `scripts/audit-packaged-native.js` checks that only the expected native payload (one Linux x64 `koffi.node`) is packaged.
6. `scripts/run-packaged-koffi-smoke.js` launches the packaged app under xvfb with a root-owned `chrome-sandbox`.
7. The AppImage, `.deb` and audit manifests are uploaded as workflow artifacts.

The workflow does not publish a GitHub release. Download the artifacts, check their sizes and names (`OMP-Pet-<version>-x86_64.AppImage`, `OMP-Pet-<version>-amd64.deb`), and attach them to a release by hand with the notes from step 5.

## Packaging invariants

- Each package keeps exactly one Koffi `koffi.node` for its target. `afterPack` (`scripts/after-pack-koffi.js`) prunes only physical files under `app.asar.unpacked` and never rewrites `app.asar`.
- The AppImage launcher (`build/appimage-launcher.sh`, wired by `scripts/prepare-appimage-launcher.js`) copies the app to a private `TMPDIR` directory on FUSE launches. See [known limitations](../guides/known-limitations.md) for the user-facing side.
- Artwork under `assets/` and `themes/*/assets/` is not AGPL-licensed. Redistributing builds that include the bundled themes needs permission from the artwork owners (see the README license notes).
