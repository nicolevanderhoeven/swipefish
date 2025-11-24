import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

// Track if instrumentation has been initialized to prevent multiple initializations
let isInitialized = false;

// Initialize OpenTelemetry SDK
// This must be done BEFORE importing any other modules
export function initializeInstrumentation(): void {
  // Prevent multiple initializations
  if (isInitialized) {
    console.log('OpenTelemetry instrumentation already initialized, skipping...');
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'swipefish-backend';
  const serviceVersion = process.env.OTEL_SERVICE_VERSION || '1.0.0';
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
  const prometheusPort = parseInt(process.env.PROMETHEUS_PORT || '9464', 10);
  const resourceAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES || 'app=swipefish';

  // Parse resource attributes
  const attributes: Record<string, string> = {
    [SEMRESATTRS_SERVICE_NAME]: serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
  };

  // Parse additional resource attributes from environment variable
  // Format: key1=value1,key2=value2
  if (resourceAttributes) {
    resourceAttributes.split(',').forEach((attr) => {
      const [key, value] = attr.split('=').map((s) => s.trim());
      if (key && value) {
        attributes[key] = value;
      }
    });
  }

  const resource = new Resource(attributes);

  // Configure trace exporter for Tempo
  const traceExporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  });

  // Configure Prometheus metrics exporter
  // PrometheusExporter exposes metrics via HTTP endpoint and needs to be used with a metric reader
  const prometheusExporter = new PrometheusExporter({
    port: prometheusPort,
    endpoint: '/metrics',
  });

  // Start the Prometheus exporter server
  // Wrap in try-catch to handle cases where server is already running
  try {
    prometheusExporter.startServer();
  } catch (error: any) {
    // If server is already running, that's okay - continue
    if (error?.code === 'ERR_SERVER_ALREADY_LISTEN') {
      console.warn('Prometheus exporter server already running, continuing...');
    } else {
      throw error;
    }
  }

  // Create metric reader that exports to Prometheus
  const metricReader = new PeriodicExportingMetricReader({
    exporter: prometheusExporter as any, // Type assertion needed due to interface differences
    exportIntervalMillis: 10000, // Export metrics every 10 seconds
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: metricReader as any, // Type assertion for compatibility
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable fs instrumentation to reduce noise
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
      }),
    ],
  });

  // Start the SDK
  sdk.start();

  // Mark as initialized
  isInitialized = true;

  console.log(`OpenTelemetry initialized for service: ${serviceName}`);
  console.log(`Prometheus metrics available at http://localhost:${prometheusPort}/metrics`);
  console.log(`Traces exported to: ${otlpEndpoint}/v1/traces`);

  // Gracefully shut down the SDK on process termination
  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => console.log('OpenTelemetry SDK shut down successfully'))
      .catch((error) => console.error('Error shutting down OpenTelemetry SDK', error));
  });
}

