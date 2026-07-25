// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  ExpandableSection,
  Label,
  Stack,
  StackItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import { Link } from 'react-router'
import type { FanOutOutcome } from '../util/updaterFanOut'

export type Props = {
  outcomes: FanOutOutcome[]
  onDismiss: () => void
  // onRetry takes the systems to re-run on; the parent picks the
  // action (it's already captured on every outcome). Phase 4
  // already prompts a confirm modal for apply; retry skips the
  // confirm because the operator just opted into the action.
  onRetry: (systemIds: string[], action: 'check' | 'apply') => void
  // busy is true while the parent's fan-out is in flight. Retry
  // buttons disable while busy so a frantic operator can't pile
  // up runs that the per-system advisory lock would just 409.
  busy: boolean
}

type OutcomeStatus = 'success' | 'partial' | 'failed' | 'skipped'

function outcomeStatus(o: FanOutOutcome): OutcomeStatus {
  if (o.skipped) return 'skipped'
  const failed = o.results.filter((r) => !r.ok).length
  if (failed === 0) return 'success'
  if (failed === o.results.length) return 'failed'
  return 'partial'
}

const STATUS_LABELS: Record<
  OutcomeStatus,
  { color: 'green' | 'red' | 'orange' | 'grey'; text: string }
> = {
  success: { color: 'green', text: 'Succeeded' },
  partial: { color: 'orange', text: 'Partial' },
  failed: { color: 'red', text: 'Failed' },
  skipped: { color: 'grey', text: 'Skipped' },
}

// UpdaterActionResults is the per-fan-out result surface. Replaces
// the simple Alert banner from phases 3/4 with something an
// operator can actually read after running across N systems: an
// aggregate header on top, an expandable card per system with the
// per-updater verdicts and affected counts inside, and a Retry
// button on every non-success row that re-runs the same action on
// just that system.
//
// The component is a controlled stateless view of FanOutOutcome[]
// — the parent owns the fan-out machinery and feeds in outcomes;
// onRetry hands selected system ids back to the parent.
export default function UpdaterActionResults({
  outcomes,
  onDismiss,
  onRetry,
  busy,
}: Props) {
  if (outcomes.length === 0) return null
  const action = outcomes[0].action // identical across one run
  const succeeded = outcomes.filter((o) => outcomeStatus(o) === 'success').length
  const partial = outcomes.filter((o) => outcomeStatus(o) === 'partial').length
  const failed = outcomes.filter((o) => outcomeStatus(o) === 'failed').length
  const skipped = outcomes.filter((o) => outcomeStatus(o) === 'skipped').length
  const allGood = succeeded === outcomes.length

  const retryFailedIDs = outcomes
    .filter((o) => {
      const s = outcomeStatus(o)
      return s === 'partial' || s === 'failed'
    })
    .map((o) => o.systemId)

  return (
    <Card aria-label="Updater action results">
      <CardTitle>
        <Stack hasGutter>
          <StackItem>
            <strong>
              Ran {action} on {outcomes.length} system
              {outcomes.length === 1 ? '' : 's'}
            </strong>
          </StackItem>
          <StackItem>
            <AggregateLabels
              succeeded={succeeded}
              partial={partial}
              failed={failed}
              skipped={skipped}
              total={outcomes.length}
              allGood={allGood}
            />
          </StackItem>
          <StackItem>
            {retryFailedIDs.length > 0 && (
              <Button
                variant="secondary"
                isDisabled={busy}
                onClick={() => onRetry(retryFailedIDs, action)}
              >
                Retry {retryFailedIDs.length} failed system
                {retryFailedIDs.length === 1 ? '' : 's'}
              </Button>
            )}{' '}
            <Button variant="link" onClick={onDismiss}>
              Dismiss
            </Button>
          </StackItem>
        </Stack>
      </CardTitle>
      <CardBody>
        <Stack hasGutter>
          {outcomes.map((o) => (
            <StackItem key={`${o.systemId}:${o.action}`}>
              <SystemRow outcome={o} onRetry={onRetry} busy={busy} />
            </StackItem>
          ))}
        </Stack>
      </CardBody>
    </Card>
  )
}

