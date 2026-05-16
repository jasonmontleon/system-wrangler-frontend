// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState, type FormEvent } from 'react'
import {
  ActionGroup,
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  ClipboardCopy,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Label,
  Spinner,
  Stack,
  StackItem,
  TextArea,
  TextInput,
} from '@patternfly/react-core'
import { ApiError } from '../api/systems'
import type {
  CredentialOrigin,
  CredentialSlot,
  CredentialUpsert,
} from '../api/credentials'

// KeyMode is the editor's intent for the key field on save:
//   - inherit: leave the slot's existing key (or absence) alone
//   - generate: have the server mint a fresh ed25519 keypair
//   - paste:    user-supplied PEM
//   - clear:    remove the existing key from this slot
type KeyMode = 'inherit' | 'generate' | 'paste' | 'clear'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; slot: CredentialSlot | null }
  | { kind: 'error'; message: string }

export type Props = {
  // load fetches the current slot. Returning null means "no slot
  // configured at this scope yet" and the editor starts from a
  // clean form.
  load: () => Promise<CredentialSlot | null>
  // save persists the upsert and returns the new slot. The
  // editor merges that into its local state so a second edit
  // doesn't refetch.
  save: (input: CredentialUpsert) => Promise<CredentialSlot>
  // remove deletes the slot. nil means "no remove action" (the
  // caller doesn't want to expose a delete affordance, e.g.
  // global is conceptually always present).
  remove?: () => Promise<void>
  // scopeLabel is the human-readable noun in the title — e.g.
  // "global default" or `Group "prod"`.
  scopeLabel: string
}

// CredentialSlotEditor is the shared form used by the
// Administration → Credentials page (global), the Credentials tab
// on Group Detail, and (Phase 4+) the equivalent on System
// Detail. It always loads from `props.load` on mount and writes
// back through `props.save`.
//
// The wire format the backend accepts is permissive: each PUT can
// touch just the user, just the key, or both. The editor mirrors
// this with a KeyMode selector so the operator sees one screen
// per slot regardless of intent.
export default function CredentialSlotEditor({
  load,
  save,
  remove,
  scopeLabel,
}: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [ansibleUser, setAnsibleUser] = useState('')
  const [keyMode, setKeyMode] = useState<KeyMode>('inherit')
  const [pem, setPem] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    load()
      .then((slot) => {
        if (cancelled) return
        setAnsibleUser(slot?.ansibleUser ?? '')
        setKeyMode('inherit')
        setPem('')
        setState({ kind: 'ready', slot })
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      })
    return () => {
      cancelled = true
    }
  }, [load])

  if (state.kind === 'loading') {
    return (
      <Bullseye>
        <Spinner aria-label={`Loading ${scopeLabel} credentials`} />
      </Bullseye>
    )
  }
  if (state.kind === 'error') {
    return (
      <Alert variant="danger" isInline title="Could not load credentials">
        {state.message}
      </Alert>
    )
  }

  const { slot } = state

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaveError(null)
    setSaveNotice(null)

    const input: CredentialUpsert = {}
    if (ansibleUser !== (slot?.ansibleUser ?? '')) {
      input.ansibleUser = ansibleUser
    }
    switch (keyMode) {
      case 'inherit':
        break
      case 'generate':
        input.key = { origin: 'sw_generated' }
        break
      case 'paste':
        if (!pem.trim()) {
          setSaveError('Paste a private key or switch the Key field back to Inherit.')
          return
        }
        input.key = { origin: 'user_supplied', privateKeyPem: pem }
        break
      case 'clear':
        input.clearKey = true
        break
    }
    if (Object.keys(input).length === 0) {
      setSaveError('Nothing to save. Change the user, change the key, or cancel.')
      return
    }

    setSaving(true)
    try {
      const updated = await save(input)
      setState({ kind: 'ready', slot: updated })
      setAnsibleUser(updated.ansibleUser ?? '')
      setKeyMode('inherit')
      setPem('')
      setSaveNotice('Saved.')
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      setSaveError(msg)
    } finally {
      setSaving(false)
    }
  }

  const onRemove = async () => {
    if (!remove) return
    setSaveError(null)
    setSaveNotice(null)
    setRemoving(true)
    try {
      await remove()
      setState({ kind: 'ready', slot: null })
      setAnsibleUser('')
      setKeyMode('inherit')
      setPem('')
      setSaveNotice('Removed.')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Card>
      <CardTitle>Ansible credentials — {scopeLabel}</CardTitle>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            <SlotStatus slot={slot} />
          </StackItem>
          {saveError && (
            <StackItem>
              <Alert variant="danger" isInline title="Save failed">
                {saveError}
              </Alert>
            </StackItem>
          )}
          {saveNotice && (
            <StackItem>
              <Alert variant="success" isInline title={saveNotice} />
            </StackItem>
          )}
          <StackItem>
            <Form onSubmit={onSubmit}>
              <FormGroup label="Ansible user" fieldId="ansible-user">
                <TextInput
                  id="ansible-user"
                  value={ansibleUser}
                  onChange={(_, v) => setAnsibleUser(v)}
                  placeholder="e.g. ansible, deploy, ubuntu"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      Leave blank to inherit from a higher scope.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>

              <FormGroup label="Key action" fieldId="key-mode">
                <FormSelect
                  id="key-mode"
                  value={keyMode}
                  onChange={(_, v) => setKeyMode(v as KeyMode)}
                  aria-label="Key action"
                >
                  <FormSelectOption value="inherit" label="Leave key unchanged" />
                  <FormSelectOption value="generate" label="Generate a new ed25519 keypair" />
                  <FormSelectOption value="paste" label="Paste an existing private key" />
                  {slot?.publicKey && (
                    <FormSelectOption value="clear" label="Remove the key" />
                  )}
                </FormSelect>
              </FormGroup>

              {keyMode === 'paste' && (
                <FormGroup label="Private key (PEM)" fieldId="private-key" isRequired>
                  <TextArea
                    id="private-key"
                    value={pem}
                    onChange={(_, v) => setPem(v)}
                    rows={8}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    aria-label="Private key PEM"
                  />
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        Any well-formed PEM is accepted. Passphrase-protected keys are not supported.
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
              )}

              <ActionGroup>
                <Button
                  variant="primary"
                  type="submit"
                  isLoading={saving}
                  isDisabled={saving || removing}
                >
                  Save
                </Button>
                {remove && slot && (
                  <Button
                    variant="danger"
                    onClick={() => void onRemove()}
                    isLoading={removing}
                    isDisabled={saving || removing}
                  >
                    Remove slot
                  </Button>
                )}
              </ActionGroup>
            </Form>
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  )
}

