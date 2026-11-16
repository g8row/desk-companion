# Overnight log — TB-7304X

Plan: [PLAN-overnight.md](PLAN-overnight.md). Newest entries at the bottom. Times are Mac local.

**Your approvals (03:35):** everything in the plan except long soak runs. Keep Wi-Fi working.
Kiosk mode and mainline Linux are priorities — try hard. Kernel experiments: `fastboot boot` (RAM only);
anything that might need your hands (power button) is saved for last. Downloads/toolchains OK.
Now Playing = Apple Music (automation access already works). Claude hooks OK.

---

## 03:35 — start
- Mac kept awake for the session.
- Music automation check: `player state` readable, no prompt needed.

## 03:40 — frame-time spikes fixed
- Added per-phase timing to the host (js / core / draw, over-budget count).
- Cause: MTK hotplug kept only **2 of 4 cores** online and the clock bounced **221 MHz ↔ 1.09 GHz**;
  spikes hit every phase (even the 0.01 ms core tick took 24 ms) → thread stalls, not our code.
- Fix (Magisk `service.sh`): 4 cores always online (`/proc/hps/num_base_perf_serv=4`), min clock 858 MHz.
- Result on the hero demo: **mean 5.0 → 2.4 ms, worst 18–49 → ~6 ms, 0/300 frames over budget.**

## 03:45 — cleanup round 2 (reboot-tested ✅)
- Lenovo launcher + launcher provider + MTK battery-warning app hidden → **PocketJS is now the HOME app**.
- Stopped at boot: MTK loggers (`emdlogger1`, `mobile_log_d`), engineering mode (`emsvr_user`), video calling
  (`vtservice`), Wi-Fi calling (`epdg_wod`), `netdiag`, GPS/AGPS (`agpsd`, `mnld`, `wifi2agps`, `slpd`),
  device-mgmt agents (`DMAgent`, `PPLAgent`), `batterywarning`, `cameraserver`. Modem daemons left alone.
- **LTE off, Wi-Fi on**: airplane mode restricted to the cellular radio (`airplane_mode_radios=cell`).
  Verified: Wi-Fi connected to the home network, `ping 1.1.1.1` OK (10 ms).
- Installed **Simple Keyboard** (open source, F-Droid, 650 KB) as the keyboard so Wi-Fi passwords etc. can be typed.
- Reboot: boot in ~36 s, **0 system crashes**, all 4 cores online, services confirmed stopped.
- ⚠️ Battery was at **9%** (charging over USB). Keep it plugged in.
- Screenshot: `shots/01-after-clean-reboot.png` (Wi-Fi settings were on screen after reboot).

## 03:50 — your Wi-Fi/Settings question
- **No wipe needed** (and better without one): the mtkclient unlock didn't erase data, and a wipe would
  drop adb authorization, the Magisk app/root grant, keyboard and Wi-Fi setup.
- The Settings crash was a one-off known Android 7 Wi-Fi dialog bug (`showDialog` after `onSaveInstanceState`)
  — one occurrence in the crash log; Wi-Fi connected fine.
- Headunit Reloaded came up because it's the previous task and it listens for USB device attach.
  Suggest uninstalling it (APK kept in `backup/apks/`) — **waiting for your OK**, not touching it.
- 03:55 Uninstalled Headunit Reloaded (your OK). APK kept in `backup/apks/gb.xxy.hr.apk`.

## [mainline agent] 03:14 — research + LK/DTB analysis done
- Mainline tree: gitlab.com/mt6735-mainline/linux, branch mt6735-stable-7.0.y @ 046883c0 (v7.0.10-mt6735, same as pmOS
  linux-postmarketos-mediatek-mt6735 7.0.10). Boards in tree: Doogee X5 Pro (MT6735P, uses mt6735m.dtsi — closest to us),
  Samsung Grand Prime+ (MT6737T). Drivers present: clk, pinctrl, pwrap+MT6328, mmc, musb USB, DRM/DSI, Mali node, i2c, wdt.
