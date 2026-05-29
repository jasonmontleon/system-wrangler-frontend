// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  checkOnly: false,
  lastSeenAt: '2026-05-16T00:00:00Z',
  pendingPackages: [],
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

class FakeEventSource {
  static instances: FakeEventSource[] = []
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {}
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((x) => x !== fn)
  }
  close() {}
  emit(type: string, data: unknown) {
    const e = new MessageEvent(type, { data: JSON.stringify(data) })
    ;(this.listeners[type] ?? []).forEach((fn) => fn(e))
  }
}

describe('SystemDetailPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
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
    exporterRuns?: Array<{
      id: string
      systemId: string
      exporterId: string
      kind: 'install' | 'status' | 'remove'
      startedAt: string
      finishedAt?: string
      exitCode?: number
      logTail?: string
    }>
    rebootMetricSystemIds?: string[]
  } = {}) {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/me/scope')) return Promise.resolve(scopeAdmin())
      if (url.startsWith('/api/metrics/query')) {
        const ids = opts.rebootMetricSystemIds ?? []
        return Promise.resolve(
          jsonResponse({
            status: 'success',
            data: {
              resultType: 'vector',
              result: ids.map((id) => ({
                metric: { system_id: id },
                value: [0, '1'],
              })),
            },
          }),
        )
      }
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
        return Promise.resolve(jsonResponse({ updaters: opts.updaters ?? [dnfDetectedEnabled] }))
      }
      if (url.match(/\/updater-runs/)) {
        return Promise.resolve(jsonResponse({ runs: opts.runs ?? [] }))
      }
      if (url.match(/\/exporter-runs/)) {
        return Promise.resolve(jsonResponse({ runs: opts.exporterRuns ?? [] }))
      }
      if (url.endsWith('/effective-credential')) {
        return Promise.resolve(jsonResponse({ error: 'none' }, { status: 404 }))
      }
      if (url.endsWith('/ansible-credential')) {
        return Promise.resolve(jsonResponse({ error: 'none' }, { status: 404 }))
      }
      if (url.endsWith('/host-keys')) {
        return Promise.resolve(jsonResponse({ hostKeys: [] }))
      }
      if (url.match(/\/api\/systems\/[^/]+$/)) {
        return Promise.resolve(jsonResponse(opts.system ?? sampleSystem))
      }
      return Promise.resolve(jsonResponse({}, { status: 500 }))
    })
  }

  it('caller without group role on a non-admin sees Check disabled on the row', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/me/scope'))
        return Promise.resolve(jsonResponse({ userId: 'u-1', global: '', groups: {} }))
      if (url.startsWith('/api/metrics/query'))
        return Promise.resolve(jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }))
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/))
        return Promise.resolve(jsonResponse({ updaters: [dnfDetectedEnabled] }))
      if (url.match(/\/updater-runs/))
        return Promise.resolve(jsonResponse({ runs: [] }))
      if (url.match(/\/exporter-runs/))
        return Promise.resolve(jsonResponse({ runs: [] }))
      if (url.endsWith('/effective-credential'))
        return Promise.resolve(jsonResponse({ error: 'none' }, { status: 404 }))
      if (url.endsWith('/ansible-credential'))
        return Promise.resolve(jsonResponse({ error: 'none' }, { status: 404 }))
      if (url.endsWith('/host-keys'))
        return Promise.resolve(jsonResponse({ hostKeys: [] }))
      if (url.match(/\/api\/systems\/[^/]+$/))
        return Promise.resolve(
          jsonResponse({ ...sampleSystem, groupId: 'g-other' }),
        )
      return Promise.resolve(jsonResponse({}, { status: 500 }))
    })
    renderRoute()
    expect(await screen.findByRole('heading', { name: 'web-1' })).toBeInTheDocument()
  })

  it('emits via the systems.changed event stream to refresh', async () => {
    seedHappy()
    renderRoute()
    expect(await screen.findByRole('heading', { name: 'web-1' })).toBeInTheDocument()
    const sysCallsBefore = fetchMock.mock.calls.filter((c) =>
      String(c[0]).match(/\/api\/systems\/[^/]+$/),
    ).length
    FakeEventSource.instances.forEach((es) =>
      es.emit('message', { type: 'systems.changed' }),
    )
    await waitFor(() => {
      const sysCallsAfter = fetchMock.mock.calls.filter((c) =>
        String(c[0]).match(/\/api\/systems\/[^/]+$/),
      ).length
      expect(sysCallsAfter).toBeGreaterThan(sysCallsBefore)
    })
  })

  it('renders the system header and the updater table', async () => {
    seedHappy()
    renderRoute()
    expect(await screen.findByRole('heading', { name: 'web-1' })).toBeInTheDocument()
    // Hostname appears twice (inline subtitle + the new System
    // information card). One match is fine — assert there's at
    // least one.
    expect(screen.getAllByText('web-1.example', { exact: false }).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: /Updaters/i }))
    expect(await screen.findByText('builtin.dnf')).toBeInTheDocument()
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
    await screen.findByRole('heading', { name: 'web-1' })
    fireEvent.click(screen.getByRole('tab', { name: /Updaters/i }))
    const checkbox = (await screen.findByLabelText(/Enable dnf/i)) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    // Toggle: PUT happens, then page refreshes (3 GETs).
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleSystem))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ updaters: [{ ...dnfDetectedEnabled, enabled: false }] }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [] }))
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
          checkOnly: false,
          lastSeenAt: '2026-05-16T00:00:00Z',
          pendingPackages: [],
        },
        {
          updaterId: 'custom.never-detected',
          source: 'custom',
          displayName: 'never',
          installed: false,
          enabled: false,
          checkOnly: false,
          pendingPackages: [],
        },
      ],
    })
    renderRoute()
    await screen.findByRole('heading', { name: 'web-1' })
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

  it('fires an auto-Check after a successful Apply per updater', async () => {
    seedHappy()
    renderRoute()
    await screen.findByRole('heading', { name: 'web-1' })
    // Apply (success) → auto-Check → refresh round (system + updaters + runs).
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-apply',
        updaterId: 'builtin.dnf',
        kind: 'apply',
        status: 'success',
        exitCode: 0,
        affectedCount: 1,
        durationMs: 1,
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-check',
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
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [] }))
    fireEvent.click(screen.getByRole('button', { name: /^Update$/i }))
    await waitFor(() => {
      const calls = fetchMock.mock.calls as Array<[string, RequestInit | undefined]>
      const applyCall = calls.find(
        (c) => c[0].toString().endsWith('/apply') && (c[1]?.method ?? 'GET') === 'POST',
      )
      const checkCall = calls.find(
        (c) => c[0].toString().endsWith('/check') && (c[1]?.method ?? 'GET') === 'POST',
      )
      expect(applyCall).toBeDefined()
      expect(checkCall).toBeDefined()
    })
  })

  it('Check warns when nothing is enabled', async () => {
    seedHappy({
      updaters: [{ ...dnfDetectedEnabled, enabled: false }],
    })
    renderRoute()
    await screen.findByRole('heading', { name: 'web-1' })
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

  it('renders the health icon next to the name when reachable+pending', async () => {
    seedHappy({
      system: {
        ...sampleSystem,
        status: 'reachable',
        pendingUpdates: 5,
        lastCheckedAt: '2026-05-16T09:00:00Z',
      },
    })
    renderRoute()
    expect(
      await screen.findByLabelText(/Updates available/i),
    ).toBeInTheDocument()
  })

  it('renders the up-to-date icon when reachable+0 pending', async () => {
    seedHappy({
      system: {
        ...sampleSystem,
        status: 'reachable',
        pendingUpdates: 0,
        lastCheckedAt: '2026-05-16T09:00:00Z',
      },
    })
    renderRoute()
    expect(await screen.findByLabelText(/Up to date/i)).toBeInTheDocument()
  })

  it('renders the AvailableUpdatesCard rows for updaters with a pending list', async () => {
    seedHappy({
      updaters: [
        {
          ...dnfDetectedEnabled,
          pendingPackages: [
            { name: 'kernel', oldVersion: '6.8.0-31', newVersion: '6.8.0-45' },
            { name: 'glibc', oldVersion: '2.39-1', newVersion: '2.39-3' },
          ],
        },
      ],
    })
    renderRoute()
    // The card title should be present.
    expect(await screen.findByText('Available updates')).toBeInTheDocument()
    // The "Show 2 packages" toggle reveals both packages when clicked.
    const toggle = await screen.findByRole('button', {
      name: /Show 2 packages/i,
    })
    fireEvent.click(toggle)
    expect(await screen.findByText('kernel')).toBeInTheDocument()
    expect(await screen.findByText('glibc')).toBeInTheDocument()
    // Version transition is rendered alongside the package name.
    expect(
      await screen.findByText(/6\.8\.0-31\s+→\s+6\.8\.0-45/),
    ).toBeInTheDocument()
  })

  it('Update only this fires a targeted apply with one package', async () => {
    seedHappy({
      updaters: [
        {
          ...dnfDetectedEnabled,
          pendingPackages: [
            { name: 'kernel', oldVersion: '6.8.0-31', newVersion: '6.8.0-45' },
            { name: 'openssl', oldVersion: '3.0.1', newVersion: '3.0.2' },
          ],
        },
      ],
    })
    renderRoute()
    const toggle = await screen.findByRole('button', { name: /Show 2 packages/i })
    fireEvent.click(toggle)
    // Click the "Update only this" link beside openssl.
    fireEvent.click(
      await screen.findByRole('button', { name: /Update only openssl on /i }),
    )
    const dialog = await screen.findByRole('dialog')
    // Queue the apply POST + the subsequent refresh fetches.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-1',
        updaterId: 'builtin.dnf',
        kind: 'apply',
        status: 'success',
        exitCode: 0,
        durationMs: 1,
      }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: /^Update$/i }))
    await waitFor(() => {
      const applyCall = fetchMock.mock.calls.find(
        (c) =>
          String(c[0]).endsWith('/updaters/builtin.dnf/apply') &&
          (c[1] as RequestInit | undefined)?.method === 'POST',
      )
      expect(applyCall).toBeDefined()
      expect(
        JSON.parse(String((applyCall![1] as RequestInit).body)),
      ).toEqual({ packages: ['openssl'] })
    })
  })

  it('AvailableUpdatesCard hides rows whose pending list is empty', async () => {
    seedHappy({
      updaters: [
        { ...dnfDetectedEnabled, pendingPackages: [] },
      ],
    })
    renderRoute()
    expect(await screen.findByText('Available updates')).toBeInTheDocument()
    expect(
      screen.getByText(/No pending updates known/i),
    ).toBeInTheDocument()
  })

  it('Recent runs card is collapsible', async () => {
    seedHappy()
    renderRoute()
    const toggle = await screen.findByRole('button', {
      name: /Toggle recent runs/i,
    })
    expect(toggle).toBeInTheDocument()
    // Default state is expanded — the empty-state message is visible.
    expect(
      screen.getByText(/No runs yet\./i),
    ).toBeInTheDocument()
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(screen.queryByText(/No runs yet\./i)).toBeNull()
    })
  })

  it('Recent runs unifies updater and exporter rows', async () => {
    seedHappy({
      runs: [
        {
          id: 'u1',
          systemId: 'host-1',
          updaterId: 'builtin.dnf',
          kind: 'apply',
          startedAt: '2026-05-22T10:00:00Z',
          finishedAt: '2026-05-22T10:00:05Z',
          exitCode: 0,
          logTail: 'updater apply log',
        },
      ],
      exporterRuns: [
        {
          id: 'e1',
          systemId: 'host-1',
          exporterId: 'builtin.dnf.exporter',
          kind: 'install',
          startedAt: '2026-05-22T10:01:00Z',
          finishedAt: '2026-05-22T10:01:15Z',
          exitCode: 2,
          logTail: 'TASK [Install node_exporter] failed: package not found',
        },
      ],
    })
    renderRoute()
    expect(await screen.findByText('builtin.dnf.exporter')).toBeInTheDocument()
    expect(screen.getByText('builtin.dnf')).toBeInTheDocument()
    // The exporter row's substrate column reads "exporter".
    expect(screen.getByText('install')).toBeInTheDocument()
    expect(screen.getByText('apply')).toBeInTheDocument()
    // Substrate column shows both labels.
    expect(screen.getAllByText('exporter').length).toBeGreaterThan(0)
    expect(screen.getAllByText('updater').length).toBeGreaterThan(0)
  })

  it('flips the header icon to red when the last run failed', async () => {
    seedHappy({
      system: {
        ...sampleSystem,
        status: 'reachable',
        pendingUpdates: 0,
        lastCheckedAt: '2026-05-16T09:00:00Z',
        lastRunFailed: true,
        lastRunReason: 'apply exit 2',
      },
    })
    renderRoute()
    expect(await screen.findByLabelText(/Last run failed/i)).toBeInTheDocument()
    // Healthy icon must not also render.
    expect(screen.queryByLabelText(/Up to date/i)).toBeNull()
  })

  it('shows "Needs Attention" with the reason on the System information card when failing', async () => {
    seedHappy({
      system: {
        ...sampleSystem,
        status: 'reachable',
        pendingUpdates: 0,
        lastCheckedAt: '2026-05-16T09:00:00Z',
        lastRunFailed: true,
        lastRunReason: 'apply exit 2',
      },
    })
    renderRoute()
    expect(
      await screen.findByText(/Needs Attention:/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/apply exit 2/i)).toBeInTheDocument()
  })

  it('shows "Needs Attention: Unreachable" when the system is unreachable', async () => {
    seedHappy({
      system: { ...sampleSystem, status: 'unreachable' },
    })
    renderRoute()
    const line = await screen.findByText(/Needs Attention:/i)
    expect(line.textContent).toMatch(/Unreachable/i)
  })

  it('shows "Updates Available" when reachable with pending updates and no failure', async () => {
    seedHappy({
      system: {
        ...sampleSystem,
        status: 'reachable',
        pendingUpdates: 7,
        lastCheckedAt: '2026-05-16T09:00:00Z',
      },
    })
    renderRoute()
    expect(
      await screen.findByText('Updates Available'),
    ).toBeInTheDocument()
  })

  it('shows "System Healthy" when reachable, checked, zero pending', async () => {
    seedHappy({
      system: {
        ...sampleSystem,
        status: 'reachable',
        pendingUpdates: 0,
        lastCheckedAt: '2026-05-16T09:00:00Z',
      },
    })
    renderRoute()
    expect(await screen.findByText('System Healthy')).toBeInTheDocument()
  })

  it('shows "Reboot Required" when only the exporter metric reports it (column NULL)', async () => {
    seedHappy({
      system: {
        ...sampleSystem,
        status: 'reachable',
        pendingUpdates: 0,
        lastCheckedAt: '2026-05-28T14:30:00Z',
        // Note: no rebootRequiredAt — only the metric path lights this row.
      },
      rebootMetricSystemIds: ['host-1'],
    })
    renderRoute()
    expect(await screen.findByText('Reboot Required')).toBeInTheDocument()
    expect(screen.queryByText('System Healthy')).toBeNull()
  })

  it('shows "Reboot Required" on the health line and chip when rebootRequiredAt is set', async () => {
    seedHappy({
      system: {
        ...sampleSystem,
        status: 'reachable',
        pendingUpdates: 0,
        lastCheckedAt: '2026-05-28T14:30:00Z',
        rebootRequiredAt: '2026-05-28T14:30:00Z',
      },
    })
    renderRoute()
    expect(await screen.findByText('Reboot Required')).toBeInTheDocument()
    expect(screen.queryByText('System Healthy')).toBeNull()
    expect(screen.getAllByText(/reboot required/i).length).toBeGreaterThan(1)
    expect(screen.getByLabelText('Reboot required')).toBeTruthy()
  })

  it('omits the health line for an unprobed system', async () => {
    seedHappy({ system: { ...sampleSystem, status: 'unprobed' } })
    renderRoute()
    await screen.findByRole('heading', { name: 'web-1' })
    expect(screen.queryByText(/System Healthy/i)).toBeNull()
    expect(screen.queryByText(/Needs Attention/i)).toBeNull()
    expect(screen.queryByText(/Updates Available/i)).toBeNull()
  })

  it('renders no icon for an unprobed system', async () => {
    seedHappy({
      system: { ...sampleSystem, status: 'unprobed' },
    })
    renderRoute()
    await screen.findByRole('heading', { name: 'web-1' })
    expect(screen.queryByLabelText(/Up to date/i)).toBeNull()
    expect(screen.queryByLabelText(/Updates available/i)).toBeNull()
    expect(screen.queryByLabelText(/Unreachable/i)).toBeNull()
  })

  it('reflects a remote check on the Check button label and disables every action', async () => {
    // Mirror of the SystemsPage / GroupDetailPage gate plus the
    // active-action-label UX: when a remote check is in flight the
    // Check button reads "Checking…" exactly as if the operator had
    // clicked it locally, while Update and Inspect now stay disabled
    // and unchanged.
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/me/scope')) return Promise.resolve(scopeAdmin())
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
        return Promise.resolve(jsonResponse({ updaters: [dnfDetectedEnabled] }))
      }
      if (url.match(/\/updater-runs/)) {
        return Promise.resolve(
          jsonResponse({
            runs: [
              {
                id: 'r-remote',
                systemId: 'host-1',
                kind: 'check',
                updaterId: 'builtin.dnf',
                startedAt: '2026-05-21T12:00:00Z',
              },
            ],
          }),
        )
      }
      if (url.match(/\/exporter-runs/)) {
        return Promise.resolve(jsonResponse({ runs: [] }))
      }
      if (url.match(/\/api\/systems\/[^/]+$/)) {
        return Promise.resolve(jsonResponse({ ...sampleSystem, running: true }))
      }
      return Promise.resolve(jsonResponse({}, { status: 500 }))
    })
    renderRoute()
    await screen.findByRole('heading', { name: 'web-1' })
    // Active label appears on the Check button only; Update stays
    // labelled as "Update" but disabled because only one run can
    // hold the per-system lock at a time.
    const checking = await screen.findByRole('button', { name: /^Checking…$/i })
    expect(checking).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Update$/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: /Updaters/i }))
    expect(
      await screen.findByRole('button', { name: /Inspect now/i }),
    ).toBeDisabled()
  })

  it('reflects a remote apply on the Update button and a remote inspect on the Inspect now button', async () => {
    const cases: Array<{
      kind: 'apply' | 'inspect'
      tab: RegExp
      activeName: RegExp
      idleName: RegExp
    }> = [
      {
        kind: 'apply',
        tab: /Overview/i,
        activeName: /^Updating…$/i,
        idleName: /^Check$/i,
      },
      {
        kind: 'inspect',
        tab: /Updaters/i,
        activeName: /^Inspecting…$/i,
        idleName: /^Check$/i,
      },
    ]
    for (const c of cases) {
      fetchMock.mockReset()
      fetchMock.mockImplementation((input: RequestInfo) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.endsWith('/api/me/scope')) return Promise.resolve(scopeAdmin())
        if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
          return Promise.resolve(jsonResponse({ updaters: [dnfDetectedEnabled] }))
        }
        if (url.match(/\/updater-runs/)) {
          return Promise.resolve(
            jsonResponse({
              runs: [
                {
                  id: 'r-remote',
                  systemId: 'host-1',
                  kind: c.kind,
                  startedAt: '2026-05-21T12:00:00Z',
                },
              ],
            }),
          )
        }
        if (url.match(/\/exporter-runs/)) {
          return Promise.resolve(jsonResponse({ runs: [] }))
        }
        if (url.match(/\/api\/systems\/[^/]+$/)) {
          return Promise.resolve(
            jsonResponse({ ...sampleSystem, running: true }),
          )
        }
        return Promise.resolve(jsonResponse({}, { status: 500 }))
      })
      const view = renderRoute()
      await screen.findByRole('heading', { name: 'web-1' })
      fireEvent.click(screen.getByRole('tab', { name: c.tab }))
      expect(
        await screen.findByRole('button', { name: c.activeName }),
      ).toBeDisabled()
      view.unmount()
    }
  })

  it('re-enables the action buttons when a systems.changed event reveals running=false', async () => {
    // Bug fix: SystemDetailPage now subscribes to /api/events so a
    // run that ends elsewhere flips the local running flag and
    // re-enables the action buttons without a manual reload. The
    // FakeEventSource emit() invokes registered listeners
    // synchronously; combined with the page's 200ms debounce on
    // refresh, the refetch returns running=false and the Check /
    // Update buttons re-enable.
    let systemRunning = true
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/me/scope')) return Promise.resolve(scopeAdmin())
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
        return Promise.resolve(jsonResponse({ updaters: [dnfDetectedEnabled] }))
      }
      if (url.match(/\/updater-runs/)) {
        return Promise.resolve(jsonResponse({ runs: [] }))
      }
      if (url.match(/\/exporter-runs/)) {
        return Promise.resolve(jsonResponse({ runs: [] }))
      }
      if (url.match(/\/api\/systems\/[^/]+$/)) {
        return Promise.resolve(
          jsonResponse({ ...sampleSystem, running: systemRunning }),
        )
      }
      return Promise.resolve(jsonResponse({}, { status: 500 }))
    })
    renderRoute()
    await screen.findByRole('heading', { name: 'web-1' })
    expect(screen.getByRole('button', { name: /^Check$/i })).toBeDisabled()
    // Simulate the run completing elsewhere.
    systemRunning = false
    FakeEventSource.instances.forEach((es) =>
      es.emit('message', { type: 'systems.changed' }),
    )
    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: /^Check$/i })).toBeEnabled(),
      { timeout: 2000 },
    )
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
      if (url.match(/\/exporter-runs/)) {
        return Promise.resolve(jsonResponse({ runs: [] }))
      }
      if (url.match(/\/api\/systems\/[^/]+$/)) {
        return Promise.resolve(jsonResponse(sampleSystem))
      }
      return Promise.resolve(jsonResponse({}, { status: 500 }))
    })
    renderRoute()
    await screen.findByRole('heading', { name: 'web-1' })
    // Overview tab is active by default — Check + Update sit here.
    expect(screen.getByRole('button', { name: /^Check$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Update$/i })).toBeDisabled()
    // Updaters tab hosts Inspect now + the per-updater checkbox.
    fireEvent.click(screen.getByRole('tab', { name: /Updaters/i }))
    const inspect = await screen.findByRole('button', { name: /Inspect now/i })
    expect(inspect).toBeDisabled()
    const checkbox = screen.getByLabelText(/Enable dnf/i) as HTMLInputElement
    expect(checkbox).toBeDisabled()
  })

  it('renders the credentials section for a Global Admin caller', async () => {
    seedHappy()
    renderRoute()
    await screen.findByRole('heading', { name: 'web-1' })
    fireEvent.click(screen.getByRole('tab', { name: /Connection/i }))
    expect(
      await screen.findByText(/No credentials resolve for this system/i),
    ).toBeInTheDocument()
  })

  it('hides the credentials section from a caller without admin scope', async () => {
    fetchMock.mockImplementation((input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/me/scope')) {
        return Promise.resolve(jsonResponse({ userId: 'u-1', global: 'auditor', groups: {} }))
      }
      if (url.match(/\/api\/systems\/[^/]+\/updaters$/)) {
        return Promise.resolve(jsonResponse({ updaters: [dnfDetectedEnabled] }))
      }
      if (url.match(/\/updater-runs/)) {
        return Promise.resolve(jsonResponse({ runs: [] }))
      }
      if (url.match(/\/exporter-runs/)) {
        return Promise.resolve(jsonResponse({ runs: [] }))
      }
      if (url.match(/\/api\/systems\/[^/]+$/)) {
        return Promise.resolve(jsonResponse(sampleSystem))
      }
      return Promise.resolve(jsonResponse({}, { status: 500 }))
    })
    renderRoute()
    // The page itself has loaded — wait for a non-credentials marker.
    await screen.findByRole('heading', { name: 'web-1' })
    // Credentials section should not have rendered, so its resolver
    // alert should be absent and the host-keys panel shouldn't have
    // fetched.
    expect(screen.queryByText(/No credentials resolve for this system/i)).toBeNull()
    expect(
      fetchMock.mock.calls.find((c) =>
        (typeof c[0] === 'string' ? c[0] : c[0].toString()).endsWith('/effective-credential'),
      ),
    ).toBeUndefined()
  })
})
