// SPDX-License-Identifier: Apache-2.0

import { ApiError } from './systems'

export type AuthUser = {
  id: string
  username: string
  email: string
  theme: string
  createdAt: string
  totpEnabled: boolean
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

// Discriminated result of the first step of login: either we got a session
// outright (no TOTP enabled, or trusted-device cookie hit) or the server has
// issued a 5-minute challenge cookie and is asking for the second factor.
export type LoginResult =
  | { kind: 'authenticated'; user: AuthUser }
  | { kind: 'totp' }

export type TotpSetup = {
  secret: string
  uri: string
  qrPng: string
}

export type TrustedDevice = {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string
  expiresAt: string
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
): Promise<LoginResult> {
  const resp = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as
    | { totpRequired: true }
    | AuthUser
  if ('totpRequired' in body && body.totpRequired === true) {
    return { kind: 'totp' }
  }
  return { kind: 'authenticated', user: body as AuthUser }
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

// totpSetup primes the enrollment flow. The backend stores the new secret
// as `pending` until totpConfirm validates a code against it.
export async function totpSetup(): Promise<TotpSetup> {
  const resp = await fetch('/api/auth/totp/setup', { method: 'POST' })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as TotpSetup
}

// totpConfirm activates the pending secret if the supplied code verifies,
// and returns the freshly-minted recovery codes for one-time display.
export async function totpConfirm(code: string): Promise<string[]> {
  const resp = await fetch('/api/auth/totp/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { recoveryCodes: string[] }
  return body.recoveryCodes
}

// totpVerify completes the second step of login. The backend gates this on
// the short-lived sw_totp_challenge cookie set by /api/auth/login.
export async function totpVerify(
  code: string,
  rememberDevice: boolean,
): Promise<AuthUser> {
  const resp = await fetch('/api/auth/totp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, rememberDevice }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AuthUser
}

// totpDisable revokes TOTP for the current user. The backend requires both
// the password and a current code as a deliberate two-factor confirmation.
export async function totpDisable(
  password: string,
  code: string,
): Promise<void> {
  const resp = await fetch('/api/auth/totp', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, code }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function listTrustedDevices(): Promise<TrustedDevice[]> {
  const resp = await fetch('/api/auth/devices')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as TrustedDevice[]
}

export async function revokeTrustedDevice(id: string): Promise<void> {
  const resp = await fetch(`/api/auth/devices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
