// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MonitoringTabContent from './MonitoringTabContent'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

const baseExporter = {
  exporterId: 'builtin.dnf.exporter',
  source: 'builtin' as const,
  displayName: 'dnf — node_exporter',
  description: '',
  appliesToPkgManager: 'builtin.dnf',
  exporterKind: 'node_exporter' as const,
  bindPort: 9100,
  hasRemove: false,
  scrapeEnabled: true,
}

describe('MonitoringTabContent', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the inspect hint when no managers detected', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        scrapeMode: 'localhost',
        detectedPkgManagers: [],
        exporters: [
          { ...baseExporter, availability: 'unknown', installed: false },
        ],
      }),
    )
    render(<MonitoringTabContent systemId="s1" canOperate />)
    expect(
      await screen.findByText(/Run Inspect to see exporter options/i),
    ).toBeInTheDocument()
  })

  it('shows the unavailable panel when nothing matches', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        scrapeMode: 'localhost',
        detectedPkgManagers: ['builtin.apt'],
        exporters: [
          { ...baseExporter, availability: 'unavailable', installed: false },
        ],
      }),
    )
    render(<MonitoringTabContent systemId="s1" canOperate />)
    expect(
      await screen.findByText(/No exporter installer available/i),
    ).toBeInTheDocument()
  })

  it('renders Available + Install on a matching builtin', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        scrapeMode: 'localhost',
        detectedPkgManagers: ['builtin.dnf'],
        exporters: [
          { ...baseExporter, availability: 'available', installed: false },
        ],
      }),
    )
    render(<MonitoringTabContent systemId="s1" canOperate />)
    expect(await screen.findByText('Available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Install$/i })).toBeEnabled()
  })

  it('fires install and refreshes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          scrapeMode: 'localhost',
          detectedPkgManagers: ['builtin.dnf'],
          exporters: [
            { ...baseExporter, availability: 'available', installed: false },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          runId: 'r1',
          exporterId: 'builtin.dnf.exporter',
          kind: 'install',
          status: 'success',
          exitCode: 0,
          state: 'running',
          durationMs: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          scrapeMode: 'localhost',
          detectedPkgManagers: ['builtin.dnf'],
          exporters: [
            {
              ...baseExporter,
              availability: 'available',
              installed: true,
              state: 'running',
              port: 9100,
              serviceName: 'node_exporter.service',
              lastStatusAt: '2026-05-22T00:00:00Z',
            },
          ],
        }),
      )
    render(<MonitoringTabContent systemId="s1" canOperate />)
    fireEvent.click(await screen.findByRole('button', { name: /^Install$/i }))
    expect(await screen.findByText('Running')).toBeInTheDocument()
    // Install button text now reads Reinstall.
    expect(
      await screen.findByRole('button', { name: /^Reinstall$/i }),
    ).toBeInTheDocument()
  })

  it('surfaces action error on 409 conflict', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          scrapeMode: 'localhost',
          detectedPkgManagers: ['builtin.dnf'],
          exporters: [
            { ...baseExporter, availability: 'available', installed: false },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: 'busy' }, { status: 409 }),
      )
    render(<MonitoringTabContent systemId="s1" canOperate />)
    fireEvent.click(await screen.findByRole('button', { name: /^Install$/i }))
    await waitFor(() => {
      expect(screen.getByText(/Action failed/i)).toBeInTheDocument()
    })
  })

  it('shows Remove button when an installed row has hasRemove', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        scrapeMode: 'localhost',
        detectedPkgManagers: ['builtin.dnf'],
        exporters: [
          {
            ...baseExporter,
            hasRemove: true,
            availability: 'available',
            installed: true,
            state: 'running',
          },
        ],
      }),
    )
    render(<MonitoringTabContent systemId="s1" canOperate />)
    expect(
      await screen.findByRole('button', { name: /^Remove$/i }),
    ).toBeInTheDocument()
  })

  it('disables actions when canOperate is false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        scrapeMode: 'localhost',
        detectedPkgManagers: ['builtin.dnf'],
        exporters: [
          { ...baseExporter, availability: 'available', installed: false },
        ],
      }),
    )
    render(<MonitoringTabContent systemId="s1" canOperate={false} />)
    const btn = await screen.findByRole('button', { name: /^Install$/i })
    expect(btn).toBeDisabled()
  })

  it('flips the Scrape switch and updates the row', async () => {
    // Default to a benign PUT response so any extra click-driven
    // events (PatternFly Switch may fire onChange on both label and
    // input) don't trip the test on undefined mocks.
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'PUT' && url.endsWith('/exporters/builtin.dnf.exporter/scrape')) {
        return Promise.resolve(
          jsonResponse({ exporterId: 'builtin.dnf.exporter', scrapeEnabled: false }),
        )
      }
      return Promise.resolve(
        jsonResponse({
          scrapeMode: 'localhost',
          detectedPkgManagers: ['builtin.dnf'],
          exporters: [
            {
              ...baseExporter,
              availability: 'available',
              installed: true,
              state: 'running',
              scrapeEnabled: true,
              port: 9100,
            },
          ],
        }),
      )
    })
    render(<MonitoringTabContent systemId="s1" canOperate />)
    const sw = await screen.findByRole('switch', { name: /^Scrape /i })
    fireEvent.click(sw)
    expect(await screen.findByText(/^Paused$/)).toBeInTheDocument()
    const putCall = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).endsWith('/exporters/builtin.dnf.exporter/scrape') &&
        (c[1] as RequestInit | undefined)?.method === 'PUT',
    )
    expect(putCall).toBeDefined()
    expect(JSON.parse(String((putCall![1] as RequestInit).body))).toEqual({
      enabled: false,
    })
  })

  it('disables the Scrape switch when canOperate is false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        scrapeMode: 'localhost',
        detectedPkgManagers: ['builtin.dnf'],
        exporters: [
          {
            ...baseExporter,
            availability: 'available',
            installed: true,
            state: 'running',
            scrapeEnabled: true,
          },
        ],
      }),
    )
    render(<MonitoringTabContent systemId="s1" canOperate={false} />)
    const sw = await screen.findByRole('switch', { name: /^Scrape /i })
    expect(sw).toBeDisabled()
  })

  it('shows error state when load fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('500'))
    render(<MonitoringTabContent systemId="s1" canOperate />)
    expect(
      await screen.findByText(/Failed to load exporters/i),
    ).toBeInTheDocument()
  })

  it('shows the "No system id" error when systemId is empty', async () => {
    render(<MonitoringTabContent systemId="" canOperate />)
    expect(await screen.findByText(/No system id/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fires the Probe action on Status click', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          scrapeMode: 'localhost',
          detectedPkgManagers: ['builtin.dnf'],
          exporters: [
            {
              ...baseExporter,
              availability: 'available',
              installed: true,
              state: 'running',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          runId: 'r1',
          exporterId: 'builtin.dnf.exporter',
          kind: 'status',
          status: 'success',
          exitCode: 0,
          state: 'running',
          durationMs: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          scrapeMode: 'localhost',
          detectedPkgManagers: ['builtin.dnf'],
          exporters: [
            {
              ...baseExporter,
              availability: 'available',
              installed: true,
              state: 'running',
            },
          ],
        }),
      )
    render(<MonitoringTabContent systemId="s1" canOperate />)
    fireEvent.click(await screen.findByRole('button', { name: /^Probe$/i }))
    await waitFor(() => {
      const statusCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).endsWith('/exporters/builtin.dnf.exporter/status'),
      )
      expect(statusCall).toBeDefined()
    })
  })

  it('fires the Remove action on Remove click', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          scrapeMode: 'localhost',
          detectedPkgManagers: ['builtin.dnf'],
          exporters: [
            {
              ...baseExporter,
              hasRemove: true,
              availability: 'available',
              installed: true,
              state: 'running',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          runId: 'r1',
          exporterId: 'builtin.dnf.exporter',
          kind: 'remove',
          status: 'success',
          exitCode: 0,
          state: 'removed',
          durationMs: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          scrapeMode: 'localhost',
          detectedPkgManagers: ['builtin.dnf'],
          exporters: [
            {
              ...baseExporter,
              hasRemove: true,
              availability: 'available',
              installed: false,
              state: 'removed',
            },
          ],
        }),
      )
    render(<MonitoringTabContent systemId="s1" canOperate />)
    fireEvent.click(await screen.findByRole('button', { name: /^Remove$/i }))
    await waitFor(() => {
      const removeCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).endsWith('/exporters/builtin.dnf.exporter/remove'),
      )
      expect(removeCall).toBeDefined()
    })
  })

  it('surfaces a non-ApiError exception via extractActionError fallthrough', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          scrapeMode: 'localhost',
          detectedPkgManagers: ['builtin.dnf'],
          exporters: [
            { ...baseExporter, availability: 'available', installed: false },
          ],
        }),
      )
      .mockRejectedValueOnce(new Error('network down'))
    render(<MonitoringTabContent systemId="s1" canOperate />)
    fireEvent.click(await screen.findByRole('button', { name: /^Install$/i }))
    await waitFor(() => {
      expect(screen.getByText(/Action failed/i)).toBeInTheDocument()
      expect(screen.getByText(/network down/)).toBeInTheDocument()
    })
  })
})
