// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  ClipboardCopy,
  Content,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
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
  type EffectiveCredential,
} from '../api/credentials'
import { ApiError } from '../api/systems'
import type { System } from '../api/systems'

type Props = {
  system: System
  isOpen: boolean
  onClose: () => void
}

// SystemCredentialsModal is the per-system Credentials surface
// launched from SystemsPage row actions. It bundles two things
// into one dialog so the operator never has to ask "would this
// system actually inherit X?":
//
//   - The slot editor for the system scope (CredentialSlotEditor
//     wired against the system endpoints).
//   - The Effective panel — a read-only summary showing what the
//     resolver would actually return for this system, with badges
//     calling out which scope supplied each field.
//
// The two halves refresh together: every save through the editor
// invalidates the effective view, so the operator sees the new
// resolution immediately.
export default function SystemCredentialsModal({ system, isOpen, onClose }: Props) {
  const [credsReady, setCredsReady] = useState(false)
  const [hostKeysReady, setHostKeysReady] = useState(false)
  return (
    <Modal isOpen={isOpen} onClose={onClose} variant="medium">
      <ModalHeader title={`Credentials — ${system.name}`} />
      <ModalBody>
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
          {credsReady && hostKeysReady && (
            <StackItem>
              <TestConnectionCard systemId={system.id} />
            </StackItem>
          )}
          <StackItem>
            <CredentialSlotEditor
              load={() => getSystemSlot(system.id)}
              save={(input) => putSystemSlot(system.id, input)}
              remove={() => deleteSystemSlot(system.id)}
              scopeLabel={`System "${system.name}"`}
            />
          </StackItem>
        </Stack>
      </ModalBody>
    </Modal>
  )
}

type EffectiveState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'incomplete'; message: string }
  | { kind: 'ready'; eff: EffectiveCredential }
  | { kind: 'error'; message: string }

// EffectivePanel renders the resolver's verdict for the system.
// The four wire shapes the backend can hand back:
//
//   200 → ready
//   404 → none ("no credentials configured anywhere")
//   409 → incomplete ("you set a user but no key, or vice versa")
//   5xx / network → error
//
// Each branch surfaces a different message so the operator knows
// whether to scroll down and edit, or fix something elsewhere.
//
// onReadyChange (optional) fires whenever the panel transitions
// into or out of the `ready` state so the parent can show/hide
// downstream affordances (e.g. the Test connection card) gated on
// "we have a resolved credential."
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
