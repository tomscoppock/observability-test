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

### View OTel Collector telemetry output

The collector uses a `debug` exporter that logs to stdout:

```bash
docker compose logs -f otel-collector
```

You should see trace spans, metrics, and log records printed here.

## Health checks

### API health

```bash
curl http://localhost/api/health
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
docker compose logs otel-collector | grep -i "traces\|metrics\|logs"
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
