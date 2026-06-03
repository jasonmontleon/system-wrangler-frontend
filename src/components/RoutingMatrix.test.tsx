// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RoutingMatrix from './RoutingMatrix'
import type { AlertRule } from '../api/alerts'
import type { NotificationChannel, RuleRouting } from '../api/notifications'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const rule: AlertRule = {
  id: 'r1',
  name: 'Disk Full',
  conditionKind: 'metric',
  metric: 'fs_used_pct',
  comparator: 'gt',
  threshold: 90,
  forSeconds: 0,
  severity: 'warning',
  targetKind: 'global',
  targetValue: '',
  enabled: true,
  createdBy: 'u',
  createdAt: '2026-06-02T00:00:00Z',
  updatedAt: '2026-06-02T00:00:00Z',
}

const email: NotificationChannel = {
  id: 'c1',
  name: 'Email',
  type: 'email',
  enabled: true,
  config: {},
  hasSecret: false,
  createdBy: 'u',
  createdAt: '2026-06-02T00:00:00Z',
  updatedAt: '2026-06-02T00:00:00Z',
}
const slack: NotificationChannel = { ...email, id: 'c2', name: 'Slack', type: 'slack', enabled: false }

type Opts = {
  rules?: AlertRule[]
  channels?: NotificationChannel[]
  routing?: RuleRouting[]
  failLoad?: boolean
  putResponse?: (url: string) => Response | null
}

function installFetch(opts: Opts = {}) {
  const m = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    if (opts.failLoad) return jsonResponse({ error: 'denied' }, { status: 403 })
    if (url === '/api/alerts' && method === 'GET') return jsonResponse(opts.rules ?? [rule])
    if (url === '/api/notifications/channels' && method === 'GET') {
      return jsonResponse(opts.channels ?? [email, slack])
    }
    if (url === '/api/notifications/routing' && method === 'GET') {
      return jsonResponse(opts.routing ?? [])
    }
    if (url.startsWith('/api/notifications/routing/') && method === 'PUT') {
      const custom = opts.putResponse?.(url)
      if (custom) return custom
      const body = JSON.parse(String(init?.body)) as { mode: 'all' | 'selected'; channelIds?: string[] }
      return jsonResponse({ ruleId: 'r1', mode: body.mode, channelIds: body.channelIds ?? null })
    }
    return jsonResponse({ error: 'unexpected ' + url }, { status: 500 })
  })
  vi.stubGlobal('fetch', m)
  return m
}

describe('RoutingMatrix', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders rules and channel columns; a default rule routes to all', async () => {
    installFetch()
    render(<RoutingMatrix />)
    expect(await screen.findByText('Disk Full')).toBeInTheDocument()
    // Disabled channel header is annotated.
    expect(screen.getByText('Slack (Disabled)')).toBeInTheDocument()
    // Default (no stored routing) → the all switch is on...
    const allSwitch = screen.getByRole('switch', { name: /Route Disk Full to all enabled channels/i })
    expect(allSwitch).toBeChecked()
    // ...and the per-channel checkboxes are disabled.
    expect(screen.getByRole('checkbox', { name: /Route Disk Full to Email/i })).toBeDisabled()
  })

  it('toggling off "all" drops to an empty selection', async () => {
    const fetchMock = installFetch()
    render(<RoutingMatrix />)
    fireEvent.click(await screen.findByRole('switch', { name: /Route Disk Full to all enabled channels/i }))
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([u, o]) => u === '/api/notifications/routing/r1' && (o as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeTruthy()
      expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({ mode: 'selected', channelIds: [] })
    })
    // After saving, the email checkbox is enabled.
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /Route Disk Full to Email/i })).toBeEnabled(),
    )
  })

  it('checking a channel on a selected rule sends the channel id', async () => {
    const fetchMock = installFetch({ routing: [{ ruleId: 'r1', mode: 'selected', channelIds: [] }] })
    render(<RoutingMatrix />)
    const emailBox = await screen.findByRole('checkbox', { name: /Route Disk Full to Email/i })
    expect(emailBox).toBeEnabled()
    fireEvent.click(emailBox)
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([u, o]) => u === '/api/notifications/routing/r1' && (o as RequestInit | undefined)?.method === 'PUT',
      )
      expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({
        mode: 'selected',
        channelIds: ['c1'],
      })
    })
  })

  it('unchecking a selected channel removes it', async () => {
    const fetchMock = installFetch({ routing: [{ ruleId: 'r1', mode: 'selected', channelIds: ['c1'] }] })
    render(<RoutingMatrix />)
    const emailBox = await screen.findByRole('checkbox', { name: /Route Disk Full to Email/i })
    expect(emailBox).toBeChecked()
    fireEvent.click(emailBox)
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([u, o]) => u === '/api/notifications/routing/r1' && (o as RequestInit | undefined)?.method === 'PUT',
      )
      expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({ mode: 'selected', channelIds: [] })
    })
  })

  it('shows the no-rules empty state', async () => {
    installFetch({ rules: [] })
    render(<RoutingMatrix />)
    expect(await screen.findByText('No alert rules yet')).toBeInTheDocument()
  })

  it('shows the no-channels empty state', async () => {
    installFetch({ channels: [] })
    render(<RoutingMatrix />)
    expect(await screen.findByText('No channels to route to')).toBeInTheDocument()
  })

  it('shows a load error', async () => {
    installFetch({ failLoad: true })
    render(<RoutingMatrix />)
    expect(await screen.findByText('Could not load routing')).toBeInTheDocument()
  })

  it('surfaces a save failure', async () => {
    installFetch({ putResponse: () => jsonResponse({ error: 'nope' }, { status: 500 }) })
    render(<RoutingMatrix />)
    fireEvent.click(await screen.findByRole('switch', { name: /Route Disk Full to all enabled channels/i }))
    expect(await screen.findByText('Could not save routing')).toBeInTheDocument()
    expect(screen.getByText('nope')).toBeInTheDocument()
  })

  it('dismisses the save error alert', async () => {
    installFetch({ putResponse: () => jsonResponse({ error: 'nope' }, { status: 500 }) })
    render(<RoutingMatrix />)
    fireEvent.click(await screen.findByRole('switch', { name: /Route Disk Full to all enabled channels/i }))
    await screen.findByText('Could not save routing')
    fireEvent.click(screen.getByRole('button', { name: /Dismiss routing error/i }))
    await waitFor(() => expect(screen.queryByText('Could not save routing')).not.toBeInTheDocument())
  })
})
