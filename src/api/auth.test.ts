// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './systems'
import {
  changePassword,
  getAuthStatus,
  listSessions,
  listTrustedDevices,
  listUserSessions,
  login,
  logout,
  revokeOtherSessions,
  revokeSession,
  revokeTrustedDevice,
  revokeUserSession,
  setupAdmin,
  totpConfirm,
  totpDisable,
  totpSetup,
  totpVerify,
  updateProfile,
  type AuthStatus,
} from './auth'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('api/auth', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getAuthStatus returns the parsed status', async () => {
    const want: AuthStatus = { setupRequired: true, authenticated: false }
    fetchMock.mockResolvedValueOnce(jsonResponse(want))
    const got = await getAuthStatus()
    expect(got).toEqual(want)
  })

  it('getAuthStatus throws ApiError on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'oops' }, 500))
    await expect(getAuthStatus()).rejects.toBeInstanceOf(ApiError)
  })

  it('setupAdmin posts JSON and returns the user', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { id: 'u1', username: 'admin', createdAt: '2026-05-06T12:00:00Z' },
        201,
      ),
    )
    const u = await setupAdmin('admin', 'correctpassword')
    expect(u.username).toBe('admin')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/setup',
      expect.objectContaining({ method: 'POST' }),
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      username: 'admin',
      password: 'correctpassword',
    })
  })

  it('setupAdmin throws ApiError when backend rejects', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'already done' }, 403))
    await expect(setupAdmin('a', 'b')).rejects.toBeInstanceOf(ApiError)
  })

  it('login posts JSON and returns an authenticated result', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'u1', username: 'admin', createdAt: '2026-05-06T12:00:00Z' }),
    )
    const got = await login('admin', 'correctpassword')
    expect(got.kind).toBe('authenticated')
    if (got.kind === 'authenticated') {
      expect(got.user.username).toBe('admin')
    }
  })

  it('login surfaces the totp-required branch as a discriminated result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ totpRequired: true }))
    const got = await login('admin', 'correctpassword')
    expect(got.kind).toBe('totp')
  })

  it('login surfaces backend message on 401', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid credentials' }, 401),
    )
    await expect(login('a', 'b')).rejects.toThrow(/invalid credentials/)
  })

  it('login falls back to status text when body is unparseable', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 500, statusText: 'Server Error' }),
    )
    await expect(login('a', 'b')).rejects.toThrow(/Server Error|HTTP 500/)
  })

  it('logout sends POST and resolves on 2xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(logout()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('logout throws on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, 500))
    await expect(logout()).rejects.toBeInstanceOf(ApiError)
  })

  it('updateProfile sends a PATCH and returns the updated user', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'u1',
        username: 'admin',
        email: 'a@b.c',
        theme: 'light',
        createdAt: '2026-05-06T12:00:00Z',
      }),
    )
    const u = await updateProfile({ email: 'a@b.c', theme: 'light' })
    expect(u.email).toBe('a@b.c')
    expect(u.theme).toBe('light')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/profile',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('updateProfile throws on backend error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid theme' }, 400))
    await expect(updateProfile({ email: '', theme: 'neon' })).rejects.toBeInstanceOf(
      ApiError,
    )
  })

  it('changePassword posts both passwords and resolves on 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(changePassword('old', 'newsecretpw')).resolves.toBeUndefined()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      currentPassword: 'old',
      newPassword: 'newsecretpw',
    })
  })

  it('changePassword surfaces 401 from server', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'current password incorrect' }, 401),
    )
    await expect(changePassword('wrong', 'newsecretpw')).rejects.toThrow(
      /current password incorrect/,
    )
  })

  it('totpSetup posts and returns the secret + qr', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ secret: 'JBSWY3DP', uri: 'otpauth://x', qrPng: 'BASE64' }),
    )
    const got = await totpSetup()
    expect(got.secret).toBe('JBSWY3DP')
    expect(got.qrPng).toBe('BASE64')
  })

  it('totpSetup throws ApiError on backend reject', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, 503))
    await expect(totpSetup()).rejects.toBeInstanceOf(ApiError)
  })

  it('totpConfirm sends the code and returns recovery codes', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ recoveryCodes: ['ABC12-DEF34', 'GHIJK-LMNOP'] }),
    )
    const got = await totpConfirm('123456')
    expect(got).toHaveLength(2)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ code: '123456' })
  })

  it('totpConfirm throws on bad code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid code' }, 401))
    await expect(totpConfirm('000000')).rejects.toThrow(/invalid code/)
  })

  it('totpVerify posts code+rememberDevice and returns the user', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'u1', username: 'admin', createdAt: 't' }),
    )
    const result = await totpVerify('123456', true)
    expect(result.kind).toBe('authenticated')
    if (result.kind === 'authenticated') {
      expect(result.user.username).toBe('admin')
    }
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      code: '123456',
      rememberDevice: true,
    })
  })

  it('totpVerify returns lockout on 423', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'account locked', lockedUntil: '2026-05-13T12:15:00Z' }, 423),
    )
    const result = await totpVerify('123456', false)
    expect(result.kind).toBe('locked')
    if (result.kind === 'locked') {
      expect(result.lockedUntil).toBe('2026-05-13T12:15:00Z')
    }
  })

  it('login returns lockout on 423', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'account locked', lockedUntil: '2026-05-13T12:15:00Z' }, 423),
    )
    const result = await login('alice', 'correctpassword')
    expect(result.kind).toBe('locked')
    if (result.kind === 'locked') {
      expect(result.lockedUntil).toBe('2026-05-13T12:15:00Z')
    }
  })

  it('totpDisable sends DELETE with credentials and resolves on 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(totpDisable('correctpassword', '123456')).resolves.toBeUndefined()
    const url = fetchMock.mock.calls[0][0] as string
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(url).toBe('/api/auth/totp')
    expect(init.method).toBe('DELETE')
  })

  it('totpDisable throws on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'wrong' }, 401))
    await expect(totpDisable('x', 'y')).rejects.toBeInstanceOf(ApiError)
  })

  it('listTrustedDevices returns the array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 'd1',
          label: 'Firefox on Linux',
          createdAt: 't',
          lastUsedAt: 't',
          expiresAt: 't',
        },
      ]),
    )
    const got = await listTrustedDevices()
    expect(got).toHaveLength(1)
    expect(got[0].label).toBe('Firefox on Linux')
  })

  it('listTrustedDevices throws on backend error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, 500))
    await expect(listTrustedDevices()).rejects.toBeInstanceOf(ApiError)
  })

  it('revokeTrustedDevice DELETEs the right URL and encodes the id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(revokeTrustedDevice('a/b')).resolves.toBeUndefined()
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('/api/auth/devices/a%2Fb')
  })

  it('revokeTrustedDevice throws on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404))
    await expect(revokeTrustedDevice('x')).rejects.toBeInstanceOf(ApiError)
  })

  it('listSessions returns the array with the current flag', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 's1',
          label: 'Firefox on Linux',
          ip: '10.0.0.5',
          createdAt: 't',
          lastSeenAt: 't',
          expiresAt: 't',
          current: true,
        },
      ]),
    )
    const got = await listSessions()
    expect(got).toHaveLength(1)
    expect(got[0].current).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/sessions')
  })

  it('listSessions throws on backend error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, 500))
    await expect(listSessions()).rejects.toBeInstanceOf(ApiError)
  })

  it('revokeSession DELETEs the encoded id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(revokeSession('a/b')).resolves.toBeUndefined()
    const url = fetchMock.mock.calls[0][0] as string
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(url).toBe('/api/auth/sessions/a%2Fb')
    expect(init.method).toBe('DELETE')
  })

  it('revokeSession throws on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404))
    await expect(revokeSession('x')).rejects.toBeInstanceOf(ApiError)
  })

  it('revokeOtherSessions posts and returns the revoked count', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ revoked: 3 }))
    const n = await revokeOtherSessions()
    expect(n).toBe(3)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/sessions/revoke-others',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('revokeOtherSessions throws on backend error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, 500))
    await expect(revokeOtherSessions()).rejects.toBeInstanceOf(ApiError)
  })

  it('listUserSessions hits the admin path for the user', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await listUserSessions('user 1')
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toBe('/api/admin/users/user%201/sessions')
  })

  it('listUserSessions throws on backend error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, 403))
    await expect(listUserSessions('u')).rejects.toBeInstanceOf(ApiError)
  })

  it('revokeUserSession DELETEs the encoded admin path', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(revokeUserSession('u1', 's/2')).resolves.toBeUndefined()
    const url = fetchMock.mock.calls[0][0] as string
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(url).toBe('/api/admin/users/u1/sessions/s%2F2')
    expect(init.method).toBe('DELETE')
  })

  it('revokeUserSession throws on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404))
    await expect(revokeUserSession('u', 's')).rejects.toBeInstanceOf(ApiError)
  })
})
