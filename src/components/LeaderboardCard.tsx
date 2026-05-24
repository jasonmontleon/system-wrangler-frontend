// SPDX-License-Identifier: Apache-2.0

import { Link } from 'react-router'
import { Card, CardBody, CardTitle } from '@patternfly/react-core'
import type { System } from '../api/systems'

export type LeaderboardEntry = { system: System; value: number }

type LeaderboardCardProps = {
  title: string
  entries: LeaderboardEntry[]
  format: (v: number) => string
  tint?: (v: number) => string | undefined
  emptyText: string
}

export default function LeaderboardCard({
  title,
  entries,
  format,
  tint,
  emptyText,
}: LeaderboardCardProps) {
  return (
    <Card isCompact>
      <CardTitle>{title}</CardTitle>
      <CardBody>
        {entries.length === 0 ? (
          <span
            style={{ color: 'var(--pf-t--global--text--color--subtle)' }}
          >
            {emptyText}
          </span>
        ) : (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          >
            {entries.map(({ system, value }) => (
              <div
                key={system.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Link to={`/systems/${system.id}`}>{system.name}</Link>
                <span
                  style={{
                    backgroundColor: tint?.(value),
                    padding: '0.125rem 0.5rem',
                    borderRadius: '0.25rem',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {format(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
