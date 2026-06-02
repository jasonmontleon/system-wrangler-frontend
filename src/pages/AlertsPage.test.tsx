// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AlertsPage from './AlertsPage'
import type { ActiveAlert, AlertRule } from '../api/alerts'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const catalog = [{ metric: 'mem_used_pct', label: 'Memory Used', unit: '%' }]

const rule: AlertRule = {
  id: 'rule-1',
  name: 'High memory',
  conditionKind: 'metric',
  metric: 'mem_used_pct',
  comparator: 'gt',
  threshold: 90,
  forSeconds: 300,
  severity: 'critical',
  targetKind: 'global',
  targetValue: '',
  enabled: true,
  createdBy: 'u',
  createdAt: '2026-06-02T00:00:00Z',
  updatedAt: '2026-06-02T00:00:00Z',
}

const activeAlert: ActiveAlert = {
  ruleId: 'rule-1',
  systemId: 'sys-1',
  state: 'firing',
  value: 95.4,
  firstBreachAt: '2026-06-02T12:00:00Z',
  firedAt: '2026-06-02T12:05:00Z',
  lastEvalAt: '2026-06-02T12:06:00Z',
  ruleName: 'High memory',
  severity: 'critical',
  conditionKind: 'metric',
  metric: 'mem_used_pct',
  comparator: 'gt',
  threshold: 90,
  systemName: 'web-1',
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {}
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    ;(this.listeners[type] ??= []).push(cb)
  }
  removeEventListener() {}
  close() {}
  emit(type: string, data: unknown) {
    const e = { data: JSON.stringify(data) } as MessageEvent
    for (const cb of this.listeners[type] ?? []) cb(e)
  }
}

type FetchHandler = (input: RequestInfo, init?: RequestInit) => Promise<Response>

function installFetch(handler: FetchHandler) {
  const m = vi.fn(handler)
  vi.stubGlobal('fetch', m)
  return m
}

function baseHandler(
  opts: { rules?: AlertRule[]; active?: ActiveAlert[] } = {},
  extra?: (url: string, init?: RequestInit) => Response | null,
) {
  return async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url === '/api/alerts') return jsonResponse(opts.rules ?? [rule])
    if (url === '/api/alerts/active') return jsonResponse(opts.active ?? [activeAlert])
    if (url === '/api/alerts/catalog') return jsonResponse(catalog)
    if (url === '/api/groups') return jsonResponse([])
    if (url === '/api/systems') return jsonResponse([])
    const e = extra?.(url, init)
    if (e) return e
    return jsonResponse({ error: 'unexpected ' + url }, { status: 500 })
  }
}

