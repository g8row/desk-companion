# TB-7304X overnight plan — for approval

Written 2026-11-16 ~03:30. Everything below runs unattended over USB (`adb` + root via Magisk).
Nothing in this plan needs you to touch the tablet; if a step would, it is skipped and reported.

---

## Where we are (verified tonight)

| | Before | Now |
|---|---|---|
| Bootloader | locked | **unlocked** (mtkclient seccfg) |
| Root | none | **Magisk 31.1**, adb shell has root |
| Packages | 124 | **45** (systemless strip module, reversible) |
| Google | Play Services, Play Store, Gboard, 11 Google apps | only WebView, package installer, 2 framework stubs |
| Free RAM (MemAvailable, idle) | ~310 MB | **~508 MB** |
| PocketJS | — | Android host running, **~5 ms mean frame, 60 FPS, ~17 MB RAM**, touch taps work |

Full partition backup (incl. IMEI/nvram + 4.6 GB system) is in `backup/partitions/`.

Hardware facts confirmed on the device: MT6737M, 4× Cortex-A53 @ up to 1.09 GHz (governor `interactive`,
min 221 MHz), **Mali-T720 GPU ("Midgard r12p1" driver, GLES 3.1, no Vulkan)**, 900 MB RAM + 448 MB zram,
1024×600 panel, kernel 3.18.

---

## Your four questions

### 1. Is it as clean and fast as it can be? — No, not yet.
Remaining fat, largest first (idle PSS):

| Process | ~MB | Plan |
|---|---|---|
| system_server | 76 | unavoidable while Android runs (see "kiosk mode" below) |
| SystemUI | 56 | keep (status/nav already hidden for PocketJS); revisit in kiosk mode |
| Lenovo launcher | 53 | **remove** once PocketJS is the HOME app |
| com.android.phone (telephony) | 24 | you don't use LTE → **airplane-mode radios off**; can't remove TeleService safely |
| MTK daemons (vtservice, em_svr, mtk loggers…) | ~20 | **stop unneeded init services** via the Magisk module (one at a time, reboot-tested) |

Speed: the frame-time **spikes (18–36 ms worst)** are the real problem, not the 5 ms average.
Most likely cause: the `interactive` CPU governor parks at 221 MHz and ramps late. Plan: raise min
frequency / pin performance while PocketJS is foreground, plus check QuickJS GC pauses. Target:
**worst frame < 16.7 ms over a 10-minute soak.**

### 2. Can it run another OS?
- **Custom Android ROM:** none exists for this model. No.
- **Mainline Linux (postmarketOS):** an MT6735-family mainline kernel exists (6.1, with display support),
  but **no port for this tablet**, Lenovo has **not published kernel source** for the TB-7304X as far as I
  can find, and WiFi (MT6625 combo chip) / touch / panel would each need driver work. Realistically
  weeks of bring-up with a real risk of no WiFi. **Not tonight.**
- **The practical "other OS": Android kernel + no Android framework ("kiosk mode").** Keep Lenovo's
  kernel and drivers (they already work), but stop Java entirely (`zygote`, `system_server`,
  SystemUI, launcher) and run the PocketJS host directly on the framebuffer + touchscreen
  (`/dev/graphics/fb0` + `/dev/input/event*`). That frees roughly **another 250–300 MB** and removes
  every Android jank source. `adbd` is native, so USB link + recovery keep working.
  Tonight: **prototype it as an opt-in toggle**, measure, and leave the tablet in normal Android mode
  by default so nothing surprises you in the morning.

### 3. What will I build in PocketJS?
The **desk companion**: tablet = touchscreen, Mac = brains.

```
Mac: deskd (Bun daemon)  ⇄ USB (adb reverse tcp:7777) ⇄  Tablet: PocketJS host + link module + Desk app
```

1. **`link` module in the Android host** — Rust socket thread to `localhost:7777` (tunnelled over USB),
   exposed to JS as `link.on(key, fn)` / `link.send(action)`; auto-reconnect; status dot in the UI.
2. **`deskd` on the Mac** (Bun, in `lenovo-tab/deskd/`):
   - keeps `adb reverse` alive (re-applies on replug);
   - **UI upload**: watches the Desk app source → `bun pocket compile` → pushes the new bundle over the
     link → tablet hot-reloads in ~1–2 s (no reinstall);
   - **providers** that push state: clock/date, Mac CPU/RAM/net, Now Playing (Music/Spotify via
     AppleScript), Claude Code session status, next calendar event (if accessible without new permissions);
   - **actions** run on tap: shell commands, `shortcuts run`, open app/URL, media play/pause/next,
     volume, mic mute — defined in one config file `deskd/config.ts`;
   - **runtime text**: bakes glyphs for unseen characters (song titles etc.) and pushes font atlases;
   - **images**: album art decoded and pushed as textures.
