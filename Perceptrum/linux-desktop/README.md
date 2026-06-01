# Perceptrum Linux Desktop Host

The Linux desktop host renders the shared `DrakonSite/dist` React build through a local HTTP backend.

Window modes:

- `auto` tries the native WebKitGTK window first, then falls back to `xdg-open` if GTK cannot initialize.
- `webkit` requires the native WebKitGTK window and exits if it cannot be created.
- `browser` skips WebKitGTK and opens the URL through `xdg-open`.

Examples:

```sh
APP_STATIC_ROOT=/path/to/DrakonSite/dist ./perceptrum-desktop
PERCEPTRUM_LINUX_WINDOW_MODE=browser ./perceptrum-desktop
./perceptrum-desktop --webkit
```

The common React UI must not import GTK, WebKitGTK, WinUI, WebView2, or AppHost code. Platform-specific windowing stays in this directory and the Windows-only `AppHost`.
