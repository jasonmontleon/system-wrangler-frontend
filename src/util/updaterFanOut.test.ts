// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fanOutOnSystem } from './updaterFanOut'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('fanOutOnSystem', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fires once per enabled detected updater and reports success', async () => {
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
          {
            updaterId: 'custom.disabled',
            source: 'custom',
            displayName: 'disabled',
            installed: true,
            enabled: false,
          },
          {
            updaterId: 'custom.absent',
            source: 'custom',
            displayName: 'absent',
            installed: false,
            enabled: true,
          },
        ],
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-1',
        updaterId: 'builtin.dnf',
        kind: 'check',
        status: 'success',
        exitCode: 0,
        affectedCount: 2,
        durationMs: 1,
      }),
    )
    const out = await fanOutOnSystem('host-1', 'web-1', 'check')
    expect(out.attempted).toBe(1)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].ok).toBe(true)
    expect(out.results[0].affectedCount).toBe(2)
    expect(out.skipped).toBe(false)
  })

  it('returns skipped=true when no updater is both detected and enabled', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        updaters: [
          {
            updaterId: 'builtin.dnf',
            source: 'builtin',
            displayName: 'dnf',
            installed: false,
            enabled: false,
          },
        ],
      }),
    )
    const out = await fanOutOnSystem('host-1', 'web-1', 'check')
    expect(out.skipped).toBe(true)
    expect(out.skipReason).toMatch(/No enabled updaters/i)
    // No per-updater POST should have fired.
    expect(fetchMock.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === 'POST')).toHaveLength(0)
  })

  it('captures per-updater errors without aborting the loop', async () => {
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
          {
            updaterId: 'custom.apt-mirror',
            source: 'custom',
            displayName: 'apt-mirror',
            installed: true,
            enabled: true,
          },
        ],
      }),
    )
    // First updater succeeds, second 409s on conflict.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-1',
        updaterId: 'builtin.dnf',
        kind: 'apply',
        status: 'success',
        exitCode: 0,
        affectedCount: 0,
        durationMs: 1,
      }),
    )
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'busy', conflictingRun: 'r-other' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const out = await fanOutOnSystem('host-1', 'web-1', 'apply')
    expect(out.attempted).toBe(2)
    expect(out.results.filter((r) => r.ok)).toHaveLength(1)
    const failure = out.results.find((r) => !r.ok)!
    expect(failure.updaterId).toBe('custom.apt-mirror')
    expect(failure.error).toMatch(/Another inspect\/check\/apply is running/i)
  })

  it('skips when listSystemUpdaters fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const out = await fanOutOnSystem('host-1', 'web-1', 'check')
    expect(out.skipped).toBe(true)
    expect(out.skipReason).toMatch(/boom/i)
  })

  it('records playbook-side failure status from a 200 response', async () => {
    // The runner reports failure status with exit code embedded in
    // the body. fanOut must NOT treat the 200 as a success.
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
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-1',
        updaterId: 'builtin.dnf',
        kind: 'check',
        status: 'failure',
        exitCode: 2,
        affectedCount: 0,
        reason: 'task failed',
        durationMs: 1,
      }),
    )
    const out = await fanOutOnSystem('host-1', 'web-1', 'check')
    expect(out.results[0].ok).toBe(false)
    expect(out.results[0].error).toMatch(/task failed/)
  })
})

