// SPDX-License-Identifier: Apache-2.0

import { query } from '../api/metrics'
import type { System } from '../api/systems'

// queryRebootRequiredSet returns the set of system_id labels reporting
// sw_reboot_required > 0 on the latest exporter scrape. The textfile
// collector pipeline (dnf + Windows) emits this gauge every minute;
// hosts where the underlying needs-restarting / registry probe says a
// reboot is required show up here even when no SW-driven apply has
// stamped the per-row column. Errors are swallowed by the caller —
// the chip falls back to the column-only signal so a Prometheus blip
// doesn't blank the indicator.
export async function queryRebootRequiredSet(): Promise<Set<string>> {
  const vec = await query('sw_reboot_required > 0')
  const out = new Set<string>()
  for (const v of vec) {
    if (v.metric.system_id) out.add(v.metric.system_id)
  }
  return out
}

// needsReboot is true when the system is in needs-reboot state. The
// sw_reboot_required metric is authoritative whenever it signals, so a
// host in the metric set always reads true. The SW-stamped
// rebootRequiredAt column is a fast-path that covers the metric's
// catch-up lag after an apply, but only for a bounded grace window:
// past graceMs the metric takes over as the sole source of truth, so a
// stamp that outlives a reboot self-expires instead of sticking on a
// host that has already rebooted. graceMs comes from the
// reboot_grace_seconds setting; now is injected for testability.
export function needsReboot(
  s: System,
  metricSet: Set<string>,
  graceMs: number,
  now: number = Date.now(),
): boolean {
  if (metricSet.has(s.id)) return true
  if (!s.rebootRequiredAt) return false
  const stamped = Date.parse(s.rebootRequiredAt)
  if (Number.isNaN(stamped)) return false
  return now - stamped < graceMs
}
