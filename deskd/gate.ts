// Permission gate: Claude Code's PermissionRequest hook (hooks/claude-gate.sh)
// POSTs to /claude/permission and waits for the response body. deskd holds the
// request until the tablet taps allow/deny or the timeout passes. On timeout
// (or when the gate is off / no tablet is connected) the body is empty, the
// hook prints nothing, and Claude Code shows its normal prompt — a session is
// never blocked for longer than the timeout.

import { summarizeTool, toolName } from "./providers/claude.ts";

export interface Pending {
  id: string;
  session: string;
  tool: string;
  summary: string;
  expires: number;
  resolve: (d: Decision) => void;
}
export type Decision = "allow" | "deny" | "timeout";

let pending: Pending | null = null;
const queue: Pending[] = [];
let n = 0;

export function currentPending(): Pending | null {
  return pending;
}

function promote() {
  if (!pending && queue.length) pending = queue.shift()!;
}

/** Hold a request; resolves with the decision (or "timeout"). */
export function hold(ev: Record<string, any>, timeoutMs: number, onChange: () => void, now = Date.now()): Promise<Decision> {
  return new Promise((resolve) => {
    const p: Pending = {
      id: `p${++n}`,
      session: String(ev.session_id ?? ""),
      tool: toolName(ev.tool_name),
      summary: summarizeTool(String(ev.tool_name ?? ""), ev.tool_input),
      expires: now + timeoutMs,
      resolve: () => {},
    };
    const timer = setTimeout(() => finish(p, "timeout"), timeoutMs);
    p.resolve = (d) => {
      clearTimeout(timer);
      resolve(d);
    };
    queue.push(p);
    promote();
    onChange();
    function finish(x: Pending, d: Decision) {
      decideById(x.id, d);
      onChange();
    }
  });
}

/** Tablet decision (or timeout). Returns false for unknown/stale ids. */
export function decideById(id: string, d: Decision): boolean {
  let p: Pending | undefined;
  if (pending?.id === id) {
    p = pending;
    pending = null;
  } else {
    const i = queue.findIndex((q) => q.id === id);
    if (i >= 0) p = queue.splice(i, 1)[0];
  }
  if (!p) return false;
  promote();
  p.resolve(d);
  return true;
}

/** Drop held requests for a session that moved on (answered at the Mac). */
export function dropSession(session: string): void {
  for (const q of [pending, ...queue]) if (q && q.session === session) decideById(q.id, "timeout");
}

/** The hook's stdout for a decision (empty = fall back to the normal prompt). */
export function hookResponse(d: Decision): string {
  if (d === "timeout") return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: d === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "Denied from the desk tablet." },
    },
  });
}
