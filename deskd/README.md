# deskd

The Mac half of the desk companion. It is a single Bun process with no npm dependencies.

```bash
bun main.ts        # run
bun test           # unit tests (protocol, config, runner, gate, transcript, usage, focus)
```

## What it does

| | |
|---|---|
| **Link** | A TCP server on `127.0.0.1:7777`. It re-applies `adb reverse tcp:7777 tcp:7777` every 3 s, so the tablet reaches it over USB and replugging just works. |
| **Hot reload** | Watches `../pocketjs/apps/desk/`. On save it runs `bun pocket compile --target android` and pushes the bundle (JS + font/texture pak) to the tablet, which swaps it in place (~2 s end to end). |
| **Providers** | Push state keys to the tablet (see below). |
| **Actions** | Tile taps arrive as `{t:"action", id}` and run on the Mac. |
| **Claude hooks** | `POST 127.0.0.1:7778/claude` receives Claude Code hook events. |
| **Permission gate** | `POST 127.0.0.1:7778/claude/permission` holds a permission request for up to ~25 s for an allow/deny tap on the tablet. Otherwise it returns empty and the normal prompt appears. |
| **Desk Studio** | `http://127.0.0.1:7778/`: a web UI for panes, deck tiles and accent. It saves to `desk.config.json` and hot-pushes. |

## Providers

| Key | Source | Interval |
|---|---|---|
| `clock` | local time | 1 s |
| `sys` | Mac CPU and memory | 2 s |
| `music` + art blob | Apple Music via AppleScript; art pushed as an RGBA blob | 1 s |
| `deck` | tiles + live subtitles from `config.ts` / `desk.config.json` | 5 s |
| `claude` | hook events + transcript tail (`providers/transcript.ts`): model, tokens, context, tool timeline | 1–3 s |
| `usage` | today's Claude usage from `~/.claude/projects/**/*.jsonl` | 30 s |
| `focus` | the focus timer (state lives in deskd) | 1 s |
| `tablet` | battery, free RAM, CPU clock, uptime via `adb shell` | 30 s |

## Configuration

- **`config.ts`** holds the built-in tiles and actions (mic toggle, volume, Terminal, Claude, screenshot) and their
  live subtitles. It is TypeScript, so a tile can compute anything.
- **`desk.config.json`** is written by Desk Studio and is git-ignored. It stores the pane order and visibility, extra
  deck tiles and the accent colour. Tile actions are one of these types: `shell`, `url`, `app`, `applescript`,
  `shortcut` or `builtin` (see `runner.ts`). AppleScript and Shortcuts need macOS; the others also work on Linux
  and Windows. Every child process gets a timeout and its output is discarded.

Environment variables:

| Var | Default |
|---|---|
| `DESKD_PORT` | `7777` (tablet link) |
| `DESKD_HOOK_PORT` | `7778` (hooks + Desk Studio) |
| `DESKD_CONFIG` | `deskd/desk.config.json` |
| `POCKETJS_DIR` | `../pocketjs` |

## Wire protocol (`protocol.ts`)

There is one JSON object per line in each direction. The other end is `pocketjs/hosts/android/src/link.rs`.

```ts
// Mac → tablet
{ t: "state",  k, v }                         // a state key changed
{ t: "blob",   k, w, h, b64 }                 // RGBA image (album art)
{ t: "bundle", js, pak, viewport? }           // new app bundle → hot reload
// tablet → Mac
{ t: "hello",  host, abi, bundle, viewport }  // bundle = FNV-1a hash; deskd skips the push if it matches
{ t: "action", id, args? }
{ t: "reloaded", ok, error? }
{ t: "error",  error }
```

## Security

Both servers bind to `127.0.0.1` only. Desk Studio's API needs a per-run token that deskd injects into the page it
serves, and requests with a foreign `Host` header are rejected. This guards against DNS rebinding and CSRF from
websites open in your browser.

## Hooks

- `hooks/claude-hook.sh` forwards the hook's stdin JSON with a 1 s timeout and always exits 0.
- `hooks/claude-gate.sh` is the `PermissionRequest` hook for approving from the tablet. It is experimental and not
  installed by default.

Install instructions are in [docs/ONBOARDING.md](../docs/ONBOARDING.md#6-claude-code-hooks-optional-but-the-claude-pane-needs-them).
