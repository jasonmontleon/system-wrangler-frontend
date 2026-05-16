// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SystemDetailPage from './SystemDetailPage'
import type { System } from '../api/systems'
import type { SystemUpdater } from '../api/updaters'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const sampleSystem: System = {
  id: 'host-1',
  name: 'web-1',
  hostname: 'web-1.example',
  createdAt: '2026-05-16T00:00:00Z',
  status: 'reachable',
  groupId: null,
}

const dnfDetectedEnabled: SystemUpdater = {
  updaterId: 'builtin.dnf',
  source: 'builtin',
  displayName: 'dnf',
  installed: true,
  enabled: true,
  lastSeenAt: '2026-05-16T00:00:00Z',
}

function renderRoute(path = '/systems/host-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/systems/:systemId" element={<SystemDetailPage />} />
        <Route path="/systems" element={<div>Systems list</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// scopeFor returns a mock /api/me/scope payload for a Global Admin
// caller. The page only calls roleOnGroup/isGlobalOperator/etc., so
// granting global=admin keeps the operate buttons enabled in tests
// that don't care about RBAC.
function scopeAdmin() {
  return jsonResponse({ userId: 'u-1', global: 'admin', groups: {} })
}

describe('SystemDetailPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function seedHappy(opts: {
    system?: typeof sampleSystem
    updaters?: SystemUpdater[]
    runs?: Array<{
      id: string
      systemId: string
      kind: 'inspect' | 'check' | 'apply'
      updaterId?: string
      startedAt: string
      finishedAt?: string
      exitCode?: number
      logTail?: string
    }>
  } = {}) {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/me/scope')) return Promise.resolve(scopeAdmin())
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
        return Promise.resolve(jsonResponse({ updaters: opts.updaters ?? [dnfDetectedEnabled] }))
      }
      if (url.match(/\/updater-runs/)) {
        return Promise.resolve(jsonResponse({ runs: opts.runs ?? [] }))
      }
      if (url.match(/\/api\/systems\/[^/]+$/)) {
        return Promise.resolve(jsonResponse(opts.system ?? sampleSystem))
      }
      return Promise.resolve(jsonResponse({}, { status: 500 }))
    })
  }

  it('renders the system header and the updater table', async () => {
    seedHappy()
    renderRoute()
    expect(await screen.findByRole('heading', { name: 'web-1' })).toBeInTheDocument()
    // Hostname appears twice (inline subtitle + the new System
    // information card). One match is fine — assert there's at
    // least one.
    expect(screen.getAllByText('web-1.example', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getByText('builtin.dnf')).toBeInTheDocument()
  })

  it('renders the System information card with last seen and added', async () => {
    seedHappy({
      system: {
        ...sampleSystem,
        lastSeen: '2026-05-16T01:23:45Z',
      },
    })
    renderRoute()
    expect(
      await screen.findByText(/System information/i),
    ).toBeInTheDocument()
    // Terms should appear at least once in the description list.
    // PatternFly may double-render for a11y, so getAllByText.
    expect(screen.getAllByText(/^Last seen$/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^Added$/i).length).toBeGreaterThan(0)
  })

  it('fires PUT enabled when the checkbox is toggled', async () => {
    seedHappy()
    renderRoute()
    const checkbox = (await screen.findByLabelText(/Enable dnf/i)) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    // Toggle: PUT happens, then page refreshes (3 GETs).
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleSystem))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ updaters: [{ ...dnfDetectedEnabled, enabled: false }] }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [] }))
    fireEvent.click(checkbox)
    await waitFor(() => {
      const after = screen.getByLabelText(/Enable dnf/i) as HTMLInputElement
      expect(after.checked).toBe(false)
    })
    // Verify the PUT body.
    const put = fetchMock.mock.calls.find(
      (c) => (c[1]?.method ?? 'GET') === 'PUT',
    )
    expect(put?.[0]).toBe('/api/systems/host-1/updaters/builtin.dnf/enabled')
    expect(JSON.parse(put?.[1].body as string)).toEqual({ enabled: false })
  })

  it('fan-out Check fires one POST per enabled detected updater', async () => {
    seedHappy({
      updaters: [
        dnfDetectedEnabled,
        {
          updaterId: 'custom.apt-mirror',
          source: 'custom',
          displayName: 'apt-mirror',
          installed: true,
          enabled: false, // disabled — should NOT fire
          lastSeenAt: '2026-05-16T00:00:00Z',
        },
        {
          updaterId: 'custom.never-detected',
          source: 'custom',
          displayName: 'never',
          installed: false,
          enabled: false,
        },
      ],
    })
    renderRoute()
    await screen.findByText('builtin.dnf')
    // Queue the single check + refresh round.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-1',
        updaterId: 'builtin.dnf',
        kind: 'check',
        status: 'success',
        exitCode: 0,
        affectedCount: 0,
        durationMs: 1,
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleSystem))
    fetchMock.mockResolvedValueOnce(jsonResponse({ updaters: [dnfDetectedEnabled] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [] }))
    fireEvent.click(screen.getByRole('button', { name: /^Check$/i }))
    await waitFor(() => {
      const checkCalls = fetchMock.mock.calls.filter((c) => {
        const url = c[0] as string
        return url.endsWith('/check') && (c[1]?.method ?? 'GET') === 'POST'
      })
      expect(checkCalls).toHaveLength(1)
      expect(checkCalls[0][0]).toBe('/api/systems/host-1/updaters/builtin.dnf/check')
    })
  })

  it('Check warns when nothing is enabled', async () => {
    seedHappy({
      updaters: [{ ...dnfDetectedEnabled, enabled: false }],
    })
    renderRoute()
    await screen.findByText('builtin.dnf')
    fireEvent.click(screen.getByRole('button', { name: /^Check$/i }))
    expect(
      await screen.findByText(/No enabled updaters on this system/i),
    ).toBeInTheDocument()
  })

  it('shows the runs table when runs are present', async () => {
    seedHappy({
      runs: [
        {
          id: 'r-1',
          systemId: 'host-1',
          kind: 'apply',
          updaterId: 'builtin.dnf',
          startedAt: '2026-05-16T00:00:00Z',
          finishedAt: '2026-05-16T00:01:00Z',
          exitCode: 0,
          logTail: 'updated 3 packages',
        },
      ],
    })
    renderRoute()
    expect(await screen.findByText('apply')).toBeInTheDocument()
  })

  it('renders an error when the system lookup fails', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/me/scope')) return Promise.resolve(scopeAdmin())
      if (url.match(/\/api\/systems\/[^/]+$/)) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      // updater calls should also fail-soft so Promise.all rejects.
      return Promise.resolve(jsonResponse({}, { status: 404 }))
    })
    renderRoute()
    expect(
      await screen.findByText(/Failed to load system/i),
    ).toBeInTheDocument()
  })

  it('disables the action buttons when the caller cannot operate', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      // Auditor — read-only.
      if (url.endsWith('/api/me/scope')) {
        return Promise.resolve(jsonResponse({ userId: 'u-1', global: 'auditor', groups: {} }))
      }
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
        return Promise.resolve(jsonResponse({ updaters: [dnfDetectedEnabled] }))
      }
      if (url.match(/\/updater-runs/)) {
        return Promise.resolve(jsonResponse({ runs: [] }))
      }
      if (url.match(/\/api\/systems\/[^/]+$/)) {
        return Promise.resolve(jsonResponse(sampleSystem))
      }
      return Promise.resolve(jsonResponse({}, { status: 500 }))
    })
    renderRoute()
    const inspect = await screen.findByRole('button', { name: /Inspect now/i })
    expect(inspect).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Check$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Update$/i })).toBeDisabled()
    // Checkbox should also be disabled for the auditor.
    const checkbox = screen.getByLabelText(/Enable dnf/i) as HTMLInputElement
    expect(checkbox).toBeDisabled()
  })
})
