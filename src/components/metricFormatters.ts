// SPDX-License-Identifier: Apache-2.0

// Shared formatters and threshold tints used by both the Systems
// overview heatmap cells and the Dashboard leaderboards. Centralised
// so a threshold tweak applies everywhere consistently.

export function tintForPercent(pct: number | undefined): string | undefined {
  if (pct === undefined || !Number.isFinite(pct)) return undefined
  if (pct < 60)
    return 'color-mix(in srgb, var(--pf-t--global--icon--color--status--success--default) 18%, transparent)'
  if (pct < 85)
    return 'color-mix(in srgb, var(--pf-t--global--icon--color--status--warning--default) 22%, transparent)'
  return 'color-mix(in srgb, var(--pf-t--global--icon--color--status--danger--default) 22%, transparent)'
}

export function tintForPending(count: number | undefined): string | undefined {
  if (count === undefined || count === 0) return undefined
  if (count < 10)
    return 'color-mix(in srgb, var(--pf-t--global--icon--color--status--warning--default) 22%, transparent)'
  return 'color-mix(in srgb, var(--pf-t--global--icon--color--status--danger--default) 22%, transparent)'
}

export function formatPct(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  return `${n.toFixed(0)}%`
}

export function formatBytesPerSec(v: number): string {
  const abs = Math.abs(v)
  if (abs < 1000) return `${v.toFixed(0)} B/s`
  if (abs < 1e6) return `${(v / 1000).toFixed(1)} KB/s`
  if (abs < 1e9) return `${(v / 1e6).toFixed(1)} MB/s`
  if (abs < 1e12) return `${(v / 1e9).toFixed(1)} GB/s`
  return `${(v / 1e12).toFixed(1)} TB/s`
}

// formatMountLabel returns a compact display name for filesystem
// legend entries. macOS reports each APFS volume under
// /System/Volumes/<name> (system volumes) or /Volumes/<name> (user
// volumes — external drives, network mounts), which fills the chart
// legend with redundant prefix; stripping these keeps the meaningful
// suffix ("Data", "Backup", "External SSD") visible. Linux mountpoints,
// BSD mountpoints, and Windows drive letters fall through unchanged.
export function formatMountLabel(meta: Record<string, string>): string {
  const raw = meta.mountpoint ?? meta.volume ?? ''
  for (const prefix of ['/System/Volumes/', '/Volumes/']) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length)
  }
  return raw
}