describe('AlertsPage', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists rules and active alerts', async () => {
    installFetch(baseHandler())
    render(<AlertsPage />)
    // "High memory" shows in both the rules table and the active row.
    expect((await screen.findAllByText('High memory')).length).toBeGreaterThanOrEqual(2)
    // Active-alert row: system display name + firing state.
    expect(screen.getByText('web-1')).toBeInTheDocument()
    expect(screen.getByText('Firing')).toBeInTheDocument()
    // Condition cell renders the curated label + threshold + unit.
    expect(screen.getByText(/Memory Used > 90%/)).toBeInTheDocument()
  })

  it('shows the no-active-alerts success banner when none are active', async () => {
    installFetch(baseHandler({ active: [] }))
    render(<AlertsPage />)
    expect(await screen.findByText('No active alerts')).toBeInTheDocument()
  })

  it('shows the empty-rules info alert', async () => {
    installFetch(baseHandler({ rules: [], active: [] }))
    render(<AlertsPage />)
    expect(await screen.findByText('No alert rules yet')).toBeInTheDocument()
  })

  it('opens the create modal from Add alert rule', async () => {
    installFetch(baseHandler())
    render(<AlertsPage />)
    await screen.findAllByText('High memory')
    fireEvent.click(screen.getByRole('button', { name: /Add alert rule/i }))
    expect(await screen.findByText(/New alert rule/i)).toBeInTheDocument()
  })

  it('deletes a rule after confirmation', async () => {
    const fetchMock = installFetch(
      baseHandler({}, (url, init) =>
        url === '/api/alerts/rule-1' && init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : null,
      ),
    )
    render(<AlertsPage />)
    await screen.findAllByText('High memory')
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Delete'))
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) => u === '/api/alerts/rule-1' && (o as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true)
    })
  })

  it('toggles enabled with a full PUT payload', async () => {
    const fetchMock = installFetch(
      baseHandler({}, (url, init) =>
        url === '/api/alerts/rule-1' && init?.method === 'PUT'
          ? jsonResponse({ ...rule, enabled: false })
          : null,
      ),
    )
    render(<AlertsPage />)
    await screen.findAllByText('High memory')
    fireEvent.click(screen.getByRole('switch', { name: /Toggle High memory/i }))
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([u, o]) => u === '/api/alerts/rule-1' && (o as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeTruthy()
      const body = JSON.parse(String((put![1] as RequestInit).body))
      expect(body.enabled).toBe(false)
      expect(body.name).toBe('High memory')
      expect(body.threshold).toBe(90)
    })
  })

  it('re-fetches active alerts on an alerts.changed event', async () => {
    let activeCalls = 0
    installFetch(
      baseHandler(),
    )
    // Re-wrap fetch to count /api/alerts/active hits.
    const counting = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/alerts/active') activeCalls++
      return baseHandler()(input, init)
    })
    vi.stubGlobal('fetch', counting)

    render(<AlertsPage />)
    await screen.findAllByText('High memory')
    await waitFor(() => expect(activeCalls).toBeGreaterThanOrEqual(1))
    const before = activeCalls

    await act(async () => {
      FakeEventSource.instances.forEach((es) => es.emit('message', { type: 'alerts.changed' }))
    })
    await waitFor(() => expect(activeCalls).toBeGreaterThan(before))
  })

  it('ignores unrelated events', async () => {
    let activeCalls = 0
    const counting = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/alerts/active') activeCalls++
      return baseHandler()(input, init)
    })
    vi.stubGlobal('fetch', counting)
    render(<AlertsPage />)
    await screen.findAllByText('High memory')
    await waitFor(() => expect(activeCalls).toBeGreaterThanOrEqual(1))
    const before = activeCalls
    await act(async () => {
      FakeEventSource.instances.forEach((es) => es.emit('message', { type: 'systems.changed' }))
    })
    expect(activeCalls).toBe(before)
  })

  it('renders condition, target, and for variants across rule kinds', async () => {
    const rules: AlertRule[] = [
      { ...rule, id: 'r-promql', name: 'PromQL rule', conditionKind: 'promql', metric: undefined, expr: 'node_load1', comparator: 'lt', threshold: 1, forSeconds: 0, targetKind: 'group', targetValue: 'grp-x' },
      { ...rule, id: 'r-unreach', name: 'Unreach rule', conditionKind: 'unreachable', metric: undefined, comparator: undefined, threshold: 0, forSeconds: 30, severity: 'info', targetKind: 'systems', targetValue: '["a","b"]' },
      { ...rule, id: 'r-sel', name: 'Selector rule', conditionKind: 'metric', forSeconds: 600, severity: 'warning', targetKind: 'selector', targetValue: 'env=prod' },
    ]
    installFetch(
      async (input: RequestInfo) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url === '/api/alerts') return jsonResponse(rules)
        if (url === '/api/alerts/active') return jsonResponse([])
        if (url === '/api/alerts/catalog') return jsonResponse(catalog)
        if (url === '/api/groups')
          return jsonResponse([{ id: 'grp-x', name: 'prod-grp', createdAt: 't', systemCount: 0 }])
        return jsonResponse([])
      },
    )
    render(<AlertsPage />)
    expect(await screen.findByText('PromQL rule')).toBeInTheDocument()
    // promql condition + group target (resolved name)
    expect(screen.getByText('PromQL')).toBeInTheDocument()
    expect(screen.getByText(/prod-grp Group/)).toBeInTheDocument()
    expect(screen.getByText('Immediately')).toBeInTheDocument()
    // unreachable condition + systems target + seconds "for"
    expect(screen.getByText('Unreachable')).toBeInTheDocument()
    expect(screen.getByText('2 Systems')).toBeInTheDocument()
    expect(screen.getByText('30s')).toBeInTheDocument()
    // selector target + minutes "for"
    expect(screen.getByText('env=prod')).toBeInTheDocument()
    expect(screen.getByText('10m')).toBeInTheDocument()
  })

  it('renders a dash value for an unreachable active alert', async () => {
    const unreachActive: ActiveAlert = {
      ...activeAlert,
      systemId: 'sys-2',
      systemName: '',
      conditionKind: 'unreachable',
      metric: undefined,
      comparator: undefined,
      value: 1,
      severity: 'info',
    }
    installFetch(baseHandler({ rules: [], active: [unreachActive] }))
    render(<AlertsPage />)
    // No systemName → falls back to systemId; value renders as a dash.
    expect(await screen.findByText('sys-2')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows and dismisses an action error when delete fails', async () => {
    installFetch(
      baseHandler({}, (url, init) =>
        url === '/api/alerts/rule-1' && init?.method === 'DELETE'
          ? jsonResponse({ error: 'forbidden' }, { status: 403 })
          : null,
      ),
    )
    render(<AlertsPage />)
    await screen.findAllByText('High memory')
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Delete'))
    expect(await screen.findByText('Action failed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Dismiss error/i }))
    await waitFor(() => expect(screen.queryByText('Action failed')).toBeNull())
  })

  it('refreshes after creating a rule through the modal', async () => {
    let ruleListCalls = 0
    const counting = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/alerts' && (init?.method ?? 'GET') === 'GET') ruleListCalls++
      if (url === '/api/alerts' && init?.method === 'POST') return jsonResponse(rule, { status: 201 })
      return baseHandler({ rules: [], active: [] })(input, init)
    })
    vi.stubGlobal('fetch', counting)
    render(<AlertsPage />)
    await screen.findByText('No alert rules yet')
    const initial = ruleListCalls
    fireEvent.click(screen.getByRole('button', { name: /Add alert rule/i }))
    await screen.findByText(/New alert rule/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Fresh rule' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => expect(ruleListCalls).toBeGreaterThan(initial))
  })

  it('surfaces a non-ApiError when a toggle network call rejects', async () => {
    installFetch(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/alerts/rule-1' && init?.method === 'PUT') {
        throw new TypeError('network down')
      }
      return baseHandler()(input, init)
    })
    render(<AlertsPage />)
    await screen.findAllByText('High memory')
    fireEvent.click(screen.getByRole('switch', { name: /Toggle High memory/i }))
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
  })

  it('surfaces a load error', async () => {
    installFetch(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/alerts') return jsonResponse({ error: 'boom' }, { status: 500 })
      return jsonResponse([])
    })
    render(<AlertsPage />)
    expect(await screen.findByText('Could not load alert rules')).toBeInTheDocument()
  })
})
