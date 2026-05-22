# drakon-server Linux packaging

This directory documents the intended Linux/headless installation flow.
These commands are for the operator; the build process must not run `sudo`.

## Build package

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
cmake --build build --target package
```

## Installed layout

```text
/opt/drakon-server/bin/drakon-server
/etc/drakon-server/drakon-server.env.example
/etc/drakon-server/drakon-server.json.example
/lib/systemd/system/drakon-server.service
/var/lib/drakon-server/
/var/log/drakon-server/
```

The service writes state, frames, JSON/JSONL indexes and SQLite data under
`/var/lib/drakon-server`, logs under `/var/log/drakon-server`, and runtime files
under `/run/drakon-server`. It must not write inside `/opt/drakon-server`.

## Install

```bash
sudo apt install ./build/drakon-server_0.1.0_amd64.deb
sudo cp /etc/drakon-server/drakon-server.json.example /etc/drakon-server/drakon-server.json
sudo cp /etc/drakon-server/drakon-server.env.example /etc/drakon-server/drakon-server.env
sudo editor /etc/drakon-server/drakon-server.json
sudo editor /etc/drakon-server/drakon-server.env
sudo systemctl daemon-reload
sudo systemctl enable --now drakon-server
```

## Validate service manually

```bash
/opt/drakon-server/bin/drakon-server validate-config --config /etc/drakon-server/drakon-server.json
/opt/drakon-server/bin/drakon-server prepare-runtime --config /etc/drakon-server/drakon-server.json
/opt/drakon-server/bin/drakon-server run --config /etc/drakon-server/drakon-server.json --once
systemctl status drakon-server
journalctl -u drakon-server -n 100 --no-pager
```

## Remove

```bash
sudo systemctl disable --now drakon-server
sudo apt remove drakon-server
```

`apt remove` removes package-managed files but leaves operator data in
`/var/lib/drakon-server` and `/var/log/drakon-server`.

## Purge

```bash
sudo systemctl disable --now drakon-server
sudo apt purge drakon-server
```

If the operator intentionally wants to delete runtime data after a purge:

```bash
sudo rm -rf /var/lib/drakon-server /var/log/drakon-server
```

Do not run the delete command unless the data has been backed up or is known to
be disposable.

## Secrets

Do not package real secrets. Use references such as `env:OPENAI_API_KEY`,
`env:DRAKON_POSTGRES_DSN`, `env:DRAKON_WEBHOOK_URL` and camera-specific RTSP
references in `/etc/drakon-server/drakon-server.env` or a future secret store.
