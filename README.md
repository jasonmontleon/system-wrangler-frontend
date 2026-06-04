<!-- SPDX-License-Identifier: Apache-2.0 -->

# System Wrangler — Web UI

The React/TypeScript single-page app for **System Wrangler**, a single-container
dashboard for managing package updates, telemetry, alerts, and notifications
across every system you run.

This repo is **only the frontend**. It builds to static assets that the Go
backend embeds and serves — there is no standalone frontend deployment and no
Node runtime in production.

## Looking for the full picture?

Almost everything — what System Wrangler is, screenshots, installation, the user
guide, and how to run it — lives in the [**backend**](../system-wrangler-backend)
repo. Start there.

## Stack

React 19 + TypeScript (strict) + PatternFly v6, built with Vite. See
[`CLAUDE.md`](CLAUDE.md) for the contributor rules, and the backend repo's
development guide for building the two repos together.

## License

[Apache-2.0](LICENSE).
