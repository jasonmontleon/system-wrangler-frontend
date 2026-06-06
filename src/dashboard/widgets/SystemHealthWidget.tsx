// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
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
  Spinner,
} from '@patternfly/react-core'
import { ChartDonut, ChartLabel } from '@patternfly/react-charts/victory'
import { useNavigate } from 'react-router'
import { useDashboardData } from '../dashboardContext'
import type { WidgetParams } from '../widgets'
import { BUCKETS, type HealthBucket, tally } from './systemHealthShared'

type Variant = 'full' | 'compact'

const DONUT_SIZE: Record<Variant, number> = {
  full: 320,
  compact: 240,
}

// Victory's ChartDonut paints the center number (title) and the
// "Systems" caption (subtitle) via inline SVG `fill`, which sidesteps
// the .pf-v6-theme-dark class on <html>. Without an explicit fill the
// text ends up nearly invisible in dark mode. Threading the PatternFly
// regular-text token through ChartLabel.style lets the SVG resolve the
// right color per theme. Same trick MetricsPanel uses for its axis
// labels. Passing a separate subTitleComponent (below) also makes
// Victory render the caption as its own <text> element, so we can wire
// a click handler to the center number and the "Systems" word.
const DONUT_LABEL_FILL = 'var(--pf-t--global--text--color--regular)'

export default function SystemHealthWidget({
  params,
  variant = 'full',
}: {
  params?: WidgetParams
  variant?: Variant
} = {}) {
  const { systems, systemsError, rebootMetricSet, groups } = useDashboardData()
  const navigate = useNavigate()
  const groupId = params?.groupId
  const filtered = useMemo(() => {
    if (!systems) return null
    if (!groupId) return systems
    return systems.filter((s) => s.groupId === groupId)
  }, [systems, groupId])
  const counts = useMemo(
    () => (filtered ? tally(filtered, rebootMetricSet) : null),
    [filtered, rebootMetricSet],
  )
  const total = filtered?.length ?? 0
  const groupName = groupId
    ? (groups.find((g) => g.id === groupId)?.name ?? null)
    : null
  const title = groupName ? `System health — ${groupName}` : 'System health'
  const emptyMessage = groupId
    ? 'No systems in this group yet.'
    : 'Add a system from the Systems page to start seeing health data here.'
  const donutSize = DONUT_SIZE[variant]
  const showLegend = variant === 'full'

  // The donut center (the count and the "Systems" caption) links to
  // wherever those systems live: the group's page for a group donut, the
  // Inventory → Systems list for the all-systems donut. Both lines carry
  // the click handler; the caption is the single keyboard tab stop so we
  // don't expose two stops to the same destination.
  const navTarget = groupId ? `/groups/${groupId}` : '/systems'
  const navLabel = groupName
    ? `Go to the ${groupName} group`
    : 'Go to all systems'
  const donutTitleComponent = (
    <ChartLabel
      style={{
        fill: DONUT_LABEL_FILL,
        fontSize: 28,
        fontWeight: 600,
        cursor: 'pointer',
      }}
      events={{ onClick: () => navigate(navTarget) }}
    />
  )
  const donutSubTitleComponent = (
    <ChartLabel
      style={{ fill: DONUT_LABEL_FILL, fontSize: 14, cursor: 'pointer' }}
      ariaLabel={navLabel}
      tabIndex={0}
      events={{
        onClick: () => navigate(navTarget),
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            navigate(navTarget)
          }
        },
      }}
    />
  )

  return (
    <Card style={{ height: '100%', overflow: 'hidden' }}>
      <CardTitle>{title}</CardTitle>
      <CardBody>
        {systemsError && (
          <Alert variant="danger" title="Could not load systems" isInline>
            {systemsError}
          </Alert>
        )}
        {!systemsError && systems === null && (
          <Bullseye style={{ minHeight: '12rem' }}>
            <Spinner />
          </Bullseye>
        )}
        {!systemsError && filtered !== null && total === 0 && (
          <EmptyState titleText="No systems" headingLevel="h2">
            <EmptyStateBody>{emptyMessage}</EmptyStateBody>
          </EmptyState>
        )}
        {!systemsError && counts && total > 0 && (
          <Flex
            direction={{ default: 'column' }}
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItemsMd' }}
          >
            <FlexItem>
              <div style={{ height: donutSize, width: donutSize }}>
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
                  height={donutSize}
                  width={donutSize}
                  innerRadius={Math.round(donutSize * 0.28)}
                  title={String(total)}
                  subTitle={total === 1 ? 'System' : 'Systems'}
                  titleComponent={donutTitleComponent}
                  subTitleComponent={donutSubTitleComponent}
                />
              </div>
            </FlexItem>
            {showLegend && (
              <FlexItem alignSelf={{ default: 'alignSelfStretch' }}>
                <BucketLegend counts={counts} />
              </FlexItem>
            )}
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

export function CompactSystemHealthWidget({ params }: { params?: WidgetParams } = {}) {
  return <SystemHealthWidget params={params} variant="compact" />
}
