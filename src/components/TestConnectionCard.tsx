// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Stack,
  StackItem,
} from '@patternfly/react-core'
import {
  testConnection,
  type ConnectionStatus,
  type ConnectionTestResult,
} from '../api/connection'

type Props = {
  systemId: string
}

type State =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: ConnectionTestResult }
  | { kind: 'error'; message: string }

// TestConnectionCard surfaces the end-to-end probe — `ansible <host>
// -m ping` — once both the Effective credential and Host keys cards
// have reached their accepted/established state. Verifies that
// what the operator has configured actually works in production
// without scheduling a real playbook run.
export default function TestConnectionCard({ systemId }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  const run = async () => {
    setState({ kind: 'running' })
    try {
      const result = await testConnection(systemId)
      setState({ kind: 'done', result })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <Card>
      <CardTitle>Test connection</CardTitle>
      <CardBody>
        <Stack hasGutter>
          {state.kind === 'done' && (
            <StackItem>
              <Alert
                variant={alertVariantFor(state.result.status)}
                isInline
                title={titleFor(state.result.status)}
              >
                {state.result.reason} (exit {state.result.exitCode},{' '}
                {state.result.durationMs}ms)
              </Alert>
            </StackItem>
          )}
          {state.kind === 'error' && (
            <StackItem>
              <Alert variant="danger" isInline title="Test failed to run">
                {state.message}
              </Alert>
            </StackItem>
          )}
          <StackItem>
            <Button
              variant="primary"
              isLoading={state.kind === 'running'}
              isDisabled={state.kind === 'running'}
              onClick={() => void run()}
            >
              {state.kind === 'running' ? 'Pinging…' : 'Run `ansible -m ping`'}
            </Button>
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  )
}

function alertVariantFor(s: ConnectionStatus): 'success' | 'warning' | 'danger' {
  if (s === 'success') return 'success'
  if (s === 'no_accepted_host_key' || s === 'missing_credentials') return 'warning'
  return 'danger'
}

function titleFor(s: ConnectionStatus): string {
  switch (s) {
    case 'success':
      return 'Connection ok'
    case 'host_key_mismatch':
      return 'Host key mismatch'
    case 'no_accepted_host_key':
      return 'No accepted host key'
    case 'missing_credentials':
      return 'Missing credentials'
    default:
      return 'Connection failed'
  }
}
