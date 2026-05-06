// SPDX-License-Identifier: AGPL-3.0-or-later

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

type Props = {
  onSetup: (username: string, password: string) => Promise<unknown>
}

const MIN_PASSWORD = 8

export default function SetupForm({ onSetup }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid =
    username.trim().length >= 1 &&
    password.length >= MIN_PASSWORD &&
    password === confirm

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError(null)
    try {
      await onSetup(username.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Bullseye>
      <Card style={{ width: 420 }}>
        <CardTitle>Create admin account</CardTitle>
        <CardBody>
          <p style={{ marginBottom: 16 }}>
            Welcome — pick the credentials for the first user. This account
            owns the install and creates other users.
          </p>
          <Form onSubmit={onSubmit}>
            <FormGroup label="Username" fieldId="setup-username" isRequired>
              <TextInput
                id="setup-username"
                value={username}
                onChange={(_, v) => setUsername(v)}
                isDisabled={submitting}
                isRequired
                autoFocus
                autoComplete="username"
              />
            </FormGroup>
            <FormGroup label="Password" fieldId="setup-password" isRequired>
              <TextInput
                id="setup-password"
                type="password"
                value={password}
                onChange={(_, v) => setPassword(v)}
                isDisabled={submitting}
                isRequired
                autoComplete="new-password"
              />
              <small>Minimum {MIN_PASSWORD} characters.</small>
            </FormGroup>
            <FormGroup label="Confirm password" fieldId="setup-confirm" isRequired>
              <TextInput
                id="setup-confirm"
                type="password"
                value={confirm}
                onChange={(_, v) => setConfirm(v)}
                isDisabled={submitting}
                isRequired
                autoComplete="new-password"
              />
              {confirm.length > 0 && password !== confirm && (
                <small style={{ color: 'var(--pf-v6-global--danger-color--100, red)' }}>
                  Passwords do not match.
                </small>
              )}
            </FormGroup>
            {error && (
              <Alert variant="danger" title="Setup failed" isInline>
                {error}
              </Alert>
            )}
            <Button
              type="submit"
              variant="primary"
              isLoading={submitting}
              isDisabled={!valid || submitting}
            >
              Create account
            </Button>
          </Form>
        </CardBody>
      </Card>
    </Bullseye>
  )
}
