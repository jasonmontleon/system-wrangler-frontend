// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage'
import type { AuthUser } from '../api/auth'

const baseUser: AuthUser = {
  id: 'u1',
  username: 'admin',
  email: '',
  theme: '',
  createdAt: '2026-05-06T12:00:00Z',
  totpEnabled: false,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// routedFetch builds a fetch mock that dispatches by URL substring. This is
// less flaky than chained mockResolvedValueOnce because the order of mounted
// components (TrustedDevicesCard fires /api/auth/devices on mount, then the
// user clicks Save) doesn't have to match the order of mock setup.
type RouteMap = Record<string, () => Response | Promise<Response>>

function routedFetch(routes: RouteMap): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string) => {
    for (const [substr, fn] of Object.entries(routes)) {
      if (url.includes(substr)) return Promise.resolve(fn())
    }
    // SessionsCard mounts on every ProfilePage render and expects an
    // array; default any unrouted /sessions GET to empty so per-test
    // maps don't each have to declare it.
    if (url.includes('/sessions')) return Promise.resolve(jsonResponse([]))
    return Promise.resolve(jsonResponse({}))
  })
}

describe('ProfilePage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Default: devices endpoint returns empty (TrustedDevicesCard mounts on
    // every render). Per-test setups override this map for the call they
    // actually exercise.
    fetchMock = routedFetch({
      '/api/auth/devices': () => jsonResponse([]),
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the username read-only and the existing email pre-filled', async () => {
    render(
      <ProfilePage
        user={{ ...baseUser, email: 'pre@filled.com' }}
        onProfileUpdate={() => {}}
      />,
    )
    await act(async () => {})
    const username = screen.getByLabelText(/username/i)
    expect(username).toBeDisabled()
    expect((username as HTMLInputElement).value).toBe('admin')

    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe(
      'pre@filled.com',
    )
  })

  it('saves profile updates and reports success', async () => {
    const onProfileUpdate = vi.fn()
    fetchMock = routedFetch({
      '/api/auth/devices': () => jsonResponse([]),
      '/api/auth/profile': () =>
        jsonResponse({ ...baseUser, email: 'a@b.c', theme: 'light' }),
    })
    vi.stubGlobal('fetch', fetchMock)
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
    // Find the PATCH /api/auth/profile call (other calls fire on mount).
    const profileCall = fetchMock.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/api/auth/profile') &&
        (c[1] as RequestInit | undefined)?.method === 'PATCH',
    )
    expect(profileCall).toBeDefined()
    const init = profileCall![1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'a@b.c',
      theme: 'light',
    })
  })

  it('surfaces an error when the profile update fails', async () => {
    fetchMock = routedFetch({
      '/api/auth/devices': () => jsonResponse([]),
      '/api/auth/profile': () => jsonResponse({ error: 'invalid theme' }, 400),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ProfilePage user={baseUser} onProfileUpdate={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => {
      expect(screen.getByText(/save failed/i)).toBeInTheDocument()
    })
  })

  it('warns when the new password is shorter than the minimum', async () => {
    render(<ProfilePage user={baseUser} onProfileUpdate={() => {}} />)
    await act(async () => {})
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

  it('disables the change-password submit until both passwords match', async () => {
    render(<ProfilePage user={baseUser} onProfileUpdate={() => {}} />)
    await act(async () => {})
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
    fetchMock = routedFetch({
      '/api/auth/devices': () => jsonResponse([]),
      '/api/auth/password': () => new Response(null, { status: 204 }),
    })
    vi.stubGlobal('fetch', fetchMock)
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
    fetchMock = routedFetch({
      '/api/auth/devices': () => jsonResponse([]),
      '/api/auth/password': () =>
        jsonResponse({ error: 'current password incorrect' }, 401),
    })
    vi.stubGlobal('fetch', fetchMock)
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
