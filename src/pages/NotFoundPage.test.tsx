// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import NotFoundPage from './NotFoundPage'

describe('NotFoundPage', () => {
  it('renders the not-found heading and a link back to dashboard', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { name: /page not found/i }),
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /back to dashboard/i })
    expect(link.getAttribute('href')).toBe('/')
  })
})
