// SPDX-License-Identifier: Apache-2.0

import { apiFetch } from './client'
import { ApiError } from './systems'

export type AuthUser = {
  id: string
  username: string
  email: string
  theme: string
  createdAt: string
  totpEnabled: boolean
  mustChangePassword?: boolean
}

export type ProfileUpdate = {
  email: string
  theme: string
}

export type AuthStatus = {
  setupRequired: boolean
  authenticated: boolean
  user?: AuthUser
  // Present when the backend has OpenID Connect single sign-on enabled.
  // oidcDisplayName is the provider label shown on the SSO button.
  oidcEnabled?: boolean
  oidcDisplayName?: string
}

// Discriminated result of the first step of login: either we got a session
// outright (no TOTP enabled, or trusted-device cookie hit), the server has
// issued a 5-minute challenge cookie and is asking for the second factor,
// or the credentials were correct but the account is in a lockout window
// (the 423 response carries the lockedUntil timestamp).
export type LoginResult =
  | { kind: 'authenticated'; user: AuthUser }
  | { kind: 'totp' }
  | { kind: 'locked'; lockedUntil: string }

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

export type Session = {
  id: string
  label: string
  ip?: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  // current is true for the session the requesting cookie belongs to.
  // Always false on the admin list (the admin isn't the session owner).
  current: boolean
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
  const resp = await apiFetch('/api/auth/status')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as AuthStatus
}

export async function setupAdmin(
  username: string,
  password: string,
): Promise<AuthUser> {
  const resp = await apiFetch('/api/auth/setup', {
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
  const resp = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (resp.status === 423) {
    const body = (await resp.json()) as { lockedUntil?: string }
    return { kind: 'locked', lockedUntil: body.lockedUntil ?? '' }
  }
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { totpRequired: true } | AuthUser
  if ('totpRequired' in body && body.totpRequired === true) {
    return { kind: 'totp' }
  }
  return { kind: 'authenticated', user: body as AuthUser }
}

// logout clears the server session. For an OIDC (single sign-on) session
// the backend replies 200 with a logoutUrl the caller should navigate to,
// so the upstream IdP session is ended too; a local session replies 204
// (no body) and logoutUrl is undefined.
export async function logout(): Promise<{ logoutUrl?: string }> {
  const resp = await apiFetch('/api/auth/logout', { method: 'POST' })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  if (resp.status === 204) return {}
  return (await resp.json()) as { logoutUrl?: string }
}

export async function updateProfile(update: ProfileUpdate): Promise<AuthUser> {
  const resp = await apiFetch('/api/auth/profile', {
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
  const resp = await apiFetch('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

// totpSetup primes the enrollment flow. The backend stores the new secret
// as `pending` until totpConfirm validates a code against it.
export async function totpSetup(): Promise<TotpSetup> {
  const resp = await apiFetch('/api/auth/totp/setup', { method: 'POST' })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as TotpSetup
}

// totpConfirm activates the pending secret if the supplied code verifies,
// and returns the freshly-minted recovery codes for one-time display.
export async function totpConfirm(code: string): Promise<string[]> {
  const resp = await apiFetch('/api/auth/totp/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { recoveryCodes: string[] }
  return body.recoveryCodes
}

// TotpVerifyResult mirrors LoginResult for the second-factor path:
// successful auth carries the user, locked carries the lockedUntil
// timestamp so the UI can render a countdown.
export type TotpVerifyResult =
  | { kind: 'authenticated'; user: AuthUser }
  | { kind: 'locked'; lockedUntil: string }

// totpVerify completes the second step of login. The backend gates this on
// the short-lived sw_totp_challenge cookie set by /api/auth/login.
export async function totpVerify(
  code: string,
  rememberDevice: boolean,
): Promise<TotpVerifyResult> {
  const resp = await apiFetch('/api/auth/totp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, rememberDevice }),
  })
  if (resp.status === 423) {
    const body = (await resp.json()) as { lockedUntil?: string }
    return { kind: 'locked', lockedUntil: body.lockedUntil ?? '' }
  }
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const user = (await resp.json()) as AuthUser
  return { kind: 'authenticated', user }
}

// totpDisable revokes TOTP for the current user. The backend requires both
// the password and a current code as a deliberate two-factor confirmation.
export async function totpDisable(
  password: string,
  code: string,
): Promise<void> {
  const resp = await apiFetch('/api/auth/totp', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, code }),
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

export async function listTrustedDevices(): Promise<TrustedDevice[]> {
  const resp = await apiFetch('/api/auth/devices')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as TrustedDevice[]
}

export async function revokeTrustedDevice(id: string): Promise<void> {
  const resp = await apiFetch(`/api/auth/devices/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

// listSessions returns the caller's own active login sessions, with the
// current one flagged.
export async function listSessions(): Promise<Session[]> {
  const resp = await apiFetch('/api/auth/sessions')
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Session[]
}

// revokeSession revokes one of the caller's own sessions. Revoking the
// current session clears the cookie server-side (an effective logout).
export async function revokeSession(id: string): Promise<void> {
  const resp = await apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}

// revokeOtherSessions signs the caller out of every session except the
// current one; returns the count revoked.
export async function revokeOtherSessions(): Promise<number> {
  const resp = await apiFetch('/api/auth/sessions/revoke-others', {
    method: 'POST',
  })
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  const body = (await resp.json()) as { revoked: number }
  return body.revoked
}

// listUserSessions is the admin view of another user's active sessions.
export async function listUserSessions(userId: string): Promise<Session[]> {
  const resp = await apiFetch(
    `/api/admin/users/${encodeURIComponent(userId)}/sessions`,
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
  return (await resp.json()) as Session[]
}

// revokeUserSession revokes one of another user's sessions (admin).
export async function revokeUserSession(
  userId: string,
  sessionId: string,
): Promise<void> {
  const resp = await apiFetch(
    `/api/admin/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  )
  if (!resp.ok) throw new ApiError(resp.status, await parseError(resp))
}
