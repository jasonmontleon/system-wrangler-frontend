// SPDX-License-Identifier: Apache-2.0

import { useState, type FormEvent } from 'react'
import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  ClipboardCopy,
  Form,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core'
import {
  totpConfirm,
  totpDisable,
  totpSetup,
  type TotpSetup,
} from '../api/auth'

type Props = {
  // initialEnabled lets the parent supply the user's current TOTP-enabled
  // status from /api/auth/status. The card manages its own state from there.
  initialEnabled: boolean
  // onChange notifies the parent that TOTP enablement changed so it can
  // refresh status (e.g. show a fresh `authenticated` payload).
  onChange?: () => void
}

type EnrollPhase =
  | { kind: 'idle' }
  | { kind: 'setup'; data: TotpSetup; code: string; submitting: boolean; error: string | null }
  | { kind: 'codes'; codes: string[]; saved: boolean }

export default function TwoFactorCard({ initialEnabled, onChange }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [phase, setPhase] = useState<EnrollPhase>({ kind: 'idle' })
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [disableOpen, setDisableOpen] = useState(false)

  const startEnroll = async () => {
    setEnrollError(null)
    try {
      const data = await totpSetup()
      setPhase({ kind: 'setup', data, code: '', submitting: false, error: null })
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : String(err))
    }
  }

  const cancelEnroll = () => {
    setPhase({ kind: 'idle' })
    setEnrollError(null)
  }

  const submitEnroll = async (e: FormEvent) => {
    e.preventDefault()
    if (phase.kind !== 'setup') return
    setPhase({ ...phase, submitting: true, error: null })
    try {
      const codes = await totpConfirm(phase.code.trim())
      setPhase({ kind: 'codes', codes, saved: false })
      setEnabled(true)
      onChange?.()
    } catch (err) {
      setPhase({
        ...phase,
        submitting: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const dismissCodes = () => {
    setPhase({ kind: 'idle' })
  }

  return (
    <Card>
      <CardTitle>Two-factor authentication</CardTitle>
      <CardBody>
        {phase.kind === 'codes' ? (
          // Codes phase wins over enabled — when we just enrolled, the user
          // is now `enabled=true` AND should see the recovery codes once.
          // Without this branch the conditional ladder below would fall into
          // the `enabled` arm and skip the codes display.
          <Stack hasGutter>
            <StackItem>
              <Alert
                variant="success"
                title="Two-factor authentication enabled"
                isInline
              >
                Save these recovery codes somewhere safe. Each one can be used
                once to sign in if you lose access to your authenticator. They
                will not be shown again.
              </Alert>
            </StackItem>
            <StackItem>
              <ClipboardCopy
                isReadOnly
                isExpanded
                hoverTip="Copy all"
                clickTip="Copied"
              >
                {phase.codes.join('\n')}
              </ClipboardCopy>
            </StackItem>
            <StackItem>
              <Checkbox
                id="totp-saved-codes"
                label="I have saved these recovery codes"
                isChecked={phase.saved}
                onChange={(_, v) => setPhase({ ...phase, saved: v })}
              />
            </StackItem>
            <StackItem>
              <Button
                variant="primary"
                isDisabled={!phase.saved}
                onClick={dismissCodes}
              >
                Done
              </Button>
            </StackItem>
          </Stack>
        ) : enabled ? (
          <Stack hasGutter>
            <StackItem>
              Two-factor authentication is enabled on this account. Sign-ins
              from new browsers require a code from your authenticator app
              (or a recovery code).
            </StackItem>
            <StackItem>
              <Button variant="danger" onClick={() => setDisableOpen(true)}>
                Disable two-factor authentication
              </Button>
            </StackItem>
          </Stack>
        ) : phase.kind === 'idle' ? (
          <Stack hasGutter>
            <StackItem>
              Add a second step at sign-in using an authenticator app
              (1Password, Authy, Google Authenticator, etc.).
            </StackItem>
            {enrollError && (
              <StackItem>
                <Alert variant="danger" title="Enrollment failed" isInline>
                  {enrollError}
                </Alert>
              </StackItem>
            )}
            <StackItem>
              <Button variant="primary" onClick={() => void startEnroll()}>
                Enable
              </Button>
            </StackItem>
          </Stack>
        ) : phase.kind === 'setup' ? (
          <Form onSubmit={submitEnroll}>
            <Stack hasGutter>
              <StackItem>
                Scan the QR code below with your authenticator app, or copy
                the secret. Then enter the 6-digit code your app shows to
                confirm.
              </StackItem>
              <StackItem>
                <img
                  src={`data:image/png;base64,${phase.data.qrPng}`}
                  alt="TOTP QR code"
                  width={256}
                  height={256}
                />
              </StackItem>
              <StackItem>
                <FormGroup label="Secret (manual entry)" fieldId="totp-secret">
                  <ClipboardCopy
                    isReadOnly
                    hoverTip="Copy"
                    clickTip="Copied"
                  >
                    {phase.data.secret}
                  </ClipboardCopy>
                </FormGroup>
              </StackItem>
              <StackItem>
                <FormGroup
                  label="Authenticator code"
                  fieldId="totp-confirm-code"
                  isRequired
                >
                  <TextInput
                    id="totp-confirm-code"
                    value={phase.code}
                    onChange={(_, v) =>
                      setPhase({ ...phase, code: v, error: null })
                    }
                    isDisabled={phase.submitting}
                    isRequired
                    inputMode="numeric"
                    placeholder="123456"
                    autoComplete="one-time-code"
                  />
                </FormGroup>
              </StackItem>
              {phase.error && (
                <StackItem>
                  <Alert variant="danger" title="Verification failed" isInline>
                    {phase.error}
                  </Alert>
                </StackItem>
              )}
              <StackItem>
                <ActionGroup>
                  <Button
                    type="submit"
                    variant="primary"
                    isLoading={phase.submitting}
                    isDisabled={
                      phase.submitting || phase.code.trim().length === 0
                    }
                  >
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    onClick={cancelEnroll}
                    isDisabled={phase.submitting}
                  >
                    Cancel
                  </Button>
                </ActionGroup>
              </StackItem>
            </Stack>
          </Form>
        ) : null}
      </CardBody>
      {disableOpen && (
        <DisableModal
          onClose={() => setDisableOpen(false)}
          onDisabled={() => {
            setEnabled(false)
            setDisableOpen(false)
            onChange?.()
          }}
        />
      )}
    </Card>
  )
}

type DisableProps = {
  onClose: () => void
  onDisabled: () => void
}

function DisableModal({ onClose, onDisabled }: DisableProps) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = password.length > 0 && code.trim().length > 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError(null)
    try {
      await totpDisable(password, code.trim())
      onDisabled()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} aria-labelledby="totp-disable-title">
      <ModalHeader title="Disable two-factor authentication" labelId="totp-disable-title" />
      <ModalBody>
        <Form id="totp-disable-form" onSubmit={submit}>
          <FormGroup label="Password" fieldId="disable-password" isRequired>
            <TextInput
              id="disable-password"
              type="password"
              value={password}
              onChange={(_, v) => setPassword(v)}
              isDisabled={submitting}
              isRequired
              autoComplete="current-password"
            />
          </FormGroup>
          <FormGroup label="Authenticator code" fieldId="disable-code" isRequired>
            <TextInput
              id="disable-code"
              value={code}
              onChange={(_, v) => setCode(v)}
              isDisabled={submitting}
              isRequired
              inputMode="numeric"
              placeholder="123456"
              autoComplete="one-time-code"
            />
          </FormGroup>
          {error && (
            <Alert variant="danger" title="Disable failed" isInline>
              {error}
            </Alert>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          form="totp-disable-form"
          type="submit"
          variant="danger"
          isLoading={submitting}
          isDisabled={!valid || submitting}
        >
          Disable
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={submitting}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}
