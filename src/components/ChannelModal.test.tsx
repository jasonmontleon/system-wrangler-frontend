// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChannelModal from './ChannelModal'
import type { NotificationChannel } from '../api/notifications'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const slackChannel: NotificationChannel = {
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

function installFetch(handler: (input: RequestInfo, init?: RequestInit) => Promise<Response>) {
  const m = vi.fn(handler)
  vi.stubGlobal('fetch', m)
  return m
}

describe('ChannelModal', () => {
  beforeEach(() => {
    installFetch(async () => jsonResponse({ error: 'unexpected' }, { status: 500 }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when target is null', () => {
    render(<ChannelModal target={null} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens in create mode defaulting to email with SMTP fields', async () => {
    render(<ChannelModal target="new" onClose={() => {}} onSaved={() => {}} />)
    expect(await screen.findByText(/New notification channel/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/SMTP host/i)).toBeInTheDocument()
    const port = screen.getByLabelText(/SMTP port/i) as HTMLInputElement
    expect(port.value).toBe('587')
  })

  it('POSTs an email channel with parsed recipients and numeric port', async () => {
    const fetchMock = installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/notifications/channels' && init?.method === 'POST') {
        return jsonResponse({ id: 'ch-new' }, { status: 201 })
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })
    const onSaved = vi.fn()
    render(<ChannelModal target="new" onClose={() => {}} onSaved={onSaved} />)
    await screen.findByText(/New notification channel/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Email' } })
    fireEvent.change(screen.getByLabelText(/SMTP host/i), { target: { value: 'smtp.x' } })
    fireEvent.change(screen.getByLabelText(/^From/i), { target: { value: 'a@x' } })
    fireEvent.change(screen.getByLabelText(/Email recipients/i), { target: { value: 'b@x, c@x' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, o]) => (o as RequestInit | undefined)?.method === 'POST')
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.type).toBe('email')
      expect(body.config.smtpPort).toBe(587)
      expect(body.config.to).toEqual(['b@x', 'c@x'])
      expect(onSaved).toHaveBeenCalled()
    })
  })

  it('switches to slack and requires a secret before submit', async () => {
    render(<ChannelModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New notification channel/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Slack' } })
    fireEvent.click(screen.getByRole('button', { name: /Email \(SMTP\)/i }))
    fireEvent.click(await screen.findByText('Slack'))
    // Slack needs a webhook URL secret → submit disabled until provided.
    expect(screen.getByRole('button', { name: /^Create$/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Slack webhook URL/i), {
      target: { value: 'https://hooks.slack.com/x' },
    })
    expect(screen.getByRole('button', { name: /^Create$/i })).toBeEnabled()
  })

  it('edit mode shows the keep-secret placeholder and locks the type', async () => {
    render(<ChannelModal target={slackChannel} onClose={() => {}} onSaved={() => {}} />)
    expect(await screen.findByText(/Edit channel: Ops Slack/i)).toBeInTheDocument()
    const secret = screen.getByLabelText(/Slack webhook URL/i) as HTMLInputElement
    expect(secret.placeholder).toMatch(/Leave blank to keep/i)
    // Type toggle is disabled in edit mode.
    expect(screen.getByRole('button', { name: /Slack/i })).toBeDisabled()
    // Save without re-entering the secret is allowed (preserve-on-omit).
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeEnabled()
  })

  it('PUTs on save when editing', async () => {
    const fetchMock = installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/notifications/channels/ch-1' && init?.method === 'PUT') {
        return jsonResponse(slackChannel)
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })
    render(<ChannelModal target={slackChannel} onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/Edit channel/i)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))
    })
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, o]) => (o as RequestInit | undefined)?.method === 'PUT')).toBe(true)
    })
  })

  it('builds a webhook channel with method and auth header', async () => {
    const fetchMock = installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/notifications/channels' && init?.method === 'POST') {
        return jsonResponse({ id: 'ch-wh' }, { status: 201 })
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })
    render(<ChannelModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New notification channel/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Hook' } })
    fireEvent.click(screen.getByRole('button', { name: /Email \(SMTP\)/i }))
    fireEvent.click(await screen.findByText('Webhook'))
    fireEvent.change(screen.getByLabelText(/^URL/i), { target: { value: 'https://x/hook' } })
    fireEvent.click(screen.getByRole('button', { name: /^POST$/i }))
    fireEvent.click(await screen.findByText('PUT'))
    fireEvent.change(screen.getByLabelText(/Auth header name/i), { target: { value: 'X-Token' } })
    fireEvent.change(screen.getByLabelText(/Auth header value/i), { target: { value: 'sekret' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, o]) => (o as RequestInit | undefined)?.method === 'POST')
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.type).toBe('webhook')
      expect(body.config).toMatchObject({ url: 'https://x/hook', method: 'PUT', headerName: 'X-Token' })
      expect(body.secret).toBe('sekret')
    })
  })

  it('builds an sms channel and requires the auth token', async () => {
    const fetchMock = installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/notifications/channels' && init?.method === 'POST') {
        return jsonResponse({ id: 'ch-sms' }, { status: 201 })
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })
    render(<ChannelModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New notification channel/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Texts' } })
    fireEvent.click(screen.getByRole('button', { name: /Email \(SMTP\)/i }))
    fireEvent.click(await screen.findByText('SMS'))
    fireEvent.change(screen.getByLabelText(/Account SID/i), { target: { value: 'AC123' } })
    fireEvent.change(screen.getByLabelText(/From number/i), { target: { value: '+15550000000' } })
    fireEvent.change(screen.getByLabelText(/SMS recipients/i), { target: { value: '+15551112222' } })
    // Token required → submit disabled until provided.
    expect(screen.getByRole('button', { name: /^Create$/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Auth token/i), { target: { value: 'tok' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, o]) => (o as RequestInit | undefined)?.method === 'POST')
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.type).toBe('sms')
      expect(body.config).toMatchObject({ accountSID: 'AC123', from: '+15550000000', to: ['+15551112222'] })
      expect(body.secret).toBe('tok')
    })
  })

  it('surfaces a save error inline', async () => {
    installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/notifications/channels' && init?.method === 'POST') {
        return jsonResponse({ error: 'smtpHost is required' }, { status: 400 })
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })
    render(<ChannelModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New notification channel/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(/SMTP host/i), { target: { value: 's' } })
    fireEvent.change(screen.getByLabelText(/^From/i), { target: { value: 'a@x' } })
    fireEvent.change(screen.getByLabelText(/Email recipients/i), { target: { value: 'b@x' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    expect(await screen.findByText(/smtpHost is required/i)).toBeInTheDocument()
  })
})
