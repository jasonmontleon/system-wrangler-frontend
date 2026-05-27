// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  interpretLabelInput,
  partitionSelector,
} from './labelSelectorPartition'

describe('partitionSelector', () => {
  it('sends real label tokens to the backend untouched', () => {
    const { backend, statusFilter } = partitionSelector('env=prod,role!=cache')
    expect(backend).toBe('env=prod,role!=cache')
    expect(statusFilter('reachable')).toBe(true) // no status reqs → always true
  })

  it('strips status=X out of the backend selector and filters client-side', () => {
    const { backend, statusFilter } = partitionSelector('env=prod,status=reachable')
    expect(backend).toBe('env=prod')
    expect(statusFilter('reachable')).toBe(true)
    expect(statusFilter('unreachable')).toBe(false)
  })

  it('handles status!=X', () => {
    const { backend, statusFilter } = partitionSelector('status!=unreachable')
    expect(backend).toBe('')
    expect(statusFilter('reachable')).toBe(true)
    expect(statusFilter('unreachable')).toBe(false)
    expect(statusFilter('unprobed')).toBe(true)
  })

  it('handles status in (...) (parens not split on inner comma)', () => {
    const { backend, statusFilter } = partitionSelector(
      'status in (reachable,unprobed)',
    )
    expect(backend).toBe('')
    expect(statusFilter('reachable')).toBe(true)
    expect(statusFilter('unprobed')).toBe(true)
    expect(statusFilter('unreachable')).toBe(false)
  })

  it('handles status notin (...)', () => {
    const { statusFilter } = partitionSelector('status notin (unreachable)')
    expect(statusFilter('reachable')).toBe(true)
    expect(statusFilter('unreachable')).toBe(false)
  })

  it('treats a bare status name as shorthand for status=<name>', () => {
    const { backend, statusFilter } = partitionSelector('reachable')
    expect(backend).toBe('')
    expect(statusFilter('reachable')).toBe(true)
    expect(statusFilter('unreachable')).toBe(false)
  })

  it('matches the bare status shorthand case-insensitively', () => {
    const { statusFilter } = partitionSelector('Unreachable')
    expect(statusFilter('unreachable')).toBe(true)
    expect(statusFilter('reachable')).toBe(false)
  })

  it('combines a status shorthand with a real label selector', () => {
    const { backend, statusFilter } = partitionSelector('unreachable,env=prod')
    expect(backend).toBe('env=prod')
    expect(statusFilter('unreachable')).toBe(true)
    expect(statusFilter('reachable')).toBe(false)
  })

  it('returns an empty backend selector and a permissive filter for empty input', () => {
    const { backend, statusFilter } = partitionSelector('')
    expect(backend).toBe('')
    expect(statusFilter('reachable')).toBe(true)
    expect(statusFilter('unreachable')).toBe(true)
  })

  it('treats bare "status" as always-true and "!status" as never', () => {
    expect(partitionSelector('status').statusFilter('reachable')).toBe(true)
    expect(partitionSelector('!status').statusFilter('reachable')).toBe(false)
  })

  it('AND-joins multiple status requirements', () => {
    const { statusFilter } = partitionSelector(
      'status!=unreachable,status!=unprobed',
    )
    expect(statusFilter('reachable')).toBe(true)
    expect(statusFilter('unreachable')).toBe(false)
    expect(statusFilter('unprobed')).toBe(false)
  })
})

describe('interpretLabelInput', () => {
  const reachable = { status: 'reachable' as const, labels: [] }
  const unreachable = { status: 'unreachable' as const, labels: [] }
  const unprobed = { status: 'unprobed' as const, labels: [] }
  const prodDb = {
    status: 'reachable' as const,
    labels: [
      { key: 'env', value: 'prod' },
      { key: 'role', value: 'db' },
    ],
  }
  const oncallBare = {
    status: 'reachable' as const,
    labels: [{ key: 'oncall', value: null }],
  }

  it('empty input matches everything and sends nothing to the backend', () => {
    const { backend, matches } = interpretLabelInput('')
    expect(backend).toBe('')
    expect(matches(reachable)).toBe(true)
    expect(matches(unreachable)).toBe(true)
  })

  it('substring mode matches partial status names', () => {
    const { backend, matches } = interpretLabelInput('reach')
    expect(backend).toBe('')
    expect(matches(reachable)).toBe(true)
    expect(matches(unreachable)).toBe(true) // "reach" is a substring of "unreachable"
    expect(matches(unprobed)).toBe(false)
  })

  it('substring mode matches partial status-name prefixes ("un")', () => {
    const { backend, matches } = interpretLabelInput('un')
    expect(backend).toBe('')
    expect(matches(reachable)).toBe(false)
    expect(matches(unreachable)).toBe(true)
    expect(matches(unprobed)).toBe(true)
  })

  it('substring mode matches inside user label values', () => {
    const { backend, matches } = interpretLabelInput('prod')
    expect(backend).toBe('')
    expect(matches(prodDb)).toBe(true)
    expect(matches(reachable)).toBe(false)
  })

  it('substring mode matches user label keys', () => {
    const { matches } = interpretLabelInput('env')
    expect(matches(prodDb)).toBe(true)
    expect(matches(reachable)).toBe(false)
  })

  it('substring mode matches bare-tag keys', () => {
    const { matches } = interpretLabelInput('oncall')
    expect(matches(oncallBare)).toBe(true)
    expect(matches(reachable)).toBe(false)
  })

  it('substring mode is case-insensitive', () => {
    const { matches } = interpretLabelInput('PROD')
    expect(matches(prodDb)).toBe(true)
  })

  it('grammar mode takes over the moment a selector marker appears', () => {
    const { backend, matches } = interpretLabelInput('env=prod')
    expect(backend).toBe('env=prod')
    // status predicate is permissive when no `status` requirements present
    expect(matches(reachable)).toBe(true)
    expect(matches(prodDb)).toBe(true)
  })

  it('grammar mode handles mixed status + real label requirements', () => {
    const { backend, matches } = interpretLabelInput('env=prod,status=reachable')
    expect(backend).toBe('env=prod')
    expect(matches(prodDb)).toBe(true)
    // status mismatch — the env=prod half is backend-applied, but the
    // SPA's status filter still gates here.
    expect(matches(unreachable)).toBe(false)
  })

  it('grammar mode is triggered by a comma', () => {
    const { backend, matches } = interpretLabelInput('a,b')
    expect(backend).toBe('a,b')
    // No status requirement → predicate permissive.
    expect(matches(reachable)).toBe(true)
  })

  it('grammar mode is triggered by " in " keyword', () => {
    const { backend } = interpretLabelInput('region in (us-east)')
    expect(backend).toBe('region in (us-east)')
  })

  it('grammar mode does NOT trigger on identifiers starting with "in"', () => {
    // "inventory" contains "in" but no surrounding spaces → substring mode.
    const { backend, matches } = interpretLabelInput('inventory')
    expect(backend).toBe('')
    expect(matches({ status: 'reachable', labels: [{ key: 'inventory', value: 'a' }] })).toBe(true)
  })
})
