// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listScheduleRuns,
  listSchedules,
  runScheduleNow,
  updateSchedule,
  type Schedule,
  type ScheduleInput,
} from './schedules'
import { ApiError } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const sampleSchedule: Schedule = {
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
  createdBy: 'user-1',
  createdAt: '2026-05-31T12:00:00Z',
  updatedAt: '2026-05-31T12:00:00Z',
}

const sampleInput: ScheduleInput = {
  name: 'Nightly check',
  cronExpr: '0 3 * * *',
  timezone: 'UTC',
  runCheck: true,
  runApply: false,
  rebootAfterApply: false,
  targetKind: 'global',
  targetValue: '',
  enabled: true,
}

describe('schedules api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listSchedules returns the array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([sampleSchedule]))
    const got = await listSchedules()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/schedules')
    expect(got[0].id).toBe('sch-1')
  })

  it('listSchedules throws on 500', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'boom' }, { status: 500 }),
    )
    await expect(listSchedules()).rejects.toBeInstanceOf(ApiError)
  })

  it('getSchedule URL-encodes the id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleSchedule))
    await getSchedule('a/b c')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/schedules/a%2Fb%20c')
  })

  it('createSchedule posts JSON and returns the row', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(sampleSchedule, { status: 201 }),
    )
    const out = await createSchedule(sampleInput)
    expect(out.id).toBe('sch-1')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toContain('"cronExpr":"0 3 * * *"')
  })

  it('createSchedule surfaces validation errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid cron' }, { status: 400 }),
    )
    await expect(createSchedule(sampleInput)).rejects.toThrow(/invalid cron/)
  })

  it('updateSchedule PUTs to the right URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleSchedule))
    await updateSchedule('sch-1', sampleInput)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/schedules/sch-1')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PUT')
  })

  it('deleteSchedule DELETEs', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteSchedule('sch-1')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('DELETE')
  })

  it('listScheduleRuns includes the limit query param when provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listScheduleRuns('sch-1', 5)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/schedules/sch-1/runs?limit=5')
  })

  it('listScheduleRuns omits the limit when not provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listScheduleRuns('sch-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/schedules/sch-1/runs')
  })

  it('runScheduleNow POSTs and resolves on 202', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }))
    await runScheduleNow('sch-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/schedules/sch-1/run-now')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST')
  })

  it('runScheduleNow raises ApiError on 503', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'runtime down' }, { status: 503 }),
    )
    await expect(runScheduleNow('sch-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('deleteSchedule surfaces non-empty bodies on error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'forbidden' }, { status: 403 }),
    )
    await expect(deleteSchedule('sch-1')).rejects.toThrow(/forbidden/)
  })

  it('falls back to statusText when the error body has no message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('garbage-not-json', { status: 503 }),
    )
    await expect(listSchedules()).rejects.toThrow(/HTTP 503|Service Unavailable/)
  })
})
