# DynamicLight

A lightweight Windows/macOS app for SyncLight-compatible USB monitor backlights, built with **Tauri 2 and Rust**. No account, cloud service, or original SyncLight installation is needed.

**Early prototype:** the original USB protocol was verified on a ROBOBLOQ controller. The native migration's validation is tracked in [docs/tauri-migration.md](docs/tauri-migration.md). macOS hardware validation is still pending.

![DynamicLight lighting studio](docs/studio.png)

[Feature and UI backlog](BACKLOG.md) · [Issues](https://github.com/mskutin/DynamicLight/issues) · [Builds](https://github.com/mskutin/DynamicLight/actions/workflows/build.yml) · [Contributing](CONTRIBUTING.md)

## Use

Download the appropriate artifact from a successful [GitHub Actions build](https://github.com/mskutin/DynamicLight/actions/workflows/build.yml). Windows builds provide a per-user NSIS installer; macOS builds provide separate Apple Silicon and Intel DMGs. Builds are currently unsigned. macOS requires version 13 or later. Windows uses the installed Microsoft WebView2 runtime; the installer can bootstrap it if missing.

Exit SyncLight and any older DynamicLight instance, launch DynamicLight, then click **Connect strip**.

- **Solid color:** choose a color and brightness.
- **Screen sync:** refresh the display list, select a display, and click Start capture. The preview shows sampled edge colors, without copying your desktop into the UI.
- **Music:** select Computer audio or Microphone, then Start capture. Windows computer audio uses WASAPI loopback; macOS uses ScreenCaptureKit. Microphone capture uses the default input device.
- **Color flow:** a moving spectrum generated in Rust.
- **Strip setup:** LED count, three/four-sided layout, direction, starting offset, smoothing, frame rate, and sleep/quit behavior.

Closing the window keeps the app and native lighting worker running in the tray/menu bar. Use **Quit DynamicLight** or the tray menu to exit. Only one app instance runs at a time.

The initial profile is 65 LEDs, three sides, RGB, and 38% brightness. Layout starts at bottom-left, travels up the left edge, across the top, and down the right. Four-sided mode also crosses the bottom. Physical spacing is approximated from the display aspect ratio. The supported count is 1–127 LEDs.

Connection requires a click. After connecting, the app retries a lost connection every three seconds. Screen/audio capture always requires Start capture. Power off, disconnect, changing mode/source, sleep, and quit stop capture. After sleep, turn the lights on and explicitly restart capture. Computer suspend is supported; display-only sleep is not currently monitored.

On macOS, allow **Screen & System Audio Recording** (called Screen Recording on older macOS versions) in System Settings → Privacy & Security. Microphone mode needs its own permission. Restart the app after changing permissions if required. Capture is processed in memory and is neither recorded nor uploaded. Protected content may appear black; HDR tone mapping is not implemented.

## Develop

Install [Tauri's system prerequisites](https://v2.tauri.app/start/prerequisites/), current stable Rust (tested with 1.99.1), Node.js 24, and pnpm 11. Windows needs the Visual Studio C++ build tools and Windows SDK; macOS needs Xcode command-line tools.

```sh
pnpm install --frozen-lockfile
pnpm start                 # Native app with development rebuilds
pnpm test                  # Rust protocol, settings, audio, sampling, lifecycle tests
pnpm check                 # Clippy, with warnings treated as errors
pnpm run build:win         # Windows NSIS installer, on Windows
pnpm run build:mac         # macOS DMG for the host architecture, on macOS
```

For another Mac architecture, use `rustup target add x86_64-apple-darwin` or `aarch64-apple-darwin`, then `pnpm tauri build --target <target> --bundles dmg`. CI builds Windows x64 and both Mac architectures. Bundles appear in `src-tauri/target[/<target>]/release/bundle/`. Cargo.lock and pnpm-lock.yaml are committed.

`scripts/smoke.cjs` tests the packaged Windows UI and IPC through WebView2's local debugging port. Install `playwright-core` separately or set `PLAYWRIGHT_PATH` to an existing Playwright installation. Close any running DynamicLight first. `node scripts/smoke.cjs --hardware` additionally changes the strip and briefly captures screen/system audio. Ordinary tests never access USB or start capture. Set `DYNAMICLIGHT_EXECUTABLE` to test an installed executable. The debugging port is enabled only in that test process.

## Implementation

- `src-tauri/src/protocol.rs` implements RB commands and SC frames, split into 64-byte payloads plus report ID 0.
- `device.rs` opens only the lighting interface, rejects the keyboard interface, checks complete writes, and drains replies. A single worker owns all USB operations.
- `engine.rs` owns settings, capture lifetimes, effects, smoothing, reconnect, and frame pacing. It does not depend on JavaScript timers. Preview events are limited to 10 Hz and suppressed while the window is unfocused, hidden, or minimized.
- `capture.rs` enumerates displays through xcap. Windows uses Desktop Duplication with direct edge sampling from a reusable GPU staging texture, with a small GDI thumbnail as a fallback for unsupported or rotated displays. macOS uses native xcap capture. `audio.rs` uses bounded sample buffers and RustFFT. The macOS bridge handles ScreenCaptureKit system audio, microphone permission, and sleep notifications.
- The HTML/CSS/JavaScript UI sends validated commands through Tauri IPC. It has no Node.js, filesystem, shell, or remote network access. Runtime assets are embedded in the executable.

Settings are atomically saved under the OS application-data directory in `com.dynamiclight.desktop/settings.json`. On first launch, valid settings from the Electron prototype's `dynamiclight/settings.json` are imported. Legacy display IDs reset to the primary display because native display IDs differ. The old file is retained.

Protocol references: [HdrBridge wire format](https://github.com/GetTheNya/HdrBridge/blob/main/node_strip_test.js), [SyncLight RB commands](https://github.com/jakebuild/synclight), and [section command investigation](https://github.com/tanmaster/light-control).

## License

Copyright (c) 2026 mskutin. Released under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.
