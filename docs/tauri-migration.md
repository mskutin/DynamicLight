# Tauri migration validation

The 0.2.0 migration replaces Electron and node-hid with Tauri 2, Rust hidapi, native screen capture, and native audio capture. The existing studio controls remain. Screen preview now shows sampled edge colors, rather than a copy of the captured desktop.

## Automated coverage

Fourteen Rust tests cover observed initialization packets, solid range clearing, report reassembly at 1/65/127 LEDs, rejection of the keyboard interface, incomplete/disconnected writes, spatial sampling, smoothing decay, bounded audio buffering, FFT frequency localization, invalid settings, atomic settings replacement, and capture/sleep state transitions. Clippy passes with warnings denied.

## Platform checks

Windows packaged-app and macOS CI checks are being completed. Physical macOS USB, capture permissions, audio, sleep/wake, and unplug/replug validation remain necessary. Simulated lifecycle tests do not replace physical suspend testing.

Screen capture uses ordinary RGB and does not apply HDR tone mapping. macOS requires 13+ for system audio. Default audio-device changes require stopping and restarting capture. No signed distribution or automatic updater is configured.
