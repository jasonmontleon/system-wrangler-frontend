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

// needsReboot is true when the system is in needs-reboot state from
// either source: the SW-stamped rebootRequiredAt column (fast-path,
// flips immediately after apply) or the steady-state exporter metric
// (sw_reboot_required gauge from the textfile collector pipeline).
// Either alone is enough — the apply-time column covers the
// sub-1-minute UX gap; the metric covers reboots needed from any
// source, including manual dnf upgrade or dnf-automatic.
export function needsReboot(s: System, metricSet: Set<string>): boolean {
  return Boolean(s.rebootRequiredAt) || metricSet.has(s.id)
}
