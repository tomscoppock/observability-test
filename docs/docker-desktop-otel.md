# Docker Desktop OpenTelemetry Integration

Docker Desktop 4.35+ can export its own telemetry (container metrics,
build traces, Compose events) to any OTLP-compatible endpoint. This
guide configures it to send data to our project's OTel Collector, so
Docker engine metrics appear alongside the RAG API telemetry in Splunk.

## Prerequisites

- Docker Desktop 4.35 or later (check: Help > About Docker Desktop)
- The project stack running (`docker compose up -d`)
- The OTel Collector listening on `localhost:4318` (OTLP HTTP)

## Setup steps

### 1. Open Docker Desktop Settings

- Click the Docker Desktop tray icon (system tray / menu bar)
- Select **Settings** (gear icon)

### 2. Enable OpenTelemetry export

1. In the left sidebar, click **General**
2. Scroll down to the **OpenTelemetry** section
3. Toggle **Send anonymized usage statistics** OFF (optional -- this is
   Docker Inc telemetry, not your OTLP export)
4. In the left sidebar, click **Resources** > **Advanced** (if present)

Then navigate to the OTLP configuration:

1. In the left sidebar, click **General** or look for **OpenTelemetry**
   / **Observability** (the exact location varies by Docker Desktop
   version)
2. Enable **Export OpenTelemetry data**
3. Set the **OTLP endpoint** to:

   ```
   http://localhost:4318
   ```

4. Set the **Protocol** to **HTTP/protobuf** (OTLP HTTP)
5. Click **Apply & restart**

> **Note:** Docker Desktop versions may label this differently:
> - 4.35-4.37: Settings > General > OpenTelemetry
> - 4.38+: Settings > Observability > OpenTelemetry
>
> If you don't see an OpenTelemetry section, check that you're on a
> recent enough version or enable it via the CLI (see below).

### 3. Alternative: Enable via CLI / config file

If the UI option is not available, you can enable OTLP export by editing
the Docker Desktop `settings-store.json` or `daemon.json`:

**Windows** -- edit `%APPDATA%\Docker\settings-store.json`:

```json
{
  "openTelemetry": {
    "enabled": true,
    "endpoint": "http://localhost:4318",
    "protocol": "http/protobuf"
  }
}
```

**macOS** -- edit `~/Library/Group Containers/group.com.docker/settings-store.json`:

```json
{
  "openTelemetry": {
    "enabled": true,
    "endpoint": "http://localhost:4318",
    "protocol": "http/protobuf"
  }
}
```

After editing, restart Docker Desktop.

### 4. Alternative: Docker daemon.json (Engine-level)

For Docker Engine metrics specifically, you can configure the daemon
directly. Edit the Docker daemon config:

**Windows:** `%USERPROFILE%\.docker\daemon.json`
**macOS/Linux:** `~/.docker/daemon.json` or `/etc/docker/daemon.json`

```json
{
  "metrics-addr": "127.0.0.1:9323",
  "experimental": true
}
```

