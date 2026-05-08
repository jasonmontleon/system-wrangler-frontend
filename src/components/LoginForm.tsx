// SPDX-License-Identifier: Apache-2.0

import { useState, type FormEvent } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  TextInput,
} from '@patternfly/react-core'
import type { LoginResult } from '../api/auth'
import { totpVerify } from '../api/auth'
import TotpChallengeForm from './TotpChallengeForm'

type Props = {
  onLogin: (username: string, password: string) => Promise<LoginResult>
  // onTotpComplete is the parent's hook to refresh /api/auth/status after
  // the second-factor step issues a session cookie. Optional so simple
  // (non-TOTP) callers stay typeable.
  onTotpComplete?: () => Promise<void> | void
}

export default function LoginForm({ onLogin, onTotpComplete }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // When the password step returns totpRequired, we swap to the second-step
  // form. The credentials are NOT retained — the backend tracks the partial
  // login via a short-lived signed cookie.
  const [totpStep, setTotpStep] = useState(false)

  const valid = username.trim().length > 0 && password.length > 0

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await onLogin(username.trim(), password)
      if (result.kind === 'totp') {
        setTotpStep(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const onVerify = async (code: string, rememberDevice: boolean) => {
    await totpVerify(code, rememberDevice)
    if (onTotpComplete) {
      await onTotpComplete()
    }
  }

  if (totpStep) {
    return (
      <TotpChallengeForm
        onVerify={onVerify}
        onCancel={() => {
          setTotpStep(false)
          setPassword('')
        }}
      />
    )
  }

  return (
    <Bullseye>
      <Card style={{ width: 380 }}>
        <CardTitle>Sign in</CardTitle>
        <CardBody>
          <Form onSubmit={onSubmit}>
            <FormGroup label="Username" fieldId="login-username" isRequired>
              <TextInput
                id="login-username"
                value={username}
                onChange={(_, v) => setUsername(v)}
                isDisabled={submitting}
                isRequired
                autoFocus
                autoComplete="username"
              />
            </FormGroup>
            <FormGroup label="Password" fieldId="login-password" isRequired>
              <TextInput
                id="login-password"
                type="password"
                value={password}
                onChange={(_, v) => setPassword(v)}
                isDisabled={submitting}
                isRequired
                autoComplete="current-password"
              />
            </FormGroup>
            {error && (
              <Alert variant="danger" title="Sign-in failed" isInline>
                {error}
              </Alert>
            )}
            <Button
              type="submit"
              variant="primary"
              isLoading={submitting}
              isDisabled={!valid || submitting}
            >
              Sign in
            </Button>
          </Form>
        </CardBody>
      </Card>
    </Bullseye>
  )
}
