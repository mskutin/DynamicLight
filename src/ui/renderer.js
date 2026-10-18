"use strict";
const $ = (id) => document.getElementById(id);
const { invoke } = window.__TAURI__.core;
let settings,
  runtime,
  saveTimer,
  busy = false,
  queue = Promise.resolve(),
  platform = "";
let previewPending,
  previewDirty = false,
  revision = 0,
  lastError = "";
const labels = {
  solid: "Solid color",
  screen: "Screen sync",
  music: "Music",
  rainbow: "Effects",
};
const effectLabels = {
  rainbow: "Color flow",
  aurora: "Aurora",
  breath: "Breathe",
  comet: "Comet",
  ember: "Ember",
};
const captions = {
  solid: "A steady glow, exactly how you like it.",
  screen: "Your screen, extended into your space.",
  music: "Sound becomes color. Make it your own.",
  rainbow: "A little movement changes everything.",
};
const titles = {
  solid: "Set the atmosphere.",
  screen: "Go beyond the screen.",
  music: "Give your sound a new dimension.",
  rainbow: "Find your flow.",
};
const ranges = {
  brightness: "brightness",
  sensitivity: "sensitivity",
  smoothing: "smoothing",
  speed: "speed",
  "noise-floor": "noiseFloor",
  release: "release",
};
function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
  $("notice").classList.toggle("error", error);
}
function request(action) {
  const pending = queue
    .catch(() => {})
    .then(() => invoke("control", { action }));
  queue = pending;
  return pending.then((value) => {
    renderRuntime(value);
    return value;
  });
}
function renderRuntime(value) {
  runtime = value;
  if (!settings) return;
  const connected = value.status.connected;
  const current = value.settings;
  const waiting =
    ["screen", "music"].includes(current.mode) && !value.capturing;
  const active =
    connected && value.powered && !waiting && current.brightness > 0;
  $("status-dot").classList.toggle("connected", connected);
  $("live-dot").classList.toggle("active", active);
  $("status-label").textContent = connected ? "Connected" : "Not connected";
  $("connect").textContent = connected ? "Disconnect ↗" : "Connect strip ↗";
  $("connection-message").textContent = value.status.message;
  $("power").classList.toggle("off", !value.powered);
  $("power").setAttribute("aria-pressed", value.powered);
  $("power").querySelector("span").textContent = !value.powered
    ? "Turn lights on"
    : !connected || waiting
      ? "Power enabled"
      : "Turn lights off";
  $("power").setAttribute(
    "aria-label",
    value.powered ? "Turn lights off" : "Turn lights on",
  );
  $("capture").textContent = value.capturing
    ? "Stop capture"
    : connected
      ? "Start capture"
      : "Connect & start capture";
  $("capture").disabled = busy;
  $("frame-rate").textContent = !connected
    ? "Disconnected · Preview only"
    : !value.powered
      ? "Lights off"
      : waiting
        ? "Capture stopped · Strip dark"
        : current.brightness === 0
          ? "Brightness zero · Strip dark"
          : value.capturing || current.mode === "rainbow"
            ? `${value.fps} FPS · USB`
            : "Solid color · USB";
  $("activity-label").textContent = !connected
    ? "Offline"
    : active
      ? "Sending"
      : "Standby";
  $("usb-fps").textContent = connected ? value.fps : "—";
  $("write-time").textContent =
    connected && value.lastWriteMs !== null
      ? value.writeDurationMs.toFixed(1)
      : "—";
  $("last-write").textContent =
    value.lastWriteMs === null
      ? "Never"
      : value.lastWriteMs < 1000
        ? `${value.lastWriteMs} ms ago`
        : `${Math.floor(value.lastWriteMs / 1000)} s ago`;
  $("frames-written").textContent = value.framesWritten.toLocaleString();
  $("write-errors").textContent = value.writeErrors.toLocaleString();
  $("capture-size").textContent = value.captureSize[0]
    ? value.captureSize.join(" × ")
    : "—";
  $("audio-level").textContent =
    current.mode === "music" && value.capturing
      ? `${Math.round(value.audioLevel * 100)}% RMS`
      : "—";
  $("audio-status").textContent = !value.capturing
    ? "Capture stopped"
    : !value.audioSamples
      ? "Waiting for audio"
      : value.audioLevel <= current.noiseFloor / 100
        ? "Quiet / below gate"
        : "Audio arriving";
  if (value.error && value.error !== lastError) notice(value.error, true);
  else if (!value.error && lastError && $("notice").classList.contains("error"))
    notice("");
  lastError = value.error;
  draw(value.colors);
  drawSpectrum(value.audioBands);
}
function selectButtons(selector, key, selected) {
  document.querySelectorAll(selector).forEach((button) => {
    const match = button.dataset[key] === selected;
    button.classList.toggle("selected", match);
    button.setAttribute("aria-pressed", match);
  });
}
function updateUI() {
  selectButtons("[data-mode]", "mode", settings.mode);
  selectButtons("[data-effect]", "effect", settings.effect);
  selectButtons("[data-music]", "music", settings.musicStyle);
  selectButtons("[data-color]", "color", settings.color.toLowerCase());
  $("mode-badge").textContent =
    settings.mode === "rainbow"
      ? effectLabels[settings.effect]
      : labels[settings.mode];
  $("preview-title").textContent = titles[settings.mode];
  $("preview-caption").textContent = captions[settings.mode];
  $("color").value = settings.color;
  $("hex-value").textContent = settings.color.toUpperCase();
  for (const [id, key] of Object.entries(ranges)) {
    $(id).value = settings[key];
    $(id + "-value").textContent = settings[key] + "%";
  }
  for (const name of ["count", "sides", "offset", "fps", "palette"])
    $(name).value = settings[name];
  $("audio-source").value = settings.audioSource;
  $("reverse").checked = settings.reverse;
  $("off-on-sleep").checked = settings.offOnSleep;
  $("off-on-quit").checked = settings.offOnQuit;
  $("device-detail").textContent = `${settings.count} LEDs · USB HID`;
  $("led-total").textContent = `→ ${settings.count}`;
  $("capture-controls").hidden = !["screen", "music"].includes(settings.mode);
  $("display-controls").hidden = settings.mode !== "screen";
  $("music-controls").hidden = settings.mode !== "music";
  $("effect-controls").hidden = settings.mode !== "rainbow";
  $("solid-hint").hidden = settings.mode !== "solid";
  $("palette-controls").hidden = !["music", "rainbow"].includes(settings.mode);
  const fixedPalette =
    settings.mode === "rainbow" &&
    ["rainbow", "ember"].includes(settings.effect);
  $("palette").disabled = fixedPalette;
  $("palette-help").textContent = fixedPalette
    ? "This effect has its own signature colors."
    : "Applies to your selected music style or effect.";
  $("color-control").hidden =
    settings.mode === "screen" ||
    (settings.mode !== "solid" &&
      (settings.palette !== "mono" || fixedPalette));
  $("speed-controls").hidden =
    settings.mode !== "rainbow" &&
    !(settings.mode === "music" && settings.musicStyle === "wave");
  $("smoothing").disabled = settings.mode === "solid";
  $("screen").disabled = settings.mode !== "screen";
  $("refresh-screens").disabled = busy || settings.mode !== "screen";
  $("capture-help").textContent =
    settings.mode === "screen"
      ? "Capture stays on this computer. " +
        (platform === "linux"
          ? "Screen sync needs an X11 session; Wayland support is planned."
          : platform === "macos"
            ? "Allow Screen Recording in Privacy settings."
            : "Only edge colors are sent to your strip.")
      : "Audio is analyzed locally. " +
        (platform === "linux"
          ? "Computer audio uses PulseAudio or PipeWire."
          : platform === "macos"
            ? "Allow Screen & System Audio Recording for computer audio, or Microphone access for your mic."
            : "Computer audio follows your speakers. Microphone listens to your room.");
  if (runtime) renderRuntime(runtime);
}
// Coalesce drag updates: at most one preview IPC in flight, then the newest value.
// Disk writes happen after the user pauses, not on each animation frame.
function previewSettings() {
  previewDirty = true;
  if (!previewPending) {
    previewPending = (async () => {
      while (previewDirty) {
        previewDirty = false;
        await request({ type: "previewSettings", settings: { ...settings } });
      }
    })()
      .catch((error) => {
        notice(String(error), true);
        $("save-state").textContent = "Not saved";
      })
      .finally(() => {
        previewPending = undefined;
      });
  }
  return previewPending;
}
async function save() {
  clearTimeout(saveTimer);
  await previewPending;
  const savingRevision = revision;
  $("save-state").textContent = "Saving…";
  try {
    const result = await request({
      type: "settings",
      settings: { ...settings },
    });
    if (savingRevision === revision) $("save-state").textContent = "Saved";
    return result;
  } catch (error) {
    $("save-state").textContent = "Not saved";
    throw error;
  }
}
function changed() {
  revision++;
  updateUI();
  $("save-state").textContent = "Applying…";
  previewSettings();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () => save().catch((error) => notice(String(error), true)),
    650,
  );
}
async function run(action) {
  if (busy) return;
  busy = true;
  const controls = ["connect", "power", "capture", "refresh-screens"];
  controls.forEach((id) => {
    $(id).disabled = true;
  });
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.disabled = true;
  });
  notice("");
  try {
    await action();
  } catch (error) {
    notice(String(error), true);
  } finally {
    busy = false;
    controls.forEach((id) => {
      $(id).disabled = false;
    });
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.disabled = false;
    });
    updateUI();
  }
}
function positions(count, sides) {
  const aspect = 16 / 9,
    perimeter = 2 + aspect * (sides === 4 ? 2 : 1);
  return Array.from({ length: count }, (_, i) => {
    const p = ((i + 0.5) / count) * perimeter;
    if (p < 1) return [0, 1 - p];
    if (p < 1 + aspect) return [(p - 1) / aspect, 0];
    if (p < 2 + aspect) return [1, p - 1 - aspect];
    return [1 - (p - 2 - aspect) / aspect, 1];
  });
}
function draw(colors) {
  const ctx = $("preview").getContext("2d");
  ctx.clearRect(0, 0, 1000, 420);
  const s = runtime.settings;
  const shown = runtime.powered ? colors : colors.map(() => [0, 0, 0]);
  const points = positions(shown.length, s.sides);
  ctx.strokeStyle = "#283a402b";
  ctx.lineWidth = 1;
  for (let x = 20; x < 1000; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x, 400);
    ctx.stroke();
  }
  for (let y = 20; y < 420; y += 40) {
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(980, y);
    ctx.stroke();
  }
  // The glow uses actual generated colors, including silence and lights-off black.
  shown.forEach((rgb, i) => {
    const [x, y] = points[i],
      px = 235 + x * 530,
      py = 55 + y * 275;
    const glow = ctx.createRadialGradient(px, py, 0, px, py, 75);
    glow.addColorStop(0, `rgba(${rgb.join(",")},0.13)`);
    glow.addColorStop(1, `rgba(${rgb.join(",")},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(px - 75, py - 75, 150, 150);
  });
  ctx.fillStyle = "#0c1419";
  ctx.strokeStyle = "#4b6269";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(247, 66, 506, 253, 11);
  ctx.fill();
  ctx.stroke();
  const color = shown[Math.floor(shown.length / 2)] || [0, 0, 0];
  const gradient = ctx.createLinearGradient(260, 80, 730, 310);
  gradient.addColorStop(0, `rgba(${color.join(",")},0.15)`);
  gradient.addColorStop(1, "#10191e");
  ctx.fillStyle = gradient;
  ctx.fillRect(257, 76, 486, 232);
  ctx.strokeStyle = "#849c9830";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.ellipse(500, 190, 45 + i * 21, 36 + i * 8, -0.35, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#d5e7e0";
  ctx.font = "500 23px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(
    !runtime.powered
      ? "Lights off"
      : ["screen", "music"].includes(s.mode) && !runtime.capturing
        ? "Ready when you are"
        : s.mode === "rainbow"
          ? effectLabels[s.effect]
          : labels[s.mode],
    500,
    187,
  );
  ctx.font = "11px Segoe UI";
  ctx.fillStyle = "#94b3aa";
  ctx.fillText(
    !runtime.status.connected
      ? "CONNECT YOUR STRIP TO BRING IT TO LIFE"
      : ["screen", "music"].includes(s.mode) && !runtime.capturing
        ? "START CAPTURE BELOW"
        : "YOUR SPACE, REIMAGINED",
    500,
    213,
  );
  shown.forEach((rgb, i) => {
    const [x, y] = points[i];
    ctx.beginPath();
    ctx.fillStyle = rgb.some((c) => c > 0)
      ? `rgb(${rgb.join(",")})`
      : "#34434a";
    ctx.arc(235 + x * 530, 55 + y * 275, 3.2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#283a40";
  ctx.fillRect(486, 321, 28, 29);
  ctx.beginPath();
  ctx.roundRect(439, 350, 122, 5, 3);
  ctx.fill();
  ctx.fillStyle = "#6e868f";
  ctx.font = "10px Segoe UI";
  ctx.fillText(`${s.count} LEDS  /  ${s.sides}-SIDE LAYOUT`, 500, 384);
  const strip = $("strip-preview").getContext("2d");
  strip.clearRect(0, 0, 1000, 18);
  shown.forEach((_, i) => {
    const j = (i + s.offset) % shown.length,
      rgb = shown[s.reverse ? shown.length - 1 - j : j];
    strip.fillStyle = `rgb(${rgb.join(",")})`;
    strip.fillRect(
      (i * 1000) / shown.length,
      0,
      Math.max(1, 1000 / shown.length - 1),
      18,
    );
  });
}
function drawSpectrum(bands) {
  if ($("music-controls").hidden) return;
  const ctx = $("spectrum").getContext("2d");
  ctx.clearRect(0, 0, 800, 110);
  bands.forEach((v, i) => {
    const h = Math.max(2, v * 100);
    ctx.fillStyle = `hsl(${155 + i * 2.7} 65% ${50 + v * 16}%)`;
    ctx.globalAlpha = 0.25 + v * 0.75;
    ctx.beginPath();
    ctx.roundRect(i * 25 + 3, 108 - h, 15, h, 3);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}
async function init() {
  platform = await invoke("platform_name");
  if (platform === "linux")
    $("close-behavior").textContent =
      "Closing the window minimizes it and keeps lighting running. Use Quit DynamicLight to exit.";
  await window.__TAURI__.event.listen("lighting", (event) =>
    renderRuntime(event.payload),
  );
  const initial = await request({ type: "snapshot" });
  settings = initial.settings;
  updateUI();
  $("connect").onclick = () =>
    run(async () => {
      await save();
      await request({
        type: runtime.status.connected ? "disconnect" : "connect",
      });
    });
  $("power").onclick = () =>
    run(async () => {
      await save();
      await request({ type: "power", on: !runtime.powered });
    });
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.onclick = () =>
      run(async () => {
        settings.mode = button.dataset.mode;
        await save();
        if (["screen", "music"].includes(settings.mode))
          notice("Choose your source, then start capture.");
      });
  });
  for (const [selector, dataset, key] of [
    ["[data-effect]", "effect", "effect"],
    ["[data-music]", "music", "musicStyle"],
    ["[data-color]", "color", "color"],
  ]) {
    document.querySelectorAll(selector).forEach((button) => {
      button.onclick = () => {
        settings[key] = button.dataset[dataset];
        changed();
      };
    });
  }
  $("color").oninput = (event) => {
    settings.color = event.target.value;
    changed();
  };
  for (const [id, key] of Object.entries(ranges))
    $(id).oninput = (event) => {
      settings[key] = Number(event.target.value);
      changed();
    };
  for (const name of ["count", "sides", "offset", "fps"])
    $(name).onchange = (event) => {
      if (event.target.checkValidity()) {
        settings[name] = Number(event.target.value);
        changed();
      }
    };
  $("palette").onchange = (event) => {
    settings.palette = event.target.value;
    changed();
  };
  for (const [id, key] of [
    ["reverse", "reverse"],
    ["off-on-sleep", "offOnSleep"],
    ["off-on-quit", "offOnQuit"],
  ])
    $(id).onchange = (event) => {
      settings[key] = event.target.checked;
      changed();
    };
  $("audio-source").onchange = (event) => {
    settings.audioSource = event.target.value;
    changed();
    notice("Start capture to use the selected audio source.");
  };
  $("screen").onchange = (event) => {
    settings.screenId = event.target.value;
    changed();
    notice("Start capture to use the selected display.");
  };
  $("refresh-screens").onclick = () =>
    run(async () => {
      const screens = await invoke("displays");
      $("screen").replaceChildren();
      for (const screen of screens) {
        const option = document.createElement("option");
        option.value = screen.id;
        option.textContent = screen.name;
        $("screen").append(option);
      }
      if (screens.some((screen) => screen.id === settings.screenId))
        $("screen").value = settings.screenId;
      else {
        settings.screenId = screens[0]?.id || "";
        await save();
      }
    });
  $("capture").onclick = () =>
    run(async () => {
      await save();
      if (runtime.capturing) {
        await request({ type: "stopCapture" });
        return;
      }
      if (!runtime.status.connected) await request({ type: "connect" });
      if (!runtime.powered) await request({ type: "power", on: true });
      await request({ type: "startCapture" });
    });
  $("quit").onclick = () =>
    run(async () => {
      await save();
      await invoke("quit");
    });
  document.querySelector('a[href="#setup"]').onclick = () => {
    $("setup").open = true;
  };
  window.addEventListener("focus", () =>
    request({ type: "snapshot" }).catch((error) => notice(String(error), true)),
  );
}
init().catch((error) => notice(`Unable to initialize: ${error}`, true));
