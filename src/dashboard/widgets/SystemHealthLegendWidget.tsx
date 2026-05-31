// SPDX-License-Identifier: Apache-2.0

import {
  Card,
  CardBody,
  CardTitle,
  Flex,
  FlexItem,
  Grid,
  GridItem,
} from '@patternfly/react-core'
import { BUCKETS } from './systemHealthShared'

// SystemHealthLegendWidget renders just the bucket key — colors and
// labels, no counts — so the user can include it once on the
// dashboard and pair it with one or more compact donut cards.
export default function SystemHealthLegendWidget() {
  return (
    <Card style={{ height: '100%' }}>
      <CardTitle>System health legend</CardTitle>
      <CardBody>
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
              </Flex>
            </GridItem>
          ))}
        </Grid>
      </CardBody>
    </Card>
  )
}
