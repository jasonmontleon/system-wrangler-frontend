// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SchedulesPage from './SchedulesPage'
import type { Schedule } from '../api/schedules'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const sample: Schedule = {
  id: 'sch-1',
  name: 'Nightly check',
  cronExpr: '0 3 * * *',
  timezone: 'UTC',
  runCheck: true,
  runApply: false,
  rebootAfterApply: false,
  targetKind: 'global',
  targetValue: '',
  enabled: true,
  lastRunAt: '2026-05-30T03:00:00Z',
  lastStatus: 'success',
  nextRunAt: '2026-06-01T03:00:00Z',
  createdBy: 'user-1',
  createdAt: '2026-05-15T00:00:00Z',
  updatedAt: '2026-05-15T00:00:00Z',
}

type FetchHandler = (input: RequestInfo, init?: RequestInit) => Promise<Response>

function installFetch(handler: FetchHandler) {
  const m = vi.fn(handler)
  vi.stubGlobal('fetch', m)
  return m
}

describe('SchedulesPage', () => {
  beforeEach(() => {
    // window.confirm defaults to false in jsdom; stub it to true so
    // the delete path runs.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('lists existing schedules', async () => {
    installFetch(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/schedules') return jsonResponse([sample])
      return jsonResponse({ error: 'unexpected ' + url }, { status: 500 })
    })
    render(<SchedulesPage />)
    expect(await screen.findByText('Nightly check')).toBeInTheDocument()
    expect(screen.getByText('0 3 * * *')).toBeInTheDocument()
    expect(screen.getByText(/every system/i)).toBeInTheDocument()
  })

  it('shows the empty-state alert when there are no schedules', async () => {
    installFetch(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/schedules') return jsonResponse([])
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })
    render(<SchedulesPage />)
    expect(await screen.findByText(/No schedules yet/i)).toBeInTheDocument()
  })

  it('surfaces a load error', async () => {
    installFetch(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/schedules')
        return jsonResponse({ error: 'forbidden' }, { status: 403 })
      return jsonResponse({}, { status: 500 })
    })
    render(<SchedulesPage />)
    expect(await screen.findByText(/Could not load schedules/i)).toBeInTheDocument()
  })

  it('deletes a schedule when the kebab Delete is confirmed', async () => {
    const fetchMock = installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/schedules' && (!init || init.method !== 'DELETE'))
        return jsonResponse([sample])
      if (url === '/api/schedules/sch-1' && init?.method === 'DELETE')
        return new Response(null, { status: 204 })
      return jsonResponse({}, { status: 500 })
    })
    render(<SchedulesPage />)
    await screen.findByText('Nightly check')
    // Open the kebab on the row, click Delete.
    const kebab = screen.getByRole('button', { name: /kebab/i })
    await act(async () => {
      fireEvent.click(kebab)
    })
    const del = await screen.findByRole('menuitem', { name: /^delete$/i })
    await act(async () => {
      fireEvent.click(del)
    })
    await waitFor(() => {
      const deleteCalls = fetchMock.mock.calls.filter(
        ([, opts]) => (opts as RequestInit | undefined)?.method === 'DELETE',
      )
      expect(deleteCalls.length).toBe(1)
    })
  })

  it('fires the run-now endpoint from the kebab', async () => {
    const fetchMock = installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/schedules' && (!init || init.method !== 'POST'))
        return jsonResponse([sample])
      if (url === '/api/schedules/sch-1/run-now')
        return new Response(null, { status: 202 })
      return jsonResponse({}, { status: 500 })
    })
    render(<SchedulesPage />)
    await screen.findByText('Nightly check')
    const kebab = screen.getByRole('button', { name: /kebab/i })
    await act(async () => {
      fireEvent.click(kebab)
    })
    const runNow = await screen.findByRole('menuitem', { name: /run now/i })
    await act(async () => {
      fireEvent.click(runNow)
    })
    await waitFor(() => {
      const hits = fetchMock.mock.calls.filter(
        ([u]) => String(u) === '/api/schedules/sch-1/run-now',
      )
      expect(hits.length).toBe(1)
    })
  })

  it('toggles the enabled switch by PUT-ing the row', async () => {
    const fetchMock = installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/schedules' && (!init || init.method !== 'PUT'))
        return jsonResponse([sample])
      if (url === '/api/schedules/sch-1' && init?.method === 'PUT')
        return jsonResponse({ ...sample, enabled: false })
      return jsonResponse({}, { status: 500 })
    })
    render(<SchedulesPage />)
    await screen.findByText('Nightly check')
    const sw = screen.getByRole('switch', { name: /toggle nightly check/i })
    await act(async () => {
      fireEvent.click(sw)
    })
    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(
        ([, opts]) => (opts as RequestInit | undefined)?.method === 'PUT',
      )
      expect(puts.length).toBe(1)
      expect(puts[0][1] && (puts[0][1] as RequestInit).body).toContain('"enabled":false')
    })
  })

  it('describes a group target', async () => {
    installFetch(async () => jsonResponse([{ ...sample, targetKind: 'group', targetValue: 'grp-1' }]))
    render(<SchedulesPage />)
    expect(await screen.findByText('grp-1')).toBeInTheDocument()
  })

  it('describes a selector target', async () => {
    installFetch(async () =>
      jsonResponse([{ ...sample, targetKind: 'selector', targetValue: 'env=prod' }]),
    )
    render(<SchedulesPage />)
    expect(await screen.findByText('env=prod')).toBeInTheDocument()
  })

  it('renders the partial-status label color', async () => {
    installFetch(async () => jsonResponse([{ ...sample, lastStatus: 'partial' }]))
    render(<SchedulesPage />)
    expect(await screen.findByText('partial')).toBeInTheDocument()
  })

  it('renders the failed-status label color', async () => {
    installFetch(async () => jsonResponse([{ ...sample, lastStatus: 'failed' }]))
    render(<SchedulesPage />)
    expect(await screen.findByText('failed')).toBeInTheDocument()
  })

  it('renders the running-status label color', async () => {
    installFetch(async () => jsonResponse([{ ...sample, lastStatus: 'running' }]))
    render(<SchedulesPage />)
    expect(await screen.findByText('running')).toBeInTheDocument()
  })

  it('renders "never" when the schedule has never run', async () => {
    installFetch(async () =>
      jsonResponse([{ ...sample, lastRunAt: undefined, lastStatus: undefined, nextRunAt: undefined }]),
    )
    render(<SchedulesPage />)
    expect(await screen.findByText(/never/i)).toBeInTheDocument()
  })

  it('describes a pinned systems list count', async () => {
    installFetch(async () =>
      jsonResponse([{ ...sample, targetKind: 'systems', targetValue: '["a","b","c"]' }]),
    )
    render(<SchedulesPage />)
    expect(await screen.findByText('3 systems')).toBeInTheDocument()
  })

  it('reports a delete failure as an inline error', async () => {
    installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/schedules' && (!init || init.method !== 'DELETE'))
        return jsonResponse([sample])
      if (url === '/api/schedules/sch-1' && init?.method === 'DELETE')
        return jsonResponse({ error: 'forbidden' }, { status: 403 })
      return jsonResponse({}, { status: 500 })
    })
    render(<SchedulesPage />)
    await screen.findByText('Nightly check')
    const kebab = screen.getByRole('button', { name: /kebab/i })
    await act(async () => {
      fireEvent.click(kebab)
    })
    const del = await screen.findByRole('menuitem', { name: /^delete$/i })
    await act(async () => {
      fireEvent.click(del)
    })
    expect(await screen.findByText(/Action failed/i)).toBeInTheDocument()
  })
})
