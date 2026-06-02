// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAlertRule,
  deleteAlertRule,
  listActiveAlerts,
  listAlertCatalog,
  listAlertRules,
  updateAlertRule,
  type AlertRule,
  type AlertRuleInput,
} from './alerts'
import { ApiError } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const sampleRule: AlertRule = {
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
  createdBy: 'user-1',
  createdAt: '2026-06-02T12:00:00Z',
  updatedAt: '2026-06-02T12:00:00Z',
}

const sampleInput: AlertRuleInput = {
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
}

describe('alerts api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listAlertRules returns the array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([sampleRule]))
    const got = await listAlertRules()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/alerts')
    expect(got[0].id).toBe('rule-1')
  })

  it('listAlertRules throws ApiError on 500', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    await expect(listAlertRules()).rejects.toBeInstanceOf(ApiError)
  })

  it('listAlertRules falls back to status text without an error body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 503 }))
    await expect(listAlertRules()).rejects.toThrow(/503|Service/)
  })

  it('createAlertRule POSTs the input', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleRule, { status: 201 }))
    const got = await createAlertRule(sampleInput)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/alerts')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ name: 'High memory' })
    expect(got.id).toBe('rule-1')
  })

  it('createAlertRule throws on 400', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, { status: 400 }))
    await expect(createAlertRule(sampleInput)).rejects.toBeInstanceOf(ApiError)
  })

  it('updateAlertRule PUTs to the id path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sampleRule))
    await updateAlertRule('rule-1', sampleInput)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/alerts/rule-1')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
  })

  it('updateAlertRule throws on 403', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, { status: 403 }))
    await expect(updateAlertRule('rule-1', sampleInput)).rejects.toBeInstanceOf(ApiError)
  })

  it('deleteAlertRule DELETEs the id path', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteAlertRule('rule-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/alerts/rule-1')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('deleteAlertRule throws on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'gone' }, { status: 404 }))
    await expect(deleteAlertRule('rule-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('listActiveAlerts returns active instances', async () => {
    const active = [{ ruleId: 'rule-1', systemId: 'sys-1', state: 'firing' }]
    fetchMock.mockResolvedValueOnce(jsonResponse(active))
    const got = await listActiveAlerts()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/alerts/active')
    expect(got[0].systemId).toBe('sys-1')
  })

  it('listActiveAlerts throws on 500', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    await expect(listActiveAlerts()).rejects.toBeInstanceOf(ApiError)
  })

  it('listAlertCatalog returns catalog entries', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ metric: 'mem_used_pct', label: 'Memory Used', unit: '%' }]),
    )
    const got = await listAlertCatalog()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/alerts/catalog')
    expect(got[0].metric).toBe('mem_used_pct')
  })

  it('listAlertCatalog throws on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, { status: 401 }))
    await expect(listAlertCatalog()).rejects.toBeInstanceOf(ApiError)
  })
})