- **Stock LK does NOT register a `boot` fastboot command** (disassembled lk.bin: registered = getvar, download, flash, erase,
  continue, reboot, reboot-bootloader, oem p2u/reboot-recovery/append-cmdline/off-mode-charge). Expect `fastboot boot`
  → "unknown command". RAM-only test likely impossible via LK fastboot; alternative = flash *recovery* partition (backed up)
  + `fastboot oem reboot-recovery`. Needs the user's OK — it writes flash (recovery only, boot untouched).
- Stock boot.img: v0, page 2048, kernel@0x40080000 (gzip Image + appended DTB, no MTK headers), ramdisk@0x44000000,
  tags@0x4e000000, cmdline "bootopt=64S3,32N2,64N2" (LK needs bootopt to pick 64-bit).
- Stock DTB: touch Goodix GT9293 @ i2c1 0x5d (alt FocalTech FT5x46 @0x38), LCM candidates nt51021b_dsi_vdo_{dj,gx},
  nt35521z_dsi_vdo_gx, hx8394d_dsi_vdo_boe (LK picks by ID), charger SM5414 @ i2c3 0x49, PMIC MT6328 via pwrap,
  LK passes fb base via /chosen "atag,videolfb".

## 04:20 — desk companion working end to end ✅
Built tonight: **`link` module** in the Android host, **`deskd`** (Mac daemon, `lenovo-tab/deskd/`),
and the **Desk app** (`pocketjs/apps/desk/`, 512×300 logical = full 1024×600 panel, no borders).
- Transport: TCP 127.0.0.1:7777 over USB via `adb reverse` (deskd re-applies it every 3 s).
- **Hot reload / UI upload works**: edit a file in `apps/desk/` → deskd rebuilds (~1.5–2.7 s) →
  pushes the bundle → tablet swaps it in place (~2 s total, no reinstall). Verified twice.
- **Live data**: clock/date, Mac CPU/RAM, link status, deck tiles with live subtitles, Claude sessions.
- **Actions verified on device**: tapped *Mic* via adb → Mac input volume 71 → 0 and the tile showed
  MUTED; tapped again → back to 71 (`shots/05-mic-muted-by-tap.png`).
- **Claude Code hooks installed** in `~/.claude/settings.json` (backup: `backup/claude-settings.json.bak`):
  SessionStart, UserPromptSubmit, PreToolUse, Notification, Stop, SessionEnd → `deskd/hooks/claude-hook.sh`
  (1 s timeout, never blocks a session). Verified: this session shows up live as "working"
  (`shots/06-claude-hooks.png`).
- Text: font atlases bake ASCII + Latin-1 + Latin Ext-A + **Cyrillic** + symbols (pak 7 MB).
- Tests: deskd 5/5 (`bun test`), host 5/5 (`cargo test`), PocketJS input/touch suites 34/34.
- Bugs found+fixed on the way: INTERNET permission missing; 512 rejected by a ≤511 check; Bun socket
  partial writes truncating the 9.6 MB bundle line (now a drain-aware write queue); frame hooks
  registered before `mount()` get wiped; reconnect busy-loop when deskd is down.
- **Not verified yet**: Now Playing with real music + album art (Music is stopped; I won't play audio
  at night). Volume tiles not pressed (would change your volume).
