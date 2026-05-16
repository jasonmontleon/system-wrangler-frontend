// SPDX-License-Identifier: Apache-2.0

import type { SystemStatus } from '../api/systems'

// Non-component exports for the shared systems table. Components
// live in systemsTable.tsx so the Vite fast-refresh rule is happy
// — it requires component files to export only components.

export const STATUS_LABELS: Record<
  SystemStatus,
  { color: 'green' | 'red' | 'grey'; text: string }
> = {
  reachable: { color: 'green', text: 'Reachable' },
  unreachable: { color: 'red', text: 'Unreachable' },
  unprobed: { color: 'grey', text: 'Unprobed' },
}

// formatLastChecked renders the Last Checked column. Operators
// want a clear "Never" when no check has been run.
export function formatLastChecked(iso: string | undefined): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Never' : d.toLocaleString()
}

// formatPendingUpdates renders the Updates Available column.
// Distinguishes "never checked" (—) from "checked, zero pending"
// (0) so an operator who hasn't run a check yet doesn't get a
// false sense of being up to date.
export function formatPendingUpdates(n: number | undefined): string {
  if (n === undefined) return '—'
  return String(n)
}

// TIGHT_END collapses the right-side padding on the bulk-select
// checkbox column. TIGHT_START collapses the left-side padding on
// the row-actions kebab column. The `width: 1px` is the standard
// table-layout-auto trick: the browser shrinks the column to fit
// its content rather than honoring a percentage width prop.
export const TIGHT_END: React.CSSProperties = {
  paddingInlineEnd: '0.25rem',
  width: '1px',
}
export const TIGHT_START: React.CSSProperties = {
  paddingInlineStart: '0.25rem',
  width: '1px',
}

// TABLE_DENSITY_STYLE is the inline style applied to the <Table>
// element to compress horizontal padding throughout. Without it,
// every cell carries ~1rem of inline padding on each side, which
// on a narrow page leaves the middle columns visually cramped.
export const TABLE_DENSITY_STYLE = {
  '--pf-v6-c-table--cell--first-last-child--PaddingInline': '0.25rem',
  '--pf-v6-c-table--cell--PaddingInlineStart': '0.5rem',
  '--pf-v6-c-table--cell--PaddingInlineEnd': '0.5rem',
} as React.CSSProperties
