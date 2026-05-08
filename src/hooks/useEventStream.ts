// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'

// ServerEvent matches the backend Event payload — small "doorbell"
// notifications. Clients re-fetch the affected REST endpoint on receipt.
export type ServerEvent = { type: string }

// useEventStream subscribes to /api/events and forwards each parsed message
// to the latest onEvent. The connection is opened once on mount and closed
// on unmount; changing the callback does not reopen.
export function useEventStream(onEvent: (event: ServerEvent) => void): void {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    const es = new EventSource('/api/events')
    const handler = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as ServerEvent
        cbRef.current(parsed)
      } catch {
        // ignore malformed payloads
      }
    }
    es.addEventListener('message', handler)
    return () => {
      es.removeEventListener('message', handler)
      es.close()
    }
  }, [])
}
