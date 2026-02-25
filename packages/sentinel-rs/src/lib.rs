//! Rust client SDK for Paradigm Sentinel observability server.
//!
//! Provides async batched logging and metrics submission to a Sentinel HTTP server.
//! Designed for STAR/kamiki applications that need structured, symbol-aware observability.
//!
//! # Quick Start
//!
//! ```no_run
//! use std::collections::HashMap;
//!
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! let sentinel = sentinel_client::client("my-app")
//!     .url("http://localhost:3838")
//!     .environment("development")
//!     .build();
//!
//! sentinel.register().await?;
//! sentinel.info("#checkout", "Order placed").await;
//! sentinel.counter("orders.total", 1.0, HashMap::new()).await;
//! sentinel.flush().await?;
//! # Ok(())
//! # }
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Log severity level, serialized as lowercase strings to match the Sentinel API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// A single structured log entry sent to Sentinel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub level: LogLevel,
    pub symbol: String,
    pub message: String,
    pub service: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
}

/// Metric type classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MetricType {
    Counter,
    Gauge,
    Histogram,
}

/// A single metric data point sent to Sentinel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub metric_type: MetricType,
    pub value: f64,
    pub tags: HashMap<String, String>,
    pub service: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
}

/// Response from the Sentinel server after accepting a batch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchResponse {
    pub accepted: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<String>>,
}

// ---------------------------------------------------------------------------
// Internal request bodies
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct LogBatchBody {
    entries: Vec<LogEntry>,
}

#[derive(Serialize)]
struct MetricBatchBody {
    entries: Vec<MetricEntry>,
}

#[derive(Serialize)]
struct ServiceRegistration {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    environment: Option<String>,
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/// Builder for constructing a [`SentinelClient`] with custom configuration.
pub struct SentinelClientBuilder {
    service: String,
    url: String,
    token: Option<String>,
    environment: Option<String>,
    batch_size: usize,
}

impl SentinelClientBuilder {
    /// Create a new builder for the given service name.
    ///
    /// Defaults: url = `http://localhost:3838`, batch_size = 50.
    pub fn new(service: &str) -> Self {
        Self {
            service: service.to_owned(),
            url: "http://localhost:3838".to_owned(),
            token: None,
            environment: None,
            batch_size: 50,
        }
    }

    /// Set the Sentinel server URL.
    pub fn url(mut self, url: &str) -> Self {
        self.url = url.trim_end_matches('/').to_owned();
        self
    }

    /// Set the bearer token for authenticated requests.
    pub fn token(mut self, token: &str) -> Self {
        self.token = Some(token.to_owned());
        self
    }

    /// Set the environment label (e.g. "development", "production").
    pub fn environment(mut self, env: &str) -> Self {
        self.environment = Some(env.to_owned());
        self
    }

    /// Set the number of entries that triggers an automatic flush.
    pub fn batch_size(mut self, n: usize) -> Self {
        self.batch_size = n;
        self
    }

