// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Stack,
  StackItem,
} from '@patternfly/react-core'
import {
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@patternfly/react-table'
import {
  listTrustedDevices,
  revokeTrustedDevice,
  type TrustedDevice,
} from '../api/auth'

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatTimestamp(ts: string): string {
  // Server returns RFC 3339; new Date handles it across browsers. Defensive:
  // if it parses to NaN we fall back to the raw string rather than rendering
  // "Invalid Date".
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : dateFormatter.format(d)
}

export default function TrustedDevicesCard() {
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDevices(await listTrustedDevices())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onRevoke = async (id: string) => {
    setRevokingId(id)
    setError(null)
    try {
      await revokeTrustedDevice(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <Card>
      <CardTitle>Trusted browsers</CardTitle>
      <CardBody>
        <Stack hasGutter>
          <StackItem>
            Browsers you have chosen to remember for 30 days. Sign-ins from
            these browsers skip the second-factor step. Revoke any you no
            longer recognise.
          </StackItem>
          {error && (
            <StackItem>
              <Alert variant="danger" title="Trusted browsers" isInline>
                {error}
              </Alert>
            </StackItem>
          )}
          <StackItem>
            {loading ? (
              <p>Loading…</p>
            ) : devices.length === 0 ? (
              <p>No trusted browsers.</p>
            ) : (
              <Table aria-label="Trusted browsers">
                <Thead>
                  <Tr>
                    <Th>Label</Th>
                    <Th>Last used</Th>
                    <Th>Expires</Th>
                    <Th screenReaderText="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {devices.map((d) => (
                    <Tr key={d.id}>
                      <Td>{d.label}</Td>
                      <Td>{formatTimestamp(d.lastUsedAt)}</Td>
                      <Td>{formatTimestamp(d.expiresAt)}</Td>
                      <Td>
                        <Button
                          variant="secondary"
                          isDanger
                          isLoading={revokingId === d.id}
                          isDisabled={revokingId !== null}
                          onClick={() => void onRevoke(d.id)}
                        >
                          Revoke
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </StackItem>
        </Stack>
      </CardBody>
    </Card>
  )
}
