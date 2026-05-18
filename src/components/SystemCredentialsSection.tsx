// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  ClipboardCopy,
  Content,
  Label,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core'
import CredentialSlotEditor from './CredentialSlotEditor'
import HostKeysPanel from './HostKeysPanel'
import TestConnectionCard from './TestConnectionCard'
import {
  deleteSystemSlot,
  getEffectiveCredential,
  getSystemSlot,
  putSystemSlot,
  type CredentialScopeKind,
  type CredentialOrigin,
  type CredentialUpsert,
  type EffectiveCredential,
} from '../api/credentials'
import { ApiError } from '../api/systems'
import type { System } from '../api/systems'

type Props = {
  system: System
}

// SystemCredentialsSection is the per-system credentials surface
// rendered inline on SystemDetailPage. Bundles four panels so the
// operator can see what would resolve, fix it if it's wrong, and
// confirm the host actually answers, without leaving the page:
//
//   - Effective panel — what the resolver returns for this system.
//   - Host keys — TOFU surface for SSH host-key trust.
//   - Test connection — gated on creds + host-keys ready.
//   - Slot editor — the per-system override.
export default function SystemCredentialsSection({ system }: Props) {
  const [credsReady, setCredsReady] = useState(false)
  const [hostKeysReady, setHostKeysReady] = useState(false)
  // Stable references for the slot editor's IO props: the editor's
  // useEffect depends on `load`, so a fresh arrow per render would
  // refire the slot fetch every time the parent re-rendered.
  const loadSlot = useCallback(() => getSystemSlot(system.id), [system.id])
  const saveSlot = useCallback(
    (input: CredentialUpsert) => putSystemSlot(system.id, input),
    [system.id],
  )
  const removeSlot = useCallback(() => deleteSystemSlot(system.id), [system.id])
  return (
    <Card>
      <CardTitle>SSH Credentials</CardTitle>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            <EffectivePanel
              systemId={system.id}
              onReadyChange={setCredsReady}
            />
          </StackItem>
          <StackItem>
            <HostKeysPanel
              systemId={system.id}
              onReadyChange={setHostKeysReady}
            />
          </StackItem>
          <StackItem>
            <CredentialSlotEditor
              load={loadSlot}
              save={saveSlot}
              remove={removeSlot}
              scopeLabel={`System "${system.name}"`}
            />
          </StackItem>
          {credsReady && hostKeysReady && (
            <StackItem>
              <TestConnectionCard systemId={system.id} />
            </StackItem>
          )}
        </Stack>
      </CardBody>
    </Card>
  )
}

type EffectiveState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'incomplete'; message: string }
  | { kind: 'ready'; eff: EffectiveCredential }
  | { kind: 'error'; message: string }

// EffectivePanel renders the resolver's verdict for the system.
// Wire shapes:
//   200 → ready, 404 → none, 409 → incomplete, 5xx/network → error.
// onReadyChange fires on transitions into/out of ready so the parent
// can gate downstream affordances (e.g. the Test connection card).
function EffectivePanel({
  systemId,
  onReadyChange,
}: {
  systemId: string
  onReadyChange?: (ready: boolean) => void
}) {
  const [state, setState] = useState<EffectiveState>({ kind: 'loading' })

  const refresh = useCallback(() => {
    setState({ kind: 'loading' })
    getEffectiveCredential(systemId)
      .then((eff) => {
        if (eff === null) {
          setState({ kind: 'none' })
          return
        }
        setState({ kind: 'ready', eff })
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 409) {
          setState({ kind: 'incomplete', message: err.message })
          return
        }
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      })
  }, [systemId])

  useEffect(() => refresh(), [refresh])
  useEffect(() => {
    if (onReadyChange) onReadyChange(state.kind === 'ready')
  }, [state.kind, onReadyChange])

  if (state.kind === 'loading') {
    return (
      <Bullseye>
        <Spinner aria-label="Resolving effective credential" />
      </Bullseye>
    )
  }
  if (state.kind === 'none') {
    return (
      <Alert variant="warning" isInline title="No credentials resolve for this system">
        Set a global default, a group override, or a system override below.
      </Alert>
    )
  }
  if (state.kind === 'incomplete') {
    return (
      <Alert variant="warning" isInline title="Credential is incomplete">
        {state.message}
      </Alert>
    )
  }
  if (state.kind === 'error') {
    return (
      <Alert variant="danger" isInline title="Could not resolve credential">
        {state.message}
      </Alert>
    )
  }
  const { eff } = state
  return (
    <Alert variant="success" isInline title="Effective credential">
      <Stack hasGutter>
        <StackItem>
          <Content>
            <strong>Ansible user:</strong> <code>{eff.ansibleUser}</code>{' '}
            <Label color={sourceColor(eff.userSource)} isCompact>
              from {eff.userSource}
            </Label>
          </Content>
        </StackItem>
        <StackItem>
          <Content>
            <strong>Public key:</strong>{' '}
            <Label color={sourceColor(eff.keySource)} isCompact>
              from {eff.keySource}
            </Label>{' '}
            <Label color="grey" isCompact>
              {originLabel(eff.keyOrigin)}
            </Label>
          </Content>
          <ClipboardCopy
            isReadOnly
            hoverTip="Copy public key"
            clickTip="Copied"
            variant="inline-compact"
          >
            {eff.publicKey}
          </ClipboardCopy>
        </StackItem>
      </Stack>
    </Alert>
  )
}

function sourceColor(s: CredentialScopeKind): 'blue' | 'purple' | 'orange' {
  switch (s) {
    case 'global':
      return 'blue'
    case 'group':
      return 'purple'
    case 'system':
      return 'orange'
  }
}

function originLabel(o: CredentialOrigin): string {
  return o === 'sw_generated' ? 'SW-generated' : 'user-supplied'
}
