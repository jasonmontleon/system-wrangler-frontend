// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlatformIcon, SystemStatusIcon } from './systemsTable'

describe('PlatformIcon', () => {
  it('renders the Linux icon with distribution as accessible label', () => {
    render(<PlatformIcon osFamily="Linux" osDistribution="Fedora 41" />)
    expect(screen.getAllByLabelText(/fedora 41/i).length).toBeGreaterThan(0)
  })

  it('renders the Apple icon for the Darwin family with the distribution label', () => {
    render(<PlatformIcon osFamily="Darwin" osDistribution="macOS 14.6" />)
    expect(screen.getAllByLabelText(/macos 14\.6/i).length).toBeGreaterThan(0)
  })

  it('renders the Windows icon', () => {
    render(<PlatformIcon osFamily="Windows" osDistribution="Microsoft Windows 11 Pro 10.0.22631" />)
    expect(screen.getAllByLabelText(/microsoft windows 11 pro/i).length).toBeGreaterThan(0)
  })

  it.each(['FreeBSD', 'OpenBSD', 'NetBSD'])(
    'renders the BSD icon for %s with the distribution label',
    (family) => {
      render(<PlatformIcon osFamily={family} osDistribution={`${family} 14.0`} />)
      expect(
        screen.getAllByLabelText(new RegExp(`${family} 14\\.0`, 'i')).length,
      ).toBeGreaterThan(0)
    },
  )

  it('falls back to the family name when distribution is missing', () => {
    render(<PlatformIcon osFamily="Linux" osDistribution="" />)
    expect(screen.getAllByLabelText('Linux').length).toBeGreaterThan(0)
  })

  it('renders an aria-hidden alignment placeholder when osFamily is empty', () => {
    const { container } = render(
      <PlatformIcon osFamily="" osDistribution="" />,
    )
    const slot = container.firstChild as HTMLElement | null
    expect(slot).not.toBeNull()
    expect(slot?.getAttribute('aria-hidden')).toBe('true')
    expect(slot?.style.width).toBe('1em')
  })

  it('renders an aria-hidden alignment placeholder for an unrecognized OS family', () => {
    const { container } = render(
      <PlatformIcon osFamily="Plan9" osDistribution="Plan 9 v4" />,
    )
    const slot = container.firstChild as HTMLElement | null
    expect(slot).not.toBeNull()
    expect(slot?.getAttribute('aria-hidden')).toBe('true')
    expect(slot?.style.width).toBe('1em')
  })

  it('falls back to the Windows icon when osFamily is empty but isWindows is true', () => {
    render(
      <PlatformIcon osFamily="" osDistribution="" isWindows={true} />,
    )
    expect(screen.getAllByLabelText('Windows').length).toBeGreaterThan(0)
  })

  it('prefers detected osFamily over the isWindows fallback', () => {
    render(
      <PlatformIcon
        osFamily="Linux"
        osDistribution="Fedora 41"
        isWindows={true}
      />,
    )
    expect(screen.getAllByLabelText(/fedora 41/i).length).toBeGreaterThan(0)
  })
})

describe('SystemStatusIcon', () => {
  it('renders the reboot-required glyph when rebootRequiredAt is set on an otherwise-healthy host', () => {
    render(
      <SystemStatusIcon
        status="reachable"
        pendingUpdates={0}
        lastRunFailed={false}
        rebootRequired={true}
      />,
    )
    expect(screen.getByLabelText('Reboot required')).toBeTruthy()
    expect(screen.queryByLabelText('Up to date')).toBeNull()
  })

  it('keeps lastRunFailed precedence over reboot required', () => {
    render(
      <SystemStatusIcon
        status="reachable"
        pendingUpdates={0}
        lastRunFailed={true}
        rebootRequired={true}
      />,
    )
    expect(screen.getByLabelText('Last run failed')).toBeTruthy()
    expect(screen.queryByLabelText('Reboot required')).toBeNull()
  })

  it('keeps unreachable precedence over reboot required', () => {
    render(
      <SystemStatusIcon
        status="unreachable"
        pendingUpdates={undefined}
        lastRunFailed={false}
        rebootRequired={true}
      />,
    )
    expect(screen.getByLabelText('Unreachable')).toBeTruthy()
    expect(screen.queryByLabelText('Reboot required')).toBeNull()
  })

  it('falls through to up-to-date when rebootRequiredAt is absent', () => {
    render(
      <SystemStatusIcon
        status="reachable"
        pendingUpdates={0}
        lastRunFailed={false}
      />,
    )
    expect(screen.getByLabelText('Up to date')).toBeTruthy()
  })
})
