// SPDX-License-Identifier: Apache-2.0

// aggSeriesLabel maps the `agg` Prometheus label written by the
// global-trend recording rules to the friendly series label rendered
// in MetricsPanel legends.
export function aggSeriesLabel(metric: Record<string, string>): string {
  if (metric.agg === 'avg') return 'Average'
  if (metric.agg === 'peak') return 'Peak'
  return ''
}
