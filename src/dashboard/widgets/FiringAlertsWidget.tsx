// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  Label,
  List,
  ListItem,
  Spinner,
} from '@patternfly/react-core'
import { listActiveAlerts, type ActiveAlert, type Severity } from '../../api/alerts'
import { useEventStream } from '../../hooks/useEventStream'

// FiringAlertsWidget is the dashboard "banner" delivery surface: it shows
// the alerts currently firing, refreshed live off the alerts.changed
// event stream. Pending alerts are excluded — only fully-fired ones are
// worth surfacing on the dashboard.
export default function FiringAlertsWidget() {
  const [firing, setFiring] = useState<ActiveAlert[] | null>(null)

  const refresh = useCallback(() => {
    listActiveAlerts()
      .then((all) => setFiring(all.filter((a) => a.state === 'firing')))
      .catch(() => setFiring([]))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEventStream(
    useCallback(
      (event) => {
        if (event.type === 'alerts.changed') refresh()
      },
      [refresh],
    ),
  )

  let body
  if (firing === null) {
    body = (
      <Bullseye>
        <Spinner aria-label="Loading firing alerts" />
      </Bullseye>
    )
  } else if (firing.length === 0) {
    body = <span>No firing alerts.</span>
  } else {
    body = (
      <List isPlain aria-label="Firing alerts">
        {firing.map((a) => (
          <ListItem key={`${a.ruleId}-${a.systemId}`}>
            <Label isCompact color={severityColor(a.severity)} style={{ marginInlineEnd: '0.5rem' }}>
              {a.severity}
            </Label>
            {a.ruleName} on {a.systemName || a.systemId}
          </ListItem>
        ))}
      </List>
    )
  }

  return (
    <Card style={{ height: '100%' }}>
      <CardTitle>Firing alerts</CardTitle>
      <CardBody>{body}</CardBody>
    </Card>
  )
}

function severityColor(s: Severity): 'blue' | 'orange' | 'red' {
  switch (s) {
    case 'info':
      return 'blue'
    case 'warning':
      return 'orange'
    case 'critical':
      return 'red'
  }
}