// SlotStatus renders the current state of the slot: what's set,
// when it was last updated, and the public key (with copy-to-
// clipboard) when one is configured. Public keys are deliberately
// shown verbatim — the backend never returns the private bytes,
// and operators need the line to paste into authorized_keys.
function SlotStatus({ slot }: { slot: CredentialSlot | null }) {
  if (!slot) {
    return (
      <Alert variant="info" isInline title="No slot configured at this scope">
        Save a user and/or key below to set one, or leave it empty to inherit
        from a higher scope.
      </Alert>
    )
  }
  return (
    <Stack hasGutter>
      <StackItem>
        <Label color={slot.ansibleUser ? 'green' : 'grey'}>
          Ansible user: {slot.ansibleUser || '(inherits)'}
        </Label>{' '}
        <Label color={slot.publicKey ? 'green' : 'grey'}>
          Key: {slot.publicKey ? originLabel(slot.origin) : 'inherits'}
        </Label>
      </StackItem>
      {slot.publicKey && (
        <StackItem>
          <FormHelperText>
            <HelperText>
              <HelperTextItem>
                Paste this line into <code>~/.ssh/authorized_keys</code> on
                every target system. Refresh the page after rotating to copy
                the new line.
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
          <ClipboardCopy
            isReadOnly
            hoverTip="Copy public key"
            clickTip="Copied"
            variant="inline-compact"
          >
            {slot.publicKey}
          </ClipboardCopy>
        </StackItem>
      )}
    </Stack>
  )
}

function originLabel(origin: CredentialOrigin | undefined): string {
  switch (origin) {
    case 'sw_generated':
      return 'SW-generated'
    case 'user_supplied':
      return 'user-supplied'
    default:
      return 'configured'
  }
}
