import os from "node:os";
import { $ } from "bun";

let prev = os.cpus().map((c) => c.times);

export function cpuPercent(): number {
  const cur = os.cpus().map((c) => c.times);
  let idle = 0;
  let total = 0;
  cur.forEach((t, i) => {
    const p = prev[i] ?? t;
    const d = (k: keyof typeof t) => t[k] - p[k];
    const tot = d("user") + d("nice") + d("sys") + d("idle") + d("irq");
    idle += d("idle");
    total += tot;
  });
  prev = cur;
  return total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
}

/** Used memory % like Activity Monitor's "memory used" (app + wired + compressed). */
export async function memPercent(): Promise<number> {
  const out = (await $`vm_stat`.quiet().nothrow()).stdout.toString();
  const page = Number(/page size of (\d+)/.exec(out)?.[1] ?? 16384);
  const get = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] ?? 0) * page;
  const used = get("Anonymous pages") - get("Pages purgeable") + get("Pages wired down") + get("Pages occupied by compressor");
  return Math.max(0, Math.min(100, Math.round((100 * used) / os.totalmem())));
}
