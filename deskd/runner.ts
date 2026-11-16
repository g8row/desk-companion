// Runs a deck tile's action on the host. Cross-platform where it can be:
// shell/url/app work on macOS, Linux and Windows; AppleScript and Shortcuts are
// macOS-only and report an error elsewhere. Every child gets a timeout and its
// output is discarded — a tile tap must never wedge deskd.

import type { TileAction } from "./deskconfig.ts";

export interface Spawned {
  argv: string[];
}

const P = process.platform;

/** The argv a tile action turns into (pure; unit-tested). */
export function actionArgv(a: TileAction, platform: string = P): string[] | { error: string } {
  switch (a.type) {
    case "shell":
      return platform === "win32" ? ["cmd", "/c", a.cmd] : ["/bin/sh", "-c", a.cmd];
    case "url":
      return platform === "darwin" ? ["open", a.url] : platform === "win32" ? ["cmd", "/c", "start", "", a.url] : ["xdg-open", a.url];
    case "app":
      return platform === "darwin" ? ["open", "-a", a.name] : platform === "win32" ? ["cmd", "/c", "start", "", a.name] : ["/bin/sh", "-c", `${a.name} >/dev/null 2>&1 &`];
    case "applescript":
      return platform === "darwin" ? ["osascript", "-e", a.script] : { error: "AppleScript needs macOS" };
    case "shortcut":
      return platform === "darwin" ? ["shortcuts", "run", a.name] : { error: "Shortcuts needs macOS" };
    case "builtin":
      return { error: "builtin actions are not spawned" };
  }
}

export async function runAction(
  a: TileAction,
  builtins: Record<string, (args?: unknown) => Promise<unknown>>,
  timeoutMs = 30_000,
): Promise<{ ok: boolean; error?: string }> {
  if (a.type === "builtin") {
    const fn = builtins[a.id];
    if (!fn) return { ok: false, error: `unknown builtin ${a.id}` };
    await fn();
    return { ok: true };
  }
  const argv = actionArgv(a);
  if (!Array.isArray(argv)) return { ok: false, error: argv.error };
  const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "pipe", stdin: "ignore", env: process.env });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const code = await proc.exited;
  clearTimeout(timer);
  if (code === 0) return { ok: true };
  const err = (await new Response(proc.stderr).text()).trim().slice(0, 200);
  return { ok: false, error: err || `exit ${code}` };
}
