// SPDX-License-Identifier: Apache-2.0

import { useState, type FormEvent } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  Form,
  FormGroup,
  TextInput,
} from '@patternfly/react-core'

type Props = {
  // onVerify is supplied by the parent so it can chain a useAuth.refresh()
  // after the session cookie is issued. The parent is also responsible for
  // unmounting this component when the verify resolves.
  onVerify: (code: string, rememberDevice: boolean) => Promise<unknown>
  // onCancel returns the user to the password screen (clears any in-progress
  // state at the parent). Optional — not all callers wire it.
  onCancel?: () => void
}

export default function TotpChallengeForm({ onVerify, onCancel }: Props) {
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [rememberDevice, setRememberDevice] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = code.trim().length > 0

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError(null)
    try {
      await onVerify(code.trim(), rememberDevice)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      // On failure leave the form filled so the user can correct a typo
      // rather than retyping a long recovery code.
    } finally {
      setSubmitting(false)
    }
  }

  const toggleRecovery = () => {
    setUseRecovery((v) => !v)
    setCode('')
    setError(null)
  }

  return (
    <Bullseye>
      <Card style={{ width: 380 }}>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardBody>
          <Form onSubmit={onSubmit}>
            <FormGroup
              label={useRecovery ? 'Recovery code' : 'Authenticator code'}
              fieldId="totp-code"
              isRequired
            >
              <TextInput
                id="totp-code"
                value={code}
                onChange={(_, v) => setCode(v)}
                isDisabled={submitting}
                isRequired
                autoFocus
                autoComplete="one-time-code"
                inputMode={useRecovery ? 'text' : 'numeric'}
                placeholder={useRecovery ? 'XXXXX-XXXXX' : '123456'}
              />
            </FormGroup>
            <Checkbox
              id="totp-remember"
              label="Remember this browser for 30 days"
              isChecked={rememberDevice}
              onChange={(_, v) => setRememberDevice(v)}
              isDisabled={submitting}
            />
            {error && (
              <Alert variant="danger" title="Verification failed" isInline>
                {error}
              </Alert>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <Button
                type="submit"
                variant="primary"
                isLoading={submitting}
                isDisabled={!valid || submitting}
              >
                Verify
              </Button>
              <Button
                type="button"
                variant="link"
                onClick={toggleRecovery}
                isDisabled={submitting}
              >
                {useRecovery
                  ? 'Use authenticator code'
                  : 'Use a recovery code'}
              </Button>
              {onCancel && (
                <Button
                  type="button"
                  variant="link"
                  onClick={onCancel}
                  isDisabled={submitting}
                >
                  Back
                </Button>
              )}
            </div>
          </Form>
        </CardBody>
      </Card>
    </Bullseye>
  )
}
