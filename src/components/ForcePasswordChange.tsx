// SPDX-License-Identifier: Apache-2.0

import { useState, type FormEvent } from 'react'
import {
  ActionGroup,
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
import { changePassword } from '../api/auth'

const MIN_PASSWORD = 8

type Props = {
  username: string
  onChanged: () => void | Promise<void>
}

export default function ForcePasswordChange({ username, onChanged }: Props) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const passwordsMatch = newPassword === confirmPassword
  const newLongEnough = newPassword.length >= MIN_PASSWORD
  const valid = currentPassword.length > 0 && newLongEnough && passwordsMatch

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError(null)
    try {
      await changePassword(currentPassword, newPassword)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Bullseye style={{ height: '100vh' }}>
      <Card style={{ maxWidth: 480, width: '100%' }}>
        <CardTitle>Set a new password</CardTitle>
        <CardBody>
          <p style={{ marginBottom: 16 }}>
            An administrator set the password for <strong>{username}</strong>.
            Choose a new one to continue.
          </p>
          <Form onSubmit={onSubmit}>
            <FormGroup
              label="Current (admin-supplied) password"
              fieldId="force-pw-current"
              isRequired
            >
              <TextInput
                id="force-pw-current"
                type="password"
                value={currentPassword}
                onChange={(_, v) => setCurrentPassword(v)}
                isDisabled={submitting}
                isRequired
                autoComplete="current-password"
                autoFocus
              />
            </FormGroup>
            <FormGroup label="New password" fieldId="force-pw-new" isRequired>
              <TextInput
                id="force-pw-new"
                type="password"
                value={newPassword}
                onChange={(_, v) => setNewPassword(v)}
                isDisabled={submitting}
                isRequired
                autoComplete="new-password"
                validated={
                  newPassword.length > 0 && !newLongEnough ? 'error' : 'default'
                }
              />
              <small>Minimum {MIN_PASSWORD} characters.</small>
            </FormGroup>
            <FormGroup
              label="Confirm new password"
              fieldId="force-pw-confirm"
              isRequired
            >
              <TextInput
                id="force-pw-confirm"
                type="password"
                value={confirmPassword}
                onChange={(_, v) => setConfirmPassword(v)}
                isDisabled={submitting}
                isRequired
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <small style={{ color: 'var(--pf-v6-global--danger-color--100, red)' }}>
                  Passwords do not match.
                </small>
              )}
            </FormGroup>
            {error && (
              <Alert variant="danger" title="Change failed" isInline>
                {error}
              </Alert>
            )}
            <ActionGroup>
              <Button
                type="submit"
                variant="primary"
                isLoading={submitting}
                isDisabled={!valid || submitting}
              >
                Set password
              </Button>
            </ActionGroup>
          </Form>
        </CardBody>
      </Card>
    </Bullseye>
  )
}