- Run it: `cd ~/lenovo-tab/deskd && bun main.ts` (it's running now in the background, log `deskd/deskd.log`).

## [mainline agent] 03:25 — kernel built, images ready (not tested on device)
- Built mt6735-mainline 7.0.10 (pmOS config + small fragment, no modules, mediatek-drm off) with a new
  TB-7304X DTS + a small "lkfb" shim (simple-framebuffer from LK's atag,videolfb / OVL0 regs). Image 26.9 MB.
- LK disassembly: LK unpacks gzip kernels up to **0x1C00000 (28 MiB)**, needs kernel_addr 512K-aligned, finds the DTB by
  scanning backwards for d00dfeed. Our Image fits with 2.4 MB to spare. Stock boot.bin re-packs byte-identically with our
  mkbootimg parameters.
- Images in mainline/out/: boot-mainline.img, boot-mainline-noovl.img, boot-stock-kernel-initramfs.img (control).
  Plan: mainline/TEST-PLAN.md. `fastboot boot` is expected to fail (LK has no boot cmd) → recovery-partition route
  needs the user's OK.

## [mainline agent] 03:27 — done: docs written
- mainline/README.md (findings, sources/commits, build steps, unknowns) and mainline/TEST-PLAN.md (exact commands,
  success criteria, hang recovery). Rebuild: `mainline/scripts/build.sh`. Nothing was run on the tablet.

## 04:45 — kiosk mode, Desk v2, your live feedback
**Kiosk mode** (`kiosk/kiosk.sh start|stop|restart`, binary `pocketjs-kiosk`): Android framework stopped,
PocketJS draws straight to `/dev/graphics/fb0` (rotated, BGRA) and reads `mtk-tpd` touch directly.
- MemAvailable **462 → ~705 MB**; frame cost mean 0.56 ms / worst ~4 ms (vs 2.4 / 6 ms under Android).
- Touch verified with injected events (Mic toggled the Mac mic 71→0→71); hot reload works in kiosk.
- **Wi-Fi works in kiosk mode** natively: wmtWifi power → wpa_supplicant (saved networks re-enabled) →
  busybox udhcpc. Needed one narrow *live-only* SELinux rule (`allow wpa magisk unix_dgram_socket sendto`,
  gone on reboot, SELinux stays enforcing). Verified ping 1.1.1.1 from kiosk mode.
- ⚠️ Your report: in kiosk mode the screen froze on the first frame — my single-buffer path skipped the
  display flip. Fixed (pan after every changed frame) but **not yet seen on the real screen**.
- `kiosk.sh stop` brings Android back (~15 s) and now re-enables Wi-Fi (it came back disabled once).
- **The tablet is in normal Android mode now** (PocketJS activity as home screen).

**Music fix**: Now Playing showed nothing because `st` (my AppleScript variable) is a reserved word →
syntax error → reported "off". Renamed; added a test that compiles the script. Album art now 256 px.

**Desk v2** (your request): five swipeable panes — HOME (clock + the g8row.xyz ASCII ridge field),
DECK, MUSIC (art, visualizer, gliding progress), CLAUDE (sessions, pulsing dots), SYSTEM (arc gauges,
CPU history, live FPS). Styled from `~/Documents/personal-website` tokens: #070707 ground, #141414
cards, #222 rules, accent #a8c7fa, **Geist + Geist Mono** (now baked into the app's font atlases;
OFL). Swipe = 1:1 drag + spring snap; a swipe never fires the tile under your finger.
- Measured delivered FPS on every pane: **60** (header counter). Off-screen panes do zero work.
- Screenshots: `shots/11…15-*.png`.

**Mainline Linux (agent finished)**: images built in `mainline/out/` (mainline 7.0 kernel for MT6735 +
a new TB-7304X DTS + an LK-framebuffer driver; plus a stock-kernel control image). Blocker found:
**this LK has no `fastboot boot`** (disassembled: no `boot` command), so a RAM-only test is impossible.
Only hands-free route: flash the **recovery** partition (stock backed up) and `fastboot oem reboot-recovery`.
Not done — needs your OK, and the mainline kernel has no charger driver (battery was 9%).
Details: `mainline/README.md`, `mainline/TEST-PLAN.md`.

## 04:58 — Desk v3: rebuilt from the actual g8row.xyz
- Rendered the site locally (copy in `.site-preview/`, macOS blocks serving from ~/Documents) and rebuilt
  the app from its real components: **nav strip** of ruled cells (also the page switcher — tap a cell),
  **hero** home (lowercase display type, accent first line, ASCII ridge field behind, stats row of ruled
  cells: now / claude / mac / tablet), **project-card** deck tiles with outlined mono chips,
  **centuryplay** music card (selected device row with the travelling **wave** as the progress bar),
  device-row Claude sessions (accent border when a session needs you), **frame-time graph** with a dashed
  16.7 ms budget line + **spec table** (soc, cpu, ram free, battery, uptime, mac).
- New deskd provider: tablet vitals over adb every 5 s (battery 20% charging, ~490 MB free).
- Fixed: Geist lacks ♪/■ glyphs (replaced), hero column direction, budget-line anchoring, row overflow.
- All panes 57–60 fps (home with the ridge field is the heaviest). Screenshots `shots/21-*`, `22-*`.

## 06:25 — GPU test (wgpu over OpenGL ES on the Mali-T720)
- Added an opt-in GPU presenter to the Android host (`--features gpu` / `CARGO_FEATURES=gpu build.sh`,
  enabled at runtime by `/data/local/tmp/pocketjs/gpu`): `pocket-ui-wgpu` through wgpu's GLES backend.
  It works: adapter "Mali-T720", driver "OpenGL ES 3.1 r12p1", renders the Desk app correctly.
- **Result: ~4× slower.** Same app, same pane, back-to-back:
  software **10.7 ms** mean, 14–22/300 frames over budget · GPU **45.5 ms** mean (~22 fps), 297–300/300 over.
  The old Mali driver + wgpu's GL path (full redraw every changed frame, per-frame vertex upload,
  synchronous EGL present) cost far more than our damage-tracked software raster on 4×A53 @ 858 MHz+.
