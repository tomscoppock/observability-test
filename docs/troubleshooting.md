# Troubleshooting

## Docker issues

### "failed to connect to the docker API" / Docker daemon not running

**Symptom:**
```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
```

**Fix:** Start Docker Desktop. On Windows, launch it from the Start menu
or system tray. Verify with:

```bash
docker version
```

Both "Client" and "Server" sections should appear.

### Port already in use

**Symptom:**
```
Error response from daemon: Ports are not available: listen tcp 0.0.0.0:80: bind: address already in use
```

**Fix:** Another process is using the port. Find and stop it:

```bash
# On Windows (PowerShell)
Get-NetTCPConnection -LocalPort 80 | Select-Object OwningProcess
Get-Process -Id <PID>

# On Linux/macOS
lsof -i :80
```

Or change the port mapping in `docker-compose.yml`:

```yaml
nginx:
  ports:
    - "8080:80"  # Use port 8080 instead
```

### Nginx "502 Bad Gateway"

**Symptom:** Chat UI loads but API calls fail with 502.

**Cause:** The API container isn't ready yet or has crashed.

**Fix:**

```bash
# Check API container status
docker compose ps api

# Check API logs for errors
docker compose logs api

# Restart the API
docker compose restart api
```

### SurrealDB won't start

**Symptom:** SurrealDB container exits immediately or restarts in a loop.

**Common causes:**

1. **Permission denied (AOL writes):** SurrealDB 3.x runs as a non-root
   user, but Docker named volumes are created as root. The SurrealMX AOL
   engine needs write access for append-only logs and snapshots. The
   `docker-compose.yml` sets `user: "0:0"` to work around this in dev.

2. **Corrupted AOL data:** If the container was killed mid-write, the AOL
   files may be corrupt.

**Fix:**

```bash
# Check the actual error
docker compose logs surrealdb

# If data is corrupted, reset the volume
docker compose down -v
docker compose up -d --build
```

### OTel Collector config errors

**Symptom:** Collector exits with YAML parse errors.

**Fix:** Validate the YAML syntax:

```bash
# Check for YAML errors
docker compose logs otel-collector
```

Common issues:
- Indentation errors (YAML is whitespace-sensitive)
- Missing quotes around environment variable references
- Typos in exporter/receiver names
- An empty `SPLUNK_HEC_URL` or `SPLUNK_HEC_TOKEN`. The `splunk_hec`
  exporter rejects an empty endpoint or token at validation time, which
  stops the **whole** collector, traces and metrics included. This is why
  `docker-compose.yml` gives both inert placeholder defaults rather than
  `""`.

### Dashboards suddenly empty / no traces or metrics arriving

**Symptom:** Splunk dashboards show no data, but the collector looks
healthy and logs are still reaching Splunk Cloud Platform.

**Most likely cause:** a rotated or revoked `SPLUNK_ACCESS_TOKEN`. The
collector keeps running and reports itself as fine while silently
dropping every span and datapoint.

```bash
docker compose logs otel-collector --since=5m | grep -iE "401|403|Unauthorized"
```

A rejected token looks like this:

```
error  Exporting failed. Dropping data.  {"otelcol.component.id": "signalfx",
  "error": "Permanent error: HTTP \"/v2/datapoint\" 401 \"Unauthorized\"",
  "dropped_items": 135}
```

**Fix:** put a valid token in `.env`, then **force-recreate** the
container. Editing `.env` alone does nothing to a running container, and
plain `restart` or `up -d` will not pick it up either:

```bash
docker compose up -d --force-recreate otel-collector
```

See [Docker Commands > Apply changed .env values](docker-commands.md#apply-changed-env-values-after-rotating-a-token)
for the full explanation, including why the replacement token needs both
INGEST and API scopes.

Note that logs are unaffected by this, because they authenticate
separately with `SPLUNK_HEC_TOKEN` against Splunk Cloud Platform. Logs
continuing to arrive while traces and metrics stop is a strong signal
that the Observability Cloud token specifically is the problem.

## API issues

### "Cannot find module" errors

**Symptom:** API crashes with module not found errors.

**Fix:** Rebuild the container to reinstall dependencies:

```bash
docker compose up -d --build api
```

### OTel SDK errors on startup

**Symptom:** Warnings about missing exporters or SDK configuration.

**Fix:** These are usually non-fatal. If `OTEL_EXPORTER_OTLP_ENDPOINT`
is not set, the SDK falls back to console/noop mode. Check the API logs:

```bash
docker compose logs api | head -20
```

You should see either:
- `[otel] Exporting telemetry to http://otel-collector:4318`
- `[otel] No OTEL_EXPORTER_OTLP_ENDPOINT set -- telemetry goes to console/noop`

### Health endpoint not responding

**Fix:**

```bash
# Check if the container is running
docker compose ps api

# Try the direct port (bypassing Nginx)
curl http://localhost:3000/health

# Check API logs
docker compose logs -f api
```

## Network issues

### Services can't communicate

**Symptom:** API can't reach SurrealDB or OTel Collector.

**Fix:** All services should be on the same Docker Compose network.
Check with:

```bash
docker network ls
docker network inspect observability-test_default
```

### Local development: can't reach collector

When running the API locally (outside Docker), use `localhost` instead
of the Docker service name:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
SURREAL_URL=http://localhost:8000
```

## Resetting everything

Nuclear option -- removes all containers, volumes, and images:

```bash
docker compose down -v --rmi all
docker compose up -d --build
```
