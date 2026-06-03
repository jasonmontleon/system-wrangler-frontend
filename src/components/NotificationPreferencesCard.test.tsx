// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationPreferencesCard from './NotificationPreferencesCard'
import type { AlertSubscription, NotificationChannel, NotificationDelivery } from '../api/notifications'
import type { Group } from '../api/groups'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const channel: NotificationChannel = {
  id: 'ch-1',
  name: 'My Webhook',
  type: 'webhook',
  enabled: true,
  config: { url: 'https://x' },
  hasSecret: false,
  createdBy: 'u1',
  createdAt: '2026-06-03T00:00:00Z',
  updatedAt: '2026-06-03T00:00:00Z',
}

const delivery: NotificationDelivery = {
  id: 'd-1',
  channelId: 'ch-0',
  channelName: 'Old Webhook',
  channelType: 'webhook',
  kind: 'fired',
  ruleName: 'High memory',
  systemId: 's1',
  status: 'success',
  at: '2026-06-03T12:00:00Z',
}

const enabledSub: AlertSubscription = { enabled: true, groups: ['g1'], severities: ['critical'] }
const groups: Group[] = [
  { id: 'g1', name: 'Web', createdAt: '', systemCount: 2 },
  { id: 'g2', name: 'DB', createdAt: '', systemCount: 1 },
]

type Opts = {
  channels?: NotificationChannel[]
  subscription?: AlertSubscription
  groups?: Group[]
  deliveries?: NotificationDelivery[]
  extra?: (url: string, init?: RequestInit) => Response | null
}

function installFetch(opts: Opts = {}) {
  const m = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    const e = opts.extra?.(url, init)
    if (e) return e
    if (url === '/api/notifications/me/channels' && method === 'GET') {
      return jsonResponse(opts.channels ?? [channel])
    }
    if (url === '/api/notifications/me/subscription' && method === 'GET') {
      return jsonResponse(opts.subscription ?? enabledSub)
    }
    if (url === '/api/notifications/me/subscription' && method === 'PUT') {
      return jsonResponse(JSON.parse(String(init?.body)))
    }
    if (url === '/api/groups') return jsonResponse(opts.groups ?? groups)
    if (url.startsWith('/api/notifications/me/deliveries')) {
      return jsonResponse(opts.deliveries ?? [delivery])
    }
    return jsonResponse({ error: 'unexpected ' + url }, { status: 500 })
  })
  vi.stubGlobal('fetch', m)
  return m
}

