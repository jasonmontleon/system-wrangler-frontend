// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginForm from './LoginForm'

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