- Also fixed a crash the test exposed: hot reload built a 2nd EGL surface before dropping the 1st.
- **Software stays the default** (switch file removed). GPU build is kept behind the feature flag.
- Note: software mean rose from ~2.4 ms to ~10.7 ms because the desk-views session's app is much bigger
  now (8 panes, BOARD dashboard, etc.) — worth a perf pass on that app.
- The desk-views session stopped at the 5-hour usage limit mid-work (its partial panes are live on the tablet).

## [desk-views] perf pass, device check, commit
Finished the uncommitted desk-views work (PULSE / BOARD / FOCUS panes, CLAUDE v4 detail, permission sheet,
alerts, Desk Studio config UI) and made it fast again. Measured on the tablet with `adb logcat -s pocketjs:V`
"tick cost", one pane at a time, after a 6 s settle (the first window after a switch includes the swipe).

**Mean tick per pane, before → after** (over-budget frames per 300 in brackets):

| pane | before | after |
|---|---|---|
| home | 17.8 ms (109) | 5.6 ms (8–10) |
| claude | 8.6 (18) | 3.9–4.0 (0–1) |
| pulse | 12.1 (77) | 4.7 (12) |
| deck | 9.8 (75) | 3.8 (0–6) |
| music | 5.4 (9) | 2.6 (0) |
| board | 10.7 (14) | 4.5 (4) |
| focus | 13.3 (121) | 2.7 (0) |
| system | 17.3 (116) | 4.7 (6–10) |

All panes run at 60 fps (the frame-time graph sits on the 16.7 ms line). HOME is the one still a bit over 5 ms
(the 42×20 ASCII ridge field is ~1000 glyphs).

What was heavy (found by bisecting on the device + a draw-list diff harness on the wasm core):
- **Any posted frame costs ~5.5 ms in the Android host** (lock + copy + post), however small: a blank app with
  one 2 px dot moving every frame = 6.4 ms/tick, every other frame = 3.0 ms. Fix: `apps/desk/clock.ts`, one
  shared clock: ambient motion steps at 30 Hz on even frames, slower things at 15 Hz on one shared phase so
  they land in the same posted frame. Shapes repaint only when a corner moves ≥ 1 px.
- **The core repaints the whole screen when the DrawList's op sequence changes shape** (`damage.rs` falls back
  to full on an op-code mismatch). Triggers we had: rounded bars being scaled (the SYSTEM frame graph did it
  every frame), arcs springing (gauges, focus ring), fractional positions (AA span ops), text going `""`.
  Fixes: no rounding on scaled bars, `jump` instead of `spring` for arcs/bars, whole-pixel motion, never set "".
- **Relayout on every ridge/trace text change** (empty↔non-empty is a full relayout): fixed-size `w×h` text
  cells, so a text swap skips layout. Ridge maths rewritten (precomputed per-column sin/cos, reused buffers):
  ~9 ms of JS per render → ~2 ms.
