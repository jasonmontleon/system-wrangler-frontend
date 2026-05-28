// SPDX-License-Identifier: Apache-2.0

// Shared PromQL fragments for telemetry that needs cross-OS fallback.
//
// node_exporter (Linux + BSD) emits `node_*` metrics; windows_exporter
// emits `windows_*`. The two namespaces don't overlap, so every shared
// chart query chains the variants with a PromQL `or`. Each system_id
// only has one branch populated, so the union picks the right one per
// system. BSDs share the `node_*` namespace with Linux but expose
// memory through different fields (`active`, `inactive`, `wired`,
// `free`) — captured as a second `or` branch on the memory helpers.
//
// Some metrics have no Windows equivalent (load average, CPU iowait,
// swap %, file descriptors, processes running/blocked); call sites
// keep those as raw `node_*` queries and the panels stay blank on
// Windows. Same shape as the BSD telemetry-gap acceptance.

const DEFAULT_RANGE = '5m'

const FS_FILTER_NODE =
  'fstype!~"tmpfs|devtmpfs|squashfs|overlay|ramfs|nsfs|cgroup.*|tracefs|debugfs|fusectl|sysfs|proc|pstore|bpf|configfs|securityfs|hugetlbfs|mqueue|autofs|binfmt_misc",mountpoint!~"/System/Library/.*|/Library/Developer/CoreSimulator/Volumes/.*|/System/Volumes/(Hardware|xarts|iSCPreboot|Preboot|Update|VM).*|/private/tmp/tmp-mount-.*"'
const NET_FILTER_NODE = 'device!~"lo|docker.*|veth.*|cni.*|br-.*|virbr.*"'
const FS_FILTER_WINDOWS = 'volume!~"HarddiskVolume.*"'
const NET_FILTER_WINDOWS = 'nic!~"Loopback.*|.*[Vv]irtual.*|.*Tunnel.*|isatap.*"'

function whereClause(parts: string[]): string {
  const kept = parts.filter((p) => p && p.length > 0)
  return kept.length ? `{${kept.join(',')}}` : ''
}

function sysFilter(id: string): string {
  return id ? `system_id="${id}"` : ''
}

function byClause(id: string): string {
  return id ? '' : ' by (system_id)'
}

// memUsedPct returns Memory-used-percent PromQL. The selector lets the
// caller scope to a single system (e.g. `{system_id="abc"}`) or leave
// it empty for fleet-wide. Branches in order: Linux MemAvailable /
// MemTotal, BSD active+wired ratio, Windows memory-collector pair
// (windows_memory_available / windows_memory_physical_total — both
// come from the same collector so labels match cleanly), and finally
// the Windows os-collector pair as a fallback for versions where the
// memory collector isn't enabled.
export function memUsedPct(selector = ''): string {
  return (
    `(1 - node_memory_MemAvailable_bytes${selector} / node_memory_MemTotal_bytes${selector}) * 100 ` +
    `or ((node_memory_active_bytes${selector} + node_memory_wired_bytes${selector}) / ` +
    `(node_memory_active_bytes${selector} + node_memory_inactive_bytes${selector} + ` +
    `node_memory_wired_bytes${selector} + node_memory_free_bytes${selector})) * 100 ` +
    `or (1 - windows_memory_available_bytes${selector} / windows_memory_physical_total_bytes${selector}) * 100 ` +
    `or (1 - windows_os_physical_memory_free_bytes${selector} / windows_os_visible_memory_bytes${selector}) * 100`
  )
}

// memAvailBytes returns Memory-available-bytes PromQL. Linux first
// (MemAvailable), BSD fallback (inactive + free — the conservative
// subset both FreeBSD and OpenBSD emit), Windows from the memory
// collector (windows_memory_available_bytes — closest semantic match
// to Linux MemAvailable), and finally the os-collector fallback
// (windows_os_physical_memory_free_bytes — present in default installs).
export function memAvailBytes(selector = ''): string {
  return (
    `node_memory_MemAvailable_bytes${selector} ` +
    `or (node_memory_inactive_bytes${selector} + node_memory_free_bytes${selector}) ` +
    `or windows_memory_available_bytes${selector} ` +
    `or windows_os_physical_memory_free_bytes${selector}`
  )
}

// cpuBusyPct returns 100 minus the per-system average idle-CPU rate.
// Linux uses node_cpu_seconds_total; Windows uses windows_cpu_time_total
// (same `mode` label semantics). Empty id aggregates by system_id.
export function cpuBusyPct(id = '', range = DEFAULT_RANGE): string {
  const nodeSel = whereClause([sysFilter(id), 'mode="idle"'])
  const winSel = whereClause([sysFilter(id), 'mode="idle"'])
  const by = byClause(id)
  return (
    `100 - (avg${by}(rate(node_cpu_seconds_total${nodeSel}[${range}])) * 100) ` +
    `or 100 - (avg${by}(rate(windows_cpu_time_total${winSel}[${range}])) * 100)`
  )
}

