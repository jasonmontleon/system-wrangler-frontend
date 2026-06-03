// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationChannelsPage from './NotificationChannelsPage'
import type { NotificationChannel, NotificationDelivery } from '../api/notifications'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const channel: NotificationChannel = {
  id: 'ch-1',
  name: 'Ops Slack',
  type: 'slack',
  enabled: true,
  config: {},
  hasSecret: true,
  createdBy: 'u',
  createdAt: '2026-06-02T00:00:00Z',
  updatedAt: '2026-06-02T00:00:00Z',
}

const delivery: NotificationDelivery = {
  id: 'd-1',
  channelId: 'ch-1',
  channelName: 'Ops Slack',
  channelType: 'slack',
  kind: 'fired',
  ruleName: 'High memory',
  systemId: 'sys-1',
  status: 'success',
  at: '2026-06-02T12:00:00Z',
}

type FetchHandler = (input: RequestInfo, init?: RequestInit) => Promise<Response>

function installFetch(handler: FetchHandler) {
  const m = vi.fn(handler)
  vi.stubGlobal('fetch', m)
  return m
}

function baseHandler(
  opts: {
    channels?: NotificationChannel[]
    deliveries?: NotificationDelivery[]
    rules?: unknown[]
    routing?: unknown[]
    policy?: unknown
  } = {},
  extra?: (url: string, init?: RequestInit) => Response | null,
) {
  return async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url === '/api/notifications/channels' && (init?.method ?? 'GET') === 'GET') {
      return jsonResponse(opts.channels ?? [channel])
    }
    if (url.startsWith('/api/notifications/deliveries')) {
      return jsonResponse(opts.deliveries ?? [delivery])
    }
    // RoutingMatrix (mounted on the page) fetches rules + routing; default
    // both to empty so the matrix renders its "no rules" state quietly and
    // doesn't disturb the channel/delivery assertions.
    if (url === '/api/alerts' && (init?.method ?? 'GET') === 'GET') {
      return jsonResponse(opts.rules ?? [])
    }
    if (url === '/api/notifications/routing' && (init?.method ?? 'GET') === 'GET') {
      return jsonResponse(opts.routing ?? [])
    }
    // DeliveryPolicyCard (mounted on the page) fetches the policy.
    if (url === '/api/notifications/policy' && (init?.method ?? 'GET') === 'GET') {
      return jsonResponse(opts.policy ?? { timezone: 'UTC', windows: [], severities: {} })
    }
    const e = extra?.(url, init)
    if (e) return e
    return jsonResponse({ error: 'unexpected ' + url }, { status: 500 })
  }
}

