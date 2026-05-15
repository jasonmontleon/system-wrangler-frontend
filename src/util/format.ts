// SPDX-License-Identifier: Apache-2.0

// formatBytes renders a byte count as B / KiB / MiB / GiB / TiB. Used
// by surfaces that report download sizes (backup) where a raw byte
// count is less useful than a rounded human-readable one.
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}
