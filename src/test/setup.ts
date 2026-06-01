// SPDX-License-Identifier: Apache-2.0

import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// Raise React Testing Library's async ceiling above its 1 s default.
// Under the pre-commit hook's parallel run on a constrained machine,
// a correct `findBy*` / `waitFor` assertion can take longer than a
// second to settle while workers contend; the suite is green in
// serial, so the extra headroom removes load-induced false failures
// without masking real ones (a genuinely-stuck assertion still fails,
// just later).
configure({ asyncUtilTimeout: 5000 })

// React 19 emits "The current testing environment is not configured to
// support act(...)" any time act() is called with the env flag unset.
// @testing-library/react sets this lazily on first render(), but tests
// that call act() between Popper microtasks can land outside that
// window. Setting it up-front at module load makes act() quiet in every
// test file without each one having to import a helper.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

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

// jsdom logs "Not implemented: navigation to another Document" via its
// virtual console whenever a form submit event reaches the default
// action — even when the React onSubmit handler calls preventDefault,
// because jsdom emits the log before checking defaultPrevented. The
// message is routed through console.log (jsdomError → virtualConsole
// default handler) AND directly to process.stderr.write depending on
// the jsdom build, so we filter both streams.
const NOISE_PATTERNS = [
  /Not implemented: navigation to another Document/,
  // React 19 logs this when act() is invoked while
  // globalThis.IS_REACT_ACT_ENVIRONMENT is unset. We set the flag at
  // module load above, but Vitest worker isolation can land deep
  // React-internal act calls in a scope where the flag was reset
  // between our setup pass and the call site. Filtering the line is
  // the reliable last-mile.
  /The current testing environment is not configured to support act/,
]
function filterConsole(
  original: (...args: unknown[]) => void,
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const first = args[0]
    if (typeof first === 'string' && NOISE_PATTERNS.some((re) => re.test(first))) {
      return
    }
    original(...args)
  }
}
console.error = filterConsole(console.error.bind(console))
console.log = filterConsole(console.log.bind(console))
console.warn = filterConsole(console.warn.bind(console))

// Some jsdom builds bypass console entirely and write directly to
// process.stderr. The proc reference is loosely typed because @types/node
// is not in the frontend's devDependencies (this is a browser SPA).
const proc = (globalThis as unknown as {
  process?: { stderr?: { write: (chunk: unknown, ...rest: unknown[]) => boolean } }
}).process
if (proc?.stderr) {
  const originalStderrWrite = proc.stderr.write.bind(proc.stderr)
  proc.stderr.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
    if (
      typeof chunk === 'string' &&
      NOISE_PATTERNS.some((re) => re.test(chunk))
    ) {
      return true
    }
    return originalStderrWrite(chunk, ...rest)
  }) as typeof proc.stderr.write
}
