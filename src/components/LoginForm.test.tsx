// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginForm from './LoginForm'
import { fetchBuildInfo } from '../api/buildInfo'

// The login footer fires fetchBuildInfo on mount in every test. Default
// it to a never-resolving promise so it neither pollutes other tests'
// fetch counters nor leaves an unhandled rejection; the dedicated
// build-footer describe block overrides this per-test.
vi.mock('../api/buildInfo', () => ({
  fetchBuildInfo: vi.fn(() => new Promise(() => {})),
}))

function authenticatedResult() {
  return {
    kind: 'authenticated' as const,
    user: {
      id: 'u',
      username: 'admin',
      email: '',
      theme: '',
      createdAt: '2026-05-06T12:00:00Z',
    },
  }
}

describe('LoginForm', () => {
  it('disables the submit button until both fields are filled', () => {
    const onLogin = vi.fn()
    render(<LoginForm onLogin={onLogin} />)
    const submit = screen.getByRole('button', { name: /sign in/i })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correctpassword' },
    })
    expect(submit).toBeEnabled()
  })

  it('calls onLogin with trimmed values when submitted', async () => {
    const onLogin = vi.fn().mockResolvedValue(authenticatedResult())
    render(<LoginForm onLogin={onLogin} />)
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: '  admin  ' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('admin', 'correctpassword')
    })
  })

  it('shows the error message when onLogin throws', async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error('invalid credentials'))
    render(<LoginForm onLogin={onLogin} />)
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrong' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument()
    })
  })

  it('shows the lockout banner with unlock time when login returns locked', async () => {
    const onLogin = vi.fn().mockResolvedValue({
      kind: 'locked' as const,
      lockedUntil: new Date(Date.now() + 65_000).toISOString(),
    })
    render(<LoginForm onLogin={onLogin} />)
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByText(/account locked until/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/try again in/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled()
  })

  it('clears the lockout banner when the user edits a field', async () => {
    const onLogin = vi.fn().mockResolvedValue({
      kind: 'locked' as const,
      lockedUntil: new Date(Date.now() + 65_000).toISOString(),
    })
    render(<LoginForm onLogin={onLogin} />)
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrongnow' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByText(/account locked until/i)).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'retrying' },
    })
    expect(screen.queryByText(/account locked until/i)).not.toBeInTheDocument()
  })

  it('swaps to the TOTP challenge form when login returns totpRequired', async () => {
    const onLogin = vi.fn().mockResolvedValue({ kind: 'totp' as const })
    render(<LoginForm onLogin={onLogin} />)
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/authenticator code/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/two-factor authentication/i)).toBeInTheDocument()
  })
})

describe('LoginForm TOTP step', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls totpVerify and then onTotpComplete on success', async () => {
    const onLogin = vi.fn().mockResolvedValue({ kind: 'totp' as const })
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'u',
          username: 'admin',
          email: '',
          theme: '',
          createdAt: 't',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const onTotpComplete = vi.fn()
    render(<LoginForm onLogin={onLogin} onTotpComplete={onTotpComplete} />)

    // Drive through password step.
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/authenticator code/i)).toBeInTheDocument()
    })

    // Submit the TOTP code.
    fireEvent.change(screen.getByLabelText(/authenticator code/i), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }))
    await waitFor(() => {
      expect(onTotpComplete).toHaveBeenCalled()
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      code: '123456',
      rememberDevice: false,
    })
  })

  it('returns to the password step when Back is clicked', async () => {
    const onLogin = vi.fn().mockResolvedValue({ kind: 'totp' as const })
    render(<LoginForm onLogin={onLogin} />)
    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByLabelText(/authenticator code/i)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    // Password should have been cleared so the user has to retype it.
    expect((screen.getByLabelText(/password/i) as HTMLInputElement).value).toBe('')
  })
})

describe('LoginForm OIDC', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/')
    vi.restoreAllMocks()
  })

  it('does not render the SSO button when OIDC is disabled', () => {
    render(<LoginForm onLogin={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: /sign in with/i }),
    ).not.toBeInTheDocument()
  })

  it('renders the SSO button with the provider name when enabled', () => {
    render(
      <LoginForm onLogin={vi.fn()} oidcEnabled oidcDisplayName="Acme SSO" />,
    )
    expect(
      screen.getByRole('button', { name: /sign in with acme sso/i }),
    ).toBeInTheDocument()
  })

  it('falls back to "SSO" when no display name is provided', () => {
    render(<LoginForm onLogin={vi.fn()} oidcEnabled />)
    expect(
      screen.getByRole('button', { name: /sign in with sso/i }),
    ).toBeInTheDocument()
  })

  it('navigates to the OIDC login endpoint on click', () => {
    // jsdom marks window.location.assign non-configurable, so spying on it
    // fails; swap the whole location object for the duration of the test.
    const assign = vi.fn()
    const orig = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...orig, assign },
    })
    try {
      render(<LoginForm onLogin={vi.fn()} oidcEnabled oidcDisplayName="SSO" />)
      fireEvent.click(
        screen.getByRole('button', { name: /sign in with sso/i }),
      )
      expect(assign).toHaveBeenCalledWith('/api/auth/oidc/login')
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: orig,
      })
    }
  })

  it('shows an alert and strips the param when returning with ?error=oidc', async () => {
    window.history.pushState({}, '', '/?error=oidc')
    render(<LoginForm onLogin={vi.fn()} />)
    expect(
      await screen.findByText(/single sign-on failed/i),
    ).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })
})

describe('LoginForm build footer', () => {
  const fetchBuildInfoMock = vi.mocked(fetchBuildInfo)

  afterEach(() => {
    fetchBuildInfoMock.mockReset()
    fetchBuildInfoMock.mockImplementation(() => new Promise(() => {}))
  })

  it('renders the build identifiers in the lower-right after fetch resolves', async () => {
    fetchBuildInfoMock.mockResolvedValueOnce({
      backend: 'be01234',
      frontend: 'fe05678',
      buildDate: '2026-05-29T22:00:00Z',
    })
    render(<LoginForm onLogin={vi.fn()} />)
    const footer = await screen.findByTestId('build-footer')
    expect(footer).toHaveTextContent('frontend fe05678')
    expect(footer).toHaveTextContent('backend be01234')
    expect(footer).toHaveTextContent('built 2026-05-29T22:00:00Z')
  })

  it('does not render the footer when /api/build-info errors', async () => {
    fetchBuildInfoMock.mockRejectedValueOnce(new Error('boom'))
    render(<LoginForm onLogin={vi.fn()} />)
    await waitFor(() => {
      expect(fetchBuildInfoMock).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('build-footer')).not.toBeInTheDocument()
  })
})
