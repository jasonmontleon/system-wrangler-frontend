// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  cpuBusyPct,
  diskIoBytesBidi,
  diskIoBytesPerSec,
  diskIopsBidi,
  fsUsedPctMax,
  fsUsedPctPerMount,
  memAvailBytes,
  memUsedPct,
  netIoBidi,
  netIoBytesPerSec,
  tcpEstablished,
  uptimeDays,
} from './promql'

// Each helper produces deterministic PromQL. The tests pin the exact
// string so cross-OS fallback branches (Linux + BSD + Windows) and
// intrinsic filter clauses can't silently drift.

describe('memUsedPct', () => {
  it('emits Linux + BSD + Windows-memory + Windows-os branches, fleet-wide', () => {
    expect(memUsedPct()).toBe(
      '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 ' +
        'or ((node_memory_active_bytes + node_memory_wired_bytes) / ' +
        '(node_memory_active_bytes + node_memory_inactive_bytes + ' +
        'node_memory_wired_bytes + node_memory_free_bytes)) * 100 ' +
        'or (1 - windows_memory_available_bytes / windows_memory_physical_total_bytes) * 100 ' +
        'or (1 - windows_os_physical_memory_free_bytes / windows_os_visible_memory_bytes) * 100',
    )
  })
  it('pastes a per-system selector into every metric reference', () => {
    const out = memUsedPct('{system_id="abc"}')
    expect(out).toContain('node_memory_MemAvailable_bytes{system_id="abc"}')
    expect(out).toContain('windows_memory_physical_total_bytes{system_id="abc"}')
    expect(out).toContain('windows_os_physical_memory_free_bytes{system_id="abc"}')
  })
})

describe('memAvailBytes', () => {
  it('emits Linux + BSD + Windows-memory + Windows-os branches', () => {
    expect(memAvailBytes()).toBe(
      'node_memory_MemAvailable_bytes ' +
        'or (node_memory_inactive_bytes + node_memory_free_bytes) ' +
        'or windows_memory_available_bytes ' +
        'or windows_os_physical_memory_free_bytes',
    )
  })
})

describe('cpuBusyPct', () => {
  it('fleet-wide query uses avg by (system_id)', () => {
    const out = cpuBusyPct()
    expect(out).toContain('avg by (system_id)(rate(node_cpu_seconds_total{mode="idle"}[5m]))')
    expect(out).toContain('avg by (system_id)(rate(windows_cpu_time_total{mode="idle"}[5m]))')
  })
  it('per-system query drops the by aggregation', () => {
    const out = cpuBusyPct('abc')
    expect(out).toContain('avg(rate(node_cpu_seconds_total{system_id="abc",mode="idle"}[5m]))')
    expect(out).toContain('avg(rate(windows_cpu_time_total{system_id="abc",mode="idle"}[5m]))')
    expect(out).not.toContain('by (system_id)')
  })
})

describe('fsUsedPctMax', () => {
  it('bakes the Linux fstype filter, the macOS asset/simulator/system-volume/tmp-mount filters, and the Windows volume filter', () => {
    const out = fsUsedPctMax()
    expect(out).toContain('fstype!~"tmpfs|devtmpfs|squashfs')
    expect(out).toContain('/System/Library/.*')
    expect(out).toContain('/Library/Developer/CoreSimulator/Volumes/.*')
    expect(out).toContain('/System/Volumes/(Hardware|xarts|iSCPreboot|Preboot|Update|VM).*')
    expect(out).toContain('/private/tmp/tmp-mount-.*')
    expect(out).toContain('volume!~"HarddiskVolume.*"')
    expect(out).toContain('max by (system_id)')
  })
  it('per-system query adds the system_id filter to both branches', () => {
    const out = fsUsedPctMax('abc')
    expect(out).toContain('node_filesystem_avail_bytes{system_id="abc",fstype!~')
    expect(out).toContain('windows_logical_disk_free_bytes{system_id="abc",volume!~')
  })
})

