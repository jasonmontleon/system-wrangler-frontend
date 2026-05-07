// SPDX-License-Identifier: AGPL-3.0-or-later

import { ApiError } from './systems'

export type AuthUser = {
  id: string
  username: string
  email: string
  theme: string
  createdAt: string
}

export type ProfileUpdate = {
  email: string
  theme: string
}

export type AuthStatus = {
  setupRequired: boolean
  authenticated: boolean
  user?: AuthUser
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

export async function getAuthStatus(): Promise<AuthStatus> {
  const resp = await fetch('/api/auth/status')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AuthStatus
}

export async function setupAdmin(
  username: string,
  password: string,
): Promise<AuthUser> {
  const resp = await fetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AuthUser
}

export async function login(
  username: string,
  password: string,
): Promise<AuthUser> {
  const resp = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AuthUser
}

export async function logout(): Promise<void> {
  const resp = await fetch('/api/auth/logout', { method: 'POST' })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function updateProfile(update: ProfileUpdate): Promise<AuthUser> {
  const resp = await fetch('/api/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AuthUser
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const resp = await fetch('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