function AggregateLabels({
  succeeded,
  partial,
  failed,
  skipped,
  total,
  allGood,
}: {
  succeeded: number
  partial: number
  failed: number
  skipped: number
  total: number
  allGood: boolean
}) {
  if (allGood) {
    return <Label color="green">All {total} succeeded</Label>
  }
  return (
    <>
      {succeeded > 0 && (
        <>
          <Label color="green">{succeeded} succeeded</Label>{' '}
        </>
      )}
      {partial > 0 && (
        <>
          <Label color="orange">{partial} partial</Label>{' '}
        </>
      )}
      {failed > 0 && (
        <>
          <Label color="red">{failed} failed</Label>{' '}
        </>
      )}
      {skipped > 0 && <Label color="grey">{skipped} skipped</Label>}
    </>
  )
}

function SystemRow({
  outcome,
  onRetry,
  busy,
}: {
  outcome: FanOutOutcome
  onRetry: (systemIds: string[], action: 'check' | 'apply') => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const status = outcomeStatus(outcome)
  const cfg = STATUS_LABELS[status]
  const totalAffected = outcome.results
    .filter((r) => r.ok && r.affectedCount !== undefined)
    .reduce((sum, r) => sum + (r.affectedCount ?? 0), 0)
  const summary =
    status === 'skipped'
      ? outcome.skipReason ?? 'Skipped'
      : `${outcome.results.filter((r) => r.ok).length}/${outcome.attempted} updater(s) ok` +
        (totalAffected > 0
          ? ` — ${totalAffected} package${totalAffected === 1 ? '' : 's'} ${outcome.action === 'apply' ? 'updated' : 'pending'}`
          : '')

  const toggleContent = (
    <span>
      <Label color={cfg.color} isCompact>
        {cfg.text}
      </Label>{' '}
      <strong>
        <Link to={`/systems/${encodeURIComponent(outcome.systemId)}`}>
          {outcome.systemName}
        </Link>
      </strong>{' '}
      — {summary}
    </span>
  )

  // Skipped rows have no per-updater body to expand; render the
  // reason as the only line.
  if (status === 'skipped') {
    return (
      <Card isCompact>
        <CardBody>{toggleContent}</CardBody>
      </Card>
    )
  }

  return (
    <Card isCompact>
      <CardBody>
        <ExpandableSection
          isExpanded={open}
          onToggle={(_e, expanded) => setOpen(expanded)}
          toggleContent={toggleContent}
        >
          <Table aria-label={`Per-updater results for ${outcome.systemName}`} variant="compact">
            <Thead>
              <Tr>
                <Th>Updater</Th>
                <Th>Result</Th>
                <Th>Affected</Th>
                <Th>Reason</Th>
              </Tr>
            </Thead>
            <Tbody>
              {outcome.results.map((r) => (
                <Tr key={r.updaterId}>
                  <Td>
                    <Stack>
                      <StackItem>{r.displayName}</StackItem>
                      <StackItem>
                        <small>{r.updaterId}</small>
                      </StackItem>
                    </Stack>
                  </Td>
                  <Td>
                    {r.ok ? (
                      <Label color="green" isCompact>
                        ok
                      </Label>
                    ) : (
                      <Label color="red" isCompact>
                        fail
                      </Label>
                    )}
                  </Td>
                  <Td>{r.affectedCount ?? '—'}</Td>
                  <Td>
                    {r.error ?? (r.ok ? '' : '—')}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          {(status === 'partial' || status === 'failed') && (
            <Button
              variant="link"
              isDisabled={busy}
              onClick={() => onRetry([outcome.systemId], outcome.action)}
            >
              Retry on {outcome.systemName}
            </Button>
          )}
        </ExpandableSection>
      </CardBody>
    </Card>
  )
}
