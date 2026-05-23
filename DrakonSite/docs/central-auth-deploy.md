# Central Auth Deploy

This backend is intended to run separately from the legacy DrakonSite server.
Use a dedicated Linux service on port `6999`, with Postgres credentials stored only on the server.

## Security model

- Do not place `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, or `PGPASSWORD` in the desktop/local `.env`.
- The desktop should only know:
  - `CENTRAL_AUTH_BASE_URL`
  - `CENTRAL_AUTH_PUBLIC_KEY` or `CENTRAL_AUTH_PUBLIC_KEY_PATH`
- The Linux server keeps:
  - Postgres credentials
  - `CENTRAL_AUTH_PRIVATE_KEY_PATH`

## 1. Generate the Ed25519 keypair

Run locally or on the server:

```bash
npm run keys:central-auth -- --out-dir ./tmp/central-auth-keys
```

This creates:

- `central-auth-public.pem`
- `central-auth-private.pem`

## 2. Install secrets on the Linux server

Copy the files to a root-only location, for example:

- `/etc/perceptrum/keys/central-auth-public.pem`
- `/etc/perceptrum/keys/central-auth-private.pem`

Recommended permissions:

```bash
mkdir -p /etc/perceptrum/keys
chmod 700 /etc/perceptrum /etc/perceptrum/keys
chmod 644 /etc/perceptrum/keys/central-auth-public.pem
chmod 600 /etc/perceptrum/keys/central-auth-private.pem
```

Create the env file:

- `/etc/perceptrum/central-auth.env`

Use [central-auth.env.example](/C:/dev/Workspace/DrakonSite/ops/secrets/central-auth.env.example) as the template.

Important values for the dedicated service:

- `PORT=6999`
- `APP_RUNTIME_ENV=server`
- `APP_DB_BACKEND=postgres`
- `PGHOST=172.233.186.23`
- `PGPORT=5432`
- `PGDATABASE=perceptrum_server`
- `PGUSER=postgres`
- `PGPASSWORD=...`
- `CENTRAL_AUTH_PUBLIC_KEY_PATH=/etc/perceptrum/keys/central-auth-public.pem`
- `CENTRAL_AUTH_PRIVATE_KEY_PATH=/etc/perceptrum/keys/central-auth-private.pem`
- `GOOGLE_OAUTH_CLIENT_ID=...` for the web Perceptrum audience
- optional `DESKTOP_GOOGLE_OAUTH_CLIENT_ID=...` if you want a dedicated desktop Google audience

Recommended permissions:

```bash
chmod 600 /etc/perceptrum/central-auth.env
```

## 3. Deploy the dedicated backend

From this repo:

```bash
npm run deploy:central-auth
```

This uploads the backend into `/var/www/perceptrum-central-auth/backend`, installs dependencies, writes a dedicated `systemd` unit, and restarts the service.

The installed service is based on [perceptrum-central-auth.service.template](/C:/dev/Workspace/DrakonSite/ops/systemd/perceptrum-central-auth.service.template).

## 4. Put HTTPS in front of port 6999

Use a dedicated host such as `auth.perceptrum.ai` and reverse proxy it to `127.0.0.1:6999`.

Example config:

[perceptrum-central-auth.nginx.conf.example](/C:/dev/Workspace/DrakonSite/ops/nginx/perceptrum-central-auth.nginx.conf.example)

If you enable relay features, make sure both WebSocket paths are proxied with
`Upgrade`/`Connection` headers:

- `/ws/find-relay`
- `/ws/workspace-relay`

## 5. Configure the desktop/local app

Local `.env` should contain only:

```env
CENTRAL_AUTH_BASE_URL=https://auth.perceptrum.ai
CENTRAL_AUTH_PUBLIC_KEY_PATH=/absolute/path/to/central-auth-public.pem
```

Or inline:

```env
CENTRAL_AUTH_BASE_URL=https://auth.perceptrum.ai
CENTRAL_AUTH_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

Perceptrum Google login is split by surface:

- web uses `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` with `https://perceptrum.ai/auth/callback`
- desktop can reuse the web callback, and the desktop WebView rewrites `/auth/callback` back to the active local origin
- desktop can also use `DESKTOP_GOOGLE_OAUTH_CLIENT_ID`, in which case `DESKTOP_GOOGLE_OAUTH_REDIRECT_URI` may stay empty so the runtime uses its loopback callback automatically

## 6. Validate

After deploy:

```bash
systemctl status perceptrum-central-auth --no-pager
journalctl -u perceptrum-central-auth -n 100 --no-pager
curl http://127.0.0.1:6999/api/auth/country
```

Then test:

1. Signup of a new local user.
2. Login of a legacy local user to trigger migration.
3. Offline login after a valid grant has been cached.
