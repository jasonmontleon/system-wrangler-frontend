// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fanOutOnSystem,
  fanOutTargetedSelectionsOnSystem,
} from './updaterFanOut'

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

  it('skips Apply when only check-only updaters are enabled', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        updaters: [
          {
            updaterId: 'builtin.fwupdmgr',
            source: 'builtin',
            displayName: 'fwupdmgr',
            installed: true,
            enabled: true,
            checkOnly: true,
          },
        ],
      }),
    )
    const out = await fanOutOnSystem('host-1', 'web-1', 'apply')
    expect(out.skipped).toBe(true)
    expect(out.skipReason).toMatch(/check-only/i)
    // The skip is scoped to Apply: only the GET fired, no POST.
    expect(fetchMock.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === 'POST')).toHaveLength(0)
  })

  it('still fires Check against a check-only updater', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        updaters: [
          {
            updaterId: 'builtin.fwupdmgr',
            source: 'builtin',
            displayName: 'fwupdmgr',
            installed: true,
            enabled: true,
            checkOnly: true,
          },
        ],
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-fw',
        updaterId: 'builtin.fwupdmgr',
        kind: 'check',
        status: 'success',
        exitCode: 0,
        affectedCount: 1,
        durationMs: 1,
      }),
    )
    const out = await fanOutOnSystem('host-1', 'web-1', 'check')
    expect(out.skipped).toBe(false)
    expect(out.attempted).toBe(1)
    expect(out.results[0].ok).toBe(true)
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
    // Auto-Check fires after a successful Apply so the pending
    // count refreshes; satisfy the mock queue with a no-op
    // success.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-1-check',
        updaterId: 'builtin.dnf',
        kind: 'check',
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

  it('fires an auto-Check after a successful Apply', async () => {
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
        runId: 'r-apply',
        updaterId: 'builtin.dnf',
        kind: 'apply',
        status: 'success',
        exitCode: 0,
        affectedCount: 3,
        durationMs: 1,
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-check',
        updaterId: 'builtin.dnf',
        kind: 'check',
        status: 'success',
        exitCode: 0,
        affectedCount: 0,
        durationMs: 1,
      }),
    )
    const out = await fanOutOnSystem('host-1', 'web-1', 'apply')
    expect(out.results[0].ok).toBe(true)
    expect(out.results[0].affectedCount).toBe(3)
    // The fetch log should show: list, apply, auto-check.
    const postUrls = fetchMock.mock.calls
      .filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
      .map((c) => c[0] as string)
    expect(postUrls).toHaveLength(2)
    expect(postUrls[0]).toMatch(/\/apply$/)
    expect(postUrls[1]).toMatch(/\/check$/)
  })

  it('does not auto-Check after a failed Apply', async () => {
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
        runId: 'r-apply',
        updaterId: 'builtin.dnf',
        kind: 'apply',
        status: 'failure',
        exitCode: 2,
        affectedCount: 0,
        reason: 'task failed',
        durationMs: 1,
      }),
    )
    const out = await fanOutOnSystem('host-1', 'web-1', 'apply')
    expect(out.results[0].ok).toBe(false)
    const postUrls = fetchMock.mock.calls
      .filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')
      .map((c) => c[0] as string)
    expect(postUrls).toHaveLength(1)
    expect(postUrls[0]).toMatch(/\/apply$/)
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

