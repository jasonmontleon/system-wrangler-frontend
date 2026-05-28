// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { needsReboot, queryRebootRequiredSet } from './rebootSignal'
import type { System } from '../api/systems'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sys(overrides: Partial<System> = {}): System {
  return {
    id: 'sys-1',
    name: 'host',
    hostname: 'host.example',
    createdAt: '2026-01-01T00:00:00Z',
    status: 'reachable',
    ...overrides,
  }
}

describe('needsReboot', () => {
  it('is true when rebootRequiredAt is a non-empty string', () => {
    expect(needsReboot(sys({ rebootRequiredAt: '2026-05-28T14:30:00Z' }), new Set())).toBe(true)
  })

  it('is true when the metric set contains the system id even with no column stamp', () => {
    expect(needsReboot(sys(), new Set(['sys-1']))).toBe(true)
  })

  it('is false when neither source signals', () => {
    expect(needsReboot(sys(), new Set())).toBe(false)
  })

  it('is true if either source signals (column XOR metric)', () => {
    expect(needsReboot(sys({ rebootRequiredAt: undefined }), new Set(['sys-1']))).toBe(true)
    expect(needsReboot(sys({ id: 'sys-2', rebootRequiredAt: '2026-05-28T00:00:00Z' }), new Set(['sys-1']))).toBe(true)
  })
})

describe('queryRebootRequiredSet', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts system_id labels from the gauge>0 vector', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        status: 'success',
        data: {
          resultType: 'vector',
          result: [
            { metric: { system_id: 'a' }, value: [0, '1'] },
            { metric: { system_id: 'b' }, value: [0, '1'] },
            // No system_id label → ignored.
            { metric: {}, value: [0, '1'] },
          ],
        },
      }),
    )
    const set = await queryRebootRequiredSet()
    expect(set.has('a')).toBe(true)
    expect(set.has('b')).toBe(true)
    expect(set.size).toBe(2)
  })

  it('returns an empty Set when the gauge has no series above zero', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { resultType: 'vector', result: [] } }),
    )
    const set = await queryRebootRequiredSet()
    expect(set.size).toBe(0)
  })

  it('propagates a Prometheus error so callers can swallow it locally', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ status: 'error', errorType: 'bad_data', error: 'parse error' }),
    )
    await expect(queryRebootRequiredSet()).rejects.toBeTruthy()
  })
})
