// SPDX-License-Identifier: Apache-2.0

// apiFetch is the thin wrapper every src/api/*.ts module routes
// fetch() through. It exists so the CSRF defense designed in
// research/csrf.md has exactly one client-side seam: this file
// injects `X-Sw-Csrf: 1` on every request, the backend
// middleware enforces it on every mutating method, and a new
// API surface picks up the header by default just by importing
// `apiFetch` instead of the global `fetch`.
//
// Behaviorally `apiFetch` is identical to `fetch`: any
// RequestInit the caller supplies wins on a per-key basis,
// `headers` is merged so callers can add their own
// Content-Type / Accept without dropping the CSRF header.
// Same-origin SPA requests do not trigger a CORS preflight for
// this header.

const CSRF_HEADER = 'X-Sw-Csrf'
const CSRF_VALUE = '1'

export function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  // Always set — overriding from caller-supplied init.headers is
  // intentional: there's no legitimate reason for a caller to
  // suppress the CSRF header, and forgetting it would silently
  // produce 403s in production but pass in tests that stub fetch.
  headers.set(CSRF_HEADER, CSRF_VALUE)
  return fetch(input, { ...init, headers })
}