describe('NotificationPreferencesCard', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders channels, subscription, and deliveries', async () => {
    installFetch()
    render(<NotificationPreferencesCard />)
    expect(await screen.findByText('My Webhook')).toBeInTheDocument()
    // Subscription is enabled, so the severity + group checkboxes show.
    expect(screen.getByRole('checkbox', { name: 'Critical' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Info' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Web' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'DB' })).not.toBeChecked()
    // Delivery row.
    expect(screen.getByText('High memory')).toBeInTheDocument()
  })

  it('hides the filters when the subscription is disabled', async () => {
    installFetch({ subscription: { enabled: false, groups: [], severities: [] } })
    render(<NotificationPreferencesCard />)
    await screen.findByText('My Webhook')
    expect(screen.queryByRole('checkbox', { name: 'Critical' })).not.toBeInTheDocument()
  })

  it('saves the subscription with the edited filters', async () => {
    const m = installFetch({ subscription: { enabled: true, groups: [], severities: [] } })
    render(<NotificationPreferencesCard />)
    await screen.findByText('My Webhook')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Warning' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'DB' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save subscription' }))
    await screen.findByText('Subscription saved')
    const put = m.mock.calls.find(
      ([u, o]) => u === '/api/notifications/me/subscription' && (o as RequestInit | undefined)?.method === 'PUT',
    )
    expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({
      enabled: true,
      groups: ['g2'],
      severities: ['warning'],
    })
  })

  it('toggles a channel with a full PUT payload', async () => {
    const m = installFetch({
      extra: (url, init) =>
        url === '/api/notifications/me/channels/ch-1' && init?.method === 'PUT'
          ? jsonResponse({ ...channel, enabled: false })
          : null,
    })
    render(<NotificationPreferencesCard />)
    await screen.findByText('My Webhook')
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle My Webhook' }))
    await waitFor(() => {
      const put = m.mock.calls.find(
        ([u, o]) => u === '/api/notifications/me/channels/ch-1' && (o as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeTruthy()
      expect(JSON.parse(String((put![1] as RequestInit).body)).enabled).toBe(false)
    })
  })

  it('sends a test and shows the result', async () => {
    installFetch({
      extra: (url, init) =>
        url === '/api/notifications/me/channels/ch-1/test' && init?.method === 'POST'
          ? jsonResponse({ ok: true })
          : null,
    })
    render(<NotificationPreferencesCard />)
    await screen.findByText('My Webhook')
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Send test'))
    expect(await screen.findByText(/Test sent through My Webhook/i)).toBeInTheDocument()
  })

  it('deletes a channel after confirmation', async () => {
    const m = installFetch({
      extra: (url, init) =>
        url === '/api/notifications/me/channels/ch-1' && init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : null,
    })
    render(<NotificationPreferencesCard />)
    await screen.findByText('My Webhook')
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Delete'))
    await waitFor(() =>
      expect(
        m.mock.calls.some(
          ([u, o]) => u === '/api/notifications/me/channels/ch-1' && (o as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })

  it('opens and closes the add-channel modal', async () => {
    installFetch()
    render(<NotificationPreferencesCard />)
    await screen.findByText('My Webhook')
    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }))
    expect(await screen.findByText(/New notification channel/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByText(/New notification channel/i)).not.toBeInTheDocument(),
    )
  })

  it('reports a failed test and a failed delete', async () => {
    installFetch({
      extra: (url, init) => {
        if (url === '/api/notifications/me/channels/ch-1/test' && init?.method === 'POST') {
          return jsonResponse({ error: 'unreachable' }, { status: 500 })
        }
        if (url === '/api/notifications/me/channels/ch-1' && init?.method === 'DELETE') {
          return jsonResponse({ error: 'busy' }, { status: 500 })
        }
        return null
      },
    })
    render(<NotificationPreferencesCard />)
    await screen.findByText('My Webhook')
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Send test'))
    expect(await screen.findByText('Action failed')).toBeInTheDocument()
    // Then a failing delete also surfaces the error.
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Delete'))
    await waitFor(() => expect(screen.getByText('Action failed')).toBeInTheDocument())
  })

  it('shows empty states', async () => {
    installFetch({ channels: [], deliveries: [] })
    render(<NotificationPreferencesCard />)
    expect(await screen.findByText('No personal channels yet')).toBeInTheDocument()
    expect(screen.getByText('No deliveries yet')).toBeInTheDocument()
  })

  it('surfaces a subscription load error', async () => {
    installFetch({
      extra: (url) =>
        url === '/api/notifications/me/subscription' ? jsonResponse({ error: 'nope' }, { status: 500 }) : null,
    })
    render(<NotificationPreferencesCard />)
    expect(await screen.findByText('Could not load subscription')).toBeInTheDocument()
  })

  it('surfaces a channel action error', async () => {
    installFetch({
      extra: (url, init) =>
        url === '/api/notifications/me/channels/ch-1' && init?.method === 'PUT'
          ? jsonResponse({ error: 'write failed' }, { status: 500 })
          : null,
    })
    render(<NotificationPreferencesCard />)
    await screen.findByText('My Webhook')
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle My Webhook' }))
    expect(await screen.findByText('Action failed')).toBeInTheDocument()
  })

  it('surfaces a subscription save error', async () => {
    installFetch({
      extra: (url, init) =>
        url === '/api/notifications/me/subscription' && init?.method === 'PUT'
          ? jsonResponse({ error: 'bad' }, { status: 400 })
          : null,
    })
    render(<NotificationPreferencesCard />)
    await screen.findByText('My Webhook')
    fireEvent.click(screen.getByRole('button', { name: 'Save subscription' }))
    expect(await screen.findByText('Could not save subscription')).toBeInTheDocument()
  })

  it('renders a failed delivery row with its error and the no-groups note', async () => {
    installFetch({
      groups: [],
      deliveries: [{ ...delivery, status: 'failed', error: 'connection refused' }],
    })
    render(<NotificationPreferencesCard />)
    await screen.findByText('My Webhook')
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText(/connection refused/)).toBeInTheDocument()
    // Subscription is enabled but there are no groups to choose from.
    expect(screen.getByText('No groups')).toBeInTheDocument()
  })
})