// fsUsedPctMax returns the worst (most-full) mount or volume per system
// as a percentage. Linux uses node_filesystem with an fstype exclusion
// list; Windows uses windows_logical_disk with a HarddiskVolume.*
// exclusion. Empty id aggregates by system_id.
export function fsUsedPctMax(id = ''): string {
  const nodeSel = whereClause([sysFilter(id), FS_FILTER_NODE])
  const winSel = whereClause([sysFilter(id), FS_FILTER_WINDOWS])
  const by = byClause(id)
  return (
    `max${by}((1 - node_filesystem_avail_bytes${nodeSel} / node_filesystem_size_bytes${nodeSel}) * 100) ` +
    `or max${by}((1 - windows_logical_disk_free_bytes${winSel} / windows_logical_disk_size_bytes${winSel}) * 100)`
  )
}

// netIoBytesPerSec returns combined receive + transmit bytes per second
// per system. Linux filters tunnel/loopback devices; Windows filters
// virtual/loopback NICs. Empty id aggregates by system_id.
export function netIoBytesPerSec(id = '', range = DEFAULT_RANGE): string {
  const nodeSel = whereClause([sysFilter(id), NET_FILTER_NODE])
  const winSel = whereClause([sysFilter(id), NET_FILTER_WINDOWS])
  const by = byClause(id)
  return (
    `sum${by}(rate(node_network_receive_bytes_total${nodeSel}[${range}])) ` +
    `+ sum${by}(rate(node_network_transmit_bytes_total${nodeSel}[${range}])) ` +
    `or sum${by}(rate(windows_net_bytes_received_total${winSel}[${range}])) ` +
    `+ sum${by}(rate(windows_net_bytes_sent_total${winSel}[${range}]))`
  )
}

// diskIoBytesPerSec returns combined read + write bytes per second per
// system. Linux sums across raw block devices; Windows sums across
// logical disks (excluding HarddiskVolume.*). Empty id aggregates by
// system_id.
export function diskIoBytesPerSec(id = '', range = DEFAULT_RANGE): string {
  const nodeSel = whereClause([sysFilter(id)])
  const winSel = whereClause([sysFilter(id), FS_FILTER_WINDOWS])
  const by = byClause(id)
  return (
    `sum${by}(rate(node_disk_read_bytes_total${nodeSel}[${range}])) ` +
    `+ sum${by}(rate(node_disk_written_bytes_total${nodeSel}[${range}])) ` +
    `or sum${by}(rate(windows_logical_disk_read_bytes_total${winSel}[${range}])) ` +
    `+ sum${by}(rate(windows_logical_disk_write_bytes_total${winSel}[${range}]))`
  )
}

// netIoBidi returns a multi-series expression with direction=in|out
// labels, suitable for a per-system chart. Each branch is collapsed
// across NICs via `sum without` so the two directions remain distinct.
// Per-system only.
export function netIoBidi(id: string, range = DEFAULT_RANGE): string {
  const nodeSel = whereClause([sysFilter(id), NET_FILTER_NODE])
  const winSel = whereClause([sysFilter(id), NET_FILTER_WINDOWS])
  return (
    `label_replace(sum without(device)(rate(node_network_receive_bytes_total${nodeSel}[${range}])), "direction", "in", "", "") ` +
    `or label_replace(sum without(device)(rate(node_network_transmit_bytes_total${nodeSel}[${range}])), "direction", "out", "", "") ` +
    `or label_replace(sum without(nic)(rate(windows_net_bytes_received_total${winSel}[${range}])), "direction", "in", "", "") ` +
    `or label_replace(sum without(nic)(rate(windows_net_bytes_sent_total${winSel}[${range}])), "direction", "out", "", "")`
  )
}

// diskIoBytesBidi returns a multi-series expression with
// direction=read|write labels for a per-system chart. Per-system only.
export function diskIoBytesBidi(id: string, range = DEFAULT_RANGE): string {
  const nodeSel = whereClause([sysFilter(id)])
  const winSel = whereClause([sysFilter(id), FS_FILTER_WINDOWS])
  return (
    `label_replace(sum without(device)(rate(node_disk_read_bytes_total${nodeSel}[${range}])), "direction", "read", "", "") ` +
    `or label_replace(sum without(device)(rate(node_disk_written_bytes_total${nodeSel}[${range}])), "direction", "write", "", "") ` +
    `or label_replace(sum without(volume)(rate(windows_logical_disk_read_bytes_total${winSel}[${range}])), "direction", "read", "", "") ` +
    `or label_replace(sum without(volume)(rate(windows_logical_disk_write_bytes_total${winSel}[${range}])), "direction", "write", "", "")`
  )
}

