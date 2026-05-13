// SPDX-License-Identifier: Apache-2.0

import { ApiError } from './systems'

export type User = {
  id: string
  username: string
  email: string
  theme: string
  createdAt: string
  totpEnabled: boolean
  disabled: boolean
  disabledAt?: string
  failedAttempts?: number
  lockedUntil?: string
  mustChangePassword?: boolean
}

export type CreateUserInput = {
  username: string
  password: string
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

export async function listUsers(): Promise<User[]> {
  const resp = await fetch('/api/admin/users')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { users: User[] }
  return body.users
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const resp = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as User
}

export async function setUserDisabled(
  id: string,
  disabled: boolean,
): Promise<User> {
  const resp = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as User
}

export async function deleteUser(id: string): Promise<void> {
  const resp = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function adminResetPassword(
  id: string,
  password: string,
): Promise<void> {
  const resp = await fetch(
    `/api/admin/users/${encodeURIComponent(id)}/password`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function adminResetTotp(id: string): Promise<void> {
  const resp = await fetch(
    `/api/admin/users/${encodeURIComponent(id)}/totp/reset`,
    {
      method: 'POST',
    },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
