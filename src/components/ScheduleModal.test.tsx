// SPDX-License-Identifier: Apache-2.0

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScheduleModal from './ScheduleModal'
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
  name: 'Nightly',
  cronExpr: '0 3 * * *',
  timezone: 'UTC',
  runCheck: true,
  runApply: true,
  rebootAfterApply: false,
  targetKind: 'global',
  targetValue: '',
  enabled: true,
  createdBy: 'u',
  createdAt: '2026-05-15T00:00:00Z',
  updatedAt: '2026-05-15T00:00:00Z',
}

function installFetch(handler: (input: RequestInfo, init?: RequestInit) => Promise<Response>) {
  const m = vi.fn(handler)
  vi.stubGlobal('fetch', m)
  return m
}

describe('ScheduleModal', () => {
  beforeEach(() => {
    installFetch(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/groups')
        return jsonResponse([{ id: 'grp-1', name: 'prod', createdAt: 't', systemCount: 0 }])
      if (url === '/api/systems')
        return jsonResponse([{ id: 'sys-1', name: 'web-1' }])
      return jsonResponse({ error: 'unexpected ' + url }, { status: 500 })
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when target is null', () => {
    render(<ScheduleModal target={null} onClose={() => {}} onSaved={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens in create mode with the daily-at-3am defaults', async () => {
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    expect(await screen.findByText(/New schedule/i)).toBeInTheDocument()
    const cron = screen.getByLabelText(/Cron expression/i) as HTMLInputElement
    expect(cron.value).toBe('0 3 * * *')
  })

  it('opens in edit mode with the existing values', async () => {
    render(<ScheduleModal target={sample} onClose={() => {}} onSaved={() => {}} />)
    expect(await screen.findByText(/Edit schedule: Nightly/i)).toBeInTheDocument()
    const name = screen.getByLabelText(/Name/i) as HTMLInputElement
    expect(name.value).toBe('Nightly')
    const cron = screen.getByLabelText(/Cron expression/i) as HTMLInputElement
    expect(cron.value).toBe('0 3 * * *')
  })

  it('POSTs createSchedule with the form payload', async () => {
    const fetchMock = installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/groups') return jsonResponse([])
      if (url === '/api/systems') return jsonResponse([])
      if (url === '/api/schedules' && init?.method === 'POST')
        return jsonResponse(sample, { status: 201 })
      return jsonResponse({ error: 'unexpected ' + url }, { status: 500 })
    })
    const onSaved = vi.fn()
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={onSaved} />)
    await screen.findByText(/New schedule/i)
    const name = screen.getByLabelText(/Name/i) as HTMLInputElement
    fireEvent.change(name, { target: { value: 'My schedule' } })
    const create = screen.getByRole('button', { name: /^Create$/i })
    await act(async () => {
      fireEvent.click(create)
    })
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        ([, opts]) =>
          (opts as RequestInit | undefined)?.method === 'POST' &&
          String((opts as RequestInit).body ?? '').includes('"name":"My schedule"'),
      )
      expect(posts.length).toBe(1)
      expect(onSaved).toHaveBeenCalled()
    })
  })

  it('PUTs updateSchedule when editing an existing row', async () => {
    const fetchMock = installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/groups') return jsonResponse([])
      if (url === '/api/systems') return jsonResponse([])
      if (url === '/api/schedules/sch-1' && init?.method === 'PUT')
        return jsonResponse(sample)
      return jsonResponse({ error: 'unexpected ' + url }, { status: 500 })
    })
    render(<ScheduleModal target={sample} onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/Edit schedule/)
    const save = screen.getByRole('button', { name: /^Save$/i })
    await act(async () => {
      fireEvent.click(save)
    })
    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(
        ([, opts]) => (opts as RequestInit | undefined)?.method === 'PUT',
      )
      expect(puts.length).toBe(1)
    })
  })

  it('disables Save when name is empty', async () => {
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    const create = screen.getByRole('button', { name: /^Create$/i })
    expect(create).toBeDisabled()
  })

  it('disables Save when no action is selected', async () => {
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    const name = screen.getByLabelText(/Name/i)
    fireEvent.change(name, { target: { value: 'x' } })
    const check = screen.getByLabelText(/Run check on every targeted system/i)
    fireEvent.click(check)
    const create = screen.getByRole('button', { name: /^Create$/i })
    expect(create).toBeDisabled()
  })

  it('grays reboot until apply is enabled', async () => {
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    const reboot = screen.getByLabelText(/Reboot any system/i) as HTMLInputElement
    expect(reboot.disabled).toBe(true)
    const apply = screen.getByLabelText(/Run apply on every targeted system/i)
    fireEvent.click(apply)
    expect((screen.getByLabelText(/Reboot any system/i) as HTMLInputElement).disabled).toBe(false)
  })

  it('switches preset to custom when the cron field is edited', async () => {
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    const cron = screen.getByLabelText(/Cron expression/i)
    fireEvent.change(cron, { target: { value: '*/15 * * * *' } })
    expect((cron as HTMLInputElement).value).toBe('*/15 * * * *')
  })

  it('switches to a group target and requires the group id', async () => {
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'x' } })
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/A System Group/i))
    })
    const create = screen.getByRole('button', { name: /^Create$/i })
    expect(create).toBeDisabled()
  })

  it('hourly preset rewrites the cron expression on minute change', async () => {
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    const presetToggle = screen.getByRole('button', { name: /daily|frequency/i })
    await act(async () => {
      fireEvent.click(presetToggle)
    })
    const hourly = await screen.findByText(/^Hourly$/i)
    await act(async () => {
      fireEvent.click(hourly)
    })
    const minute = await screen.findByLabelText(/^Minute$/i)
    fireEvent.change(minute, { target: { value: '30' } })
    const cron = screen.getByLabelText(/Cron expression/i) as HTMLInputElement
    expect(cron.value).toBe('30 * * * *')
  })

  it('weekly preset compiles hour+minute+dow into cron', async () => {
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    const presetToggle = screen.getByRole('button', { name: /daily|frequency/i })
    await act(async () => {
      fireEvent.click(presetToggle)
    })
    const weekly = await screen.findByText(/^Weekly$/i)
    await act(async () => {
      fireEvent.click(weekly)
    })
    const hour = await screen.findByLabelText(/^Hour$/i)
    fireEvent.change(hour, { target: { value: '6' } })
    const minute = await screen.findByLabelText(/^Minute$/i)
    fireEvent.change(minute, { target: { value: '15' } })
    const dow = screen.getByLabelText(/Day of week/i)
    fireEvent.change(dow, { target: { value: '1' } })
    const cron = screen.getByLabelText(/Cron expression/i) as HTMLInputElement
    expect(cron.value).toBe('15 6 * * 1')
  })

  it('daily preset hour input rejects out-of-range values', async () => {
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    const hour = screen.getByLabelText(/^Hour$/i) as HTMLInputElement
    fireEvent.change(hour, { target: { value: '99' } })
    // The handler ignores >23 silently — the cron stays at the daily
    // default for hour=3.
    const cron = screen.getByLabelText(/Cron expression/i) as HTMLInputElement
    expect(cron.value).toBe('0 3 * * *')
  })

  it('switches to systems target and toggles selections', async () => {
    installFetch(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/groups') return jsonResponse([])
      if (url === '/api/systems')
        return jsonResponse([
          { id: 'sys-1', name: 'web-1' },
          { id: 'sys-2', name: 'web-2' },
        ])
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'x' } })
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/A specific list of systems/i))
    })
    // Open the system multi-select.
    const toggle = await screen.findByRole('button', { name: /choose systems/i })
    await act(async () => {
      fireEvent.click(toggle)
    })
    const opt = await screen.findByText(/web-1/i)
    await act(async () => {
      fireEvent.click(opt)
    })
    // The toggle now reflects the selection count.
    expect(await screen.findByRole('button', { name: /1 system selected/i })).toBeInTheDocument()
  })

  it('switches to selector target', async () => {
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/A label selector/i))
    })
    const ta = screen.getByLabelText(/Label selector expression/i) as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'env=prod' } })
    expect(ta.value).toBe('env=prod')
  })

  it('preloads an edit-mode schedule whose target is a label selector', async () => {
    render(
      <ScheduleModal
        target={{ ...sample, targetKind: 'selector', targetValue: 'env=prod' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(await screen.findByLabelText(/Label selector expression/i)).toHaveValue('env=prod')
  })

  it('preloads an edit-mode schedule whose target is a systems list', async () => {
    render(
      <ScheduleModal
        target={{ ...sample, targetKind: 'systems', targetValue: '["a","b"]' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(await screen.findByRole('button', { name: /2 systems selected/i })).toBeInTheDocument()
  })

  it('preloads an edit-mode schedule whose target is a group', async () => {
    render(
      <ScheduleModal
        target={{ ...sample, targetKind: 'group', targetValue: 'grp-1' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    // The group select toggle shows the group name once groups load.
    expect(await screen.findByRole('button', { name: /prod|grp-1/i })).toBeInTheDocument()
  })

  it('falls back to the group id when the chosen group is not in the inventory', async () => {
    render(
      <ScheduleModal
        target={{ ...sample, targetKind: 'group', targetValue: 'missing-id' }}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    )
    expect(await screen.findByRole('button', { name: /missing-id/i })).toBeInTheDocument()
  })

  it('surfaces an API error inline on submit failure', async () => {
    installFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/groups') return jsonResponse([])
      if (url === '/api/systems') return jsonResponse([])
      if (url === '/api/schedules' && init?.method === 'POST')
        return jsonResponse({ error: 'invalid cron' }, { status: 400 })
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    })
    render(<ScheduleModal target="new" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/New schedule/i)
    fireEvent.change(screen.getByLabelText(/Name/i), { target: { value: 'x' } })
    const create = screen.getByRole('button', { name: /^Create$/i })
    await act(async () => {
      fireEvent.click(create)
    })
    expect(await screen.findByText(/Could not save schedule/i)).toBeInTheDocument()
    expect(screen.getByText(/invalid cron/i)).toBeInTheDocument()
  })
})
