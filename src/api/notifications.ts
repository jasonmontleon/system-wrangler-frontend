// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type ChannelType = 'email' | 'slack' | 'webhook' | 'sms'
export type DeliveryStatus = 'success' | 'failed'

// ChannelConfig holds the non-secret, type-specific settings. Only the
// fields relevant to the channel's type are populated.
export type ChannelConfig = {
  // email
  smtpHost?: string
  smtpPort?: number
  username?: string
  startTLS?: boolean
  skipVerify?: boolean
  // email + sms
  from?: string
  to?: string[]
  // webhook
  url?: string
  method?: string
  headerName?: string
  // sms
  baseURL?: string
  accountSID?: string
}

export type NotificationChannel = {
  id: string
  name: string
  type: ChannelType
  enabled: boolean
  config: ChannelConfig
  hasSecret: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type NotificationChannelInput = {
  name: string
  type: ChannelType
  enabled: boolean
  config: ChannelConfig
  // Plaintext secret, sealed server-side. Required on create for slack/sms;
  // omit/empty on update to keep the stored secret.
  secret?: string
}

export type NotificationDelivery = {
  id: string
  channelId: string
  channelName: string
  channelType: ChannelType
  kind: string
  ruleName: string
  systemId: string
  status: DeliveryStatus
  error?: string
  at: string
}

export type ChannelTestResult = {
  ok: boolean
  error?: string
}

async function parseError(resp: Response): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    // fall through
  }
  return resp.statusText || `HTTP ${resp.status}`
}

export async function listChannels(): Promise<NotificationChannel[]> {
  const resp = await apiFetch('/api/notifications/channels')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as NotificationChannel[]
}

export async function createChannel(
  input: NotificationChannelInput,
): Promise<NotificationChannel> {
  const resp = await apiFetch('/api/notifications/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as NotificationChannel
}

export async function updateChannel(
  id: string,
  input: NotificationChannelInput,
): Promise<NotificationChannel> {
  const resp = await apiFetch(`/api/notifications/channels/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as NotificationChannel
}

export async function deleteChannel(id: string): Promise<void> {
  const resp = await apiFetch(`/api/notifications/channels/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function testChannel(id: string): Promise<ChannelTestResult> {
  const resp = await apiFetch(
    `/api/notifications/channels/${encodeURIComponent(id)}/test`,
    { method: 'POST' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as ChannelTestResult
}

export async function listDeliveries(limit?: number): Promise<NotificationDelivery[]> {
  const path = limit
    ? `/api/notifications/deliveries?limit=${limit}`
    : '/api/notifications/deliveries'
  const resp = await apiFetch(path)
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as NotificationDelivery[]
}
