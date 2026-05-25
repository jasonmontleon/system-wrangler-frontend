// SPDX-License-Identifier: Apache-2.0

import {
  AppleIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  FreebsdIcon,
  LinuxIcon,
  TimesCircleIcon,
  WindowsIcon,
} from '@patternfly/react-icons'
import { Tooltip } from '@patternfly/react-core'
import type { ComponentType } from 'react'
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

// PlatformIcon renders a small OS-family glyph for the systems-list
// row decoration. Returns null for empty / unrecognized families so
// pre-inspect rows stay visually quiet. Linux/Windows/Apple/FreeBSD
// come from the FontAwesome brand set; *BSD (OpenBSD/NetBSD) reuses
// the FreeBSD daemon glyph as a recognized BSD mark with the tooltip
// carrying the exact OS flavor.
const osIconMap: Record<string, ComponentType<{ 'aria-label'?: string }>> = {
  linux: LinuxIcon,
  darwin: AppleIcon,
  windows: WindowsIcon,
  freebsd: FreebsdIcon,
  openbsd: FreebsdIcon,
  netbsd: FreebsdIcon,
}

export function PlatformIcon({
  osFamily,
  osDistribution,
  isWindows,
}: {
  osFamily: string | undefined
  osDistribution: string | undefined
  // isWindows is the operator-declared platform flag. Used as a
  // fallback for pre-inspect Windows hosts so the icon lights up
  // before the first inspect populates osFamily.
  isWindows?: boolean
}) {
  const family = osFamily || (isWindows ? 'Windows' : '')
  const Icon = family ? osIconMap[family.toLowerCase()] : undefined
  // Pre-inspect rows and unrecognized families still occupy an icon
  // slot so the system-name column lines up across rows. The
  // placeholder matches PatternFly's default 1em icon footprint.
  if (!Icon) {
    return (
      <span
        aria-hidden="true"
        style={{ display: 'inline-block', width: '1em' }}
      />
    )
  }
  const label = osDistribution || family
  return (
    <Tooltip content={label}>
      <span aria-label={label}>
        <Icon aria-label={label} />
      </span>
    </Tooltip>
  )
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
