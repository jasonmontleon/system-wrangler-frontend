// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SystemSparklinesRow from './SystemSparklinesRow'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SystemSparklinesRow', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'success',
        data: { resultType: 'matrix', result: [] },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders all three sparkline cards', async () => {
    render(<SystemSparklinesRow systemId="sys-1" />)
    expect(await screen.findByText('Load (1m)')).toBeInTheDocument()
    expect(screen.getByText('Memory used')).toBeInTheDocument()
    expect(screen.getByText('Disk IO')).toBeInTheDocument()
  })

  it('threads system_id into each query', async () => {
    render(<SystemSparklinesRow systemId="sys-XYZ" />)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    for (const call of fetchMock.mock.calls) {
      const url = String(call[0])
      expect(url).toContain('sys-XYZ')
    }
  })
})
