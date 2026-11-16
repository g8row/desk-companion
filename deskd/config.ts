// What the tablet's deck shows and what each tap does. Edit freely: deskd
// pushes the new tiles on restart. Actions run on the Mac as the logged-in user.

import { $ } from "bun";

export interface TileDef {
  id: string;
  label: string;
  color: "blue" | "violet" | "emerald" | "amber" | "rose" | "zinc";
  /** Optional dynamic subtitle, recomputed every few seconds. */
  sub?: () => Promise<string>;
}

const osa = (script: string) => $`osascript -e ${script}`.quiet().nothrow();

async function micVolume(): Promise<number> {
  const r = await $`osascript -e ${"input volume of (get volume settings)"}`.quiet().nothrow();
  return Number(r.stdout.toString().trim()) || 0;
}
let micRestore = 75;

export const tiles: TileDef[] = [
  {
    id: "mic.toggle",
    label: "Mic",
    color: "rose",
    sub: async () => ((await micVolume()) === 0 ? "MUTED" : "live"),
  },
  { id: "vol.down", label: "Vol −", color: "zinc" },
  { id: "vol.up", label: "Vol +", color: "zinc" },
  { id: "open.terminal", label: "Terminal", color: "blue" },
  { id: "open.claude", label: "Claude", color: "amber" },
  { id: "screenshot", label: "Screenshot", color: "emerald", sub: async () => "to Desktop" },
];

export const actions: Record<string, (args?: unknown) => Promise<unknown>> = {
  "mic.toggle": async () => {
    const v = await micVolume();
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
  "music.toggle": "Music play / pause",
  "music.next": "Music next track",
  "music.prev": "Music previous track",
  "focus.toggle": "focus timer start / pause",
  "focus.add": "focus timer +5 min",
  "focus.reset": "focus timer reset",
  ping: "no-op (test)",
};

/** Live subtitles for builtin-backed tiles. */
export const builtinSub: Record<string, () => Promise<string>> = Object.fromEntries(
  tiles.filter((t) => t.sub).map((t) => [t.id, t.sub!]),
);
