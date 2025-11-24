import { initializeFaro as faroInit } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

// Initialize Grafana Faro for frontend observability
export function initializeFaro(): void {
  const faroEndpoint = import.meta.env.VITE_FARO_ENDPOINT;
  const appName = import.meta.env.VITE_FARO_APP_NAME || 'swipefish-frontend';
  const otlpEndpoint = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!faroEndpoint) {
    console.warn('VITE_FARO_ENDPOINT not set, Faro instrumentation disabled');
    return;
  }

  const instrumentations = otlpEndpoint
    ? [new TracingInstrumentation()]
    : [];

  faroInit({
    url: faroEndpoint,
    app: {
      name: appName,
      version: '1.0.0',
    },
    instrumentations,
    beforeSend: (event: any) => {
      // Optional: filter or modify events before sending
      return event;
    },
  });

  console.log(`Grafana Faro initialized for app: ${appName}`);
  if (otlpEndpoint) {
    console.log(`OpenTelemetry traces endpoint: ${otlpEndpoint}`);
  }
}

