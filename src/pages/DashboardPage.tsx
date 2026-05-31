// SPDX-License-Identifier: Apache-2.0

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Button,
  Flex,
  FlexItem,
  PageSection,
  Title,
} from '@patternfly/react-core'
import { CogIcon } from '@patternfly/react-icons'
import { apiFetch } from '../api/client'
import { fetchReadiness, type Readiness } from '../api/readiness'
import { listSystems, type System } from '../api/systems'
import { listGroups, type Group } from '../api/groups'
import { query } from '../api/metrics'
import { queryRebootRequiredSet } from '../util/rebootSignal'
import {
  cpuBusyPct,
  diskIoBytesPerSec,
  fsUsedPctMax,
  memUsedPct,
  netIoBytesPerSec,
} from '../api/promql'
import { useEventStream } from '../hooks/useEventStream'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useDashboardLayout } from '../hooks/useDashboardLayout'
import { DashboardProvider } from '../dashboard/DashboardContext'
import type {
  BackendHealth,
  DashboardContextValue,
  DashboardMetrics,
} from '../dashboard/dashboardContext'
import { WIDGETS_BY_ID } from '../dashboard/widgets'
import { ROW_UNIT_PX } from '../dashboard/widgetSize'
import CustomizeDashboardModal from '../components/CustomizeDashboardModal'

const METRIC_REFRESH_INTERVAL_MS = 30_000

// Health and readiness poll on a shorter cadence than metrics so the
// status cards reflect a backend that disappeared within roughly one
// poll window. The frontend is served from the same binary, so anyone
// looking at the dashboard after it shuts down is reading a stale
// page — the cards are the only signal that something changed.
const HEALTH_POLL_INTERVAL_MS = 15_000

const PROMQL = {
  cpu: cpuBusyPct(),
  mem: memUsedPct(),
  disk: fsUsedPctMax(),
  netIo: netIoBytesPerSec(),
  diskIo: diskIoBytesPerSec(),
}

function indexBySystemId(
  vector: { metric: Record<string, string>; value: [number, string] }[],
): Map<string, number> {
  const map = new Map<string, number>()
  for (const entry of vector) {
    const id = entry.metric.system_id
    if (!id) continue
    const n = Number(entry.value[1])
    if (Number.isFinite(n)) map.set(id, n)
  }
  return map
}

