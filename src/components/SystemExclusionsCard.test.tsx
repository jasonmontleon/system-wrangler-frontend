// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SystemExclusionsCard from './SystemExclusionsCard'

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
  id: 'e1',
  scope: 'system',
  targetId: 's1',
  updater: 'dnf',
  pattern: 'kernel-*',
  reason: '',
  createdAt: '2026-05-15T00:00:00Z',
  createdBy: 'admin',
}

describe('SystemExclusionsCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the system exclusion list and updater catalog', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = String(input)
      if (url.endsWith('/api/systems/s1/package-exclusions')) {
        return Promise.resolve(jsonResponse([dnfRow]))
      }
      if (url.endsWith('/api/admin/updater-definitions')) {
        return Promise.resolve(jsonResponse({ definitions: [dnfDef] }))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
    })
    render(<SystemExclusionsCard systemId="s1" canManage />)
    expect(await screen.findByText('kernel-*')).toBeInTheDocument()
  })

  it('surfaces a load error if the API rejects', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = String(input)
      if (url.endsWith('/api/systems/s1/package-exclusions')) {
        return Promise.resolve(jsonResponse({ error: 'forbidden' }, 403))
      }
      if (url.endsWith('/api/admin/updater-definitions')) {
        return Promise.resolve(jsonResponse({ definitions: [dnfDef] }))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
    })
    render(<SystemExclusionsCard systemId="s1" canManage />)
    expect(await screen.findByText(/forbidden/i)).toBeInTheDocument()
  })

  it('POSTs and refreshes on create', async () => {
    fetchMock.mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (
        url.endsWith('/api/systems/s1/package-exclusions') &&
        method === 'GET'
      ) {
        return Promise.resolve(jsonResponse([]))
      }
      if (
        url.endsWith('/api/systems/s1/package-exclusions') &&
        method === 'POST'
      ) {
        return Promise.resolve(jsonResponse(dnfRow, 201))
      }
      if (url.endsWith('/api/admin/updater-definitions')) {
        return Promise.resolve(jsonResponse({ definitions: [dnfDef] }))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
    })
    render(<SystemExclusionsCard systemId="s1" canManage />)
    // Open the inline create form via the Add button on the card.
    fireEvent.click(await screen.findByRole('button', { name: /Add exclusion/i }))
    const patternInput = (await screen.findByLabelText(
      /^Pattern$/i,
    )) as HTMLInputElement
    fireEvent.change(patternInput, { target: { value: 'kernel-*' } })
    // The submit button inside the modal is labelled "Add" (the
    // primary action), distinguished from "Add exclusion" on the
    // card body by being the second match.
    const addBtns = screen.getAllByRole('button', { name: /^Add$/i })
    fireEvent.click(addBtns[addBtns.length - 1])
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (c) =>
          String(c[0]).endsWith('/api/systems/s1/package-exclusions') &&
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
        url.endsWith('/api/systems/s1/package-exclusions') &&
        method === 'GET'
      ) {
        return Promise.resolve(jsonResponse([dnfRow]))
      }
      if (
        url.endsWith('/api/systems/s1/package-exclusions/e1') &&
        method === 'DELETE'
      ) {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.endsWith('/api/admin/updater-definitions')) {
        return Promise.resolve(jsonResponse({ definitions: [dnfDef] }))
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected' }, 500))
    })
    render(<SystemExclusionsCard systemId="s1" canManage />)
    expect(await screen.findByText('kernel-*')).toBeInTheDocument()
    // Row "Remove" opens a confirm modal whose primary action is also
    // "Remove" — click the row link first, then the modal danger
    // button.
    fireEvent.click(screen.getByRole('button', { name: /^Remove$/i }))
    const removes = await screen.findAllByRole('button', { name: /^Remove$/i })
    fireEvent.click(removes[removes.length - 1])
    await waitFor(() => {
      const deletes = fetchMock.mock.calls.filter(
        (c) =>
          String(c[0]).endsWith('/api/systems/s1/package-exclusions/e1') &&
          (c[1] as RequestInit | undefined)?.method === 'DELETE',
      )
      expect(deletes.length).toBe(1)
    })
  })
})