This exposes Prometheus-format metrics at `http://localhost:9323/metrics`.
To ingest these into the OTel Collector, you would add a Prometheus
receiver to `otel-collector-config.yaml` (see "Adding a Prometheus
scraper" below).

## What telemetry does Docker Desktop export?

When OTLP export is enabled, Docker Desktop sends:

### Metrics

| Metric | Type | Description |
|---|---|---|
| `container.cpu.usage` | Gauge | CPU usage per container |
| `container.memory.usage` | Gauge | Memory usage per container |
| `container.network.io` | Counter | Network bytes sent/received |
| `container.blockio.read` | Counter | Disk read bytes |
| `container.blockio.write` | Counter | Disk write bytes |
| `container.uptime` | Gauge | Container uptime in seconds |

### Traces

| Span | Description |
|---|---|
| `docker.build` | Image build operations |
| `docker.compose.up` | Compose stack start |
| `docker.compose.down` | Compose stack stop |
| `docker.pull` | Image pull operations |

### Resource attributes

All Docker Desktop telemetry includes:

| Attribute | Example | Description |
|---|---|---|
| `service.name` | `docker-desktop` | Always `docker-desktop` |
| `container.name` | `observability-test-api-1` | Container name |
| `container.id` | `882e3323a1fd...` | Container ID |
| `container.image.name` | `observability-test-api` | Image name |

## Verifying the integration

### 1. Check the OTel Collector debug output

After enabling Docker Desktop OTLP export, you should see new
telemetry in the collector logs:

```bash
docker compose logs -f otel-collector
```

Look for `service.name: Str(docker-desktop)` in the output.

### 2. Filter for Docker Desktop telemetry

```powershell
# PowerShell
docker compose logs otel-collector | Select-String "docker-desktop"

# Linux/macOS
docker compose logs otel-collector | grep "docker-desktop"
```

### 3. Check in Splunk

If Splunk is configured, Docker Desktop metrics will appear in:

- **Infrastructure Monitoring** -- look for `docker-desktop` service
- **APM** -- build and compose traces appear as a separate service

## Adding a Prometheus scraper (optional)

If you prefer to scrape Docker Engine's Prometheus endpoint instead of
(or in addition to) OTLP, add this receiver to
`otel-collector-config.yaml`:

```yaml
receivers:
  prometheus/docker:
    config:
      scrape_configs:
        - job_name: docker-engine
          scrape_interval: 15s
          static_configs:
            - targets: ['host.docker.internal:9323']
```

Then add it to the metrics pipeline:

```yaml
service:
  pipelines:
    metrics:
      receivers: [otlp, prometheus/docker]
      processors: [batch, resource/splunk]
      exporters: [debug, signalfx]
```

> **Note:** `host.docker.internal` resolves to the host machine from
> inside a Docker container. This requires Docker Desktop or the
> `extra_hosts` setting in `docker-compose.yml`.

## Troubleshooting

### No Docker Desktop telemetry appearing

1. **Check Docker Desktop version:** Must be 4.35+. Run
   `docker version` and check the Desktop version in the UI.
2. **Check the endpoint:** Must be `http://localhost:4318` (not
   `http://otel-collector:4318` -- Docker Desktop runs on the host,
   not inside the Docker network).
3. **Check the collector is listening:** Run
   `curl http://localhost:4318/v1/traces` -- you should get a 405
   (Method Not Allowed), not a connection refused.
4. **Restart Docker Desktop** after changing settings.

### Collector shows "connection refused" errors

The collector container exposes port 4318 to the host via the
`docker-compose.yml` port mapping (`4318:4318`). If another process
is using port 4318, Docker Desktop can't reach the collector.

```powershell
# Check what's using port 4318
netstat -ano | findstr :4318
```

### Too much telemetry / noisy metrics

Docker Desktop can generate a lot of container metrics. To filter or
reduce volume, add a `filter` processor to the collector config:

```yaml
processors:
  filter/docker:
    metrics:
      exclude:
        match_type: regexp
        metric_names:
          - "container\\.blockio\\..*"
```

---

## Automated setup

Instead of following the manual steps above, you can use the provided
script to configure Docker Desktop OTLP export automatically.

**Windows (PowerShell):**

```powershell
.\scripts\setup-docker-desktop-otel.ps1
```

**macOS/Linux:**

```bash
./scripts/setup-docker-desktop-otel.sh
```

The script:

1. Locates Docker Desktop's `settings-store.json`
2. Backs up the original file
3. Enables OTLP export with endpoint `http://localhost:4318`
4. Prompts you to restart Docker Desktop

The script is idempotent -- it skips if already configured. If OTLP
export is already enabled with a different endpoint, it asks before
overwriting.

After running the script and restarting Docker Desktop, container
metrics (`container.cpu.usage`, `container.memory.usage`,
`container.network.io`) will flow through the OTel Collector into
Splunk. The demo dashboard includes charts for these metrics (charts
15-17 in `splunk/dashboard.json`).

---

*Last updated: 2026-09-04*