export default function DashboardPage() {
  const [health, setHealth] = useState<BackendHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [readinessError, setReadinessError] = useState<string | null>(null)
  const [systems, setSystems] = useState<System[] | null>(null)
  const [systemsError, setSystemsError] = useState<string | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [rebootMetricSet, setRebootMetricSet] = useState<Set<string>>(new Set())
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    cpu: new Map(),
    mem: new Map(),
    disk: new Map(),
    netIo: new Map(),
    diskIo: new Map(),
  })
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const { layout, setLayout, reset: resetLayout } = useDashboardLayout()
  const isNarrow = useMediaQuery('(max-width: 767px)')

  useEffect(() => {
    let cancelled = false
    async function pollHealth() {
      try {
        const r = await apiFetch('/api/health')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const body = (await r.json()) as BackendHealth
        if (cancelled) return
        setHealth(body)
        setHealthError(null)
      } catch (e) {
        if (cancelled) return
        // Clear the cached value so the widget falls through to the
        // error branch; a stale "ok" next to an error message would
        // mislead the operator.
        setHealth(null)
        setHealthError(e instanceof Error ? e.message : String(e))
      }
    }
    void pollHealth()
    const handle = window.setInterval(() => {
      void pollHealth()
    }, HEALTH_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function pollReadiness() {
      try {
        const body = await fetchReadiness()
        if (cancelled) return
        setReadiness(body)
        setReadinessError(null)
      } catch (e) {
        if (cancelled) return
        setReadiness(null)
        setReadinessError(e instanceof Error ? e.message : String(e))
      }
    }
    void pollReadiness()
    const handle = window.setInterval(() => {
      void pollReadiness()
    }, HEALTH_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const data = await listSystems()
      setSystems(data)
      setSystemsError(null)
    } catch (e) {
      setSystemsError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    listGroups()
      .then(setGroups)
      .catch(() => {
        // Groups feed the per-group widget picker only; on failure we
        // just render an empty list in the modal — no toast.
      })
  }, [])

  // Debounced refresh on the systems.changed event so a Check across
  // every system (or a probe tick) ripples here without flooding the API.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEventStream(
    useCallback(
      (event) => {
        if (event.type !== 'systems.changed') return
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          void refresh()
        }, 200)
      },
      [refresh],
    ),
  )
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const [cpu, mem, disk, netIo, diskIo, rebootSet] = await Promise.all([
          query(PROMQL.cpu),
          query(PROMQL.mem),
          query(PROMQL.disk),
          query(PROMQL.netIo),
          query(PROMQL.diskIo),
          queryRebootRequiredSet(),
        ])
        if (cancelled) return
        setRebootMetricSet(rebootSet)
        setMetrics({
          cpu: indexBySystemId(cpu),
          mem: indexBySystemId(mem),
          disk: indexBySystemId(disk),
          netIo: indexBySystemId(netIo),
          diskIo: indexBySystemId(diskIo),
        })
      } catch {
        // Soft-fail: keep last good values.
      }
    }
    void tick()
    const handle = window.setInterval(() => {
      void tick()
    }, METRIC_REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  const contextValue: DashboardContextValue = useMemo(
    () => ({
      systems,
      systemsError,
      rebootMetricSet,
      health,
      healthError,
      readiness,
      readinessError,
      metrics,
      groups,
    }),
    [
      systems,
      systemsError,
      rebootMetricSet,
      health,
      healthError,
      readiness,
      readinessError,
      metrics,
      groups,
    ],
  )

  const visible = layout.filter((e) => e.enabled)

  return (
    <>
      <PageSection>
        <Flex
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsCenter' }}
        >
          <FlexItem>
            <Title headingLevel="h1">Dashboard</Title>
          </FlexItem>
          <FlexItem>
            <Button
              variant="secondary"
              icon={<CogIcon />}
              onClick={() => setCustomizeOpen(true)}
            >
              Customize dashboard
            </Button>
          </FlexItem>
        </Flex>
      </PageSection>
      <PageSection aria-label="Dashboard widgets">
        <DashboardProvider value={contextValue}>
          <div
            style={
              isNarrow
                ? {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                  }
                : {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(12, 1fr)',
                    gridAutoRows: `${ROW_UNIT_PX}px`,
                    gridAutoFlow: 'dense',
                    gap: '1rem',
                  }
            }
          >
            {visible.map((entry) => {
              const spec = WIDGETS_BY_ID.get(entry.widgetId)
              if (!spec) return null
              const Component = spec.Component
              return (
                <div
                  key={entry.instanceId}
                  data-instance-id={entry.instanceId}
                  data-widget-id={entry.widgetId}
                  style={
                    isNarrow
                      ? { minWidth: 0 }
                      : {
                          gridColumn: `span ${spec.cell.colSpan}`,
                          gridRow: `span ${spec.cell.rowSpan}`,
                          minWidth: 0,
                          minHeight: 0,
                        }
                  }
                >
                  <Component params={entry.params} />
                </div>
              )
            })}
          </div>
        </DashboardProvider>
      </PageSection>
      <CustomizeDashboardModal
        isOpen={customizeOpen}
        layout={layout}
        groups={groups}
        onApply={setLayout}
        onReset={() => {
          resetLayout()
          return Array.from(WIDGETS_BY_ID.values())
            .filter((w) => w.defaultEnabled)
            .map((w) => ({
              instanceId: w.id,
              widgetId: w.id,
              enabled: w.defaultEnabled,
            }))
        }}
        onClose={() => setCustomizeOpen(false)}
      />
    </>
  )
}
