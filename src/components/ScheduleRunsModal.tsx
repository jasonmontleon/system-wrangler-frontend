// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  listScheduleRuns,
  type Schedule,
  type ScheduleRun,
} from '../api/schedules'

type Props = {
  schedule: Schedule | null
  onClose: () => void
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; runs: ScheduleRun[] }

// ScheduleRunsModal shows the recent run history for a single
// schedule. Triggered from the row's "View runs" action. The modal
// fetches on every open so the rows reflect any recent fires; we
// deliberately don't poll — for that, the operator can re-open.
export default function ScheduleRunsModal({ schedule, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    if (!schedule) return
    setState({ kind: 'loading' })
    listScheduleRuns(schedule.id, 50)
      .then((runs) => setState({ kind: 'ready', runs }))
      .catch((err) =>
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      )
  }, [schedule])

  if (!schedule) return null

  return (
    <Modal
      variant="large"
      isOpen={schedule !== null}
      onClose={onClose}
      aria-labelledby="schedule-runs-title"
    >
      <ModalHeader
        title={`Run history: ${schedule.name}`}
        labelId="schedule-runs-title"
      />
      <ModalBody>
        {state.kind === 'loading' && (
          <Bullseye>
            <Spinner aria-label="Loading runs" />
          </Bullseye>
        )}
        {state.kind === 'error' && (
          <Alert variant="danger" title="Could not load runs" isInline>
            {state.message}
          </Alert>
        )}
        {state.kind === 'ready' && state.runs.length === 0 && (
          <Alert variant="info" title="No runs yet" isInline>
            This schedule has not fired since it was created.
          </Alert>
        )}
        {state.kind === 'ready' && state.runs.length > 0 && (
          <Table aria-label="Run history">
            <Thead>
              <Tr>
                <Th>Started</Th>
                <Th>Finished</Th>
                <Th>Status</Th>
                <Th>Attempted</Th>
                <Th>Succeeded</Th>
                <Th>Failed</Th>
                <Th>Message</Th>
              </Tr>
            </Thead>
            <Tbody>
              {state.runs.map((r) => (
                <Tr key={r.id}>
                  <Td dataLabel="Started">{new Date(r.startedAt).toLocaleString()}</Td>
                  <Td dataLabel="Finished">
                    {r.finishedAt ? new Date(r.finishedAt).toLocaleString() : '—'}
                  </Td>
                  <Td dataLabel="Status">
                    <Label color={statusColor(r.status)}>{statusLabel(r.status)}</Label>
                  </Td>
                  <Td dataLabel="Attempted">{r.targetsAttempted}</Td>
                  <Td dataLabel="Succeeded">{r.targetsSucceeded}</Td>
                  <Td dataLabel="Failed">{r.targetsFailed}</Td>
                  <Td dataLabel="Message">{r.message ?? ''}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="link" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  )
}

function statusColor(
  status: ScheduleRun['status'],
): 'blue' | 'green' | 'orange' | 'red' {
  switch (status) {
    case 'success':
      return 'green'
    case 'partial':
      return 'orange'
    case 'failed':
      return 'red'
    default:
      return 'blue'
  }
}

// statusLabel mirrors SchedulesPage's mapping — the wire stays
// lowercase, the chip renders Title Case.
function statusLabel(status: ScheduleRun['status']): string {
  switch (status) {
    case 'running':
      return 'Running'
    case 'success':
      return 'Success'
    case 'partial':
      return 'Partial'
    case 'failed':
      return 'Failed'
  }
}
