// SPDX-License-Identifier: Apache-2.0

// Shared PromQL fragments for telemetry that needs cross-OS fallback.
//
// Most node_exporter metric names come from Linux's /proc/meminfo and
// only emit on Linux targets. BSDs (FreeBSD / OpenBSD / NetBSD) expose
// memory through different fields (`active`, `inactive`, `wired`,
// `free`), so we chain a PromQL `or` so series fall through to the
// BSD shape per-system when the Linux fields aren't present.

// memUsedPct returns Memory-used-percent PromQL. The selector lets the
// caller scope to a single system (e.g. `{system_id="abc"}`) or leave
// it empty for fleet-wide aggregation. BSD branch uses the lowest-
// common-denominator subset (active + inactive + wired + free) so it
// works on FreeBSD, OpenBSD, and NetBSD where node_exporter exposes
// memory at all.
export function memUsedPct(selector = ''): string {
  return (
    `(1 - node_memory_MemAvailable_bytes${selector} / node_memory_MemTotal_bytes${selector}) * 100 ` +
    `or ((node_memory_active_bytes${selector} + node_memory_wired_bytes${selector}) / ` +
    `(node_memory_active_bytes${selector} + node_memory_inactive_bytes${selector} + ` +
    `node_memory_wired_bytes${selector} + node_memory_free_bytes${selector})) * 100`
  )
}

// memAvailBytes returns Memory-available-bytes PromQL. Linux-first
// (MemAvailable) with BSD fallback (inactive + free — the conservative
// subset both FreeBSD and OpenBSD emit).
export function memAvailBytes(selector = ''): string {
  return (
    `node_memory_MemAvailable_bytes${selector} ` +
    `or (node_memory_inactive_bytes${selector} + node_memory_free_bytes${selector})`
  )
}
