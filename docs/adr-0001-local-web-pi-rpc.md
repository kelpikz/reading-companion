# ADR 0001: Local browser UI with a Pi RPC subprocess

- Date: 2026-10-26
- Status: Accepted by the user

## Context
The user wants a small reading companion in Chrome/Chromium/Brave. Pi must run on their computer. V1 accepts a link or pasted page/selected text. It has separate reading and tool modes. The user prefers fast setup over an extension and permits sending manually shared content to their configured model provider.

## Decision
Use a small TypeScript/Node HTTP server, a browser UI, and the installed Pi CLI in long-lived RPC mode. Bind only to 127.0.0.1. Authenticate API/SSE requests with a per-launch token and validate Host/Origin. Keep credentials on the backend.

Reading sessions have no tools, extensions, MCP, skills, templates, or discovered context files. Tool sessions use a fresh Pi process with a small built-in tool allowlist and require explicit acknowledgement. No article or conversation is automatically copied across the mode boundary. The default tool working folder is owned by this application, but it is NOT a sandbox.

Use safe server-side URL fetching with DNS/IP checks, address pinning, redirect revalidation, time/size limits, and readable-text extraction. Fetch no browser cookies. Pasted text is the fallback for authenticated and script-rendered pages. Store chat only in server memory; allow Markdown export. Refresh restores the live session; restart does not.

## Alternatives
- **Pi SDK in-process:** fewer protocol boundaries and direct APIs, but needs more deliberate resource/CLI-parity wiring and couples Pi failures to the web host. RPC fits reuse of an existing installed Pi and isolates its lifecycle.
- **Browser extension first:** better selection/current-tab capture, but adds permission, installation, and browser-specific work before validating usefulness. Add later as an explicit input adapter.
- **Remote hosting:** not needed for a single-machine companion; unnecessarily exposes a powerful local agent and adds authentication/hosting work.

## Consequences
No automatic active-tab visibility in V1. Links cannot read private browser sessions. The model provider receives supplied content. Tool mode has the OS user's permissions; an ordinary working directory and prompt-injection instructions are not security boundaries. Terminal-only extensions and MCP are deliberately not supported in this MVP. The UI/backend boundary allows adding an extension without replacing the Pi integration.
