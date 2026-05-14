// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UserRolesCard from './UserRolesCard'

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('UserRolesCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', (input: FetchInput, init?: FetchInit) =>
      (fetchMock as unknown as typeof fetch)(input, init),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows global and per-group rows for the target user', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assignments: [
            { userId: 'u1', username: 'alice', groupId: null, role: 'admin' },
            { userId: 'u1', username: 'alice', groupId: 'g1', groupName: 'prod', role: 'operator' },
            { userId: 'u2', username: 'bob', groupId: 'g1', groupName: 'prod', role: 'auditor' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: 'g1', name: 'prod', createdAt: '', systemCount: 0 }]),
      )
    render(<UserRolesCard userId="u1" username="alice" editable />)
    expect(await screen.findByText(/global \(install-wide\)/i)).toBeInTheDocument()
    expect(screen.getByText(/group: prod/i)).toBeInTheDocument()
    // Bob's row should NOT appear — different user.
    expect(screen.queryByText(/auditor/i)).toBeNull()
  })

  it('renders empty state when the user holds no roles', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
    render(<UserRolesCard userId="u1" username="alice" editable />)
    expect(await screen.findByText(/no roles assigned/i)).toBeInTheDocument()
    expect(screen.getByText(/use grant role to give them access/i)).toBeInTheDocument()
  })

  it('renders read-only when editable is false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        assignments: [{ userId: 'u1', username: 'alice', groupId: null, role: 'admin' }],
      }),
    )
    render(<UserRolesCard userId="u1" username="alice" editable={false} />)
    await screen.findByText(/global \(install-wide\)/i)
    expect(screen.queryByRole('button', { name: /grant role/i })).toBeNull()
  })

  it('grants a global role and refreshes', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse(
          { userId: 'u1', username: 'alice', groupId: null, role: 'operator' },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          assignments: [{ userId: 'u1', username: 'alice', groupId: null, role: 'operator' }],
        }),
      )
    render(<UserRolesCard userId="u1" username="alice" editable />)
    fireEvent.click(await screen.findByRole('button', { name: /grant role/i }))
    const modal = await screen.findByRole('dialog', { name: /grant role to alice/i })
    fireEvent.click(within(modal).getByRole('button', { name: /^grant$/i }))
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => [
        String(c[0]),
        (c[1] as RequestInit | undefined)?.method ?? 'GET',
      ])
      expect(calls).toContainEqual(['/api/admin/role-assignments', 'POST'])
    })
  })

  it('warns the user when a grant duplicates an existing assignment', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assignments: [{ userId: 'u1', username: 'alice', groupId: null, role: 'operator' }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
    render(<UserRolesCard userId="u1" username="alice" editable />)
    fireEvent.click(await screen.findByRole('button', { name: /grant role/i }))
    const modal = await screen.findByRole('dialog', { name: /grant role to alice/i })
    // Default role is operator, default scope is global — already exists.
    expect(
      within(modal).getByText(/already has that role on the selected scope/i),
    ).toBeInTheDocument()
    expect(
      within(modal).getByRole('button', { name: /^grant$/i }),
    ).toBeDisabled()
  })

  it('revokes a role via the row actions menu', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assignments: [{ userId: 'u1', username: 'alice', groupId: null, role: 'auditor' }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
    render(<UserRolesCard userId="u1" username="alice" editable />)
    await screen.findByText(/global \(install-wide\)/i)
    fireEvent.click(screen.getByRole('button', { name: /kebab toggle/i }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /revoke global auditor/i }),
    )
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => [
        String(c[0]),
        (c[1] as RequestInit | undefined)?.method ?? 'GET',
      ])
      expect(calls).toContainEqual(['/api/admin/role-assignments', 'DELETE'])
    })
  })

  it('grants a role scoped to a specific group', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
      .mockResolvedValueOnce(
        jsonResponse([{ id: 'g1', name: 'prod', createdAt: '', systemCount: 0 }]),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { userId: 'u1', username: 'alice', groupId: 'g1', groupName: 'prod', role: 'admin' },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          assignments: [
            { userId: 'u1', username: 'alice', groupId: 'g1', groupName: 'prod', role: 'admin' },
          ],
        }),
      )
    render(<UserRolesCard userId="u1" username="alice" editable />)
    fireEvent.click(await screen.findByRole('button', { name: /grant role/i }))
    const modal = await screen.findByRole('dialog', { name: /grant role to alice/i })
    fireEvent.click(within(modal).getByRole('button', { name: /scope picker/i }))
    fireEvent.click(
      await screen.findByRole('option', { name: /group: prod/i, hidden: true }),
    )
    fireEvent.click(within(modal).getByRole('button', { name: /role picker/i }))
    fireEvent.click(await screen.findByRole('option', { name: 'Admin', hidden: true }))
    fireEvent.click(within(modal).getByRole('button', { name: /^grant$/i }))
    await waitFor(() => {
      const grantCall = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]) === '/api/admin/role-assignments' &&
          (c[1] as RequestInit | undefined)?.method === 'POST',
      )
      expect(grantCall).toBeDefined()
      const body = JSON.parse(
        (grantCall![1] as RequestInit).body as string,
      ) as { userId: string; groupId: string | null; role: string }
      expect(body).toEqual({ userId: 'u1', groupId: 'g1', role: 'admin' })
    })
  })

  it('shows an error if listing fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'gone' }, 500))
    render(<UserRolesCard userId="u1" username="alice" editable />)
    expect(await screen.findByText(/could not load roles/i)).toBeInTheDocument()
  })
})
