// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LabelColorPicker from './LabelColorPicker'

const noop = () => {}

describe('LabelColorPicker', () => {
  it('renders one radio per palette color and marks the current one checked', () => {
    render(
      <LabelColorPicker
        labelText="env=prod"
        currentColor="blue"
        hasOverride={true}
        isBusy={false}
        onSelect={noop}
        onReset={noop}
        onCancel={noop}
      />,
    )
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBe(9)
    const blue = screen.getByRole('radio', { name: /set color to blue/i })
    expect(blue.getAttribute('aria-checked')).toBe('true')
    const red = screen.getByRole('radio', { name: /set color to red/i })
    expect(red.getAttribute('aria-checked')).toBe('false')
  })

  it('emits onSelect with the clicked color', () => {
    const onSelect = vi.fn()
    render(
      <LabelColorPicker
        labelText="env=prod"
        currentColor="blue"
        hasOverride={true}
        isBusy={false}
        onSelect={onSelect}
        onReset={noop}
        onCancel={noop}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: /set color to red/i }))
    expect(onSelect).toHaveBeenCalledWith('red')
  })

  it('disables the Auto button when there is no persisted override', () => {
    render(
      <LabelColorPicker
        labelText="env=prod"
        currentColor="blue"
        hasOverride={false}
        isBusy={false}
        onSelect={noop}
        onReset={noop}
        onCancel={noop}
      />,
    )
    expect(screen.getByRole('button', { name: /auto/i })).toBeDisabled()
  })

  it('emits onReset when Auto is clicked', () => {
    const onReset = vi.fn()
    render(
      <LabelColorPicker
        labelText="env=prod"
        currentColor="blue"
        hasOverride={true}
        isBusy={false}
        onSelect={noop}
        onReset={onReset}
        onCancel={noop}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /auto/i }))
    expect(onReset).toHaveBeenCalled()
  })

  it('emits onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn()
    render(
      <LabelColorPicker
        labelText="env=prod"
        currentColor="blue"
        hasOverride={true}
        isBusy={false}
        onSelect={noop}
        onReset={noop}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables every control while a request is in flight', () => {
    render(
      <LabelColorPicker
        labelText="env=prod"
        currentColor="blue"
        hasOverride={true}
        isBusy={true}
        onSelect={noop}
        onReset={noop}
        onCancel={noop}
      />,
    )
    for (const r of screen.getAllByRole('radio')) {
      expect(r).toBeDisabled()
    }
    expect(screen.getByRole('button', { name: /auto/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
  })
})