describe('fanOutTargetedSelectionsOnSystem', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards the matching subset to the chosen updater only', async () => {
    // Both dnf and flatpak have `openssl` pending, but the operator
    // explicitly picked the dnf row in the picker — flatpak must not
    // fire even though it would also match by name.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        updaters: [
          {
            updaterId: 'builtin.dnf',
            source: 'builtin',
            displayName: 'dnf',
            installed: true,
            enabled: true,
            checkOnly: false,
            pendingPackages: [
              { name: 'openssl', oldVersion: '3.0', newVersion: '3.1' },
              { name: 'curl', oldVersion: '8.0', newVersion: '8.1' },
            ],
          },
          {
            updaterId: 'builtin.flatpak',
            source: 'builtin',
            displayName: 'flatpak',
            installed: true,
            enabled: true,
            checkOnly: false,
            pendingPackages: [
              { name: 'openssl', oldVersion: '', newVersion: '' },
            ],
          },
        ],
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-apply',
        updaterId: 'builtin.dnf',
        kind: 'apply',
        status: 'success',
        exitCode: 0,
        affectedCount: 1,
        durationMs: 1,
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-check',
        updaterId: 'builtin.dnf',
        kind: 'check',
        status: 'success',
        exitCode: 0,
        affectedCount: 0,
        durationMs: 1,
      }),
    )
    const out = await fanOutTargetedSelectionsOnSystem('host-1', 'web-1', [
      { updaterId: 'builtin.dnf', packageName: 'openssl' },
    ])
    expect(out.skipped).toBe(false)
    expect(out.attempted).toBe(1)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].updaterId).toBe('builtin.dnf')
    expect(out.results[0].ok).toBe(true)
    const applyCalls = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].endsWith('/apply') &&
        (c[1] as RequestInit | undefined)?.method === 'POST',
    )
    expect(applyCalls).toHaveLength(1)
    expect(applyCalls[0][0]).toContain('builtin.dnf')
    const body = JSON.parse(
      (applyCalls[0][1] as RequestInit).body as string,
    ) as { packages: string[] }
    expect(body.packages).toEqual(['openssl'])
  })

  it('groups multiple selections targeting the same updater into one apply call', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        updaters: [
          {
            updaterId: 'builtin.dnf',
            source: 'builtin',
            displayName: 'dnf',
            installed: true,
            enabled: true,
            checkOnly: false,
            pendingPackages: [
              { name: 'openssl', oldVersion: '3.0', newVersion: '3.1' },
              { name: 'curl', oldVersion: '8.0', newVersion: '8.1' },
            ],
          },
        ],
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-apply',
        updaterId: 'builtin.dnf',
        kind: 'apply',
        status: 'success',
        exitCode: 0,
        affectedCount: 2,
        durationMs: 1,
      }),
    )
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        runId: 'r-check',
        updaterId: 'builtin.dnf',
        kind: 'check',
        status: 'success',
        exitCode: 0,
        affectedCount: 0,
        durationMs: 1,
      }),
    )
    const out = await fanOutTargetedSelectionsOnSystem('host-1', 'web-1', [
      { updaterId: 'builtin.dnf', packageName: 'openssl' },
      { updaterId: 'builtin.dnf', packageName: 'curl' },
    ])
    expect(out.attempted).toBe(1)
    const applyCalls = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].endsWith('/apply') &&
        (c[1] as RequestInit | undefined)?.method === 'POST',
    )
    expect(applyCalls).toHaveLength(1)
    const body = JSON.parse(
      (applyCalls[0][1] as RequestInit).body as string,
    ) as { packages: string[] }
    expect(body.packages.sort()).toEqual(['curl', 'openssl'])
  })

  it('skips when no selected (updater, package) is still pending on this system', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        updaters: [
          {
            updaterId: 'builtin.dnf',
            source: 'builtin',
            displayName: 'dnf',
            installed: true,
            enabled: true,
            checkOnly: false,
            pendingPackages: [
              { name: 'curl', oldVersion: '8.0', newVersion: '8.1' },
            ],
          },
        ],
      }),
    )
    const out = await fanOutTargetedSelectionsOnSystem('host-1', 'web-1', [
      { updaterId: 'builtin.dnf', packageName: 'openssl' },
    ])
    expect(out.skipped).toBe(true)
    expect(out.skipReason).toMatch(/None of the selected packages/i)
    expect(
      fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
      ),
    ).toHaveLength(0)
  })

  it('drops selections whose updater is not installed / not enabled / check-only', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        updaters: [
          {
            updaterId: 'builtin.fwupdmgr',
            source: 'builtin',
            displayName: 'fwupdmgr',
            installed: true,
            enabled: true,
            checkOnly: true,
            pendingPackages: [
              { name: 'openssl', oldVersion: '', newVersion: '' },
            ],
          },
          {
            updaterId: 'builtin.dnf',
            source: 'builtin',
            displayName: 'dnf',
            installed: false,
            enabled: true,
            checkOnly: false,
            pendingPackages: [
              { name: 'openssl', oldVersion: '', newVersion: '' },
            ],
          },
        ],
      }),
    )
    const out = await fanOutTargetedSelectionsOnSystem('host-1', 'web-1', [
      { updaterId: 'builtin.fwupdmgr', packageName: 'openssl' },
      { updaterId: 'builtin.dnf', packageName: 'openssl' },
    ])
    expect(out.skipped).toBe(true)
  })

  it('reports skipped when the selection list is empty', async () => {
    const out = await fanOutTargetedSelectionsOnSystem('host-1', 'web-1', [])
    expect(out.skipped).toBe(true)
    expect(out.skipReason).toMatch(/No packages selected/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips when listSystemUpdaters fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const out = await fanOutTargetedSelectionsOnSystem('host-1', 'web-1', [
      { updaterId: 'builtin.dnf', packageName: 'openssl' },
    ])
    expect(out.skipped).toBe(true)
    expect(out.skipReason).toMatch(/boom/i)
  })
})

