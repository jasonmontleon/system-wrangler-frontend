// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './DashboardPage'
import type { System } from '../api/systems'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sys(overrides: Partial<System>): System {
  return {
    id: 's-' + Math.random().toString(36).slice(2, 8),
    name: 'host',
    hostname: '10.0.0.1',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'reachable',
    ...overrides,
  }
}

class FakeEventSource {
  constructor(public url: string) {}
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the empty state when no systems exist', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url === '/api/systems') return Promise.resolve(jsonResponse([]))
      return Promise.resolve(jsonResponse({}, 500))
    })
    render(<DashboardPage />)
    expect(await screen.findByText(/No systems yet/i)).toBeInTheDocument()
  })

  it('tallies systems into the five health buckets with precedence', async () => {
    // Precedence rule from SystemStatusIcon:
    //   unreachable → red
    //   lastRunFailed → red (Failed run bucket)
    //   reachable + pending > 0 → yellow
    //   reachable + pending = 0 → green
    //   anything else (unprobed / never checked) → grey
    const systems: System[] = [
      sys({ status: 'reachable', pendingUpdates: 0 }), // healthy
      sys({ status: 'reachable', pendingUpdates: 0 }), // healthy
      sys({ status: 'reachable', pendingUpdates: 3 }), // updates available
      sys({ status: 'reachable', pendingUpdates: 7 }), // updates available
      sys({ status: 'reachable', pendingUpdates: 1 }), // updates available
      sys({ status: 'unreachable' }), // unreachable (precedence)
      // lastRunFailed must win over pending > 0:
      sys({ status: 'reachable', pendingUpdates: 5, lastRunFailed: true }),
      sys({ status: 'unprobed' }), // unknown
    ]
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url === '/api/systems') return Promise.resolve(jsonResponse(systems))
      return Promise.resolve(jsonResponse({}, 500))
    })
    render(<DashboardPage />)
    // Wait for the donut to render — its center label carries the total.
    await screen.findByLabelText('Healthy count')
    expect(screen.getByLabelText('Healthy count').textContent).toBe('2')
    expect(screen.getByLabelText('Updates available count').textContent).toBe('3')
    expect(screen.getByLabelText('Unreachable count').textContent).toBe('1')
    expect(screen.getByLabelText('Failed run count').textContent).toBe('1')
    expect(screen.getByLabelText('Unknown count').textContent).toBe('1')
  })

  it('surfaces a load error when /api/systems fails', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/health') return Promise.resolve(jsonResponse({ status: 'ok' }))
      if (url === '/api/systems')
        return Promise.resolve(jsonResponse({ error: 'down' }, 500))
      return Promise.resolve(jsonResponse({}, 500))
    })
    render(<DashboardPage />)
    expect(
      await screen.findByText(/Could not load systems/i),
    ).toBeInTheDocument()
  })
})
