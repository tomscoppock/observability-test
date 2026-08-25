# Decision Log

<!-- One entry per non-obvious decision. Newest first. Include the date,
     the decision, and the reason -- the reason is what makes this useful
     six months later. -->

### 2026-08-25 -- Upgrade SurrealDB to 3.2.4 for native OTLP telemetry

**Decision:** Upgrade SurrealDB from 3.0.5 to 3.2.4 (latest) and enable
native OTLP telemetry via `SURREAL_TELEMETRY_PROVIDER=otlp`.

**Why:** SurrealDB 3.1+ introduced a unified OTel pipeline that pushes
metrics, traces, and logs over OTLP. Version 3.0.5 silently ignored the
telemetry env vars -- no `/metrics` endpoint, no OTLP export. Upgrading
to 3.2.4 enables infrastructure monitoring (CPU, memory, transaction
throughput, HTTP activity, network I/O) without any sidecar or scraper.

**Metrics confirmed flowing:** `surrealdb.process.*`,
`surrealdb.transaction.*`, `surrealdb.http.*`, `surrealdb.rpc.*`,
`surrealdb.network.*` -- all arriving at the OTel Collector and forwarded
to Splunk via the existing signalfx/otlp_http/splunk_hec pipelines.

**Risk:** Major version jump (3.0 -> 3.2). SurrealDB 3.x is pre-1.0
semantically, so breaking changes are possible. Acceptable for a dev/test
stack; pin to a specific tag (e.g. `surrealdb/surrealdb:v3.2.4`) before
production use.

**Alternatives considered:** Prometheus scraping via `/metrics` endpoint
(not available in 3.0.5, and OTLP push is simpler than adding a scraper),
StatsD sidecar (unnecessary complexity).

### 2026-08-18 -- SurrealMX in-memory engine with async AOL

**Decision:** Use SurrealDB's SurrealMX in-memory engine with async
append-only logging (`mem://srdb?aol=async&sync=5s&snapshot=60s`) instead
of RocksDB or SurrealKV on-disk engines.

**Why:** User preference -- RocksDB is "horrible" (performance/reliability
issues reported). In-memory is fast and sufficient for dev. Async AOL
with 5-second sync and 60-second snapshots provides durability across
container restarts without the overhead of synchronous disk writes.

**Alternatives considered:** RocksDB (rejected by user), SurrealKV
(newer but less tested), pure `mem://` without AOL (no restart
durability), SurrealDB Cloud (future option, hooks in `.env.example`).

**Note:** SurrealDB 3.x runs as non-root in the container, but Docker
named volumes are root-owned. The `docker-compose.yml` uses `user: "0:0"`
to work around this in dev. Production deployments should use proper
volume permissions or cloud storage.

### 2026-08-18 -- Use upstream OTel Collector Contrib, not Splunk distribution

**Decision:** Use `otel/opentelemetry-collector-contrib` Docker image
rather than the Splunk Distribution of the OpenTelemetry Collector.

**Why:** The upstream contrib image includes the Splunk exporter and is
more portable -- switching observability backends (Splunk -> Azure Monitor
-> Grafana) only requires changing the collector config, not the collector
image. This project's purpose is to test multiple backends.

**Alternatives considered:** Splunk Distribution (recommended by Splunk,
but locks you into their image and adds Splunk-specific components we
don't need).

### 2026-08-18 -- OTel JS SDK 2.x with --require instrumentation pattern

**Decision:** Use OTel JS SDK 2.x (packages >= 2.0.0) and load
`instrumentation.js` via `node --require` before any app code.

**Why:** SDK 2.x is the current stable release (since 2025). The
`--require` pattern ensures OTel patches libraries (Express, HTTP, etc.)
before they're imported -- this is the #1 source of "I don't see traces"
issues. Minimum Node.js: ^18.19.0 || >=20.6.0.

**Alternatives considered:** SDK 1.x (outdated), ESM `--import` (more
complex, less documented for OTel).

### 2026-08-18 -- SurrealDB for document/embedding storage

**Decision:** Use SurrealDB as the database for documents, chunks, and
vector embeddings.

**Why:** Multi-model (document + graph + relational), supports vector
fields and vector search natively, runs as a single Docker container,
has a Node.js SDK. Good fit for RAG where you need both document storage
and vector similarity search.

**Alternatives considered:** PostgreSQL + pgvector (more mature but
heavier), ChromaDB (vector-only, no document storage), Qdrant
(vector-only).

### 2026-08-18 -- All configuration in .env

**Decision:** Every configurable value (LLM endpoints, API keys, database
credentials, collector endpoints, embedding config) lives in `.env`.

**Why:** Enables swapping LLM providers, observability backends, and
database settings without touching code. Docker Compose reads `.env`
natively. Keeps secrets out of source control.

**Alternatives considered:** Hardcoded config files (inflexible),
environment-specific config directories (overkill for a learning project).
