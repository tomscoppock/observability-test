'use strict';

/**
 * OpenTelemetry SDK initialisation.
 *
 * This file MUST be loaded before any application code via:
 *   node --require ./src/instrumentation.js src/index.js
 *
 * It configures the NodeSDK with OTLP exporters for traces, metrics,
 * and logs. When OTEL_EXPORTER_OTLP_ENDPOINT is not set (e.g. local
 * dev without a collector), it falls back to console exporters so
 * telemetry is still visible in stdout.
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} = require('@opentelemetry/semantic-conventions');

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const serviceName = process.env.OTEL_SERVICE_NAME || 'rag-api';

// Parse OTEL_RESOURCE_ATTRIBUTES (key=value,key=value) into an object.
function parseResourceAttributes(raw) {
  if (!raw) return {};
  const attrs = {};
  for (const pair of raw.split(',')) {
    const [key, ...rest] = pair.split('=');
    if (key) attrs[key.trim()] = rest.join('=').trim();
  }
  return attrs;
}

const extraAttrs = parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES);

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: '0.1.0',
  ...extraAttrs,
});

// Build SDK options -- OTLP exporters when endpoint is set, otherwise
// the SDK defaults (console/noop) are fine for local dev.
const sdkOptions = {
  resource,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable fs instrumentation -- too noisy for a learning project.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
};

if (otlpEndpoint) {
  sdkOptions.traceExporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  });

  sdkOptions.metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`,
    }),
    exportIntervalMillis: 15000,
  });

  // BatchLogRecordProcessor takes an options object -- passing the
  // exporter positionally leaves options.exporter undefined, which makes
  // every export throw internally and silently (diag is a no-op unless
  // OTEL_LOG_LEVEL is set), so no logs ever reach the collector.
  sdkOptions.logRecordProcessors = [
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: `${otlpEndpoint}/v1/logs`,
      }),
    }),
  ];

  console.log(`[otel] Exporting telemetry to ${otlpEndpoint}`);
} else {
  console.log('[otel] No OTEL_EXPORTER_OTLP_ENDPOINT set -- telemetry goes to console/noop');
}

const sdk = new NodeSDK(sdkOptions);
sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('[otel] SDK shut down'))
    .catch((err) => console.error('[otel] Error shutting down SDK', err))
    .finally(() => process.exit(0));
});
