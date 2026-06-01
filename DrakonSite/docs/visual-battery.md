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
- `/ai-agents`
- `/jobs`
- `/drakon-find`
- `/chat`
- `/settings`
- `/settings?tab=users`
- `/settings?tab=workspace-access`
- `/events`
- `/billing`

The camera fixture includes a shared camera row, and the settings fixtures cover account users,
workspace invites, available remote workspaces, and scoped resource grants.

Default themes:

- `dark`
- `light`

Override routes or themes with:

```sh
npm run visual:browser -- --routes=/dashboard,/jobs --themes=dark
```

The Linux target first runs `perceptrum-desktop --print-web-root --no-open` against the current `DrakonSite/dist`, then captures the same browser route matrix.

Use `npm run visual:battery` to run the browser and Linux host matrix together; Windows WebView2 capture is included when `VISUAL_WINDOWS_WEBVIEW2_URL` points to an active WebView2 host.
