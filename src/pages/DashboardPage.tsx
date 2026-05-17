// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
  Grid,
  GridItem,
  PageSection,
  Spinner,
  Title,
} from '@patternfly/react-core'
import { ChartDonut } from '@patternfly/react-charts/victory'
import { apiFetch } from '../api/client'
import { listSystems, type System } from '../api/systems'
import { useEventStream } from '../hooks/useEventStream'

type Health = { status: string }

// HealthBucket is one of five mutually exclusive states each system
// rolls up to. The precedence matches SystemStatusIcon so the donut
// can't disagree with the per-row glyph on the Systems page.
type HealthBucket =
  | 'healthy'
  | 'updates'
  | 'unreachable'
  | 'failed'
  | 'unknown'

type BucketSpec = {
  key: HealthBucket
  label: string
  color: string
}

// PatternFly v6 status hex codes mirrored here so the SVG-rendered
// donut can use them directly. The icons on the Systems page pull
// these via CSS custom properties; the chart is rendered inline and
// can't pierce CSS vars cleanly, so the hex codes live alongside.
const BUCKETS: BucketSpec[] = [
  { key: 'healthy', label: 'Healthy', color: '#3E8635' },
  { key: 'updates', label: 'Updates available', color: '#F0AB00' },
  { key: 'unreachable', label: 'Unreachable', color: '#C9190B' },
  { key: 'failed', label: 'Failed run', color: '#7D1007' },
  { key: 'unknown', label: 'Unknown', color: '#8A8D90' },
]

function classify(s: System): HealthBucket {
  if (s.status === 'unreachable') return 'unreachable'
  if (s.lastRunFailed) return 'failed'
  if (s.status === 'reachable' && s.pendingUpdates !== undefined) {
    return s.pendingUpdates === 0 ? 'healthy' : 'updates'
  }
  return 'unknown'
}

function tally(systems: System[]): Record<HealthBucket, number> {
  const out: Record<HealthBucket, number> = {
    healthy: 0,
    updates: 0,
    unreachable: 0,
    failed: 0,
    unknown: 0,
  }
  for (const s of systems) {
    out[classify(s)] += 1
  }
  return out
}

export default function DashboardPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [systems, setSystems] = useState<System[] | null>(null)
  const [systemsError, setSystemsError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch((e) => setHealthError(String(e)))
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

  // Debounced refresh on the systems.changed event so a fleet-wide
  // Check on the Systems page (or a probe tick) ripples here without
  // flooding the API.
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

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Dashboard</Title>
      </PageSection>
      <PageSection>
        <Grid hasGutter>
          <GridItem md={6} lg={4}>
            <SystemHealthCard
              systems={systems}
              loadError={systemsError}
            />
          </GridItem>
          <GridItem md={6} lg={4}>
            <Card>
              <CardTitle>Backend health</CardTitle>
              <CardBody>
                {healthError && <span>error: {healthError}</span>}
                {!healthError && !health && (
                  <Bullseye>
                    <Spinner />
                  </Bullseye>
                )}
                {health && <span>status: {health.status}</span>}
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>
    </>
  )
}

function SystemHealthCard({
  systems,
  loadError,
}: {
  systems: System[] | null
  loadError: string | null
}) {
  const counts = useMemo(
    () => (systems ? tally(systems) : null),
    [systems],
  )
  const total = systems?.length ?? 0

  return (
    <Card>
      <CardTitle>System health</CardTitle>
      <CardBody>
        {loadError && (
          <Alert variant="danger" title="Could not load systems" isInline>
            {loadError}
          </Alert>
        )}
        {!loadError && systems === null && (
          <Bullseye style={{ minHeight: '12rem' }}>
            <Spinner />
          </Bullseye>
        )}
        {!loadError && systems !== null && total === 0 && (
          <EmptyState titleText="No systems yet" headingLevel="h2">
            <EmptyStateBody>
              Add a system from the Systems page to start seeing health
              data here.
            </EmptyStateBody>
          </EmptyState>
        )}
        {!loadError && counts && total > 0 && (
          <Flex
            direction={{ default: 'column' }}
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItemsMd' }}
          >
            <FlexItem>
              <div style={{ height: 320, width: 320 }}>
                <ChartDonut
                  ariaDesc="System health distribution"
                  ariaTitle="System health"
                  constrainToVisibleArea
                  data={BUCKETS.map((b) => ({
                    x: b.label,
                    y: counts[b.key],
                  }))}
                  labels={({ datum }: { datum: { x: string; y: number } }) =>
                    `${datum.x}: ${datum.y}`
                  }
                  colorScale={BUCKETS.map((b) => b.color)}
                  height={320}
                  width={320}
                  innerRadius={90}
                  title={String(total)}
                  subTitle={total === 1 ? 'System' : 'Systems'}
                />
              </div>
            </FlexItem>
            <FlexItem alignSelf={{ default: 'alignSelfStretch' }}>
              <BucketLegend counts={counts} />
            </FlexItem>
          </Flex>
        )}
      </CardBody>
    </Card>
  )
}

function BucketLegend({ counts }: { counts: Record<HealthBucket, number> }) {
  return (
    <Grid hasGutter>
      {BUCKETS.map((b) => (
        <GridItem key={b.key} span={12}>
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItemsSm' }}
          >
            <FlexItem>
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: '0.75rem',
                  height: '0.75rem',
                  borderRadius: '50%',
                  backgroundColor: b.color,
                  verticalAlign: 'middle',
                }}
              />
            </FlexItem>
            <FlexItem flex={{ default: 'flex_1' }}>{b.label}</FlexItem>
            <FlexItem>
              <strong aria-label={`${b.label} count`}>{counts[b.key]}</strong>
            </FlexItem>
          </Flex>
        </GridItem>
      ))}
    </Grid>
  )
}
