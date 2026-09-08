# Docker Commands

All commands assume you are in the project root directory.

## Lifecycle

### Start all services

```bash
docker compose up -d --build
```

- `-d` runs in detached mode (background)
- `--build` rebuilds images if source code changed

### Start without rebuilding

```bash
docker compose up -d
```

### Stop all services

```bash
docker compose down
```

Containers are removed but volumes (database data) are preserved.

### Stop and remove volumes (full reset)

```bash
docker compose down -v
```

**Warning:** This deletes all SurrealDB data.

### Restart a single service

```bash
docker compose restart api
docker compose restart nginx
docker compose restart surrealdb
docker compose restart otel-collector
```

### Rebuild and restart a single service

```bash
docker compose up -d --build api
```

### Apply changed `.env` values (after rotating a token)

**A running container never sees edits to `.env`.** Environment variables
are snapshotted when the container is created, so editing `.env` and then
running `docker compose restart` or even `docker compose up -d` leaves the
old values in place. Compose only recreates a container when its resolved
config actually changes, so an unchanged image plus an unchanged compose
file means your edit is silently ignored.

Use `--force-recreate` on the affected service:

```bash
# After changing SPLUNK_ACCESS_TOKEN, SPLUNK_REALM, or any SPLUNK_HEC_* value
docker compose up -d --force-recreate otel-collector

# After changing LLM_API_KEY, EMBEDDING_API_KEY, ADMIN_PASSWORD, MCP_*, etc.
docker compose up -d --force-recreate api

# Everything at once
docker compose up -d --force-recreate
```

Then confirm the new credentials are actually accepted, because a bad
token fails silently from the outside -- telemetry just stops arriving:

```bash
# Should print nothing. Any 401/403 means the token is still wrong.
docker compose logs otel-collector --since=2m | grep -iE "401|403|Unauthorized"
```

A rejected `SPLUNK_ACCESS_TOKEN` looks like this, and drops every span
and datapoint while the collector otherwise appears healthy:

```
error  Exporting failed. Dropping data.  {"otelcol.component.id": "signalfx",
  "error": "Permanent error: HTTP \"/v2/datapoint\" 401 \"Unauthorized\"",
  "dropped_items": 135}
```

Note that `SPLUNK_ACCESS_TOKEN` is used for two different things in this
project: the collector uses it to **ingest** traces and metrics, and
`scripts/setup-splunk-dashboard.*` uses it against the **management
API**. A replacement token needs both the INGEST and API authorization
scopes, or dashboards will stop deploying even though ingest works.

## Logs

### View logs for all services

```bash
docker compose logs
```

### Follow logs in real time

```bash
docker compose logs -f
```

### Follow logs for a specific service

```bash
docker compose logs -f api
docker compose logs -f otel-collector
docker compose logs -f surrealdb
docker compose logs -f nginx
```

### View last N lines

```bash
docker compose logs --tail 50 api
```

## Status and inspection

### Check running containers

```bash
docker compose ps
```

### Check resource usage

```bash
docker stats
```

### Inspect a container

```bash
docker compose exec api sh
docker compose exec surrealdb sh
```

## Viewing OTel telemetry

The OTel Collector uses a `debug` exporter that prints all received
telemetry to its stdout. This is the primary way to verify data is
flowing before a backend (Splunk, Grafana, etc.) is connected.

### Watch all telemetry in real time

```bash
docker compose logs -f otel-collector
```

You'll see trace spans, metric histograms, and log records printed
every ~10 seconds. Press `Ctrl+C` to stop following.

### Filter to just traces

```bash
# PowerShell
docker compose logs -f otel-collector | Select-String "Span|http.method|http.route|http.status_code"

# Linux/macOS
docker compose logs -f otel-collector | grep -E "Span|http.method|http.route|http.status_code"
```

Example output when you send a chat message:

```
Span #0
     -> Name: POST /api/chat
     -> http.method: Str(POST)
     -> http.route: Str(/api/chat)
     -> http.status_code: Int(200)
```

### Filter to just metrics

```bash
# PowerShell
docker compose logs -f otel-collector | Select-String "Metric|DataPoints|Value"

# Linux/macOS
docker compose logs -f otel-collector | grep -E "Metric|DataPoints|Value"
```

### Check what signal types are arriving

```bash
# PowerShell
docker compose logs otel-collector | Select-String "otelcol.signal"

# Linux/macOS
docker compose logs otel-collector | grep "otelcol.signal"
```

You should see `"otelcol.signal": "traces"`, `"otelcol.signal": "metrics"`,
and `"otelcol.signal": "logs"`.

### Understanding the output

| What you see | What it means |
|---|---|
| `http.route: Str(/api/chat)` | Someone sent a chat message via the UI |
| `http.route: Str(/health)` | Docker healthcheck ping (every 10s) |
| `http.method: Str(GET)` | GET request (usually healthcheck) |
| `http.method: Str(POST)` | POST request (usually chat message) |
| `"spans": 6` | Batch of 6 spans received at once |
| `ExplicitBounds` / `Buckets` | Metric histogram data (request durations) |

### Where is the data going?

Currently: **collector stdout only** (debug exporter). Nothing leaves
the local Docker network. Splunk/Grafana export is configured in
Epic 002 by adding exporters to `otel-collector-config.yaml`.

## Health checks

### API health

```bash
curl http://localhost/health
# {"status":"ok"}
```

### Direct API health (bypassing Nginx)

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### SurrealDB health

```bash
curl http://localhost:8000/health
```

### OTel Collector (check it's receiving data)

```bash
# PowerShell
docker compose logs otel-collector | Select-String "traces|metrics|logs"

# Linux/macOS
docker compose logs otel-collector | grep -iE "traces|metrics|logs"
```

## Development workflow

### Rebuild after code changes

```bash
# Rebuild just the API
docker compose up -d --build api

# Nginx serves static files from a volume mount -- changes are instant
# Just refresh the browser for HTML/CSS/JS changes
```

### Run API locally (outside Docker)

```bash
cd api
npm install
cp ../.env .env  # or set env vars manually
npm run dev      # uses --watch for auto-reload
```

Note: When running locally, set `OTEL_EXPORTER_OTLP_ENDPOINT` to
`http://localhost:4318` (not `http://otel-collector:4318`).

### Clean up Docker resources

```bash
# Remove stopped containers, unused networks, dangling images
docker system prune

# Remove all unused images (more aggressive)
docker system prune -a
```
