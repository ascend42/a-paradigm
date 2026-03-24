import SwiftUI

// MARK: - String Identifiable (required by .sheet(item:) bindings in ApprovalView)

extension String: @retroactive Identifiable {
    public var id: String { self }
}

/// Shared color mapping functions used across multiple Conductor views.
/// Consolidates duplicate statusColor, priorityColor, healthColor, and levelColor
/// that were previously defined as private functions in individual views.
enum ConductorColors {

    // MARK: - Task Status Colors

    static func statusColor(_ status: TaskStatus) -> Color {
        switch status {
        case .assigned: return .blue
        case .acknowledged: return .cyan
        case .inProgress: return .green
        case .blocked: return .red
        case .awaitingApproval: return .orange
        case .complete: return .green
        case .failed: return .red
        }
    }

    // MARK: - Task Priority Colors

    static func priorityColor(_ priority: TaskPriority) -> Color {
        switch priority {
        case .critical: return .red
        case .high: return .orange
        case .normal: return .blue
        case .low: return .secondary
        }
    }

    // MARK: - Agent Health Colors

    static func healthColor(_ status: HealthStatus) -> Color {
        switch status {
        case .healthy: return .green
        case .degraded: return .yellow
        case .unhealthy: return .red
        case .unknown: return .gray
        }
    }

    // MARK: - Sentinel Level Colors

    static func levelColor(_ level: String) -> Color {
        switch level {
        case "error": return .red
        case "warn": return .orange
        case "info": return .blue
        default: return .secondary
        }
    }
}