// diskIopsBidi returns a multi-series expression with
// direction=read|write labels for a per-system IOPS chart. Per-system
// only.
export function diskIopsBidi(id: string, range = DEFAULT_RANGE): string {
  const nodeSel = whereClause([sysFilter(id)])
  const winSel = whereClause([sysFilter(id), FS_FILTER_WINDOWS])
  return (
    `label_replace(sum without(device)(rate(node_disk_reads_completed_total${nodeSel}[${range}])), "direction", "read", "", "") ` +
    `or label_replace(sum without(device)(rate(node_disk_writes_completed_total${nodeSel}[${range}])), "direction", "write", "", "") ` +
    `or label_replace(sum without(volume)(rate(windows_logical_disk_reads_total${winSel}[${range}])), "direction", "read", "", "") ` +
    `or label_replace(sum without(volume)(rate(windows_logical_disk_writes_total${winSel}[${range}])), "direction", "write", "", "")`
  )
}

// fsUsedPctPerMount returns one series per mount (Linux) or volume
// (Windows) for a per-system filesystem-usage chart. Per-system only.
export function fsUsedPctPerMount(id: string): string {
  const nodeSel = whereClause([sysFilter(id), FS_FILTER_NODE])
  const winSel = whereClause([sysFilter(id), FS_FILTER_WINDOWS])
  return (
    `(1 - node_filesystem_avail_bytes${nodeSel} / node_filesystem_size_bytes${nodeSel}) * 100 ` +
    `or (1 - windows_logical_disk_free_bytes${winSel} / windows_logical_disk_size_bytes${winSel}) * 100`
  )
}

// tcpEstablished returns the count of established TCP connections per
// system. Linux exposes it as a single counter (node_netstat_Tcp_*);
// windows_exporter splits by `family` (ipv4/ipv6), so the Windows
// branch sums across families. Per-system only.
export function tcpEstablished(id: string): string {
  const sel = whereClause([sysFilter(id)])
  return (
    `node_netstat_Tcp_CurrEstab${sel} ` +
    `or sum without(family)(windows_tcp_connections_established${sel})`
  )
}

// cpuBusyPctGlobal returns the cross-system CPU-busy aggregate as two
// labeled series, "agg=avg" and "agg=peak". Built on top of
// cpuBusyPct() so the underlying Linux/Windows fallback chain stays in
// one place. label_replace marks each branch so the chart legend can
// distinguish average from peak.
export function cpuBusyPctGlobal(): string {
  const base = cpuBusyPct()
  return (
    `label_replace(avg(${base}), "agg", "avg", "", "") ` +
    `or label_replace(max(${base}), "agg", "peak", "", "")`
  )
}

// memUsedPctGlobal mirrors cpuBusyPctGlobal for memory-used percent.
export function memUsedPctGlobal(): string {
  const base = memUsedPct()
  return (
    `label_replace(avg(${base}), "agg", "avg", "", "") ` +
    `or label_replace(max(${base}), "agg", "peak", "", "")`
  )
}

// fsUsedPctGlobal returns avg + peak across systems of the worst-mount
// percentage per system. Builds on fsUsedPctMax() which already
// max-aggregates per (system_id). avg(...) gives the typical worst
// mount; max(...) gives the single most-full mount anywhere.
export function fsUsedPctGlobal(): string {
  const base = fsUsedPctMax()
  return (
    `label_replace(avg(${base}), "agg", "avg", "", "") ` +
    `or label_replace(max(${base}), "agg", "peak", "", "")`
  )
}

// netIoBytesPerSecGlobal returns the sum across systems of combined
// receive + transmit bytes/sec — i.e. total network traffic across
// every monitored host.
export function netIoBytesPerSecGlobal(): string {
  return `sum(${netIoBytesPerSec()})`
}

// diskIoBytesPerSecGlobal returns the sum across systems of combined
// read + write disk bytes/sec.
export function diskIoBytesPerSecGlobal(): string {
  return `sum(${diskIoBytesPerSec()})`
}

// uptimeDays returns the host's uptime in days. Linux uses
// node_boot_time_seconds (a Unix-timestamp gauge); windows_exporter
// emits the same shape under one of three names depending on version:
// windows_system_boot_time_timestamp (current — no _seconds suffix
// despite the docs), windows_system_boot_time_timestamp_seconds (the
// shape the docs describe), or windows_system_system_up_time (legacy
// — also a boot timestamp despite the "up_time" name). All four
// branches subtract from time() and divide by seconds-per-day; each
// is wrapped in clamp_min so historical data points from before the
// host booted render as zero instead of negative.
export function uptimeDays(id: string): string {
  const sel = whereClause([sysFilter(id)])
  return (
    `clamp_min((time() - node_boot_time_seconds${sel}) / 86400, 0) ` +
    `or clamp_min((time() - windows_system_boot_time_timestamp${sel}) / 86400, 0) ` +
    `or clamp_min((time() - windows_system_boot_time_timestamp_seconds${sel}) / 86400, 0) ` +
    `or clamp_min((time() - windows_system_system_up_time${sel}) / 86400, 0)`
  )
}
