// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScheduleRunsModal from './ScheduleRunsModal'
import type { Schedule, ScheduleRun } from '../api/schedules'

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
  runApply: false,
  rebootAfterApply: false,
  targetKind: 'global',
  targetValue: '',
  enabled: true,
  createdBy: 'u',
  createdAt: '2026-05-15T00:00:00Z',
  updatedAt: '2026-05-15T00:00:00Z',
}

const sampleRun: ScheduleRun = {
  id: 'run-1',
  scheduleId: 'sch-1',
  startedAt: '2026-05-30T03:00:00Z',
  finishedAt: '2026-05-30T03:01:00Z',
  status: 'success',
  targetsAttempted: 3,
  targetsSucceeded: 3,
  targetsFailed: 0,
  message: '3/3 hosts ok',
}

function installFetch(handler: (input: RequestInfo) => Promise<Response>) {
  const m = vi.fn(handler)
  vi.stubGlobal('fetch', m)
  return m
}

describe('ScheduleRunsModal', () => {
  beforeEach(() => {})
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders nothing when schedule is null', () => {
    render(<ScheduleRunsModal schedule={null} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the run history table when runs exist', async () => {
    installFetch(async () => jsonResponse([sampleRun]))
    render(<ScheduleRunsModal schedule={sample} onClose={() => {}} />)
    expect(await screen.findByText('3/3 hosts ok')).toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()
  })

  it('shows the empty-state alert when no runs exist yet', async () => {
    installFetch(async () => jsonResponse([]))
    render(<ScheduleRunsModal schedule={sample} onClose={() => {}} />)
    expect(await screen.findByText(/No runs yet/i)).toBeInTheDocument()
  })

  it('surfaces a load error', async () => {
    installFetch(async () => jsonResponse({ error: 'forbidden' }, { status: 403 }))
    render(<ScheduleRunsModal schedule={sample} onClose={() => {}} />)
    expect(await screen.findByText(/Could not load runs/i)).toBeInTheDocument()
  })

  it('renders partial-status with the orange label', async () => {
    installFetch(async () =>
      jsonResponse([
        { ...sampleRun, id: 'run-2', status: 'partial', message: '1/2 hosts ok' },
      ]),
    )
    render(<ScheduleRunsModal schedule={sample} onClose={() => {}} />)
    expect(await screen.findByText('1/2 hosts ok')).toBeInTheDocument()
    expect(screen.getByText('Partial')).toBeInTheDocument()
  })
})
