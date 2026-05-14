// SPDX-License-Identifier: Apache-2.0

import { useState, type FormEvent } from 'react'
import {
  ActionGroup,
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Form,
  FormGroup,
  PageSection,
  Radio,
  TextInput,
  Title,
} from '@patternfly/react-core'
import {
  changePassword,
  updateProfile,
  type AuthUser,
} from '../api/auth'
import MyRolesCard from '../components/MyRolesCard'
import TwoFactorCard from '../components/TwoFactorCard'
import TrustedDevicesCard from '../components/TrustedDevicesCard'

const MIN_PASSWORD = 8

type Theme = 'light' | 'dark'

type Props = {
  user: AuthUser
  onProfileUpdate: (u: AuthUser) => void
}

type ProfilePageProps = Props & {
  // onAuthChange is called when an auth-relevant property of the current
  // user (TOTP enrollment, etc.) changes server-side, so the page can
  // re-fetch /api/auth/status to refresh `user.totpEnabled` and similar.
  onAuthChange?: () => void
}

export default function ProfilePage({
  user,
  onProfileUpdate,
  onAuthChange,
}: ProfilePageProps) {
  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Profile</Title>
      </PageSection>
      <PageSection>
        <ProfileForm user={user} onProfileUpdate={onProfileUpdate} />
      </PageSection>
      <PageSection>
        <ChangePasswordForm />
      </PageSection>
      <PageSection>
        <TwoFactorCard
          initialEnabled={user.totpEnabled}
          onChange={onAuthChange}
        />
      </PageSection>
      <PageSection>
        <TrustedDevicesCard />
      </PageSection>
      <PageSection>
        <MyRolesCard />
      </PageSection>
    </>
  )
}

function ProfileForm({ user, onProfileUpdate }: Props) {
  const initialTheme: Theme = user.theme === 'light' ? 'light' : 'dark'
  const [email, setEmail] = useState(user.email)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await updateProfile({ email: email.trim(), theme })
      onProfileUpdate(updated)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardTitle>Account</CardTitle>
      <CardBody>
        <Form onSubmit={onSubmit} isWidthLimited>
          <FormGroup label="Username" fieldId="profile-username">
            <TextInput id="profile-username" value={user.username} isDisabled />
          </FormGroup>
          <FormGroup label="Email" fieldId="profile-email">
            <TextInput
              id="profile-email"
              type="email"
              value={email}
              onChange={(_, v) => setEmail(v)}
              isDisabled={submitting}
              autoComplete="email"
            />
          </FormGroup>
          <FormGroup label="Theme" role="radiogroup" fieldId="profile-theme">
            <Radio
              id="profile-theme-light"
              name="profile-theme"
              label="Light"
              isChecked={theme === 'light'}
              onChange={() => setTheme('light')}
              isDisabled={submitting}
            />
            <Radio
              id="profile-theme-dark"
              name="profile-theme"
              label="Dark"
              isChecked={theme === 'dark'}
              onChange={() => setTheme('dark')}
              isDisabled={submitting}
            />
          </FormGroup>
          {error && (
            <Alert variant="danger" title="Save failed" isInline>
              {error}
            </Alert>
          )}
          {saved && !error && (
            <Alert variant="success" title="Profile saved" isInline />
          )}
          <ActionGroup>
            <Button
              type="submit"
              variant="primary"
              isLoading={submitting}
              isDisabled={submitting}
            >
              Save changes
            </Button>
          </ActionGroup>
        </Form>
      </CardBody>
    </Card>
  )
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const passwordsMatch = newPassword === confirmPassword
  const newLongEnough = newPassword.length >= MIN_PASSWORD
  const valid =
    currentPassword.length > 0 && newLongEnough && passwordsMatch

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError(null)
    setDone(false)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardTitle>Change password</CardTitle>
      <CardBody>
        <Form onSubmit={onSubmit} isWidthLimited>
          <FormGroup label="Current password" fieldId="pw-current" isRequired>
            <TextInput
              id="pw-current"
              type="password"
              value={currentPassword}
              onChange={(_, v) => setCurrentPassword(v)}
              isDisabled={submitting}
              isRequired
              autoComplete="current-password"
            />
          </FormGroup>
          <FormGroup label="New password" fieldId="pw-new" isRequired>
            <TextInput
              id="pw-new"
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
            {newPassword.length > 0 && !newLongEnough ? (
              <small style={{ color: 'var(--pf-v6-global--danger-color--100, red)' }}>
                Too short — minimum {MIN_PASSWORD} characters.
              </small>
            ) : (
              <small>Minimum {MIN_PASSWORD} characters.</small>
            )}
          </FormGroup>
          <FormGroup label="Confirm new password" fieldId="pw-confirm" isRequired>
            <TextInput
              id="pw-confirm"
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
          {done && !error && (
            <Alert variant="success" title="Password changed" isInline />
          )}
          <ActionGroup>
            <Button
              type="submit"
              variant="primary"
              isLoading={submitting}
              isDisabled={!valid || submitting}
            >
              Change password
            </Button>
          </ActionGroup>
        </Form>
      </CardBody>
    </Card>
  )
}
