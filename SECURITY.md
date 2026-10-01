# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.6.x   | :white_check_mark: |
| < 1.6   | :x:                |


## Reporting a Vulnerability

Please report vulnerabilities privately through a GitHub Security Advisory ("Report a vulnerability" on the Security tab) rather than a public issue. Include steps to reproduce and the affected version.

## Security model

- The web server binds to **127.0.0.1** by default. Requests whose `Host` is not `localhost`/an IP literal are rejected (DNS-rebinding protection) and cross-site browser requests to `/api/*` are refused (CSRF protection).
- Strict Content-Security-Policy, `nosniff`, `frame-ancestors 'none'`, no inline scripts.
- The Electron renderer is sandboxed with context isolation; only `http(s)` links are opened externally, in-app navigation away from the app is blocked, and permission requests are denied.
- Rank-history files are named from a hash of the query, so request parameters can never pick the file path.