    /// Build the [`SentinelClient`].
    pub fn build(self) -> SentinelClient {
        SentinelClient {
            url: self.url,
            service: self.service,
            session_id: Uuid::new_v4().to_string(),
            token: self.token,
            http: reqwest::Client::new(),
            buffer: Arc::new(Mutex::new(Vec::new())),
            metrics_buffer: Arc::new(Mutex::new(Vec::new())),
            batch_size: self.batch_size,
            environment: self.environment,
        }
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Async client for sending structured logs and metrics to a Sentinel server.
///
/// Entries are buffered locally and flushed when the buffer reaches `batch_size`
/// or when [`flush`](SentinelClient::flush) is called explicitly.
pub struct SentinelClient {
    url: String,
    service: String,
    session_id: String,
    token: Option<String>,
    http: reqwest::Client,
    buffer: Arc<Mutex<Vec<LogEntry>>>,
    metrics_buffer: Arc<Mutex<Vec<MetricEntry>>>,
    batch_size: usize,
    environment: Option<String>,
}

impl SentinelClient {
    /// Create a [`SentinelClientBuilder`] for the given service name.
    pub fn builder(service: &str) -> SentinelClientBuilder {
        SentinelClientBuilder::new(service)
    }

    // -- Convenience log methods ------------------------------------------

    /// Log a debug-level message.
    pub async fn debug(&self, symbol: &str, message: &str) {
        self.log(LogLevel::Debug, symbol, message, None).await;
    }

    /// Log an info-level message.
    pub async fn info(&self, symbol: &str, message: &str) {
        self.log(LogLevel::Info, symbol, message, None).await;
    }

    /// Log a warn-level message.
    pub async fn warn(&self, symbol: &str, message: &str) {
        self.log(LogLevel::Warn, symbol, message, None).await;
    }

    /// Log an error-level message.
    pub async fn error(&self, symbol: &str, message: &str) {
        self.log(LogLevel::Error, symbol, message, None).await;
    }

    /// Push a log entry into the buffer. Triggers a flush when the buffer
    /// reaches the configured `batch_size`.
    pub async fn log(
        &self,
        level: LogLevel,
        symbol: &str,
        message: &str,
        data: Option<serde_json::Value>,
    ) {
        let entry = LogEntry {
            level,
            symbol: symbol.to_owned(),
            message: message.to_owned(),
            service: self.service.clone(),
            data,
            session_id: Some(self.session_id.clone()),
            correlation_id: None,
            duration_ms: None,
            environment: self.environment.clone(),
        };

        let should_flush = {
            let mut buf = self.buffer.lock().await;
            buf.push(entry);
            buf.len() >= self.batch_size
        };

        if should_flush {
            // Best-effort flush; callers who need guarantees should call flush() directly.
            let _ = self.flush().await;
        }
    }

    // -- Metric methods ---------------------------------------------------

    /// Record a counter metric.
    pub async fn counter(&self, name: &str, value: f64, tags: HashMap<String, String>) {
        self.record_metric(name, MetricType::Counter, value, tags).await;
    }

    /// Record a gauge metric.
    pub async fn gauge(&self, name: &str, value: f64, tags: HashMap<String, String>) {
        self.record_metric(name, MetricType::Gauge, value, tags).await;
    }

    /// Push a metric entry into the buffer. Triggers a flush when the metrics
    /// buffer reaches the configured `batch_size`.
    async fn record_metric(
        &self,
        name: &str,
        metric_type: MetricType,
        value: f64,
        tags: HashMap<String, String>,
    ) {
        let entry = MetricEntry {
            name: name.to_owned(),
            metric_type,
            value,
            tags,
            service: self.service.clone(),
            environment: self.environment.clone(),
        };

        let should_flush = {
            let mut buf = self.metrics_buffer.lock().await;
            buf.push(entry);
            buf.len() >= self.batch_size
        };

        if should_flush {
            let _ = self.flush().await;
        }
    }

    // -- Flush & network --------------------------------------------------

    /// Flush all buffered log entries and metric entries to the Sentinel server.
    ///
    /// Sends `POST /api/logs` with `{ entries: [...] }` for logs and
    /// `POST /api/metrics` with `{ entries: [...] }` for metrics. Buffers are
    /// drained before sending so new entries can accumulate during the request.
    pub async fn flush(&self) -> Result<(), Box<dyn std::error::Error>> {
        let logs: Vec<LogEntry> = {
            let mut buf = self.buffer.lock().await;
            std::mem::take(&mut *buf)
        };

        let metrics: Vec<MetricEntry> = {
            let mut buf = self.metrics_buffer.lock().await;
            std::mem::take(&mut *buf)
        };

        if !logs.is_empty() {
            let body = LogBatchBody { entries: logs };
            self.post("/api/logs", &body).await?;
        }

        if !metrics.is_empty() {
            let body = MetricBatchBody { entries: metrics };
            self.post("/api/metrics", &body).await?;
        }

        Ok(())
    }

    /// Register this service with the Sentinel server via `POST /api/services`.
    pub async fn register(&self) -> Result<(), Box<dyn std::error::Error>> {
        let body = ServiceRegistration {
            name: self.service.clone(),
            environment: self.environment.clone(),
        };
        self.post("/api/services", &body).await?;
        Ok(())
    }

    /// Send a POST request to the given path on the Sentinel server.
    async fn post<T: Serialize>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<reqwest::Response, Box<dyn std::error::Error>> {
        let url = format!("{}{}", self.url, path);

        let mut request = self.http.post(&url).json(body);

        if let Some(ref token) = self.token {
            request = request.header("Authorization", format!("Bearer {}", token));
        }

        let response = request.send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Sentinel API error {}: {}", status, text).into());
        }

        Ok(response)
    }

    // -- Accessors --------------------------------------------------------

    /// Return the session ID assigned to this client instance.
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Return the configured service name.
    pub fn service(&self) -> &str {
        &self.service
    }

    /// Return the number of log entries currently buffered.
    pub async fn buffered_logs(&self) -> usize {
        self.buffer.lock().await.len()
    }

    /// Return the number of metric entries currently buffered.
    pub async fn buffered_metrics(&self) -> usize {
        self.metrics_buffer.lock().await.len()
    }
}

// ---------------------------------------------------------------------------
// Top-level convenience
// ---------------------------------------------------------------------------

/// Create a new [`SentinelClientBuilder`] with minimal config.
///
/// This is the recommended entry point:
///
/// ```no_run
/// # async fn example() -> Result<(), Box<dyn std::error::Error>> {
/// let sentinel = sentinel_client::client("my-app")
///     .url("http://localhost:3838")
///     .environment("development")
///     .build();
/// # Ok(())
/// # }
/// ```
pub fn client(service: &str) -> SentinelClientBuilder {
    SentinelClient::builder(service)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_defaults() {
        let c = client("test-svc").build();
        assert_eq!(c.service(), "test-svc");
        assert!(!c.session_id().is_empty());
    }

    #[test]
    fn builder_custom_url_strips_trailing_slash() {
        let c = client("svc").url("http://example.com/").build();
        assert_eq!(c.url, "http://example.com");
    }

    #[test]
    fn builder_chaining() {
        let c = client("svc")
            .url("http://sentinel:3838")
            .token("secret-token")
            .environment("staging")
            .batch_size(100)
            .build();

        assert_eq!(c.url, "http://sentinel:3838");
        assert_eq!(c.token.as_deref(), Some("secret-token"));
        assert_eq!(c.environment.as_deref(), Some("staging"));
        assert_eq!(c.batch_size, 100);
    }

    #[test]
    fn log_level_serializes_lowercase() {
        let json = serde_json::to_string(&LogLevel::Debug).unwrap();
        assert_eq!(json, "\"debug\"");

        let json = serde_json::to_string(&LogLevel::Info).unwrap();
        assert_eq!(json, "\"info\"");

        let json = serde_json::to_string(&LogLevel::Warn).unwrap();
        assert_eq!(json, "\"warn\"");

        let json = serde_json::to_string(&LogLevel::Error).unwrap();
        assert_eq!(json, "\"error\"");
    }

    #[test]
    fn log_level_deserializes() {
        let level: LogLevel = serde_json::from_str("\"error\"").unwrap();
        assert_eq!(level, LogLevel::Error);
    }

    #[test]
    fn metric_type_serializes_lowercase() {
        let json = serde_json::to_string(&MetricType::Counter).unwrap();
        assert_eq!(json, "\"counter\"");

        let json = serde_json::to_string(&MetricType::Gauge).unwrap();
        assert_eq!(json, "\"gauge\"");

        let json = serde_json::to_string(&MetricType::Histogram).unwrap();
        assert_eq!(json, "\"histogram\"");
    }

    #[test]
    fn log_entry_serializes_to_camel_case() {
        let entry = LogEntry {
            level: LogLevel::Info,
            symbol: "#checkout".to_owned(),
            message: "Order placed".to_owned(),
            service: "my-app".to_owned(),
            data: None,
            session_id: Some("abc-123".to_owned()),
            correlation_id: None,
            duration_ms: Some(42.5),
            environment: Some("production".to_owned()),
        };

        let json = serde_json::to_value(&entry).unwrap();
        // Verify camelCase field names
        assert!(json.get("sessionId").is_some());
        assert!(json.get("durationMs").is_some());
        // Verify None fields are omitted
        assert!(json.get("correlationId").is_none());
        assert!(json.get("data").is_none());
    }

    #[test]
    fn metric_entry_serializes_type_field() {
        let entry = MetricEntry {
            name: "orders.total".to_owned(),
            metric_type: MetricType::Counter,
            value: 1.0,
            tags: HashMap::from([("region".to_owned(), "us-east".to_owned())]),
            service: "my-app".to_owned(),
            environment: None,
        };

        let json = serde_json::to_value(&entry).unwrap();
        // The field should be "type" in JSON, not "metric_type"
        assert_eq!(json.get("type").unwrap(), "counter");
        assert!(json.get("metric_type").is_none());
    }

    #[test]
    fn batch_response_deserializes() {
        let json = r#"{"accepted": 5, "errors": ["entry 2: invalid level"]}"#;
        let resp: BatchResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.accepted, 5);
        assert_eq!(resp.errors.unwrap().len(), 1);
    }

