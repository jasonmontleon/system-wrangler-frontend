// SPDX-License-Identifier: Apache-2.0

import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TimesCircleIcon,
} from '@patternfly/react-icons'
import { Tooltip } from '@patternfly/react-core'
import type { SystemStatus } from '../api/systems'
import type { PendingPackage } from '../api/updaters'
import { formatPendingUpdates } from './systemsTableHelpers'

// Component exports for the shared systems table. Non-component
// exports (constants, formatters) live in systemsTableHelpers.ts
// so Vite's fast-refresh rule stays satisfied.

// SystemStatusIcon is the per-row health glyph. Precedence:
// unreachable → red, last-run failed → red, pending > 0 → yellow,
// pending = 0 → green, unprobed / never-checked → no icon.
export function SystemStatusIcon({
  status,
  pendingUpdates,
  lastRunFailed,
}: {
  status: SystemStatus
  pendingUpdates: number | undefined
  lastRunFailed: boolean | undefined
}) {
  if (status === 'unreachable') {
    return (
      <TimesCircleIcon
        aria-label="Unreachable"
        color="var(--pf-t--global--icon--color--status--danger--default)"
      />
    )
  }
  if (lastRunFailed) {
    return (
      <TimesCircleIcon
        aria-label="Last run failed"
        color="var(--pf-t--global--icon--color--status--danger--default)"
      />
    )
  }
  if (status === 'reachable' && pendingUpdates !== undefined) {
    if (pendingUpdates === 0) {
      return (
        <CheckCircleIcon
          aria-label="Up to date"
          color="var(--pf-t--global--icon--color--status--success--default)"
        />
      )
    }
    return (
      <ExclamationTriangleIcon
        aria-label="Updates available"
        color="var(--pf-t--global--icon--color--status--warning--default)"
      />
    )
  }
  return null
}

// PendingUpdatesCell renders the integer count in the Updates
// Available column. When the count is positive and the backend
// returned the package union, the cell wraps the count in a
// hover tooltip with the per-package list (capped at 50 names
// with an overflow tail).
export function PendingUpdatesCell({
  count,
  packages,
}: {
  count: number | undefined
  packages: PendingPackage[] | undefined
}) {
  const label = formatPendingUpdates(count)
  if (!count || count <= 0 || !packages || packages.length === 0) {
    return <>{label}</>
  }
  const previewMax = 50
  const preview = packages.slice(0, previewMax)
  const more = packages.length - preview.length
  const content = (
    <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
      {preview.map((p) => (
        <li key={`${p.name}|${p.oldVersion}|${p.newVersion}`}>
          {p.name}
          {(p.oldVersion || p.newVersion) && (
            <>
              {' '}
              <small>
                {p.oldVersion || '—'} → {p.newVersion || '—'}
              </small>
            </>
          )}
        </li>
      ))}
      {more > 0 && (
        <li>
          <em>… and {more} more</em>
        </li>
      )}
    </ul>
  )
  return (
    <Tooltip content={content} maxWidth="32rem">
      <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>
        {label}
      </span>
    </Tooltip>
  )
}
