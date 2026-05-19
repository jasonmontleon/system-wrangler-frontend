// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyUpdater,
  checkUpdater,
  createUpdaterDefinition,
  deleteUpdaterDefinition,
  inspectSystem,
  listSystemUpdaters,
  listUpdaterDefinitions,
  listUpdaterRuns,
  setUpdaterEnabled,
  updateUpdaterDefinition,
} from './updaters'
import { ApiError } from './systems'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('updaters api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listUpdaterDefinitions returns the definitions array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        definitions: [
          {
            id: 'builtin.dnf',
            source: 'builtin',
            displayName: 'dnf',
            description: '',
            detectBinary: 'dnf',
            checkPlaybook: '- hosts: all\n',
            applyPlaybook: '- hosts: all\n',
          },
        ],
      }),
    )
    const got = await listUpdaterDefinitions()
    expect(got).toHaveLength(1)
    expect(got[0].id).toBe('builtin.dnf')
  })

  it('createUpdaterDefinition POSTs JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'custom.alpha',
        source: 'custom',
        displayName: 'alpha',
        description: '',
        detectBinary: 'alpha',
        checkPlaybook: '- hosts: all\n',
        applyPlaybook: '- hosts: all\n',
      }, 201),
    )
    const got = await createUpdaterDefinition({
      id: 'alpha',
      displayName: 'alpha',
      description: '',
      detectBinary: 'alpha',
      checkPlaybook: '- hosts: all\n',
      applyPlaybook: '- hosts: all\n',
      checkOnly: false,
    })
    expect(got.id).toBe('custom.alpha')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/updater-definitions')
    expect(init.method).toBe('POST')
  })

  it('createUpdaterDefinition surfaces 400 as ApiError with server message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'detect_binary required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(
      createUpdaterDefinition({
        id: 'bad',
        displayName: 'bad',
        description: '',
        detectBinary: '',
        checkPlaybook: '',
        applyPlaybook: '',
        checkOnly: false,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'detect_binary required',
    })
  })

  it('updateUpdaterDefinition issues PATCH with url-encoded id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'custom.tt',
        source: 'custom',
        displayName: 'tt',
        description: '',
        detectBinary: 'tt',
        checkPlaybook: '- hosts: all\n',
        applyPlaybook: '- hosts: all\n',
      }),
    )
    await updateUpdaterDefinition('custom.tt', {
      displayName: 'tt',
      description: '',
      detectBinary: 'tt',
      checkPlaybook: '- hosts: all\n',
      applyPlaybook: '- hosts: all\n',
      checkOnly: false,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/updater-definitions/custom.tt')
    expect(init.method).toBe('PATCH')
  })

  it('deleteUpdaterDefinition swallows 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(deleteUpdaterDefinition('custom.ghost')).resolves.toBeUndefined()
  })

  it('deleteUpdaterDefinition throws on 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await expect(deleteUpdaterDefinition('custom.x')).rejects.toBeInstanceOf(ApiError)
  })

  it('inspectSystem returns the parsed body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-1',
        status: 'success',
        exitCode: 0,
        detected: ['builtin.dnf'],
        durationMs: 1234,
      }),
    )
    const got = await inspectSystem('host-1')
    expect(got.detected).toEqual(['builtin.dnf'])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/host-1/inspect')
  })

  it('checkUpdater encodes path params and POSTs', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-2',
        updaterId: 'builtin.dnf',
        kind: 'check',
        status: 'success',
        exitCode: 0,
        affectedCount: 0,
        durationMs: 1,
      }),
    )
    await checkUpdater('host-1', 'builtin.dnf')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems/host-1/updaters/builtin.dnf/check')
    expect(init.method).toBe('POST')
  })

  it('applyUpdater surfaces 409 as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'busy', conflictingRun: 'r-9' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(applyUpdater('host-1', 'builtin.dnf')).rejects.toMatchObject({
      status: 409,
    })
  })

  it('listUpdaterRuns serializes limit', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [] }))
    await listUpdaterRuns('host-1', 5)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/host-1/updater-runs?limit=5')
  })

  it('listSystemUpdaters returns the updaters array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        updaters: [
          {
            updaterId: 'builtin.dnf',
            source: 'builtin',
            displayName: 'dnf',
            installed: true,
            enabled: true,
          },
        ],
      }),
    )
    const got = await listSystemUpdaters('host-1')
    expect(got).toHaveLength(1)
    expect(got[0].installed).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/systems/host-1/updaters')
  })

  it('setUpdaterEnabled PUTs the body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await setUpdaterEnabled('host-1', 'builtin.dnf', false)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems/host-1/updaters/builtin.dnf/enabled')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ enabled: false })
  })

  it('setUpdaterEnabled surfaces 404 as ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'not detected yet' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(setUpdaterEnabled('host-1', 'builtin.dnf', true)).rejects.toBeInstanceOf(
      ApiError,
    )
  })
})
