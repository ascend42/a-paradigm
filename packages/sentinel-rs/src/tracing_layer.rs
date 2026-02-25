//! Tracing subscriber [`Layer`] that forwards events to Sentinel.
//!
//! Enabled via the `tracing` feature flag:
//!
//! ```toml
//! [dependencies]
//! sentinel-client = { version = "0.2", features = ["tracing"] }
//! ```
//!
//! # Usage
//!
//! ```no_run
//! use tracing_subscriber::prelude::*;
//!
//! # fn example() {
//! let sentinel = sentinel_client::client("my-app")
//!     .environment("development")
//!     .build();
//!
//! let layer = sentinel_client::tracing_layer::SentinelLayer::new(sentinel);
//!
//! tracing_subscriber::registry()
//!     .with(layer)
//!     .init();
//! # }
//! ```
//!
//! Events with a `symbol` field are forwarded with that symbol. Otherwise the
//! module path is converted to a symbol: `my_app::checkout::handler` → `#checkout-handler`.

use std::sync::Arc;

use tracing_core::{Event, Subscriber};
use tracing_subscriber::{layer::Context, registry::LookupSpan, Layer};

use crate::{LogLevel, SentinelClient};

/// A [`tracing_subscriber::Layer`] that sends events to a Sentinel server.
pub struct SentinelLayer {
    client: Arc<SentinelClient>,
}

impl SentinelLayer {
    /// Create a new layer backed by the given [`SentinelClient`].
    pub fn new(client: SentinelClient) -> Self {
        Self {
            client: Arc::new(client),
        }
    }
}

impl<S> Layer<S> for SentinelLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let level = map_level(event.metadata().level());

        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);

        let symbol = visitor.symbol.unwrap_or_else(|| {
            module_to_symbol(event.metadata().module_path().unwrap_or("unknown"))
        });

        let message = visitor.message.unwrap_or_default();
        let data = if visitor.fields.is_empty() {
            None
        } else {
            Some(serde_json::Value::Object(
                visitor
                    .fields
                    .into_iter()
                    .map(|(k, v)| (k, serde_json::Value::String(v)))
                    .collect(),
            ))
        };

        let client = Arc::clone(&self.client);
        tokio::spawn(async move {
            client.log(level, &symbol, &message, data).await;
        });
    }
}

/// Map tracing levels to Sentinel log levels.
fn map_level(level: &tracing_core::Level) -> LogLevel {
    match *level {
        tracing_core::Level::TRACE | tracing_core::Level::DEBUG => LogLevel::Debug,
        tracing_core::Level::INFO => LogLevel::Info,
        tracing_core::Level::WARN => LogLevel::Warn,
        tracing_core::Level::ERROR => LogLevel::Error,
    }
}

/// Convert a Rust module path to a Paradigm symbol.
///
/// `my_crate::checkout::handler` → `#checkout-handler`
/// Strips the crate root and joins remaining segments with `-`.
fn module_to_symbol(module_path: &str) -> String {
    let segments: Vec<&str> = module_path.split("::").collect();
    let meaningful = if segments.len() > 1 {
        &segments[1..]
    } else {
        &segments[..]
    };
    format!(
        "#{}",
        meaningful
            .iter()
            .map(|s| s.replace('_', "-"))
            .collect::<Vec<_>>()
            .join("-")
    )
}

/// Visitor that extracts `message`, `symbol`, and extra fields from a tracing event.
#[derive(Default)]
struct FieldVisitor {
    message: Option<String>,
    symbol: Option<String>,
    fields: Vec<(String, String)>,
}

impl tracing_core::field::Visit for FieldVisitor {
    fn record_debug(&mut self, field: &tracing_core::Field, value: &dyn std::fmt::Debug) {
        let val = format!("{:?}", value);
        match field.name() {
            "message" => self.message = Some(val),
            "symbol" => self.symbol = Some(val.trim_matches('"').to_owned()),
            _ => self.fields.push((field.name().to_owned(), val)),
        }
    }

    fn record_str(&mut self, field: &tracing_core::Field, value: &str) {
        match field.name() {
            "message" => self.message = Some(value.to_owned()),
            "symbol" => self.symbol = Some(value.to_owned()),
            _ => self.fields.push((field.name().to_owned(), value.to_owned())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_to_symbol_strips_crate() {
        assert_eq!(module_to_symbol("my_app::checkout::handler"), "#checkout-handler");
    }

    #[test]
    fn module_to_symbol_single_segment() {
        assert_eq!(module_to_symbol("my_app"), "#my-app");
    }

    #[test]
    fn module_to_symbol_underscores_to_dashes() {
        assert_eq!(module_to_symbol("crate::user_auth::login_handler"), "#user-auth-login-handler");
    }

    #[test]
    fn map_level_trace_to_debug() {
        assert_eq!(map_level(&tracing_core::Level::TRACE), LogLevel::Debug);
    }

    #[test]
    fn map_level_error() {
        assert_eq!(map_level(&tracing_core::Level::ERROR), LogLevel::Error);
    }
}
