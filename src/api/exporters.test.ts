// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createExporterDefinition,
  deleteExporterDefinition,
  installExporter,
  listExporterDefinitions,
  listExporterRuns,
  listSystemExporters,
  removeExporter,
  setExporterScrapeMode,
  statusExporter,
  updateExporterDefinition,
} from './exporters'
import { ApiError } from './systems'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('exporters api', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listExporterDefinitions returns the definitions array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        definitions: [
          {
            id: 'builtin.dnf.exporter',
            source: 'builtin',
            displayName: 'dnf',
            description: '',
            appliesToPkgManager: 'builtin.dnf',
            exporterKind: 'node_exporter',
            bindPort: 9100,
            installPlaybook: '- hosts: all\n',
            statusPlaybook: '- hosts: all\n',
            removePlaybook: '',
          },
        ],
      }),
    )
    const got = await listExporterDefinitions()
    expect(got).toHaveLength(1)
    expect(got[0].id).toBe('builtin.dnf.exporter')
  })

  it('createExporterDefinition posts JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { id: 'custom.x', source: 'custom', displayName: 'x' },
        201,
      ),
    )
    const got = await createExporterDefinition({
      id: 'x',
      displayName: 'x',
      description: '',
      appliesToPkgManager: 'builtin.dnf',
      exporterKind: 'node_exporter',
      bindPort: 9100,
      installPlaybook: '- hosts: all\n',
      statusPlaybook: '- hosts: all\n',
      removePlaybook: '',
    })
    expect(got.id).toBe('custom.x')
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).method).toBe('POST')
  })

  it('createExporterDefinition surfaces backend error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'duplicate' }, 409),
    )
    await expect(
      createExporterDefinition({
        id: 'x',
        displayName: 'x',
        description: '',
        appliesToPkgManager: 'builtin.dnf',
        exporterKind: 'node_exporter',
        bindPort: 9100,
        installPlaybook: '- hosts: all\n',
        statusPlaybook: '- hosts: all\n',
        removePlaybook: '',
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('updateExporterDefinition PATCHes the named id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'custom.x' }))
    await updateExporterDefinition('custom.x', {
      displayName: 'renamed',
      description: '',
      appliesToPkgManager: 'builtin.dnf',
      exporterKind: 'node_exporter',
      bindPort: 9100,
      installPlaybook: '- hosts: all\n',
      statusPlaybook: '- hosts: all\n',
      removePlaybook: '',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/custom.x')
    expect((init as RequestInit).method).toBe('PATCH')
  })

  it('deleteExporterDefinition accepts 404 silently', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(deleteExporterDefinition('custom.x')).resolves.toBeUndefined()
  })

  it('listSystemExporters returns the response shape', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        scrapeMode: 'localhost',
        detectedPkgManagers: ['builtin.dnf'],
        exporters: [],
      }),
    )
    const got = await listSystemExporters('sys-1')
    expect(got.scrapeMode).toBe('localhost')
    expect(got.detectedPkgManagers).toEqual(['builtin.dnf'])
  })

  it('installExporter posts to the right URL', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r',
        exporterId: 'builtin.dnf.exporter',
        kind: 'install',
        status: 'success',
        exitCode: 0,
        state: 'running',
        durationMs: 1,
      }),
    )
    const got = await installExporter('sys', 'builtin.dnf.exporter')
    expect(got.state).toBe('running')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/sys/exporters/builtin.dnf.exporter/install')
    expect((init as RequestInit).method).toBe('POST')
  })

  it('statusExporter and removeExporter hit their endpoints', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r',
        exporterId: 'x',
        kind: 'status',
        status: 'success',
        exitCode: 0,
        state: 'running',
        durationMs: 1,
      }),
    )
    await statusExporter('sys', 'x')
    expect(fetchMock.mock.calls[0][0]).toContain('/status')

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r',
        exporterId: 'x',
        kind: 'remove',
        status: 'success',
        exitCode: 0,
        state: 'removed',
        durationMs: 1,
      }),
    )
    await removeExporter('sys', 'x')
    expect(fetchMock.mock.calls[1][0]).toContain('/remove')
  })

  it('setExporterScrapeMode PUTs the body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await setExporterScrapeMode('sys', 'localhost')
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).method).toBe('PUT')
    expect((init as RequestInit).body).toContain('localhost')
  })

  it('listExporterRuns parses runs', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runs: [
          {
            id: 'r1',
            systemId: 's',
            exporterId: 'x',
            kind: 'status',
            startedAt: '2026-05-22T00:00:00Z',
          },
        ],
      }),
    )
    const got = await listExporterRuns('s')
    expect(got).toHaveLength(1)
  })
})
