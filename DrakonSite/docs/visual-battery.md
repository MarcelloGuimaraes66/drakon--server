# Visual Battery

The visual battery captures protected internal routes with mocked API responses so the shell, internal pages, and Fluent tokens can be checked without a live backend.

## Targets

- Browser: `npm run visual:browser`
- Linux host/browser: `npm run visual:linux`
- Windows WebView2 handoff: `VISUAL_WINDOWS_WEBVIEW2_URL=http://127.0.0.1:<port> npm run visual:windows`

Screenshots and `summary.json` are written to `visual-artifacts/` and are intentionally ignored by git.

## Coverage

Default routes:

- `/dashboard`
- `/cameras`
- `/chat`
- `/settings`

Default themes:

- `dark`
- `light`

Override routes or themes with:

```sh
npm run visual:browser -- --routes=/dashboard,/jobs --themes=dark
```

The Linux target first runs `perceptrum-desktop --print-web-root --no-open` against the current `DrakonSite/dist`, then captures the same browser route matrix.
