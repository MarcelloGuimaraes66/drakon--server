## Perceptrum

This app was created using https://getmocha.com.
Need help or want to join the community? Join our [Discord](https://discord.gg/shDEGBSe2d).

To run the devserver:
```
npm install
npm run dev
```

## Environment profiles (local/server)

The backend now supports two profiles:
- `local` -> loads `.env.local` (HTTP, port `4000`)
- `server` -> loads `.env.server` (HTTPS behind reverse proxy, port `4999`)

Profile selection is controlled by `.env.init`:
```
ENV_PROFILE=auto
```

Accepted values:
- `auto`: uses `server` when `NODE_ENV=production`, otherwise `local`
- `local`: force local profile
- `server`: force server profile

## Local database backend by brand

- `brand.txt=drakon` keeps the local backend on PostgreSQL during source/dev runs, but the bundled desktop runtime now provisions SQLite for installer builds.
- `brand.txt=perceptrum` defaults the local backend to SQLite.
- You can override the backend with `APP_DB_BACKEND=postgres|sqlite|auto`.
- You can override the SQLite file location with `SQLITE_DB_PATH=...`.

To build the local Perceptrum SQLite database from the PostgreSQL dump and import the local users requested for desktop usage:

```powershell
npm run db:sqlite:import-perceptrum
```

By default this command reads [C:\dev\Workspace\Postgres\perceptrum_site.sql](C:\dev\Workspace\Postgres\perceptrum_site.sql) and writes the SQLite database under `C:\PerceptrumData\local-site\perceptrum_site.sqlite`.

The SQLite converter also accepts `--brand drakon` and writes `drakon_site.sqlite` under the configured Drakon data root.

Template files:
- `.env.init.example`
- `.env.local.example`
- `.env.server.example`

## Google login split (Perceptrum)

Perceptrum supports separate Google OAuth clients for web and desktop:
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` for the web app callback
- optional `DESKTOP_GOOGLE_OAUTH_CLIENT_ID` for a packaged desktop loopback callback
- `DESKTOP_GOOGLE_OAUTH_CLIENT_SECRET` is optional for Desktop App clients that use PKCE without a secret

Recommended shape:
- web callback: `https://perceptrum.ai/auth/callback`
- desktop without a dedicated client: reuse the web callback and let the WebView rewrite `/auth/callback` back to the active local origin
- desktop with a dedicated client: leave `DESKTOP_GOOGLE_OAUTH_REDIRECT_URI` blank and let the runtime use its loopback callback automatically

## Timezone model

- Global timezone is stored per user in `app_users.timezone_iana`.
- Job creation/edit does not accept timezone from frontend; backend always derives `jobs.timezone` from the user's global timezone.
- Camera creation/edit does not use per-camera timezone fields.
- EXE pairing (`POST /api/pairing/pair`) can update the global timezone from the machine timezone sent by the desktop agent.
- Scheduler runs from backend clock and evaluates windows in each job timezone (derived from global user timezone).

## Deploy to server

Use the project command below from Windows PowerShell:

```powershell
npm run deploy:server
```

What it does:
- runs `npm run build`
- uploads backend sources to `/var/www/drakonsite/backend`
- uploads `dist/` to `/var/www/drakonsite/app`
- runs `./deploy_backend.sh` on the server

Useful variants:

```powershell
npm run deploy:server -- -DryRun
npm run deploy:server -- -SkipBuild
npm run deploy:server:post
```
