// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage'
import type { AuthUser } from '../api/auth'

const baseUser: AuthUser = {
  id: 'u1',
  username: 'admin',
  email: '',
  theme: '',
  createdAt: '2026-05-06T12:00:00Z',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('ProfilePage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the username read-only and the existing email pre-filled', () => {
    render(
      <ProfilePage
        user={{ ...baseUser, email: 'pre@filled.com' }}
        onProfileUpdate={() => {}}
      />,
    )
    const username = screen.getByLabelText(/username/i)
    expect(username).toBeDisabled()
    expect((username as HTMLInputElement).value).toBe('admin')

    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe(
      'pre@filled.com',
    )
  })

  it('saves profile updates and reports success', async () => {
    const onProfileUpdate = vi.fn()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...baseUser, email: 'a@b.c', theme: 'light' }),
    )
    render(<ProfilePage user={baseUser} onProfileUpdate={onProfileUpdate} />)

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'a@b.c' },
    })
    fireEvent.click(screen.getByLabelText(/^light$/i))
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(onProfileUpdate).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText(/profile saved/i)).toBeInTheDocument()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'a@b.c',
      theme: 'light',
    })
  })

  it('surfaces an error when the profile update fails', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid theme' }, 400),
    )
    render(<ProfilePage user={baseUser} onProfileUpdate={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => {
      expect(screen.getByText(/save failed/i)).toBeInTheDocument()
    })
  })

  it('warns when the new password is shorter than the minimum', () => {
    render(<ProfilePage user={baseUser} onProfileUpdate={() => {}} />)
    expect(screen.queryByText(/too short/i)).toBeNull()

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'short' },
    })
    expect(screen.getByText(/too short/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'longenoughnow' },
    })
    expect(screen.queryByText(/too short/i)).toBeNull()
  })

  it('disables the change-password submit until both passwords match', () => {
    render(<ProfilePage user={baseUser} onProfileUpdate={() => {}} />)
    const button = screen.getByRole('button', { name: /change password/i })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'oldpass' },
    })
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'short' },
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'short' },
    })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'newsecretpw' },
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'mismatch' },
    })
    expect(button).toBeDisabled()
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'newsecretpw' },
    })
    expect(button).toBeEnabled()
  })

  it('changes the password and clears the form on success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    render(<ProfilePage user={baseUser} onProfileUpdate={() => {}} />)

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'oldpass' },
    })
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'newsecretpw' },
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'newsecretpw' },
    })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(screen.getByText(/password changed/i)).toBeInTheDocument()
    })
    expect(
      (screen.getByLabelText(/current password/i) as HTMLInputElement).value,
    ).toBe('')
  })

  it('reports the server error when the password change fails', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'current password incorrect' }, 401),
    )
    render(<ProfilePage user={baseUser} onProfileUpdate={() => {}} />)

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'wrong' },
    })
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'newsecretpw' },
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'newsecretpw' },
    })
    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(screen.getByText(/change failed/i)).toBeInTheDocument()
    })
    expect(
      screen.getByText(/current password incorrect/i),
    ).toBeInTheDocument()
  })
})
