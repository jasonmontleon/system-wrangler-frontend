// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SettingsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the run_history_limit and update_concurrency_limit values', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        settings: {
          run_history_limit: '250',
          update_concurrency_limit: '6',
          probe_interval_seconds: '30',
          probe_failure_threshold: '1',
          probe_success_threshold: '1',
        },
      }),
    )
    render(<SettingsPage />)
    const retention = (await screen.findByLabelText(
      /Per-system row cap/i,
    )) as HTMLInputElement
    expect(retention.value).toBe('250')
    const concurrency = (await screen.findByLabelText(
      /Simultaneous check \/ update runs/i,
    )) as HTMLInputElement
    expect(concurrency.value).toBe('6')
  })

  it('PUTs the new run_history_limit on Save and shows the success alert', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '4' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '500', update_concurrency_limit: '4' },
        }),
      )

    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Per-system row cap/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '500' } })
    // Two Save buttons render — the first belongs to the retention card.
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[0])

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put?.[0]).toBe('/api/admin/settings/run_history_limit')
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        value: '500',
      })
    })
    expect(await screen.findByText(/^Saved$/i)).toBeInTheDocument()
  })

  it('PUTs the new update_concurrency_limit on Save', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '4' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '8' },
        }),
      )

    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Simultaneous check \/ update runs/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '8' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[1])

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put?.[0]).toBe('/api/admin/settings/update_concurrency_limit')
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        value: '8',
      })
    })
    expect(await screen.findByText(/^Saved$/i)).toBeInTheDocument()
  })

  it('surfaces a 400 error from the backend without losing the input', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '4' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'run_history_limit must be between 1 and 10000' },
          400,
        ),
      )

    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Per-system row cap/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[0])

    expect(
      await screen.findByText(/must be between 1 and 10000/i),
    ).toBeInTheDocument()
    expect(input.value).toBe('0')
  })

  it('surfaces a 400 error from update_concurrency_limit save', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '4' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: 'concurrency must be between 1 and 64' }, 400),
      )
    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Simultaneous check \/ update runs/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[1])
    expect(
      await screen.findByText(/concurrency must be between 1 and 64/i),
    ).toBeInTheDocument()
    expect(input.value).toBe('0')
  })

  it('resyncs the input when the parent passes a different value after save', async () => {
    // First load returns 100; user types 250; Save returns 204; the
    // refresh after save returns 500 (server normalized). The input
    // must reflect the server's authoritative value, not the user's
    // typed 250 — that's what the value-vs-input useEffect guards.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '100', update_concurrency_limit: '4' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          settings: { run_history_limit: '500', update_concurrency_limit: '4' },
        }),
      )
    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Per-system row cap/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '250' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/i })[0])
    await waitFor(() => {
      expect(input.value).toBe('500')
    })
  })

  it('renders the three reachability probe settings', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        settings: {
          run_history_limit: '100',
          update_concurrency_limit: '4',
          probe_interval_seconds: '45',
          probe_failure_threshold: '3',
          probe_success_threshold: '2',
        },
      }),
    )
    render(<SettingsPage />)
    const interval = (await screen.findByLabelText(
      /Seconds between probe cycles/i,
    )) as HTMLInputElement
    expect(interval.value).toBe('45')
    const failure = (await screen.findByLabelText(
      /Consecutive failures before Unreachable/i,
    )) as HTMLInputElement
    expect(failure.value).toBe('3')
    const success = (await screen.findByLabelText(
      /Consecutive successes before Reachable/i,
    )) as HTMLInputElement
    expect(success.value).toBe('2')
  })

  it.each([
    {
      label: /Seconds between probe cycles/i,
      key: 'probe_interval_seconds',
      typed: '60',
    },
    {
      label: /Consecutive failures before Unreachable/i,
      key: 'probe_failure_threshold',
      typed: '3',
    },
    {
      label: /Consecutive successes before Reachable/i,
      key: 'probe_success_threshold',
      typed: '5',
    },
  ])('PUTs $key on Save', async ({ label, key, typed }) => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            run_history_limit: '100',
            update_concurrency_limit: '4',
            probe_interval_seconds: '30',
            probe_failure_threshold: '1',
            probe_success_threshold: '1',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            run_history_limit: '100',
            update_concurrency_limit: '4',
            probe_interval_seconds: '30',
            probe_failure_threshold: '1',
            probe_success_threshold: '1',
            [key]: typed,
          },
        }),
      )

    render(<SettingsPage />)
    const input = (await screen.findByLabelText(label)) as HTMLInputElement
    fireEvent.change(input, { target: { value: typed } })
    // The submit button inside the same Card form fires the matching
    // setter — query within the input's enclosing form to avoid
    // grabbing a Save from a sibling card.
    const form = input.closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put?.[0]).toBe(`/api/admin/settings/${key}`)
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        value: typed,
      })
    })
  })

  it('surfaces a 400 error from a probe-setting save without losing input', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            run_history_limit: '100',
            update_concurrency_limit: '4',
            probe_interval_seconds: '30',
            probe_failure_threshold: '1',
            probe_success_threshold: '1',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'probe_interval_seconds must be between 5 and 3600' },
          400,
        ),
      )
    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Seconds between probe cycles/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.submit(input.closest('form')!)
    expect(
      await screen.findByText(/probe_interval_seconds must be between/i),
    ).toBeInTheDocument()
    expect(input.value).toBe('1')
  })

  it('renders the schedule misfire grace value', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        settings: {
          run_history_limit: '100',
          update_concurrency_limit: '4',
          schedule_misfire_grace_seconds: '300',
        },
      }),
    )
    render(<SettingsPage />)
    const grace = (await screen.findByLabelText(
      /Seconds a run may slip before it is skipped/i,
    )) as HTMLInputElement
    expect(grace.value).toBe('300')
  })

  it('PUTs schedule_misfire_grace_seconds on Save', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            run_history_limit: '100',
            update_concurrency_limit: '4',
            schedule_misfire_grace_seconds: '120',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            run_history_limit: '100',
            update_concurrency_limit: '4',
            schedule_misfire_grace_seconds: '600',
          },
        }),
      )
    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Seconds a run may slip before it is skipped/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '600' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PUT',
      )
      expect(put?.[0]).toBe(
        '/api/admin/settings/schedule_misfire_grace_seconds',
      )
      expect(JSON.parse((put?.[1] as RequestInit).body as string)).toEqual({
        value: '600',
      })
    })
    expect(await screen.findByText(/^Saved$/i)).toBeInTheDocument()
  })

  it('surfaces a 400 error from the misfire grace save without losing input', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          settings: {
            run_history_limit: '100',
            update_concurrency_limit: '4',
            schedule_misfire_grace_seconds: '120',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'schedule_misfire_grace_seconds must be between 60 and 3600' },
          400,
        ),
      )
    render(<SettingsPage />)
    const input = (await screen.findByLabelText(
      /Seconds a run may slip before it is skipped/i,
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '30' } })
    fireEvent.submit(input.closest('form')!)
    expect(
      await screen.findByText(
        /schedule_misfire_grace_seconds must be between 60 and 3600/i,
      ),
    ).toBeInTheDocument()
    expect(input.value).toBe('30')
  })

  it('shows a load error if /api/admin/settings fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
    render(<SettingsPage />)
    expect(
      await screen.findByText(/Failed to load settings/i),
    ).toBeInTheDocument()
  })
})