- **Off-screen panes**: each pane is now an `overflow-hidden` box, so the paint walk skips it.
- **deskd pushed the 5 KB claude snapshot every second** for the "ago" labels: those now go in a tiny
  `claudeTick` key. The tablet vitals probe (`dumpsys battery` → system_server) runs every 30 s, not 5.
- CLAUDE timeline uses `<Index>` (a new tool call used to tear down and rebuild every row).

Fixed while checking on the device (shots `40-*`):
- Bar origins: `originX/Y` are offsets from centre (−0.5 = left/top), so PULSE project bars grew from the middle
  and BOARD sparks sat below their cells. BOARD sparks now sample every 2 s (a steady 79% RAM never pushed one).
- CLAUDE pane overflowed the screen (rail "ago", stat cells, last pill): constrained columns, compact token cell.
- Tabs stayed highlighted after switching: the renderer doesn't reset an inline style key that disappears
  (`{bgColor}` → `{}`), so both states now set the key explicitly. **Framework follow-up.**
- Timeline showed "…" on every call: `~/.claude/settings.json` has no PostToolUse hook, so calls never closed.
  deskd now closes a call as an estimate (`~1.2s`) when the session moves on; a real PostToolUse still wins.
- A permission answered on the tablet left the session "needs you"; deskd now clears it.
- Context % assumed a 200k window (showed 100% at 337k); past 200k it assumes 1M.
- Permission sheet now full width; FOCUS label under the time; FOCUS shape no longer clips its ring.