3. **Desk app (Solid/TSX)** — 512×300 logical canvas (fills the 1024×600 panel, no borders):
   - **Deck page**: 4×3 grid of action tiles with press feedback, long-press for page 2;
   - **Claude tile/page**: each Claude Code session's state (working / waiting for you / done),
     last message snippet, elapsed time;
   - **Now Playing** strip with art + controls; **System** strip with sparklines; big clock.
4. **Claude Code hooks** (small script `deskd/hooks/notify.sh`) that report session events to deskd.
   Installing them means adding hooks to your `~/.claude/settings.json` — **I will NOT touch that file
   without your explicit OK** (see approval list). Without it, the Claude tile shows "hooks not installed".
   *Approve-from-tablet for permission prompts is a stretch goal and needs the same OK.*

### 4. Will I test it all? — Yes. Definition of done for each piece:
- **Unit tests**: deskd protocol + config (bun test), host input/geometry/link framing (cargo test),
  existing PocketJS suites must stay green.
- **On-device E2E via adb**: launch, `input tap` on tiles → assert the Mac-side action fired (logged),
  push state from deskd → `screencap` → check pixels/text appear; hot-reload a UI change and verify.
- **Soak**: 30+ min run with live updates, logging frame cost + memory every 5 s → no crash, no leak,
  no drift; replug USB mid-run → link recovers.
- **Reboot test**: after every Magisk module change, full reboot + crash-buffer check (learned tonight).
- Morning report with screenshots and numbers, and an explicit list of anything **not** verified.

---

## Overnight order of work

1. **Safety net** (first): git-init `lenovo-tab/` (local only) and commit; branch in the `pocketjs` clone
   and commit the Android host + touch fix (local, **no push, no PR**).
2. **Speed**: diagnose the frame spikes (governor, GC, full-repaint frames), fix, soak-verify.
3. **Clean**: radios off, remove Lenovo launcher (PocketJS becomes HOME), trim MTK daemons one by one,
   reboot-test each step. Record before/after RAM.
4. **link module + deskd core** (connection, reconnect, hot reload/upload). Tests.
5. **Desk app**: deck grid + clock + system stats first (no permissions needed), then Now Playing,
   then Claude tile. Tests + screenshots at each step.
6. **Kiosk-mode prototype** (opt-in, off by default): fbdev/evdev backend in the host, measure RAM +
   frame times vs. Android mode, document how to switch.
7. **Research write-up**: mainline/postmarketOS feasibility details, GPU (Mali-T720) path if ever needed.
8. **Morning report**: `lenovo-tab/REPORT.md` — what was done, numbers, screenshots, how to run, open issues.

## Safety rules I will follow tonight
- **No writes to any flash partition** (boot, system, seccfg…). All device changes go through the
  Magisk module or `settings`, i.e. reversible from adb even if Android fails to boot.
- Every module change → reboot → verify boot completes and the crash buffer is clean; revert immediately if not.
- Never leave the tablet in kiosk mode or in a non-booting state at the end of the night.
- Nothing pushed to GitHub, no PRs, no changes to your Mac settings/Claude config without OK.
- Mac actions used for testing are harmless (logging, opening Calculator, etc.).

## Needs your OK (approve with the plan)
- [ ] Remove the Lenovo launcher and make PocketJS the HOME app (reversible via the module).
- [ ] Turn off LTE/telephony radios (airplane mode, WiFi off — USB link only).
- [ ] Add Claude Code hooks to `~/.claude/settings.json` (otherwise I build it but leave it uninstalled).
- [ ] Let deskd read Now Playing via AppleScript (macOS may show a one-time automation prompt — if it
      does, that feature waits for you in the morning).
- [ ] Kiosk-mode prototype (opt-in toggle; tablet ends the night in normal mode).

## What I can't promise
- Kiosk mode depends on the MTK fbdev driver cooperating; if the panel won't take frames without
  SurfaceFlinger, I'll document why and stop.
- Mainline Linux stays research-only.
- If USB/adb drops and won't come back (e.g. the tablet hangs hard), work on the device stops and I
  continue Mac-side (deskd, tests) — the tablet would need a power-button press from you.
