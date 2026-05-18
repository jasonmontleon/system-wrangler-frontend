// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PlatformCard from './PlatformCard'
import type { System } from '../api/systems'

function sys(overrides: Partial<System> = {}): System {
  return {
    id: 's1',
    name: 'host-a',
    hostname: 'h-a.example',
    createdAt: '2026-05-18T00:00:00Z',
    status: 'unprobed',
    ...overrides,
  }
}

function emptyResponse(init: ResponseInit = {}): Response {
  return new Response(null, { status: 204, ...init })
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('PlatformCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the Windows checkbox unchecked when isWindows is absent', () => {
    render(<PlatformCard system={sys()} canEdit={true} onChange={() => {}} />)
    const box = screen.getByRole('checkbox', { name: /windows/i }) as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(box.disabled).toBe(false)
  })

  it('renders checked when isWindows is true', () => {
    render(
      <PlatformCard
        system={sys({ isWindows: true })}
        canEdit={true}
        onChange={() => {}}
      />,
    )
    const box = screen.getByRole('checkbox', { name: /windows/i }) as HTMLInputElement
    expect(box.checked).toBe(true)
  })

  it('disables the checkbox when the caller lacks edit rights', () => {
    render(<PlatformCard system={sys()} canEdit={false} onChange={() => {}} />)
    const box = screen.getByRole('checkbox', { name: /windows/i }) as HTMLInputElement
    expect(box.disabled).toBe(true)
  })

  it('PUTs the platform endpoint and calls onChange when toggled on', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse())
    const onChange = vi.fn()
    render(<PlatformCard system={sys()} canEdit={true} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /windows/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const calls = fetchMock.mock.calls as Array<[string, RequestInit | undefined]>
    expect(calls[0][0]).toBe('/api/systems/s1/platform')
    expect(calls[0][1]?.method).toBe('PUT')
    expect(calls[0][1]?.body).toBe(JSON.stringify({ isWindows: true }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
  })

  it('shows the error alert on a non-2xx response and does not call onChange', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(403, 'forbidden'))
    const onChange = vi.fn()
    render(<PlatformCard system={sys()} canEdit={true} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /windows/i }))
    expect(await screen.findByText(/Could not update platform/i)).toBeInTheDocument()
    expect(screen.getByText(/forbidden/i)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
