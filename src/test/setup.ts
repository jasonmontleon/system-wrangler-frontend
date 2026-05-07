// SPDX-License-Identifier: AGPL-3.0-or-later

import '@testing-library/jest-dom/vitest'

// jsdom doesn't ship EventSource. Components that use useEventStream
// would otherwise throw on render. Tests that exercise the SSE behavior
// itself stub a richer fake via vi.stubGlobal; this no-op default just
// keeps unrelated component tests from crashing on construction.
class NoopEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
if (typeof globalThis.EventSource === 'undefined') {
  ;(globalThis as unknown as { EventSource: typeof NoopEventSource }).EventSource =
    NoopEventSource
}
