// SPDX-License-Identifier: Apache-2.0

import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FiringAlertsWidget from './FiringAlertsWidget'
import type { ActiveAlert } from '../../api/alerts'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const firing: ActiveAlert = {
  ruleId: 'r-1',
  systemId: 'sys-1',
  state: 'firing',
  value: 95,
  firstBreachAt: '2026-06-02T12:00:00Z',
  lastEvalAt: '2026-06-02T12:01:00Z',
  ruleName: 'High memory',
  severity: 'critical',
  conditionKind: 'metric',
  threshold: 90,
  systemName: 'web-1',
}

const pending: ActiveAlert = { ...firing, systemId: 'sys-2', systemName: 'web-2', state: 'pending' }

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
    for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) } as MessageEvent)
  }
}

function installFetch(handler: (input: RequestInfo) => Promise<Response>) {
  const m = vi.fn(handler)
  vi.stubGlobal('fetch', m)
  return m
}

describe('FiringAlertsWidget', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists only firing alerts, excluding pending', async () => {
    installFetch(async () => jsonResponse([firing, pending]))
    render(<FiringAlertsWidget />)
    expect(await screen.findByText(/High memory on web-1/)).toBeInTheDocument()
    expect(screen.queryByText(/web-2/)).toBeNull()
  })

  it('shows the no-firing-alerts message when none', async () => {
    installFetch(async () => jsonResponse([pending]))
    render(<FiringAlertsWidget />)
    expect(await screen.findByText('No firing alerts.')).toBeInTheDocument()
  })

  it('refreshes on an alerts.changed event', async () => {
    let calls = 0
    installFetch(async () => {
      calls++
      return jsonResponse(calls === 1 ? [] : [firing])
    })
    render(<FiringAlertsWidget />)
    expect(await screen.findByText('No firing alerts.')).toBeInTheDocument()
    await act(async () => {
      FakeEventSource.instances.forEach((es) => es.emit('message', { type: 'alerts.changed' }))
    })
    await waitFor(() => expect(screen.getByText(/High memory on web-1/)).toBeInTheDocument())
  })

  it('renders empty on fetch failure', async () => {
    installFetch(async () => new Response('x', { status: 500 }))
    render(<FiringAlertsWidget />)
    expect(await screen.findByText('No firing alerts.')).toBeInTheDocument()
  })
})
