// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UsersPage from './UsersPage'

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function userRow(overrides: Partial<{
  id: string
  username: string
  email: string
  theme: string
  createdAt: string
  totpEnabled: boolean
  disabled: boolean
  disabledAt?: string
}> = {}) {
  return {
    id: 'u1',
    username: 'alice',
    email: '',
    theme: '',
    createdAt: '2026-05-01T00:00:00Z',
    totpEnabled: false,
    disabled: false,
    ...overrides,
  }
}

describe('UsersPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the empty state when there are no users', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ users: [] }))
    render(<UsersPage currentUserId="u1" />)
    expect(await screen.findByText(/no users yet/i)).toBeInTheDocument()
  })

  it('renders username, status, and a disable action for each user', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        users: [
          userRow({ id: 'u1', username: 'alice' }),
          userRow({ id: 'u2', username: 'bob', disabled: true, disabledAt: '2026-05-12T00:00:00Z' }),
        ],
      }),
    )
    render(<UsersPage currentUserId="u1" />)
    const aliceRow = (await screen.findByText('alice')).closest('tr')!
    expect(within(aliceRow).getByText(/active/i)).toBeInTheDocument()
    // The current user gets a "You" badge and the disable button is disabled.
    expect(within(aliceRow).getByText(/^you$/i)).toBeInTheDocument()
    const disableSelf = within(aliceRow).getByRole('button', { name: /disable alice/i })
    expect(disableSelf).toBeDisabled()

    const bobRow = screen.getByText('bob').closest('tr')!
    expect(within(bobRow).getByText(/disabled/i)).toBeInTheDocument()
    expect(within(bobRow).getByRole('button', { name: /enable bob/i })).toBeInTheDocument()
  })

  it('shows an error alert when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
    render(<UsersPage currentUserId="u1" />)
    expect(await screen.findByText(/could not load users/i)).toBeInTheDocument()
  })

  it('opens the new-user modal and creates a user', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ users: [userRow({ id: 'u1', username: 'alice' })] }))
      .mockResolvedValueOnce(
        jsonResponse(userRow({ id: 'u2', username: 'bob' }), 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            userRow({ id: 'u1', username: 'alice' }),
            userRow({ id: 'u2', username: 'bob' }),
          ],
        }),
      )
    render(<UsersPage currentUserId="u1" />)
    await screen.findByText('alice')

    fireEvent.click(screen.getByRole('button', { name: /new user/i }))
    const usernameInput = await screen.findByLabelText(/username/i)
    fireEvent.change(usernameInput, { target: { value: 'bob' } })
    fireEvent.change(screen.getByLabelText(/initial password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    await screen.findByText('bob')

    const postCall = (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).find(
      (c) => c[0] === '/api/admin/users' && c[1]?.method === 'POST',
    )
    expect(postCall).toBeDefined()
    expect(postCall![1]!.body).toBe(
      JSON.stringify({ username: 'bob', password: 'correctpassword' }),
    )
  })

  it('surfaces server errors from create-user', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ users: [userRow({ id: 'u1' })] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'username already taken' }, 409))
    render(<UsersPage currentUserId="u1" />)
    await screen.findByText('alice')

    fireEvent.click(screen.getByRole('button', { name: /new user/i }))
    fireEvent.change(await screen.findByLabelText(/username/i), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText(/initial password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    expect(await screen.findByText(/username already taken/i)).toBeInTheDocument()
  })

  it('disables a user via the action button', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            userRow({ id: 'u1', username: 'alice' }),
            userRow({ id: 'u2', username: 'bob' }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(userRow({ id: 'u2', username: 'bob', disabled: true })),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            userRow({ id: 'u1', username: 'alice' }),
            userRow({ id: 'u2', username: 'bob', disabled: true }),
          ],
        }),
      )
    render(<UsersPage currentUserId="u1" />)
    const bobRow = (await screen.findByText('bob')).closest('tr')!
    fireEvent.click(within(bobRow).getByRole('button', { name: /disable bob/i }))

    await waitFor(() => {
      const refreshedBobRow = screen.getByText('bob').closest('tr')!
      expect(within(refreshedBobRow).getByText(/disabled/i)).toBeInTheDocument()
    })

    const patchCall = (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).find(
      (c) => c[1]?.method === 'PATCH',
    )
    expect(patchCall![0]).toBe('/api/admin/users/u2')
    expect(patchCall![1]!.body).toBe(JSON.stringify({ disabled: true }))
  })

  it('shows an action error if disable fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            userRow({ id: 'u1', username: 'alice' }),
            userRow({ id: 'u2', username: 'bob' }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: 'cannot disable the last enabled user' }, 400),
      )
    render(<UsersPage currentUserId="u1" />)
    const bobRow = (await screen.findByText('bob')).closest('tr')!
    fireEvent.click(within(bobRow).getByRole('button', { name: /disable bob/i }))

    expect(
      await screen.findByText(/cannot disable the last enabled user/i),
    ).toBeInTheDocument()
  })

  it('re-enables a disabled user', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            userRow({ id: 'u1', username: 'alice' }),
            userRow({ id: 'u2', username: 'bob', disabled: true, disabledAt: '2026-05-12T00:00:00Z' }),
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(userRow({ id: 'u2', username: 'bob', disabled: false })))
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            userRow({ id: 'u1', username: 'alice' }),
            userRow({ id: 'u2', username: 'bob' }),
          ],
        }),
      )
    render(<UsersPage currentUserId="u1" />)
    const bobRow = (await screen.findByText('bob')).closest('tr')!
    fireEvent.click(within(bobRow).getByRole('button', { name: /enable bob/i }))

    await waitFor(() => {
      const refreshed = screen.getByText('bob').closest('tr')!
      expect(within(refreshed).getByText(/active/i)).toBeInTheDocument()
    })

    const patchCall = (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).find(
      (c) => c[1]?.method === 'PATCH',
    )
    expect(patchCall![1]!.body).toBe(JSON.stringify({ disabled: false }))
  })
})
