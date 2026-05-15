// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUser, listUsers, setUserDisabled } from './users'
import { ApiError } from './systems'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('users API', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('listUsers', () => {
    it('GETs /api/admin/users and returns the users array', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          users: [
            {
              id: 'u1',
              username: 'alice',
              email: '',
              theme: '',
              createdAt: '2026-05-01T00:00:00Z',
              totpEnabled: false,
              disabled: false,
            },
          ],
        }),
      )
      const out = await listUsers()
      expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/users')
      expect(out).toHaveLength(1)
      expect(out[0].username).toBe('alice')
    })

    it('throws ApiError on non-2xx with the server error', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
      await expect(listUsers()).rejects.toBeInstanceOf(ApiError)
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403))
      await expect(listUsers()).rejects.toMatchObject({ status: 403, message: 'forbidden' })
    })

    it('falls back to statusText when the body has no error field', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 500, statusText: 'Internal Server Error' }),
      )
      await expect(listUsers()).rejects.toMatchObject({ status: 500, message: 'Internal Server Error' })
    })
  })

  describe('createUser', () => {
    it('POSTs the username and password as JSON', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            id: 'u2',
            username: 'bob',
            email: '',
            theme: '',
            createdAt: '2026-05-01T00:00:00Z',
            totpEnabled: false,
            disabled: false,
          },
          201,
        ),
      )
      const out = await createUser({ username: 'bob', password: 'correctpassword' })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ username: 'bob', password: 'correctpassword' }),
        }),
      )
      expect(out.username).toBe('bob')
    })

    it('throws ApiError with the server message on conflict', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'username already taken' }, 409))
      await expect(
        createUser({ username: 'bob', password: 'correctpassword' }),
      ).rejects.toMatchObject({ status: 409, message: 'username already taken' })
    })
  })

  describe('setUserDisabled', () => {
    it('PATCHes the user id with {disabled: true}', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          id: 'u2',
          username: 'bob',
          email: '',
          theme: '',
          createdAt: '2026-05-01T00:00:00Z',
          totpEnabled: false,
          disabled: true,
          disabledAt: '2026-05-13T00:00:00Z',
        }),
      )
      const out = await setUserDisabled('u2', true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users/u2',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ disabled: true }),
        }),
      )
      expect(out.disabled).toBe(true)
    })

    it('url-encodes the id', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          id: 'a/b',
          username: 'x',
          email: '',
          theme: '',
          createdAt: '2026-05-01T00:00:00Z',
          totpEnabled: false,
          disabled: false,
        }),
      )
      await setUserDisabled('a/b', false)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users/a%2Fb',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })

    it('throws ApiError on non-2xx', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404))
      await expect(setUserDisabled('ghost', true)).rejects.toMatchObject({
        status: 404,
        message: 'not found',
      })
    })
  })
})
