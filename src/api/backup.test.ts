// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseFilename, requestBackup } from './backup'
import { ApiError } from './systems'

describe('parseFilename', () => {
  it('extracts a quoted filename', () => {
    expect(
      parseFilename('attachment; filename="system-wrangler-20260515T123456Z.db"'),
    ).toBe('system-wrangler-20260515T123456Z.db')
  })

  it('extracts an unquoted filename', () => {
    expect(parseFilename('attachment; filename=backup.db')).toBe('backup.db')
  })

  it('falls back when the header is null', () => {
    expect(parseFilename(null)).toBe('system-wrangler-backup.db')
  })

  it('falls back when the header has no filename param', () => {
    expect(parseFilename('attachment')).toBe('system-wrangler-backup.db')
  })

  it('falls back when the filename is empty', () => {
    expect(parseFilename('attachment; filename=""')).toBe(
      'system-wrangler-backup.db',
    )
  })
})

describe('requestBackup', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs and returns the blob + parsed filename on success', async () => {
    const body = new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65])
    const resp = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition':
          'attachment; filename="system-wrangler-20260515T123456Z.db"',
      },
    })
    fetchMock.mockResolvedValueOnce(resp)

    const out = await requestBackup()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/backup')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST')
    expect(out.filename).toBe('system-wrangler-20260515T123456Z.db')
    expect(out.blob.size).toBe(body.byteLength)
  })

  it('uses the fallback filename when Content-Disposition is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    )
    const out = await requestBackup()
    expect(out.filename).toBe('system-wrangler-backup.db')
  })

  it('throws ApiError with the server error message on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'backup requires Global Admin' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(requestBackup()).rejects.toBeInstanceOf(ApiError)
  })

  it('preserves the status on ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'another backup is already in progress' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(requestBackup()).rejects.toMatchObject({
      status: 409,
      message: 'another backup is already in progress',
    })
  })

  it('falls back to statusText when the body has no error field', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 500, statusText: 'Internal Server Error' }),
    )
    await expect(requestBackup()).rejects.toMatchObject({
      status: 500,
      message: 'Internal Server Error',
    })
  })
})
