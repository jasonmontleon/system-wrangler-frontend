// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DeliveryPolicyCard from './DeliveryPolicyCard'
import type { NotificationPolicy } from '../api/notifications'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

type Opts = {
  policy?: NotificationPolicy
  failLoad?: boolean
  putResponse?: () => Response
}

function installFetch(opts: Opts = {}) {
  const m = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    if (url === '/api/notifications/policy' && method === 'GET') {
      if (opts.failLoad) return jsonResponse({ error: 'denied' }, { status: 403 })
      return jsonResponse(opts.policy ?? { timezone: 'UTC', windows: [], severities: {} })
    }
    if (url === '/api/notifications/policy' && method === 'PUT') {
      if (opts.putResponse) return opts.putResponse()
      // Echo the submitted policy back.
      return jsonResponse(JSON.parse(String(init?.body)))
    }
    return jsonResponse({ error: 'unexpected ' + url }, { status: 500 })
  })
  vi.stubGlobal('fetch', m)
  return m
}

function lastPut(m: ReturnType<typeof installFetch>) {
  const call = m.mock.calls.find(
    ([u, o]) => u === '/api/notifications/policy' && (o as RequestInit | undefined)?.method === 'PUT',
  )
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined
}

describe('DeliveryPolicyCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders default severity modes when the policy omits them', async () => {
    installFetch()
    render(<DeliveryPolicyCard />)
    const info = (await screen.findByRole('combobox', { name: 'Info delivery mode' })) as HTMLSelectElement
    expect(info.value).toBe('dashboard')
    expect((screen.getByRole('combobox', { name: 'Warning delivery mode' }) as HTMLSelectElement).value).toBe('quiet')
    expect((screen.getByRole('combobox', { name: 'Critical delivery mode' }) as HTMLSelectElement).value).toBe('always')
    expect(screen.getByText('No quiet windows')).toBeInTheDocument()
  })

  it('shows a load error', async () => {
    installFetch({ failLoad: true })
    render(<DeliveryPolicyCard />)
    expect(await screen.findByText('Could not load delivery policy')).toBeInTheDocument()
  })

  it('saves a changed severity mode', async () => {
    const m = installFetch()
    render(<DeliveryPolicyCard />)
    const warning = await screen.findByRole('combobox', { name: 'Warning delivery mode' })
    fireEvent.change(warning, { target: { value: 'always' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }))
    await screen.findByText('Delivery policy saved')
    expect(lastPut(m).severities.warning).toBe('always')
  })

  it('adds a window, sets a day and time, and saves it', async () => {
    const m = installFetch()
    render(<DeliveryPolicyCard />)
    await screen.findByRole('combobox', { name: 'Info delivery mode' })
    fireEvent.click(screen.getByRole('button', { name: 'Add window' }))
    // The default new window seeds 22:00–08:00. Time inputs expose no
    // textbox role, so query them by their aria-label.
    const start = (await screen.findByLabelText('Window 1 start')) as HTMLInputElement
    expect(start.value).toBe('22:00')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Window 1 Mon' }))
    fireEvent.change(screen.getByLabelText('Window 1 end'), { target: { value: '07:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }))
    await screen.findByText('Delivery policy saved')
    expect(lastPut(m).windows).toEqual([{ days: [1], start: '22:00', end: '07:30' }])
  })

  it('removes a window', async () => {
    const policy: NotificationPolicy = {
      timezone: 'UTC',
      windows: [{ days: [1], start: '22:00', end: '08:00' }],
      severities: {},
    }
    const m = installFetch({ policy })
    render(<DeliveryPolicyCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove window 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }))
    await screen.findByText('Delivery policy saved')
    expect(lastPut(m).windows).toEqual([])
  })

  it('edits the timezone and surfaces a save error', async () => {
    const m = installFetch({ putResponse: () => jsonResponse({ error: 'bad tz' }, { status: 400 }) })
    render(<DeliveryPolicyCard />)
    const tz = await screen.findByRole('textbox', { name: 'Quiet hours timezone' })
    fireEvent.change(tz, { target: { value: 'Mars/Phobos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }))
    expect(await screen.findByText('Could not save delivery policy')).toBeInTheDocument()
    expect(lastPut(m).timezone).toBe('Mars/Phobos')
  })
})