describe('netIoBytesPerSec', () => {
  it('fleet-wide aggregates receive + transmit and bakes the device filter', () => {
    const out = netIoBytesPerSec()
    expect(out).toContain('sum by (system_id)(rate(node_network_receive_bytes_total{device!~')
    expect(out).toContain('sum by (system_id)(rate(node_network_transmit_bytes_total{device!~')
    expect(out).toContain('sum by (system_id)(rate(windows_net_bytes_received_total{nic!~')
    expect(out).toContain('sum by (system_id)(rate(windows_net_bytes_sent_total{nic!~')
  })
})

describe('diskIoBytesPerSec', () => {
  it('emits sum read + write per system across both namespaces', () => {
    const out = diskIoBytesPerSec()
    expect(out).toContain('rate(node_disk_read_bytes_total[5m])')
    expect(out).toContain('rate(node_disk_written_bytes_total[5m])')
    expect(out).toContain('rate(windows_logical_disk_read_bytes_total{volume!~')
    expect(out).toContain('rate(windows_logical_disk_write_bytes_total{volume!~')
  })
  it('per-system query scopes via system_id label', () => {
    const out = diskIoBytesPerSec('abc')
    expect(out).toContain('node_disk_read_bytes_total{system_id="abc"}')
    expect(out).toContain('windows_logical_disk_read_bytes_total{system_id="abc",volume!~')
  })
})

describe('netIoBidi', () => {
  it('emits direction=in,out series for both namespaces', () => {
    const out = netIoBidi('abc')
    expect(out).toContain('label_replace(sum without(device)(rate(node_network_receive_bytes_total')
    expect(out).toContain('"direction", "in"')
    expect(out).toContain('"direction", "out"')
    expect(out).toContain('label_replace(sum without(nic)(rate(windows_net_bytes_received_total')
    expect(out).toContain('label_replace(sum without(nic)(rate(windows_net_bytes_sent_total')
  })
})

describe('diskIoBytesBidi', () => {
  it('emits direction=read,write series for both namespaces', () => {
    const out = diskIoBytesBidi('abc')
    expect(out).toContain('"direction", "read"')
    expect(out).toContain('"direction", "write"')
    expect(out).toContain('without(device)(rate(node_disk_read_bytes_total{system_id="abc"}')
    expect(out).toContain('without(volume)(rate(windows_logical_disk_read_bytes_total')
  })
})

describe('diskIopsBidi', () => {
  it('uses the completed-ops counters, not the bytes counters', () => {
    const out = diskIopsBidi('abc')
    expect(out).toContain('node_disk_reads_completed_total')
    expect(out).toContain('node_disk_writes_completed_total')
    expect(out).toContain('windows_logical_disk_reads_total')
    expect(out).toContain('windows_logical_disk_writes_total')
  })
})

describe('fsUsedPctPerMount', () => {
  it('emits per-mount Linux + per-volume Windows branches', () => {
    const out = fsUsedPctPerMount('abc')
    expect(out).toContain('node_filesystem_avail_bytes{system_id="abc",fstype!~')
    expect(out).toContain('windows_logical_disk_free_bytes{system_id="abc",volume!~')
    expect(out).not.toContain('max(')
    expect(out).not.toContain('by (system_id)')
  })
})

describe('tcpEstablished', () => {
  it('chains the Linux counter with a sum-across-families Windows fallback', () => {
    const out = tcpEstablished('abc')
    expect(out).toContain('node_netstat_Tcp_CurrEstab{system_id="abc"}')
    expect(out).toContain('sum without(family)(windows_tcp_connections_established{system_id="abc"})')
  })
})

describe('uptimeDays', () => {
  it('subtracts boot-time timestamps from time() for all four branches, clamped at zero', () => {
    const out = uptimeDays('abc')
    expect(out).toContain('clamp_min((time() - node_boot_time_seconds{system_id="abc"}) / 86400, 0)')
    expect(out).toContain('clamp_min((time() - windows_system_boot_time_timestamp{system_id="abc"}) / 86400, 0)')
    expect(out).toContain('clamp_min((time() - windows_system_boot_time_timestamp_seconds{system_id="abc"}) / 86400, 0)')
    expect(out).toContain('clamp_min((time() - windows_system_system_up_time{system_id="abc"}) / 86400, 0)')
  })
})