    #[test]
    fn batch_response_without_errors() {
        let json = r#"{"accepted": 10}"#;
        let resp: BatchResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.accepted, 10);
        assert!(resp.errors.is_none());
    }

    #[tokio::test]
    async fn log_buffers_entries() {
        let c = client("test").batch_size(100).build();

        c.info("#auth", "User logged in").await;
        c.debug("#db", "Query executed").await;
        c.warn("#cache", "Cache miss").await;

        assert_eq!(c.buffered_logs().await, 3);
        assert_eq!(c.buffered_metrics().await, 0);
    }

    #[tokio::test]
    async fn metric_buffers_entries() {
        let c = client("test").batch_size(100).build();

        c.counter("requests.total", 1.0, HashMap::new()).await;
        c.gauge("connections.active", 42.0, HashMap::new()).await;

        assert_eq!(c.buffered_metrics().await, 2);
        assert_eq!(c.buffered_logs().await, 0);
    }

    #[tokio::test]
    async fn log_with_data() {
        let c = client("test").batch_size(100).build();

        let data = serde_json::json!({ "orderId": "ORD-123", "total": 99.99 });
        c.log(LogLevel::Info, "#checkout", "Order placed", Some(data)).await;

        assert_eq!(c.buffered_logs().await, 1);
    }
}
