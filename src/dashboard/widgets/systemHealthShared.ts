// SPDX-License-Identifier: Apache-2.0

import type { System } from '../../api/systems'
import { needsReboot } from '../../util/rebootSignal'

// HealthBucket is one of six mutually exclusive states each system
// rolls up to. Precedence matches SystemStatusIcon so the donut on
// every dashboard variant agrees with the per-row glyph on the
// Systems page.
export type HealthBucket =
  | 'healthy'
  | 'updates'
  | 'reboot'
  | 'unreachable'
  | 'failed'
  | 'unknown'

export type BucketSpec = {
  key: HealthBucket
  label: string
  color: string
}

// PatternFly v6 status hex codes inlined here so the SVG-rendered
// donut can use them directly. The icons on the Systems page pull
// these via CSS custom properties; the chart is rendered inline and
// can't pierce CSS vars cleanly, so the hex codes live alongside.
export const BUCKETS: BucketSpec[] = [
  { key: 'healthy', label: 'Healthy', color: '#3E8635' },
  { key: 'updates', label: 'Updates available', color: '#F0AB00' },
  { key: 'reboot', label: 'Reboot required', color: '#EC7A08' },
  { key: 'unreachable', label: 'Unreachable', color: '#C9190B' },
  { key: 'failed', label: 'Failed run', color: '#7D1007' },
  { key: 'unknown', label: 'Unknown', color: '#8A8D90' },
]

export function classify(
  s: System,
  rebootMetricSet: Set<string>,
  rebootGraceMs: number,
): HealthBucket {
  if (s.status === 'unreachable') return 'unreachable'
  if (s.lastRunFailed) return 'failed'
  if (needsReboot(s, rebootMetricSet, rebootGraceMs)) return 'reboot'
  if (s.status === 'reachable' && s.pendingUpdates !== undefined) {
    return s.pendingUpdates === 0 ? 'healthy' : 'updates'
  }
  return 'unknown'
}

export function tally(
  systems: System[],
  rebootMetricSet: Set<string>,
  rebootGraceMs: number,
): Record<HealthBucket, number> {
  const out: Record<HealthBucket, number> = {
    healthy: 0,
    updates: 0,
    reboot: 0,
    unreachable: 0,
    failed: 0,
    unknown: 0,
  }
  for (const s of systems) {
    out[classify(s, rebootMetricSet, rebootGraceMs)] += 1
  }
  return out
}
