// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExclusionsPage from './ExclusionsPage'

// The page calls listGlobalExclusions + listUpdaterDefinitions in
// parallel on mount. The fetch mock services both, in order.
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('ExclusionsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/admin/package-exclusions') {
        return jsonResponse([
          {
            id: 'e1',
            scope: 'global',
            updater: 'builtin.dnf',
            pattern: 'kernel*',
            reason: 'fleet pin',
            createdAt: '2026-05-25T00:00:00Z',
            createdBy: 'u',
          },
        ])
      }
      if (url === '/api/admin/updater-definitions') {
        return jsonResponse({
          definitions: [
            {
              id: 'builtin.dnf',
              source: 'builtin',
              displayName: 'dnf',
              description: '',
              detectBinary: 'dnf',
              checkPlaybook: '',
              applyPlaybook: '',
              checkOnly: false,
            },
          ],
        })
      }
      return new Response(JSON.stringify({ error: 'unrouted ' + url }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists the global rows fetched on mount', async () => {
    render(<ExclusionsPage />)
    await waitFor(() =>
      expect(screen.getByText('kernel*')).toBeInTheDocument(),
    )
    expect(screen.getByText(/fleet pin/i)).toBeInTheDocument()
  })

  it('refreshes after a successful create', async () => {
    render(<ExclusionsPage />)
    await waitFor(() =>
      expect(screen.getByText('kernel*')).toBeInTheDocument(),
    )
    // Second-round-trip response — the just-created row + the old one.
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse(
        {
          id: 'e2',
          scope: 'global',
          updater: 'builtin.dnf',
          pattern: 'nginx',
          createdAt: '2026-05-25T00:00:00Z',
          createdBy: 'u',
        },
        { status: 201 },
      ),
    )
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse([
        {
          id: 'e1',
          scope: 'global',
          updater: 'builtin.dnf',
          pattern: 'kernel*',
          reason: 'fleet pin',
          createdAt: '2026-05-25T00:00:00Z',
          createdBy: 'u',
        },
        {
          id: 'e2',
          scope: 'global',
          updater: 'builtin.dnf',
          pattern: 'nginx',
          createdAt: '2026-05-25T00:00:00Z',
          createdBy: 'u',
        },
      ]),
    )
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({
        definitions: [
          {
            id: 'builtin.dnf',
            source: 'builtin',
            displayName: 'dnf',
            description: '',
            detectBinary: 'dnf',
            checkPlaybook: '',
            applyPlaybook: '',
            checkOnly: false,
          },
        ],
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /add exclusion/i }))
    fireEvent.change(screen.getByLabelText('Pattern'), {
      target: { value: 'nginx' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(screen.getByText('nginx')).toBeInTheDocument(),
    )
  })

  it('renders a load error when the list endpoint fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/admin/package-exclusions') {
        return jsonResponse({ error: 'boom' }, { status: 500 })
      }
      return jsonResponse({ definitions: [] })
    })
    render(<ExclusionsPage />)
    await waitFor(() =>
      expect(screen.getByText(/failed to load exclusions/i)).toBeInTheDocument(),
    )
  })
})
