// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState, type FormEvent } from 'react'
import {
  Alert,
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
import { fetchBuildInfo, type BuildInfo } from '../api/buildInfo'
import TotpChallengeForm from './TotpChallengeForm'
import wordmarkDark from '../assets/wordmark-dark.svg'
import wordmarkLight from '../assets/wordmark-light.svg'
import { useTheme } from '../hooks/useTheme'

// CARD_WIDTH is the shared width of the PatternFly Card ("the
// box") and the wordmark above it; pulling it out as a constant
// keeps the two visually aligned if either is later resized.
const CARD_WIDTH = 380

type Props = {
  onLogin: (username: string, password: string) => Promise<LoginResult>
  // onTotpComplete is the parent's hook to refresh /api/auth/status after
  // the second-factor step issues a session cookie. Optional so simple
  // (non-TOTP) callers stay typeable.
  onTotpComplete?: () => Promise<void> | void
}

export default function LoginForm({ onLogin, onTotpComplete }: Props) {
  // No authenticated user yet, so useTheme falls back to the
  // project default; matches the wordmark choice the masthead
  // uses once the user is signed in.
  const [theme] = useTheme()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // When the password step returns totpRequired, we swap to the second-step
  // form. The credentials are NOT retained — the backend tracks the partial
  // login via a short-lived signed cookie.
  const [totpStep, setTotpStep] = useState(false)
  // Conditional-reveal lockout: only populated when correct credentials
  // land on a locked account. Resets when the user re-edits the form.
  const [lockedUntil, setLockedUntil] = useState<string | null>(null)
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchBuildInfo()
      .then((info) => {
        if (!cancelled) setBuildInfo(info)
      })
      .catch(() => {
        // Footer is decorative; swallow the failure rather than
        // showing an error to a user trying to sign in.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const valid = username.trim().length > 0 && password.length > 0

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError(null)
    setLockedUntil(null)
    try {
      const result = await onLogin(username.trim(), password)
      if (result.kind === 'totp') {
        setTotpStep(true)
      } else if (result.kind === 'locked') {
        setLockedUntil(result.lockedUntil)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const onVerify = async (code: string, rememberDevice: boolean) => {
    const result = await totpVerify(code, rememberDevice)
    if (result.kind === 'locked') {
      setTotpStep(false)
      setLockedUntil(result.lockedUntil)
      return
    }
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

  // Re-edit clears the lockout banner so users aren't staring at a stale
  // countdown if they switch usernames or just want to retry after the
  // window expires.
  const onInputChange = (setter: (v: string) => void) => (v: string) => {
    setter(v)
    if (lockedUntil) setLockedUntil(null)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        paddingTop: 64,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <img
        src={theme === 'dark' ? wordmarkDark : wordmarkLight}
        alt="System Wrangler"
        style={{
          width: CARD_WIDTH,
          height: 'auto',
          marginBottom: 24,
          display: 'block',
        }}
      />
      <Card style={{ width: CARD_WIDTH }}>
        <CardTitle>Sign in</CardTitle>
        <CardBody>
          <Form onSubmit={onSubmit}>
            <FormGroup label="Username" fieldId="login-username" isRequired>
              <TextInput
                id="login-username"
                value={username}
                onChange={(_, v) => onInputChange(setUsername)(v)}
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
                onChange={(_, v) => onInputChange(setPassword)(v)}
                isDisabled={submitting}
                isRequired
                autoComplete="current-password"
              />
            </FormGroup>
            {lockedUntil && <LockedAlert lockedUntil={lockedUntil} />}
            {error && (
              <Alert variant="danger" title="Sign-in failed" isInline>
                {error}
              </Alert>
            )}
            <Button
              type="submit"
              variant="primary"
              isLoading={submitting}
              isDisabled={!valid || submitting || lockedUntil !== null}
            >
              Sign in
            </Button>
          </Form>
        </CardBody>
      </Card>
      {buildInfo && <BuildFooter info={buildInfo} />}
    </div>
  )
}

function BuildFooter({ info }: { info: BuildInfo }) {
  return (
    <div
      data-testid="build-footer"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 8,
        fontSize: 11,
        opacity: 0.6,
        textAlign: 'right',
        lineHeight: 1.4,
        pointerEvents: 'none',
      }}
    >
      <div>frontend {info.frontend}</div>
      <div>backend {info.backend}</div>
      <div>built {info.buildDate}</div>
    </div>
  )
}

// LockedAlert renders the lockout banner with the unlock time in the
// title (so it's never missed) and a live-updating countdown in the
// body. The tick runs on a 1-second interval; once the lock expires
// the title flips to "you can try again now."
function LockedAlert({ lockedUntil }: { lockedUntil: string }) {
  const target = new Date(lockedUntil).getTime()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const remaining = Math.max(0, Math.floor((target - now) / 1000))
  if (!Number.isFinite(target) || remaining === 0) {
    return (
      <Alert variant="warning" title="Account ready — re-enter your password" isInline />
    )
  }
  const min = Math.floor(remaining / 60)
  const sec = remaining % 60
  const human = min > 0 ? `${min}m ${sec}s` : `${sec}s`
  const when = new Date(target).toLocaleTimeString()
  return (
    <Alert
      variant="warning"
      title={`Account locked until ${when}`}
      isInline
    >
      Too many failed attempts. Try again in {human}.
    </Alert>
  )
}