describe('NotificationChannelsPage', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists channels and deliveries', async () => {
    installFetch(baseHandler())
    render(<NotificationChannelsPage />)
    // "Ops Slack" shows in both the channel table and the delivery row.
    expect((await screen.findAllByText('Ops Slack')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('High memory')).toBeInTheDocument()
    expect(screen.getByText('Slack')).toBeInTheDocument()
  })

  it('shows empty states', async () => {
    installFetch(baseHandler({ channels: [], deliveries: [] }))
    render(<NotificationChannelsPage />)
    expect(await screen.findByText('No channels yet')).toBeInTheDocument()
    expect(screen.getByText('No deliveries yet')).toBeInTheDocument()
  })

  it('opens the create modal', async () => {
    installFetch(baseHandler())
    render(<NotificationChannelsPage />)
    await screen.findAllByText('Ops Slack')
    fireEvent.click(screen.getByRole('button', { name: /Add channel/i }))
    expect(await screen.findByText(/New notification channel/i)).toBeInTheDocument()
  })

  it('toggles enabled with a full PUT payload', async () => {
    const fetchMock = installFetch(
      baseHandler({}, (url, init) =>
        url === '/api/notifications/channels/ch-1' && init?.method === 'PUT'
          ? jsonResponse({ ...channel, enabled: false })
          : null,
      ),
    )
    render(<NotificationChannelsPage />)
    await screen.findAllByText('Ops Slack')
    fireEvent.click(screen.getByRole('switch', { name: /Toggle Ops Slack/i }))
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([u, o]) => u === '/api/notifications/channels/ch-1' && (o as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put).toBeTruthy()
      const body = JSON.parse(String((put![1] as RequestInit).body))
      expect(body.enabled).toBe(false)
      expect(body.type).toBe('slack')
    })
  })

  it('sends a test and shows the success banner', async () => {
    installFetch(
      baseHandler({}, (url, init) =>
        url === '/api/notifications/channels/ch-1/test' && init?.method === 'POST'
          ? jsonResponse({ ok: true })
          : null,
      ),
    )
    render(<NotificationChannelsPage />)
    await screen.findAllByText('Ops Slack')
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Send test'))
    expect(await screen.findByText(/Test sent through Ops Slack/i)).toBeInTheDocument()
  })

  it('shows a failed-test banner with the error', async () => {
    installFetch(
      baseHandler({}, (url, init) =>
        url === '/api/notifications/channels/ch-1/test' && init?.method === 'POST'
          ? jsonResponse({ ok: false, error: 'connection refused' })
          : null,
      ),
    )
    render(<NotificationChannelsPage />)
    await screen.findAllByText('Ops Slack')
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Send test'))
    expect(await screen.findByText(/connection refused/i)).toBeInTheDocument()
  })

  it('deletes a channel after confirmation', async () => {
    const fetchMock = installFetch(
      baseHandler({}, (url, init) =>
        url === '/api/notifications/channels/ch-1' && init?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : null,
      ),
    )
    render(<NotificationChannelsPage />)
    await screen.findAllByText('Ops Slack')
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Delete'))
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([u, o]) => u === '/api/notifications/channels/ch-1' && (o as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true)
    })
  })

  it('renders every channel type label and a failed delivery row', async () => {
    const channels: NotificationChannel[] = [
      { ...channel, id: 'c-email', name: 'Mail', type: 'email' },
      { ...channel, id: 'c-webhook', name: 'Hook', type: 'webhook' },
      { ...channel, id: 'c-sms', name: 'Texts', type: 'sms' },
    ]
    const deliveries: NotificationDelivery[] = [
      { ...delivery, id: 'd-fail', channelName: 'Hook', status: 'failed', error: 'connection refused', systemId: '' },
    ]
    installFetch(baseHandler({ channels, deliveries }))
    render(<NotificationChannelsPage />)
    expect(await screen.findByText('Mail')).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Webhook')).toBeInTheDocument()
    expect(screen.getByText('SMS')).toBeInTheDocument()
    // Failed delivery: red label + the error text appended to the When cell.
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/connection refused/)).toBeInTheDocument()
  })

  it('shows an action error when the test request itself fails', async () => {
    installFetch(
      baseHandler({}, (url, init) =>
        url === '/api/notifications/channels/ch-1/test' && init?.method === 'POST'
          ? jsonResponse({ error: 'no runtime' }, { status: 503 })
          : null,
      ),
    )
    render(<NotificationChannelsPage />)
    await screen.findAllByText('Ops Slack')
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Send test'))
    expect(await screen.findByText('Action failed')).toBeInTheDocument()
  })

  it('refreshes the list after creating a channel via the modal', async () => {
    let listCalls = 0
    const counting = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/notifications/channels' && (init?.method ?? 'GET') === 'GET') listCalls++
      if (url === '/api/notifications/channels' && init?.method === 'POST') {
        return jsonResponse({ id: 'new' }, { status: 201 })
      }
      return baseHandler({ channels: [], deliveries: [] })(input, init)
    })
    vi.stubGlobal('fetch', counting)
    render(<NotificationChannelsPage />)
    await screen.findByText('No channels yet')
    const initial = listCalls
    fireEvent.click(screen.getByRole('button', { name: /Add channel/i }))
    await screen.findByText(/New notification channel/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Hook' } })
    fireEvent.click(screen.getByRole('button', { name: /Email \(SMTP\)/i }))
    fireEvent.click(await screen.findByText('Webhook'))
    fireEvent.change(screen.getByLabelText(/^URL/i), { target: { value: 'https://x/hook' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => expect(listCalls).toBeGreaterThan(initial))
  })

  it('shows an action error when a toggle fails', async () => {
    installFetch(
      baseHandler({}, (url, init) =>
        url === '/api/notifications/channels/ch-1' && init?.method === 'PUT'
          ? jsonResponse({ error: 'boom' }, { status: 500 })
          : null,
      ),
    )
    render(<NotificationChannelsPage />)
    await screen.findAllByText('Ops Slack')
    fireEvent.click(screen.getByRole('switch', { name: /Toggle Ops Slack/i }))
    expect(await screen.findByText('Action failed')).toBeInTheDocument()
  })

  it('closes the modal on cancel', async () => {
    installFetch(baseHandler())
    render(<NotificationChannelsPage />)
    await screen.findAllByText('Ops Slack')
    fireEvent.click(screen.getByRole('button', { name: /Add channel/i }))
    await screen.findByText(/New notification channel/i)
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }))
    await waitFor(() => expect(screen.queryByText(/New notification channel/i)).toBeNull())
  })

  it('surfaces a non-ApiError thrown during an action', async () => {
    installFetch(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/notifications/channels/ch-1' && init?.method === 'PUT') {
        throw new TypeError('network down')
      }
      return baseHandler()(input, init)
    })
    render(<NotificationChannelsPage />)
    await screen.findAllByText('Ops Slack')
    fireEvent.click(screen.getByRole('switch', { name: /Toggle Ops Slack/i }))
    expect(await screen.findByText(/network down/i)).toBeInTheDocument()
  })

  it('surfaces a load error', async () => {
    installFetch(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/notifications/channels') return jsonResponse({ error: 'forbidden' }, { status: 403 })
      return jsonResponse([])
    })
    render(<NotificationChannelsPage />)
    expect(await screen.findByText('Could not load channels')).toBeInTheDocument()
  })

  it('surfaces a delete error', async () => {
    installFetch(
      baseHandler({}, (url, init) =>
        url === '/api/notifications/channels/ch-1' && init?.method === 'DELETE'
          ? jsonResponse({ error: 'nope' }, { status: 500 })
          : null,
      ),
    )
    render(<NotificationChannelsPage />)
    await screen.findAllByText('Ops Slack')
    fireEvent.click(screen.getByRole('button', { name: /Kebab toggle|Actions/i }))
    fireEvent.click(await screen.findByText('Delete'))
    expect(await screen.findByText('Action failed')).toBeInTheDocument()
  })
})
