// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GroupExclusionsTab from './GroupExclusionsTab'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const dnfDef = {
  id: 'dnf',
  displayName: 'dnf',
  pkgManager: 'dnf',
  source: 'builtin' as const,
  enabled: true,
  supportsExclusions: true,
}

const dnfRow = {
  id: 'ex-1',
  scope: 'group',
  targetId: 'g-1',
  updater: 'dnf',
  pattern: 'kernel-*',
  reason: '',
  createdAt: '2026-05-15T00:00:00Z',
  createdBy: 'admin',
}

describe('GroupExclusionsTab', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs and refreshes on create', async () => {
    fetchMock.mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (
        url.endsWith('/api/groups/g-1/package-exclusions') &&
        method === 'GET'
      ) {
        return Promise.resolve(jsonResponse([]))
      }
      if (
        url.endsWith('/api/groups/g-1/package-exclusions') &&
        method === 'POST'
      ) {
        return Promise.resolve(jsonResponse(dnfRow, 201))
      }
      if (url.endsWith('/api/admin/updater-definitions')) {
        return Promise.resolve(jsonResponse({ definitions: [dnfDef] }))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
    })
    render(<GroupExclusionsTab groupId="g-1" canManage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add exclusion/i }))
    const patternInput = (await screen.findByLabelText(
      /^Pattern$/i,
    )) as HTMLInputElement
    fireEvent.change(patternInput, { target: { value: 'kernel-*' } })
    const addBtns = screen.getAllByRole('button', { name: /^Add$/i })
    fireEvent.click(addBtns[addBtns.length - 1])
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (c) =>
          String(c[0]).endsWith('/api/groups/g-1/package-exclusions') &&
          (c[1] as RequestInit | undefined)?.method === 'POST',
      )
      expect(posts.length).toBe(1)
    })
  })

  it('DELETEs and refreshes on row delete', async () => {
    fetchMock.mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (
        url.endsWith('/api/groups/g-1/package-exclusions') &&
        method === 'GET'
      ) {
        return Promise.resolve(jsonResponse([dnfRow]))
      }
      if (
        url.endsWith('/api/groups/g-1/package-exclusions/ex-1') &&
        method === 'DELETE'
      ) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.endsWith('/api/admin/updater-definitions')) {
        return Promise.resolve(jsonResponse({ definitions: [dnfDef] }))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
    })
    render(<GroupExclusionsTab groupId="g-1" canManage />)
    expect(await screen.findByText('kernel-*')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }))
    const removes = await screen.findAllByRole('button', { name: /^Remove$/i })
    fireEvent.click(removes[removes.length - 1])
    await waitFor(() => {
      const deletes = fetchMock.mock.calls.filter(
        (c) =>
          String(c[0]).endsWith(
            '/api/groups/g-1/package-exclusions/ex-1',
          ) && (c[1] as RequestInit | undefined)?.method === 'DELETE',
      )
      expect(deletes.length).toBe(1)
    })
  })

  it('surfaces a load error when listing fails', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = String(input)
      if (url.endsWith('/api/groups/g-1/package-exclusions')) {
        return Promise.resolve(jsonResponse({ error: 'forbidden' }, 403))
      }
      if (url.endsWith('/api/admin/updater-definitions')) {
        return Promise.resolve(jsonResponse({ definitions: [dnfDef] }))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
    })
    render(<GroupExclusionsTab groupId="g-1" canManage />)
    expect(await screen.findByText(/forbidden/i)).toBeInTheDocument()
  })
})
