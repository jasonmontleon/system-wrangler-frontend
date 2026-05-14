// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GroupRolesTab from './GroupRolesTab'

type FetchInput = RequestInfo | URL
type FetchInit = RequestInit | undefined

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GroupRolesTab', () => {
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

  it('renders assignments returned from the backend', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        assignments: [
          { userId: 'u1', username: 'alice', groupId: 'g1', role: 'admin' },
          { userId: 'u2', username: 'bob', groupId: 'g1', role: 'operator' },
        ],
      }),
    )
    render(
      <GroupRolesTab
        groupId="g1"
        groupName="prod"
        canAdmin={true}
        canGrantAdminRole={true}
      />,
    )
    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('Operator')).toBeInTheDocument()
  })

  it('shows empty state with admin guidance for can-admin caller', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ assignments: [] }))
    render(
      <GroupRolesTab
        groupId="g1"
        groupName="prod"
        canAdmin={true}
        canGrantAdminRole={true}
      />,
    )
    expect(
      await screen.findByText(/use add user to grant a role/i),
    ).toBeInTheDocument()
  })

  it('hides the Add user button from non-admin callers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ assignments: [] }))
    render(
      <GroupRolesTab
        groupId="g1"
        groupName="prod"
        canAdmin={false}
        canGrantAdminRole={false}
      />,
    )
    await screen.findByText(/no users have been granted/i)
    expect(screen.queryByRole('button', { name: /add user/i })).toBeNull()
  })

  it('hides the Admin choice from a Group Admin picker', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            { id: 'u1', username: 'alice', disabled: false, totpEnabled: false, createdAt: '', email: '', theme: '' },
          ],
        }),
      )
    render(
      <GroupRolesTab
        groupId="g1"
        groupName="prod"
        canAdmin={true}
        canGrantAdminRole={false}
      />,
    )
    await screen.findByRole('button', { name: /add user/i })
    fireEvent.click(screen.getByRole('button', { name: /add user/i }))
    const modal = await screen.findByRole('dialog', { name: /grant role on prod/i })
    fireEvent.click(within(modal).getByRole('button', { name: /role picker/i }))
    await screen.findByRole('option', { name: 'Operator', hidden: true })
    expect(screen.queryByRole('option', { name: 'Admin', hidden: true })).toBeNull()
    expect(screen.getByRole('option', { name: 'Operator', hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Auditor', hidden: true })).toBeInTheDocument()
  })

  it('includes the Admin choice for a Global Admin', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            { id: 'u1', username: 'alice', disabled: false, totpEnabled: false, createdAt: '', email: '', theme: '' },
          ],
        }),
      )
    render(
      <GroupRolesTab
        groupId="g1"
        groupName="prod"
        canAdmin={true}
        canGrantAdminRole={true}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /add user/i }))
    const modal = await screen.findByRole('dialog', { name: /grant role on prod/i })
    fireEvent.click(within(modal).getByRole('button', { name: /role picker/i }))
    expect(await screen.findByRole('option', { name: 'Admin', hidden: true })).toBeInTheDocument()
  })

  it('grants a role and refreshes', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            { id: 'u1', username: 'alice', disabled: false, totpEnabled: false, createdAt: '', email: '', theme: '' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { userId: 'u1', username: 'alice', groupId: 'g1', role: 'operator' },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          assignments: [
            { userId: 'u1', username: 'alice', groupId: 'g1', role: 'operator' },
          ],
        }),
      )
    render(
      <GroupRolesTab
        groupId="g1"
        groupName="prod"
        canAdmin={true}
        canGrantAdminRole={true}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /add user/i }))
    const modal = await screen.findByRole('dialog', { name: /grant role on prod/i })
    fireEvent.click(within(modal).getByRole('button', { name: /user picker/i }))
    fireEvent.click(await screen.findByRole('option', { name: 'alice', hidden: true }))
    fireEvent.click(within(modal).getByRole('button', { name: /^grant$/i }))
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => [
        String(c[0]),
        (c[1] as RequestInit | undefined)?.method ?? 'GET',
      ])
      expect(calls).toContainEqual(['/api/groups/g1/role-assignments', 'POST'])
    })
  })

  it('surfaces a backend error on grant', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          users: [
            { id: 'u1', username: 'alice', disabled: false, totpEnabled: false, createdAt: '', email: '', theme: '' },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
    render(
      <GroupRolesTab
        groupId="g1"
        groupName="prod"
        canAdmin={true}
        canGrantAdminRole={true}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /add user/i }))
    const modal = await screen.findByRole('dialog', { name: /grant role on prod/i })
    fireEvent.click(within(modal).getByRole('button', { name: /user picker/i }))
    fireEvent.click(await screen.findByRole('option', { name: 'alice', hidden: true }))
    fireEvent.click(within(modal).getByRole('button', { name: /^grant$/i }))
    expect(await screen.findByText(/action failed/i)).toBeInTheDocument()
  })

  it('surfaces a load error if user lookup fails inside the add modal', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
    render(
      <GroupRolesTab
        groupId="g1"
        groupName="prod"
        canAdmin={true}
        canGrantAdminRole={true}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /add user/i }))
    const modal = await screen.findByRole('dialog', { name: /grant role on prod/i })
    expect(
      await within(modal).findByText(/could not load users/i),
    ).toBeInTheDocument()
  })

  it('revokes via the row kebab', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assignments: [
            { userId: 'u1', username: 'alice', groupId: 'g1', role: 'operator' },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ assignments: [] }))
    render(
      <GroupRolesTab
        groupId="g1"
        groupName="prod"
        canAdmin={true}
        canGrantAdminRole={true}
      />,
    )
    await screen.findByText('alice')
    fireEvent.click(screen.getByRole('button', { name: /kebab toggle/i }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /revoke operator from alice/i }),
    )
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => [
        String(c[0]),
        (c[1] as RequestInit | undefined)?.method ?? 'GET',
      ])
      expect(calls).toContainEqual([
        '/api/groups/g1/role-assignments/u1/operator',
        'DELETE',
      ])
    })
  })

  it('shows a load error if listing fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'gone' }, 500))
    render(
      <GroupRolesTab
        groupId="g1"
        groupName="prod"
        canAdmin={true}
        canGrantAdminRole={true}
      />,
    )
    expect(
      await screen.findByText(/could not load role assignments/i),
    ).toBeInTheDocument()
  })
})
