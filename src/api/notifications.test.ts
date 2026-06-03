// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createChannel,
  createMyChannel,
  deleteChannel,
  deleteMyChannel,
  getMyPolicy,
  getMySubscription,
  getPolicy,
  getRouting,
  listChannels,
  listDeliveries,
  listMyChannels,
  listMyDeliveries,
  setMyPolicy,
  setMySubscription,
  setPolicy,
  setRouting,
  testChannel,
  testMyChannel,
  updateChannel,
  updateMyChannel,
  type AlertSubscription,
  type NotificationChannel,
  type NotificationChannelInput,
  type NotificationPolicy,
} from './notifications'
import { ApiError } from './systems'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const sample: NotificationChannel = {
  id: 'ch-1',
  name: 'Ops Slack',
  type: 'slack',
  enabled: true,
  config: {},
  hasSecret: true,
  createdBy: 'u',
  createdAt: '2026-06-02T00:00:00Z',
  updatedAt: '2026-06-02T00:00:00Z',
}

const input: NotificationChannelInput = {
  name: 'Ops Slack',
  type: 'slack',
  enabled: true,
  config: {},
  secret: 'https://hooks.slack.com/services/x',
}

describe('notifications api', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listChannels returns the array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([sample]))
    const got = await listChannels()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/channels')
    expect(got[0].id).toBe('ch-1')
  })

  it('listChannels throws on 403', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, { status: 403 }))
    await expect(listChannels()).rejects.toBeInstanceOf(ApiError)
  })

  it('listChannels falls back to status text without an error body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 500 }))
    await expect(listChannels()).rejects.toThrow(/500|Internal/)
  })

  it('createChannel POSTs the input', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sample, { status: 201 }))
    const got = await createChannel(input)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/channels')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ type: 'slack' })
    expect(got.id).toBe('ch-1')
  })

  it('createChannel throws on 400', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, { status: 400 }))
    await expect(createChannel(input)).rejects.toBeInstanceOf(ApiError)
  })

  it('updateChannel PUTs to the id path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sample))
    await updateChannel('ch-1', input)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/channels/ch-1')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
  })

  it('updateChannel throws on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'gone' }, { status: 404 }))
    await expect(updateChannel('ch-1', input)).rejects.toBeInstanceOf(ApiError)
  })

  it('deleteChannel DELETEs', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteChannel('ch-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/channels/ch-1')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('deleteChannel throws on 500', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 }))
    await expect(deleteChannel('ch-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('testChannel POSTs to the test path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const got = await testChannel('ch-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/channels/ch-1/test')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(got.ok).toBe(true)
  })

  it('testChannel throws on 503', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no runtime' }, { status: 503 }))
    await expect(testChannel('ch-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('listDeliveries returns rows and honors limit', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'd1' }]))
    await listDeliveries(25)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/deliveries?limit=25')
  })

  it('listDeliveries without a limit hits the bare path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listDeliveries()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/deliveries')
  })

  it('listDeliveries throws on 403', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, { status: 403 }))
    await expect(listDeliveries()).rejects.toBeInstanceOf(ApiError)
  })

  it('getRouting returns the rows', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ ruleId: 'r1', mode: 'selected', channelIds: ['c1'] }]),
    )
    const got = await getRouting()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/routing')
    expect(got[0].ruleId).toBe('r1')
  })

  it('getRouting throws on 403', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, { status: 403 }))
    await expect(getRouting()).rejects.toBeInstanceOf(ApiError)
  })

  it('setRouting PUTs the input to the rule path', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ruleId: 'r 1', mode: 'all', channelIds: null }),
    )
    const got = await setRouting('r 1', { mode: 'all' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/routing/r%201')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ mode: 'all' })
    expect(got.mode).toBe('all')
  })

  it('setRouting throws on 400', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, { status: 400 }))
    await expect(setRouting('r1', { mode: 'selected', channelIds: [] })).rejects.toBeInstanceOf(
      ApiError,
    )
  })

  const policy: NotificationPolicy = {
    timezone: 'UTC',
    windows: [{ days: [1, 2], start: '22:00', end: '08:00' }],
    severities: { warning: 'always' },
  }

  it('getPolicy returns the policy', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(policy))
    const got = await getPolicy()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/policy')
    expect(got.severities.warning).toBe('always')
  })

  it('getPolicy throws on 403', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, { status: 403 }))
    await expect(getPolicy()).rejects.toBeInstanceOf(ApiError)
  })

  it('setPolicy PUTs the policy', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(policy))
    await setPolicy(policy)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/policy')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ timezone: 'UTC' })
  })

  it('setPolicy throws on 400', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad tz' }, { status: 400 }))
    await expect(setPolicy(policy)).rejects.toBeInstanceOf(ApiError)
  })

  // --- self-service (/me) ---

  it('listMyChannels hits the me path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([sample]))
    const got = await listMyChannels()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/me/channels')
    expect(got[0].id).toBe('ch-1')
  })

  it('createMyChannel POSTs to the me path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sample, { status: 201 }))
    await createMyChannel(input)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/me/channels')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })

  it('updateMyChannel PUTs to the me id path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sample))
    await updateMyChannel('ch-1', input)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/me/channels/ch-1')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
  })

  it('deleteMyChannel DELETEs the me id path', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await deleteMyChannel('ch-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/me/channels/ch-1')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('deleteMyChannel throws on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'gone' }, { status: 404 }))
    await expect(deleteMyChannel('ch-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('testMyChannel POSTs to the me test path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const got = await testMyChannel('ch-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/me/channels/ch-1/test')
    expect(got.ok).toBe(true)
  })

  const sub: AlertSubscription = { enabled: true, groups: ['g1'], severities: ['critical'] }

  it('getMySubscription reads the me subscription', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sub))
    const got = await getMySubscription()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/me/subscription')
    expect(got.enabled).toBe(true)
  })

  it('setMySubscription PUTs the subscription', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(sub))
    await setMySubscription(sub)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/me/subscription')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ enabled: true })
  })

  it('setMySubscription throws on 400', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, { status: 400 }))
    await expect(setMySubscription(sub)).rejects.toBeInstanceOf(ApiError)
  })

  it('getMyPolicy / setMyPolicy hit the me policy path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(policy))
    await getMyPolicy()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/me/policy')
    fetchMock.mockResolvedValueOnce(jsonResponse(policy))
    await setMyPolicy(policy)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/notifications/me/policy')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT' })
  })

  it('listMyDeliveries honors a limit', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listMyDeliveries(20)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/notifications/me/deliveries?limit=20')
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listMyDeliveries()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/notifications/me/deliveries')
  })

  it('listMyChannels throws on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, { status: 401 }))
    await expect(listMyChannels()).rejects.toBeInstanceOf(ApiError)
  })
})
