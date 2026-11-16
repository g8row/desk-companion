// What the tablet's deck shows and what each tap does. Edit freely: deskd
// pushes the new tiles on restart. Actions run on the Mac as the logged-in user.
//
// Layout: the tablet packs tiles in order into a 4×3 grid; `w`×`h` is a tile's
// span in cells. Consecutive tiles sharing a `group` become one split pill
// (vertical when it is taller than wide) and take the first member's span.
// A column holding only a full-height pill shrinks to a narrow rail.

import { $ } from "bun";

export type TileColor = "blue" | "violet" | "emerald" | "amber" | "rose" | "latte" | "zinc";

export interface TileDef {
  id: string;
  label: string;
  color: TileColor;
  icon?: string;
  /** Icon while the tile's live state is "on" (mic → mic-off). */
  iconOn?: string;
  w?: number;
  h?: number;
  group?: string;
  /** Always draw filled with the tile colour (else only while "on"). */
  fill?: boolean;
  shape?: "circle";
  sub?: string;
}

const osa = (script: string) => $`osascript -e ${script}`.quiet().nothrow();

/** One osascript round trip for every live tile: volumes + Caffeine. Caffeine
 *  is only asked when already running (`tell` would launch it). */
export interface MacState {
  out: number;
  input: number;
  muted: boolean;
  caffeine: boolean | null; // null = not running / not installed
}
const MAC_STATE = `set v to get volume settings
set c to "none"
if application "Caffeine" is running then
  tell application "Caffeine" to set c to (active as text)
end if
return ((output volume of v) as text) & "," & ((input volume of v) as text) & "," & ((output muted of v) as text) & "," & c`;

export async function readMacState(): Promise<MacState | null> {
  if (process.platform !== "darwin") return null;
  const r = await osa(MAC_STATE);
  const [out, input, muted, caf] = r.stdout.toString().trim().split(",");
  if (out === undefined || input === undefined) return null;
  return { out: Number(out) || 0, input: Number(input) || 0, muted: muted === "true", caffeine: caf === "none" ? null : caf === "true" };
}

let micRestore = 75;

export const tiles: TileDef[] = [
  { id: "vol.up", label: "Vol +", color: "zinc", icon: "vol-up", group: "volume", h: 3 },
  { id: "vol.down", label: "Vol −", color: "zinc", icon: "vol-down", group: "volume" },
  { id: "mic.toggle", label: "Mic", color: "rose", icon: "mic", iconOn: "mic-off", h: 2, shape: "circle" },
  { id: "open.claude", label: "Claude", color: "amber", icon: "spark", w: 2 },
  { id: "open.terminal", label: "Terminal", color: "blue", icon: "terminal" },
  { id: "screenshot", label: "Screenshot", color: "emerald", icon: "screenshot" },
  { id: "focus.toggle", label: "Focus", color: "blue", icon: "timer", fill: true },
  { id: "lock", label: "Lock", color: "violet", icon: "lock", group: "away", fill: true },
  { id: "display.sleep", label: "Sleep display", color: "zinc", icon: "display", group: "away" },
  { id: "caffeine.toggle", label: "Caffeine", color: "latte", icon: "cup" },
];

export const actions: Record<string, (args?: unknown) => Promise<unknown>> = {
  "mic.toggle": async () => {
    const v = (await readMacState())?.input ?? 0;
    if (v > 0) micRestore = v;
    await osa(`set volume input volume ${v > 0 ? 0 : micRestore}`);
  },
  "vol.down": () => osa("set volume output volume ((output volume of (get volume settings)) - 6)"),
  "vol.up": () => osa("set volume output volume ((output volume of (get volume settings)) + 6)"),
  "open.terminal": () => $`open -a Terminal`.quiet().nothrow(),
  "open.claude": () => $`open -a Claude`.quiet().nothrow(),
  screenshot: () =>
    $`screencapture -x ${`${process.env.HOME}/Desktop/desk-${new Date().toISOString().replace(/[:.]/g, "-")}.png`}`
      .quiet()
      .nothrow(),
  // ⌃⌘Q: the system "Lock Screen" shortcut (needs Accessibility for osascript)
  lock: () => osa('tell application "System Events" to keystroke "q" using {control down, command down}'),
  "display.sleep": () => $`pmset displaysleepnow`.quiet().nothrow(),
  "caffeine.toggle": () =>
    osa(`tell application "Caffeine"
  if active then
    turn off
  else
    turn on
  end if
end tell`),
  "music.toggle": () => osa('tell application "Music" to playpause'),
  "music.next": () => osa('tell application "Music" to next track'),
  "music.prev": () => osa('tell application "Music" to previous track'),
  /** Test hook: no side effects beyond the log line. */
  ping: async () => "pong",
};

/** Human descriptions of the builtins, for the config UI's action picker. */
export const builtinInfo: Record<string, string> = {
  "mic.toggle": "mute / unmute the Mac microphone",
  "vol.down": "output volume −6",
  "vol.up": "output volume +6",
  "open.terminal": "open Terminal",
  "open.claude": "open the Claude app",
  screenshot: "screenshot to Desktop",
  lock: "lock the screen",
  "display.sleep": "sleep the display",
  "caffeine.toggle": "Caffeine on / off (keeps the Mac awake)",
  "music.toggle": "Music play / pause",
  "music.next": "Music next track",
  "music.prev": "Music previous track",
  "focus.toggle": "focus timer start / pause",
  "focus.add": "focus timer +5 min",
  "focus.reset": "focus timer reset",
  ping: "no-op (test)",
};

/** Live state for builtin-backed tiles: subtitle, "on" (draw filled / iconOn)
 *  and a 0–100 level (shown between a split pill's halves). */
export interface LiveTile {
  sub?: string;
  on?: boolean;
  level?: number;
}
export const builtinState: Record<string, (m: MacState) => LiveTile> = {
  "mic.toggle": (m) => (m.input === 0 ? { sub: "MUTED", on: true } : { sub: "live", on: false }),
  "vol.up": (m) => ({ level: m.muted ? 0 : m.out }),
  "vol.down": (m) => ({ level: m.muted ? 0 : m.out }),
  "caffeine.toggle": (m) => (m.caffeine ? { sub: "awake", on: true } : { sub: "off", on: false }),
};
