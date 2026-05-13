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

function clickActionsItem(label: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /^actions$/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
}

function clickRowKebab(row: HTMLElement, label: RegExp) {
  fireEvent.click(within(row).getByRole('button', { name: /kebab toggle/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
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

  it('renders username and status for each user; self gets the "You" badge', async () => {
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
    expect(within(aliceRow).getByText(/^you$/i)).toBeInTheDocument()

    const bobRow = screen.getByText('bob').closest('tr')!
    expect(within(bobRow).getByText(/disabled/i)).toBeInTheDocument()
  })

  it('shows an error alert when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
    render(<UsersPage currentUserId="u1" />)
    expect(await screen.findByText(/could not load users/i)).toBeInTheDocument()
  })

  it('opens the new-user modal from the Actions menu and creates a user', async () => {
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

    clickActionsItem(/new user/i)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/username/i), { target: { value: 'bob' } })
    fireEvent.change(within(dialog).getByLabelText(/initial password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

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

    clickActionsItem(/new user/i)
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/username/i), { target: { value: 'alice' } })
    fireEvent.change(within(dialog).getByLabelText(/initial password/i), {
      target: { value: 'correctpassword' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    expect(await screen.findByText(/username already taken/i)).toBeInTheDocument()
  })

  it('disables a user via the row kebab menu', async () => {
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
    clickRowKebab(bobRow, /disable bob/i)

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
    clickRowKebab(bobRow, /disable bob/i)

    expect(
      await screen.findByText(/cannot disable the last enabled user/i),
    ).toBeInTheDocument()
  })

  it('re-enables a disabled user via the row kebab', async () => {
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
    clickRowKebab(bobRow, /enable bob/i)

    await waitFor(() => {
      const refreshed = screen.getByText('bob').closest('tr')!
      expect(within(refreshed).getByText(/active/i)).toBeInTheDocument()
    })

    const patchCall = (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).find(
      (c) => c[1]?.method === 'PATCH',
    )
    expect(patchCall![1]!.body).toBe(JSON.stringify({ disabled: false }))
  })

  it('removes a user only after confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            userRow({ id: 'u1', username: 'alice' }),
            userRow({ id: 'u2', username: 'bob' }),
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({ users: [userRow({ id: 'u1', username: 'alice' })] }),
      )

    render(<UsersPage currentUserId="u1" />)
    const bobRow = (await screen.findByText('bob')).closest('tr')!
    clickRowKebab(bobRow, /remove bob/i)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/permanently remove bob/i)).toBeInTheDocument()
    expect(
      (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).filter(
        (c) => c[1]?.method === 'DELETE',
      ),
    ).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: /^remove$/i }))

    await waitFor(() => {
      expect(screen.queryByText('bob')).not.toBeInTheDocument()
    })
    const deleteCall = (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).find(
      (c) => c[1]?.method === 'DELETE',
    )
    expect(deleteCall![0]).toBe('/api/admin/users/u2')
  })

  it('bulk-removes selected users via the Actions menu', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            userRow({ id: 'u1', username: 'alice' }),
            userRow({ id: 'u2', username: 'bob' }),
            userRow({ id: 'u3', username: 'carol' }),
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({ users: [userRow({ id: 'u1', username: 'alice' })] }),
      )

    render(<UsersPage currentUserId="u1" />)
    await screen.findByText('bob')

    const bobRow = screen.getByText('bob').closest('tr')!
    fireEvent.click(within(bobRow).getByRole('checkbox'))
    const carolRow = screen.getByText('carol').closest('tr')!
    fireEvent.click(within(carolRow).getByRole('checkbox'))

    clickActionsItem(/remove selected/i)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^remove$/i }))

    await waitFor(() => {
      expect(screen.queryByText('bob')).not.toBeInTheDocument()
      expect(screen.queryByText('carol')).not.toBeInTheDocument()
    })
    const deleteCalls = (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).filter(
      (c) => c[1]?.method === 'DELETE',
    )
    expect(deleteCalls.map((c) => c[0]).sort()).toEqual([
      '/api/admin/users/u2',
      '/api/admin/users/u3',
    ])
  })

  it('filters by username via the column filter input', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        users: [
          userRow({ id: 'u1', username: 'alice' }),
          userRow({ id: 'u2', username: 'bob' }),
          userRow({ id: 'u3', username: 'carol' }),
        ],
      }),
    )
    render(<UsersPage currentUserId="u1" />)
    await screen.findByText('alice')

    const filter = screen.getByLabelText(/filter username/i)
    fireEvent.change(filter, { target: { value: 'bo' } })

    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.queryByText('alice')).not.toBeInTheDocument()
    expect(screen.queryByText('carol')).not.toBeInTheDocument()
  })

  it('sorts by username when the column header is clicked', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        users: [
          userRow({ id: 'u1', username: 'carol', createdAt: '2026-05-01T00:00:00Z' }),
          userRow({ id: 'u2', username: 'alice', createdAt: '2026-05-02T00:00:00Z' }),
          userRow({ id: 'u3', username: 'bob', createdAt: '2026-05-03T00:00:00Z' }),
        ],
      }),
    )
    render(<UsersPage currentUserId="u1" />)
    await screen.findByText('alice')

    const header = screen.getByRole('columnheader', { name: /username/i })
    fireEvent.click(header.querySelector('button')!)

    const rows = screen.getAllByRole('row')
    const dataRowTexts = rows.slice(2).map((r) => r.textContent)
    expect(dataRowTexts[0]).toContain('alice')
    expect(dataRowTexts[1]).toContain('bob')
    expect(dataRowTexts[2]).toContain('carol')
  })

  it('admin password reset prompts for a new password and posts it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            userRow({ id: 'u1', username: 'alice' }),
            userRow({ id: 'u2', username: 'bob' }),
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
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
    clickRowKebab(bobRow, /reset password for bob/i)

    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/new password/i), {
      target: { value: 'adminchosen' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /^set password$/i }))

    await waitFor(() => {
      const post = (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).find(
        (c) => c[0] === '/api/admin/users/u2/password' && c[1]?.method === 'POST',
      )
      expect(post).toBeDefined()
      expect(post![1]!.body).toBe(JSON.stringify({ password: 'adminchosen' }))
    })
  })

  it('admin TOTP reset is gated on confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            userRow({ id: 'u1', username: 'alice' }),
            userRow({ id: 'u2', username: 'bob', totpEnabled: true }),
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
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
    clickRowKebab(bobRow, /reset 2fa for bob/i)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/clear bob's authenticator/i)).toBeInTheDocument()
    expect(
      (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).filter(
        (c) => c[1]?.method === 'POST',
      ),
    ).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: /^reset$/i }))

    await waitFor(() => {
      const post = (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).find(
        (c) => c[0] === '/api/admin/users/u2/totp/reset' && c[1]?.method === 'POST',
      )
      expect(post).toBeDefined()
    })
  })

  it('admin TOTP reset does nothing when the target has no 2FA', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        users: [
          userRow({ id: 'u1', username: 'alice' }),
          userRow({ id: 'u2', username: 'bob', totpEnabled: false }),
        ],
      }),
    )
    render(<UsersPage currentUserId="u1" />)
    const bobRow = (await screen.findByText('bob')).closest('tr')!
    fireEvent.click(within(bobRow).getByRole('button', { name: /kebab toggle/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /reset 2fa for bob/i }))
    // Disabled item: no confirm dialog opens and no POST happens.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      (fetchMock.mock.calls as Array<[FetchInput, FetchInit]>).filter(
        (c) => c[1]?.method === 'POST',
      ),
    ).toHaveLength(0)
  })

  it('paginates and offers an All option', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      userRow({ id: `u${i}`, username: `user${i.toString().padStart(2, '0')}` }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ users: many }))
    render(<UsersPage currentUserId="other" />)
    await screen.findByText('user00')

    expect(screen.queryByText('user29')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /page size/i }))
    fireEvent.click(await screen.findByRole('option', { name: /^all$/i }))
    expect(await screen.findByText('user29')).toBeInTheDocument()
  })
})
