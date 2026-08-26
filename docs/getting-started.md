# Getting Started

## Prerequisites

- **Docker Desktop** (or Docker Engine + Compose plugin) -- [install](https://docs.docker.com/get-docker/)
- **Git** -- for version control
- **Node.js >= 20.6.0** -- only needed for local development outside Docker
- **Python 3** -- only needed for the kanban board scripts

## Initial setup

### 1. Clone the repository

```bash
git clone <repo-url> observability-test
cd observability-test
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` with your actual values. At minimum, for the stub phase you
only need the defaults -- no API keys required until Epic 004 (RAG chat).

### 3. Start Docker Desktop

Make sure Docker Desktop is running. You can verify with:

```bash
docker version
```

Both "Client" and "Server" sections should appear.

### 4. Build and start all services

```bash
docker compose up -d --build
```

This pulls/builds all images and starts 4 services:
- **nginx** -- Chat UI on port 80
- **api** -- Node.js Express API on port 3000
- **surrealdb** -- Database on port 8000
- **otel-collector** -- Telemetry pipeline on ports 4317 (gRPC) / 4318 (HTTP)

### 5. Verify everything is running

```bash
# Check all containers are up
docker compose ps

# Test the health endpoint
curl http://localhost/api/health
# Expected: {"status":"ok"}

# Test the stub chat endpoint
curl -X POST http://localhost/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
# Expected: {"reply":"[stub] You said: \"hello\". LLM integration coming in Epic 004."}
```

**PowerShell alternative** (Windows -- use `curl.exe` to avoid the
`Invoke-WebRequest` alias):

```powershell
# Check all containers are up
docker compose ps

# Test the health endpoint
curl.exe http://localhost/api/health

# Test the stub chat endpoint
curl.exe -X POST http://localhost/api/chat `
  -H "Content-Type: application/json" `
  -d '{"message":"hello"}'
```

### 6. Open the chat UI

Navigate to [http://localhost](http://localhost) in your browser.

## What's next

- See [Docker Commands](docker-commands.md) for day-to-day operations
- See [Configuration](configuration.md) to swap LLM providers
- See [OpenTelemetry](opentelemetry.md) to understand the instrumentation
