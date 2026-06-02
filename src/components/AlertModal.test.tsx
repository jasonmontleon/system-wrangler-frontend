// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AlertModal from './AlertModal'
import type { AlertRule } from '../api/alerts'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const catalog = [
  { metric: 'mem_used_pct', label: 'Memory Used', unit: '%' },
  { metric: 'load1', label: 'Load (1m)', unit: '' },
]

const sample: AlertRule = {
  id: 'rule-1',
  name: 'High memory',
  conditionKind: 'metric',
  metric: 'mem_used_pct',
  comparator: 'gt',
  threshold: 90,
  forSeconds: 300,
  severity: 'warning',
  targetKind: 'global',
  targetValue: '',
  enabled: true,
  createdBy: 'u',
  createdAt: '2026-06-02T00:00:00Z',
  updatedAt: '2026-06-02T00:00:00Z',
}

function installFetch(
  handler: (input: RequestInfo, init?: RequestInit) => Promise<Response>,
) {
  const m = vi.fn(handler)
  vi.stubGlobal('fetch', m)
  return m
}

function baseHandler(extra?: (url: string, init?: RequestInit) => Response | null) {
  return async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url === '/api/groups')
      return jsonResponse([{ id: 'grp-1', name: 'prod', createdAt: 't', systemCount: 0 }])
    if (url === '/api/systems') return jsonResponse([{ id: 'sys-1', name: 'web-1' }])
    if (url === '/api/alerts/catalog') return jsonResponse(catalog)
    const e = extra?.(url, init)
    if (e) return e
    return jsonResponse({ error: 'unexpected ' + url }, { status: 500 })
  }
}

