# Grafana Dashboards for Swipefish

This directory contains Grafana dashboards that can be imported into your Grafana Cloud instance.

## Available Dashboards

### 1. Application Overview (`application-overview.json`)
Comprehensive overview of the entire application:
- Active backend pods
- HTTP request rate and duration
- Error rates
- Recent application logs
- Trace statistics

### 2. Socket.io Performance (`socketio-performance.json`)
Monitor Socket.io connection and event performance:
- Active socket connections
- Event rates by type
- Connection/disconnection rates
- Event latency (p50, p95)
- Socket.io logs and traces

### 3. Room Management (`room-management.json`)
Track game room operations:
- Active rooms and total players
- Room creation/join/leave rates
- Players per room distribution
- Room operation logs and traces

### 4. Error Tracking (`error-tracking.json`)
Monitor and alert on application errors:
- Error rates (4xx and 5xx)
- Error logs with trace correlation
- Error traces
- Error summary by status code

## Importing Dashboards

### Method 1: Via Grafana UI

1. Log in to your Grafana Cloud instance
2. Navigate to **Dashboards** → **Import**
3. Click **Upload JSON file** or paste the JSON content
4. Select your data sources:
   - **Prometheus**: Your Prometheus data source
   - **Loki**: Your Loki data source
   - **Tempo**: Your Tempo data source
5. Click **Import**

### Method 2: Via Grafana API

```bash
# Set your Grafana Cloud credentials
export GRAFANA_URL="https://your-instance.grafana.net"
export GRAFANA_API_KEY="your-api-key"

# Import a dashboard
curl -X POST \
  -H "Authorization: Bearer $GRAFANA_API_KEY" \
  -H "Content-Type: application/json" \
  -d @application-overview.json \
  "$GRAFANA_URL/api/dashboards/db"
```

## Data Source Configuration

Before importing, ensure you have configured these data sources in Grafana Cloud:

1. **Prometheus**
   - URL: `http://prometheus-observability.swipe.fish` (or your Ingress URL)
   - Access: Server (default)
   - Basic Auth: Enabled (use credentials from `k8s/OBSERVABILITY_CREDENTIALS.md`)

2. **Loki**
   - URL: `http://loki-observability.swipe.fish` (or your Ingress URL)
   - Access: Server (default)
   - Basic Auth: Enabled

3. **Tempo**
   - URL: `http://tempo-observability.swipe.fish` (or your Ingress URL)
   - Access: Server (default)
   - Basic Auth: Enabled

## Customizing Dashboards

After importing, you may need to:

1. **Update Data Source UIDs**: The dashboards use placeholder UIDs (`prometheus`, `loki`, `tempo`). Grafana will prompt you to select the correct data sources during import, or you can update them manually.

2. **Adjust Queries**: Some metrics may not exist yet if you haven't implemented all instrumentation. You can:
   - Comment out panels that reference non-existent metrics
   - Update queries to match your actual metric names
   - Add new panels as you add more instrumentation

3. **Set Up Alerts**: The Error Tracking dashboard includes an example alert. You can:
   - Configure notification channels
   - Add more alerts for other metrics
   - Set appropriate thresholds

## Metric Requirements

For all dashboards to work fully, ensure your backend exposes these metrics:

### HTTP Metrics
- `http_server_request_duration_seconds` (histogram)
- `http_server_request_duration_seconds_count` (counter)
- `http_server_request_duration_seconds_bucket` (histogram buckets)

### Socket.io Metrics (optional)
- `socket_io_connections_active` (gauge)
- `socket_io_events_total` (counter)
- `socket_io_disconnections_total` (counter)
- `socket_io_event_duration_seconds` (histogram)

### Room Metrics (optional)
- `room_count_active` (gauge)
- `room_players_count` (gauge)
- `room_created_total` (counter)
- `room_joined_total` (counter)
- `room_left_total` (counter)
- `room_operation_duration_seconds` (histogram)

## Troubleshooting

### "No data" in panels
- Verify data sources are correctly configured and accessible
- Check that metrics are being scraped by Prometheus
- Verify log queries match your log format
- Ensure traces are being sent to Tempo

### "Query failed" errors
- Check data source connectivity
- Verify metric names match your actual instrumentation
- Check Grafana Cloud logs for more details

### Missing metrics
- Some metrics are optional (Socket.io, Room metrics)
- You can remove or comment out panels that reference missing metrics
- Add instrumentation as needed to populate these metrics

## Next Steps

1. Import all dashboards
2. Customize data source UIDs
3. Add alerts for critical metrics
4. Create additional dashboards as needed
5. Set up dashboard folders for organization

