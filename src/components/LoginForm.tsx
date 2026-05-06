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
  onLogin: (username: string, password: string) => Promise<unknown>
}

export default function LoginForm({ onLogin }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = username.trim().length > 0 && password.length > 0

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError(null)
    try {
      await onLogin(username.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
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
