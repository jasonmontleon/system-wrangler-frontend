// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './systems'
import {
  changePassword,
  getAuthStatus,
  login,
  logout,
  setupAdmin,
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

  it('login posts JSON and returns the user', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'u1', username: 'admin', createdAt: '2026-05-06T12:00:00Z' }),
    )
    const u = await login('admin', 'correctpassword')
    expect(u.username).toBe('admin')
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
})
