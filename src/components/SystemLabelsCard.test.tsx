// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SystemLabelsCard from './SystemLabelsCard'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SystemLabelsCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows "No labels." when the system has none', () => {
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[]}
        canEdit={true}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText(/No labels\./)).toBeInTheDocument()
  })

  it('renders chips for k=v and bare-tag labels', () => {
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[
          { key: 'env', value: 'prod' },
          { key: 'oncall', value: null },
        ]}
        canEdit={true}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('env=prod')).toBeInTheDocument()
    expect(screen.getByText('oncall')).toBeInTheDocument()
  })

  it('hides the add-label form and remove buttons when canEdit is false', () => {
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[{ key: 'env', value: 'prod' }]}
        canEdit={false}
        onChange={() => {}}
      />,
    )
    expect(screen.queryByLabelText(/new label/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /remove env/i })).toBeNull()
  })

  it('submits a k=v label via PUT and clears the input on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ key: 'env', value: 'prod' }),
    )
    const onChange = vi.fn()
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[]}
        canEdit={true}
        onChange={onChange}
      />,
    )
    const input = screen.getByLabelText(/new label/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'env=prod' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems/s1/labels/env')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ value: 'prod' })
    expect(input.value).toBe('')
  })

  it('treats a no-= input as a bare tag (value:null)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ key: 'oncall', value: null }),
    )
    const onChange = vi.fn()
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[]}
        canEdit={true}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText(/new label/i), {
      target: { value: 'oncall' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems/s1/labels/oncall')
    expect(JSON.parse(init.body)).toEqual({ value: null })
  })

  it('lets the empty-string value through (env= -> "")', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ key: 'tier', value: '' }))
    const onChange = vi.fn()
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[]}
        canEdit={true}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText(/new label/i), {
      target: { value: 'tier=' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ value: '' })
  })

  it('rejects a leading "=" (empty key) without calling the API', () => {
    const onChange = vi.fn()
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[]}
        canEdit={true}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText(/new label/i), {
      target: { value: '=oops' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText(/Key is required/i)).toBeInTheDocument()
  })

  it('surfaces a 403 reserved-prefix rejection inline', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: 'label key uses reserved prefix: "system-wrangler.io/"' },
        403,
      ),
    )
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[]}
        canEdit={true}
        onChange={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText(/new label/i), {
      target: { value: 'system-wrangler.io/x=y' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(
      await screen.findByText(/reserved prefix/i),
    ).toBeInTheDocument()
  })

  it('surfaces a 400 validation error inline', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid label: key has illegal character " "' }, 400),
    )
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[]}
        canEdit={true}
        onChange={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText(/new label/i), {
      target: { value: 'bad key=x' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(
      await screen.findByText(/illegal character/i),
    ).toBeInTheDocument()
  })

  it('surfaces a delete-side failure inline', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'forbidden' }, 403),
    )
    const onChange = vi.fn()
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[{ key: 'env', value: 'prod' }]}
        canEdit={true}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /remove env/i }))
    expect(await screen.findByText(/forbidden/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('removes a label via the chip close affordance', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const onChange = vi.fn()
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[{ key: 'env', value: 'prod' }]}
        canEdit={true}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /remove env/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/systems/s1/labels/env')
    expect(init.method).toBe('DELETE')
  })

  it('disables Add while the request is in flight', async () => {
    let resolveFetch: (r: Response) => void = () => {}
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((res) => {
        resolveFetch = res
      }),
    )
    const onChange = vi.fn()
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[]}
        canEdit={true}
        onChange={onChange}
      />,
    )
    const input = screen.getByLabelText(/new label/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'env=prod' } })
    const button = screen.getByRole('button', { name: /^add$/i })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    expect(input).toBeDisabled()
    resolveFetch(jsonResponse({ key: 'env', value: 'prod' }))
    await waitFor(() => expect(input).not.toBeDisabled())
    expect(onChange).toHaveBeenCalled()
  })

  it('does not open the color picker when canManageStyles is false', () => {
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[{ key: 'env', value: 'prod' }]}
        canEdit={true}
        canManageStyles={false}
        onChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('env=prod'))
    expect(screen.queryByRole('radiogroup', { name: /label color/i })).toBeNull()
  })

  it('opens the picker on chip click when canManageStyles is true', () => {
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[{ key: 'env', value: 'prod' }]}
        canEdit={true}
        canManageStyles={true}
        onChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('env=prod'))
    expect(
      screen.getByRole('radiogroup', { name: /label color/i }),
    ).toBeInTheDocument()
  })

  it('PUTs the chosen color and closes the picker on success', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ key: 'env', color: 'red' }),
    )
    const onChange = vi.fn()
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[{ key: 'env', value: 'prod' }]}
        canEdit={true}
        canManageStyles={true}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText('env=prod'))
    fireEvent.click(screen.getByRole('radio', { name: /set color to red/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/label-styles/env')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ color: 'red' })
    expect(screen.queryByRole('radiogroup', { name: /label color/i })).toBeNull()
  })

  it('DELETEs the override when Auto is clicked (an override is present)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const onChange = vi.fn()
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[{ key: 'env', value: 'prod' }]}
        canEdit={true}
        canManageStyles={true}
        styleOverrides={{ env: 'red' }}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText('env=prod'))
    fireEvent.click(screen.getByRole('button', { name: /auto/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/label-styles/env')
    expect(init.method).toBe('DELETE')
  })

  it('Cancel closes the picker without firing a request', () => {
    const onChange = vi.fn()
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[{ key: 'env', value: 'prod' }]}
        canEdit={true}
        canManageStyles={true}
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByText('env=prod'))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('radiogroup', { name: /label color/i })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('surfaces a 403 from setLabelStyle inline', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'forbidden' }, 403),
    )
    render(
      <SystemLabelsCard
        systemId="s1"
        labels={[{ key: 'env', value: 'prod' }]}
        canEdit={true}
        canManageStyles={true}
        onChange={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('env=prod'))
    fireEvent.click(screen.getByRole('radio', { name: /set color to red/i }))
    expect(await screen.findByText(/forbidden/i)).toBeInTheDocument()
  })
})