Checked on the real tablet with real data: all 8 panes (`40-<pane>.png`), CLAUDE timeline / prompts / reply
(`40-claude-*.png`), the alert flash + toast (`40-alert.png`) and the permission sheet (`40-permission.png`).
The sheet was driven by a fake session posted to deskd's hook endpoint; tapping deny and allow on the tablet
returned the right hook JSON. The FOCUS timer start/reset worked (`40-focus-running.png`). The Desk Studio
(http://127.0.0.1:7778/) loads the real config with no console errors, and its "show" button jumps the tablet.
deskd tests: 25 pass (2 new). pocketjs: renderer/cursor/devtools/hot tests 83 pass.

Not verified / left alone:
- `hooks/claude-gate.sh` (tablet approvals for real sessions) is **still not installed** in
  `~/.claude/settings.json`, and neither is a PostToolUse hook. Both are your call (global Claude config).
- Studio save/edit flows (tiles, accent) were not exercised, to avoid rewriting `desk.config.json`.
- The tablet's `system_server` sits at ~45% CPU with growing RSS (138 → 242 MB) independent of the desk app;
  it causes occasional noisy samples (one CLAUDE run read 9–10 ms, then 3.9).
- Engine follow-ups (not done, host/APK rebuild): smarter damage fallback than full-screen on an op-count
  change; skip the per-frame paint walk when nothing changed; cheaper present path.

## [deck-rail] deck redesign: rail layout, icons, split pills
Mockups (bento / rail / quick settings) on a Design canvas; built "rail" with the music row swapped for
focus, lock | sleep-display and Caffeine.
- Tablet: `pocketjs/apps/desk/deck.tsx` packs tiles into a 4×3 grid (`w`/`h` spans, dense, first fit);
  consecutive tiles with one `group` are a split pill (vertical when tall; a full-height one becomes a
  narrow rail, with the live volume level between its halves). Tiles draw as circle / pill / icon-only.
  The core has one radius per box, so a pill half = full pill + same-colour cover over its inner end.
- Icons: `apps/desk/icons/gen.ts` expands 2 px "strokes" into filled shapes (the SVG baker fills only),
  light + ink tones, 32 px; six also large (48 px drawn on a 64 px canvas — pak textures must be pow2).
  Bundle 8.3 → 10.1 MB.
- deskd: tile fields icon/iconOn/w/h/group/fill/shape; `readMacState()` (one osascript: volumes +
  Caffeine, only asked when running); builtins `caffeine.toggle`, `lock` (⌃⌘Q, needs Accessibility),
  `display.sleep`; deck refreshes right after a tap; focus.* tiles drive deskd's timer.
- Studio: icon/size/group/fill/circle fields; deck preview shows the packed 4×3 layout.
Verified: tablet screenshot `shots/50-deck-rail.png`; Caffeine off/on and focus start/reset through the
tile path; deskd tests 35 pass. Not verified: real finger taps (another session was driving the tablet,
and `kiosk/tap.sh` injection did not register), lock and sleep display (would lock this Mac).

## [claude-pane] CLAUDE pane v5: conversation layout
Replaced the sessions rail, stat cells and tool timeline with the "conversation" layout chosen from
`deskd/mockups/claude-pane.html`. Session chips sit on top in a stable order. Your last prompt and Claude's
last reply fill the left column; the reply wraps by estimated Geist widths and scrolls by touch with a
position bar and a "more ↓" pill. Tap the reply to read it full width. The side card shows the state: what
it's doing now as a sentence (`$ cmd` for Bash), a permission with the full command and "always allow", a
question, a plan, or finished with the turn time and edited files.
- deskd: snapshot gains `prompt`, `reply` (markdown → plain), `now`, `steps`, `ctx`, `took`, `changed`,
  `question`, `plan` and a per-session `held` request; `claudeTick` gains `held` and `run`.
- Gate: answers AskUserQuestion (`updatedInput` with `answers` keyed by question text, multi-select
  joined with ", "), ExitPlanMode (approve echoes the input; "auto-accept edits" adds `setMode`; keep
  planning = deny), and "always allow" adds a session `addRules` entry. Questions/plans wait 50 s
  (`claude-gate.sh` curl timeout raised to 58 s).
- Pager: a shared `gesture.owner` so a vertical scroll never turns into a page swipe.
- Other panes: the sheet offers "open →" for questions and plans. The toast also shows on CLAUDE when the
  alert is for another session. A deskd restart no longer fires an empty toast.
Verified on the tablet with a fake session posted to the hook endpoints: working, scrolled reply, reading
mode, permission allow and always-allow, a two-question AskUserQuestion answered by taps (hook output had
the right `answers`), plan approve + auto-accept edits, finished, and the sheet's "open →" on HOME.
deskd tests 35 pass (`test/conversation.test.ts` new).
Not verified: real Claude Code sessions answering through the gate. `hooks/claude-gate.sh` is still not
installed as a PermissionRequest hook in `~/.claude/settings.json`, and Claude Code firing
PermissionRequest for AskUserQuestion is implied by the docs but not stated. Without the gate, questions and
plans show read-only with "answer on laptop".
- Later: installed `hooks/claude-gate.sh` as a PermissionRequest hook (matcher `*`, timeout 60 s) in
  `~/.claude/settings.json` (backup: `settings.json.bak-desk-gate`) and made it executable (it wasn't).
  Ran the script by hand with a Bash request; a tap on the tablet returned the allow JSON.

## [mainline] 2026-11-16 11:00–11:45 — fastboot `download:` stalls from the Mac
- `fastboot boot` never reached the boot command: the upload stalls in "Sending", and LK then stops answering
  until the tablet is rebooted (hold Power ~15 s; replugging USB does not help, the battery keeps LK alive).
- Even a 4 KB `fastboot stage` stalls. Same on a USB 3 port, through a USB 2 hub, and with deskd and the adb
  server stopped. `getvar` always works. Nothing was flashed.
- LK's `download:` handler (0x41e222bc in lk.bin) is standard: size parse, battery > 3.5 V check
  ("low power, need battery charging"), screen clear, `DATA%08x`, "USB Transferring..." on screen, 16 KB
  `usb_read` chunks (0x41e20904), "USB Transmission OK", `OKAY`. Nothing explains a stall.
- Next: test from a Linux host — `mainline/scripts/linux-test.sh` (images in GitHub release `mainline-test-1`),
  and `scripts/analysis/fb_probe.py` (raw pyusb probe, shows which protocol phase stalls).
- Fallback that avoids fastboot entirely: write `recovery` from rooted Android (`su -c dd`), then
  `adb reboot recovery`.
