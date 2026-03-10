// ConductorLog.swift — #conductor-app
// Paradigm-style structured logging for Conductor.
// Uses os.Logger (Unified Logging) with symbol-tagged subsystems.

import os

/// Paradigm-style logger for Conductor.
/// Usage: ConductorLog.component("panel").info("Panel visible")
enum ConductorLog {
    private static let subsystem = "com.a-company.paradigm.conductor"

    // MARK: - Pre-built loggers for common symbols

    /// App lifecycle events (#conductor-app)
    static let app = Logger(subsystem: subsystem, category: "#conductor-app")

    /// Panel management (#conductor-panel)
    static let panel = Logger(subsystem: subsystem, category: "#conductor-panel")

    /// Permission checks (#permissions-onboarding)
    static let permissions = Logger(subsystem: subsystem, category: "#permissions-onboarding")

    // MARK: - Dynamic loggers

    /// Log for a Paradigm component (#symbol).
    static func component(_ name: String) -> Logger {
        Logger(subsystem: subsystem, category: "#\(name)")
    }

    /// Log for a Paradigm gate (^symbol).
    static func gate(_ name: String) -> Logger {
        Logger(subsystem: subsystem, category: "^\(name)")
    }

    /// Log for a Paradigm signal (!symbol).
    static func signal(_ name: String) -> Logger {
        Logger(subsystem: subsystem, category: "!\(name)")
    }

    /// Log for a Paradigm flow ($symbol).
    static func flow(_ name: String) -> Logger {
        Logger(subsystem: subsystem, category: "$\(name)")
    }

    /// Log for a Paradigm aspect (~symbol).
    static func aspect(_ name: String) -> Logger {
        Logger(subsystem: subsystem, category: "~\(name)")
    }
}