describe('AlertModal', () => {
  beforeEach(() => {
    installFetch(baseHandler())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when target is null', () => {
    render(<AlertModal target={null} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens in create mode with metric defaults', async () => {
    render(<AlertModal target="new" onClose={() => {}} onSaved={() => {}} />)
    expect(await screen.findByText(/New alert rule/i)).toBeInTheDocument()
    const threshold = screen.getByLabelText(/Threshold value/i) as HTMLInputElement
    expect(threshold.value).toBe('90')
  })

  it('opens in edit mode prefilled, converting forSeconds to minutes', async () => {
    render(<AlertModal target={sample} onClose={() => {}} onSaved={() => {}} />)
    expect(await screen.findByText(/Edit alert rule: High memory/i)).toBeInTheDocument()
    const name = screen.getByLabelText(/^Name/i) as HTMLInputElement
    expect(name.value).toBe('High memory')
    const forMin = screen.getByLabelText(/For minutes/i) as HTMLInputElement
    expect(forMin.value).toBe('5')
  })

  it('POSTs a metric rule with forSeconds derived from minutes', async () => {
    const fetchMock = installFetch(
      baseHandler((url, init) =>
        url === '/api/alerts' && init?.method === 'POST'
          ? jsonResponse(sample, { status: 201 })
          : null,
      ),
    )
    const onSaved = vi.fn()
    render(<AlertModal target="new" onClose={() => {}} onSaved={onSaved} />)
    await screen.findByText(/New alert rule/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Mem rule' } })
    fireEvent.change(screen.getByLabelText(/For minutes/i), { target: { value: '2' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, opts]) => (opts as RequestInit | undefined)?.method === 'POST',
      )
      expect(post).toBeTruthy()
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body).toMatchObject({
        name: 'Mem rule',
        conditionKind: 'metric',
        metric: 'mem_used_pct',
        comparator: 'gt',
        threshold: 90,
        forSeconds: 120,
      })
      expect(onSaved).toHaveBeenCalled()
    })
  })

  it('omits metric/comparator/threshold for an unreachable rule', async () => {
    const fetchMock = installFetch(
      baseHandler((url, init) =>
        url === '/api/alerts' && init?.method === 'POST'
          ? jsonResponse(sample, { status: 201 })
          : null,
      ),
    )
    render(<AlertModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New alert rule/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Down rule' } })
    fireEvent.click(screen.getByLabelText(/A system is unreachable/i))
    // The threshold field disappears for unreachable.
    expect(screen.queryByLabelText(/Threshold value/i)).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, opts]) => (opts as RequestInit | undefined)?.method === 'POST',
      )
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.conditionKind).toBe('unreachable')
      expect(body.metric).toBeUndefined()
      expect(body.comparator).toBeUndefined()
      expect(body.threshold).toBe(0)
    })
  })

  it('requires a PromQL expression before submit is enabled', async () => {
    render(<AlertModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New alert rule/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Expr rule' } })
    fireEvent.click(screen.getByLabelText(/custom PromQL expression/i))
    expect(screen.getByRole('button', { name: /^Create$/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/PromQL rule expression/i), {
      target: { value: 'node_load1' },
    })
    expect(screen.getByRole('button', { name: /^Create$/i })).toBeEnabled()
  })

  it('PUTs when editing an existing rule', async () => {
    const fetchMock = installFetch(
      baseHandler((url, init) =>
        url === '/api/alerts/rule-1' && init?.method === 'PUT'
          ? jsonResponse(sample)
          : null,
      ),
    )
    render(<AlertModal target={sample} onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/Edit alert rule/i)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Save$/i }))
    })
    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(
        ([, opts]) => (opts as RequestInit | undefined)?.method === 'PUT',
      )
      expect(puts.length).toBe(1)
    })
  })

  it('builds a group target value from the picker', async () => {
    const fetchMock = installFetch(
      baseHandler((url, init) =>
        url === '/api/alerts' && init?.method === 'POST'
          ? jsonResponse(sample, { status: 201 })
          : null,
      ),
    )
    render(<AlertModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New alert rule/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Grp rule' } })
    fireEvent.click(screen.getByLabelText(/A System Group/i))
    fireEvent.click(await screen.findByRole('button', { name: /Choose a group/i }))
    fireEvent.click(await screen.findByText('prod'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, opts]) => (opts as RequestInit | undefined)?.method === 'POST',
      )
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.targetKind).toBe('group')
      expect(body.targetValue).toBe('grp-1')
    })
  })

  it('builds a systems target value from the picker', async () => {
    const fetchMock = installFetch(
      baseHandler((url, init) =>
        url === '/api/alerts' && init?.method === 'POST'
          ? jsonResponse(sample, { status: 201 })
          : null,
      ),
    )
    render(<AlertModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New alert rule/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Sys rule' } })
    fireEvent.click(screen.getByLabelText(/A specific list of systems/i))
    fireEvent.click(await screen.findByRole('button', { name: /Choose systems/i }))
    fireEvent.click(await screen.findByText('web-1'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, opts]) => (opts as RequestInit | undefined)?.method === 'POST',
      )
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.targetKind).toBe('systems')
      expect(JSON.parse(body.targetValue)).toEqual(['sys-1'])
    })
  })

  it('builds a selector target value from the textarea', async () => {
    const fetchMock = installFetch(
      baseHandler((url, init) =>
        url === '/api/alerts' && init?.method === 'POST'
          ? jsonResponse(sample, { status: 201 })
          : null,
      ),
    )
    render(<AlertModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New alert rule/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Sel rule' } })
    fireEvent.click(screen.getByLabelText(/A label selector/i))
    fireEvent.change(screen.getByLabelText(/Label selector expression/i), {
      target: { value: 'env=prod' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, opts]) => (opts as RequestInit | undefined)?.method === 'POST',
      )
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.targetKind).toBe('selector')
      expect(body.targetValue).toBe('env=prod')
    })
  })

  it('changes metric, comparator, and severity via the selects', async () => {
    const fetchMock = installFetch(
      baseHandler((url, init) =>
        url === '/api/alerts' && init?.method === 'POST'
          ? jsonResponse(sample, { status: 201 })
          : null,
      ),
    )
    render(<AlertModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New alert rule/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Picks' } })
    // Metric: Memory Used → Load (1m)
    fireEvent.click(await screen.findByRole('button', { name: /Memory Used/i }))
    fireEvent.click(await screen.findByText(/Load \(1m\)/i))
    // Comparator: above → below
    fireEvent.click(screen.getByRole('button', { name: /is above/i }))
    fireEvent.click(await screen.findByText(/is below/i))
    // Severity: Warning → Critical
    fireEvent.click(screen.getByRole('button', { name: /Warning/i }))
    fireEvent.click(await screen.findByText('Critical'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, opts]) => (opts as RequestInit | undefined)?.method === 'POST',
      )
      const body = JSON.parse(String((post![1] as RequestInit).body))
      expect(body.metric).toBe('load1')
      expect(body.comparator).toBe('lt')
      expect(body.severity).toBe('critical')
    })
  })

  it('disables submit when the threshold is not a number', async () => {
    render(<AlertModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New alert rule/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Bad threshold' } })
    fireEvent.change(screen.getByLabelText(/Threshold value/i), { target: { value: '' } })
    expect(screen.getByRole('button', { name: /^Create$/i })).toBeDisabled()
  })

  it('surfaces a save error inline', async () => {
    installFetch(
      baseHandler((url, init) =>
        url === '/api/alerts' && init?.method === 'POST'
          ? jsonResponse({ error: 'threshold must be finite' }, { status: 400 })
          : null,
      ),
    )
    render(<AlertModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New alert rule/i)
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Bad' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Create$/i }))
    })
    expect(await screen.findByText(/threshold must be finite/i)).toBeInTheDocument()
  })
})
