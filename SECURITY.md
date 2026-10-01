# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.6.x   | :white_check_mark: |
| < 1.6   | :x:                |


## Reporting a Vulnerability

Please report vulnerabilities privately by opening a GitHub Security Advisory (via the "Report a vulnerability" button on the Security tab) instead of creating a public issue. Be sure to include detailed steps to reproduce the issue and specify the affected version.

## Security Model

- By default, the web server binds to **127.0.0.1**. To protect against DNS-rebinding attacks, requests with a `Host` header other than `localhost` or an IP literal are rejected. Cross-site browser requests to `/api/*` are refused to prevent CSRF attacks.
- The application enforces a strict Content-Security-Policy (CSP), uses the `nosniff` header, sets `frame-ancestors 'none'`, and blocks all inline scripts.
- The Electron renderer process is fully sandboxed with context isolation enabled. External links are restricted to `http(s)` URLs only, in-app navigation to external sites is blocked, and all permission requests are denied by default.
- Rank-history files are named using a hash of the query, ensuring that user-controlled request parameters cannot dictate the file path.
