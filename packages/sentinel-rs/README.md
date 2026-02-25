# sentinel-client

Rust client SDK for the [Paradigm Sentinel](https://github.com/ascend42/a-paradigm) observability server.

A lightweight async client that STAR/kamiki applications use to send structured logs and metrics to a Sentinel HTTP server with buffered batching.

## Usage

```rust
use std::collections::HashMap;
use sentinel_client::LogLevel;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let sentinel = sentinel_client::client("my-app")
        .url("http://localhost:3838")
        .environment("development")
        .build();

    // Register this service with Sentinel
    sentinel.register().await?;

    // Structured logging with Paradigm symbols
    sentinel.info("#checkout", "Order placed").await;
    sentinel.debug("#db", "Query executed").await;
    sentinel.warn("#cache", "Cache miss on product lookup").await;
    sentinel.error("^authenticated", "Token expired").await;

    // Log with additional data
    sentinel.log(
        LogLevel::Info,
        "#checkout",
        "Payment processed",
        Some(serde_json::json!({ "orderId": "ORD-123", "amount": 49.99 })),
    ).await;

    // Metrics
    let mut tags = HashMap::new();
    tags.insert("region".into(), "us-east".into());
    sentinel.counter("orders.total", 1.0, tags).await;
    sentinel.gauge("connections.active", 42.0, HashMap::new()).await;

    // Flush remaining buffered entries before shutdown
    sentinel.flush().await?;

    Ok(())
}
```

## Configuration

| Method | Default | Description |
|--------|---------|-------------|
| `url` | `http://localhost:3838` | Sentinel server URL |
| `token` | None | Bearer token for authenticated servers |
| `environment` | None | Environment label (development, staging, production) |
| `batch_size` | 50 | Auto-flush threshold for buffered entries |

## Batching

Log and metric entries are buffered in memory. A flush is triggered automatically when the buffer reaches `batch_size`, or manually via `sentinel.flush().await`. Always call `flush()` before your application exits to avoid losing buffered data.

## API Endpoints

The client communicates with these Sentinel server endpoints:

- `POST /api/logs` -- submit log entry batches
- `POST /api/metrics` -- submit metric entry batches
- `POST /api/services` -- register a service

## License

MIT
