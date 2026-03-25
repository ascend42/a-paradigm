import SwiftUI

// MARK: - String Identifiable (required by .sheet(item:) bindings in ApprovalView)

extension String: @retroactive Identifiable {
    public var id: String { self }
}

/// Conductor design token system.
/// Provides semantic colors, font sizes, and card styles used across all Conductor views.
/// Consolidates statusColor, priorityColor, healthColor, and levelColor mappings.
enum ConductorTheme {

    // MARK: - Semantic Color Tokens

    /// Conductor brand color — used on folder icons, workspace badges.
    static var brand: Color { .cyan }

    /// Symphony / team / agent messaging color.
    static var symphony: Color { .purple }

    /// Healthy / running / success state.
    static var healthy: Color { .green }

    /// Degraded / warning-level state.
    static var degraded: Color { .yellow }

    /// Critical / failure / error state.
    static var critical: Color { .red }

    /// Warning / needs attention state.
    static var warning: Color { .orange }

    /// Active / selected / informational state.
    static var active: Color { .blue }

    /// Muted / inactive / tertiary state.
    static var muted: Color { .secondary }

    // MARK: - Font Size Constants

    /// Minimum allowed font size (8pt).
    static let fontXS: CGFloat = 8.0

    /// Small font size (9pt).
    static let fontSM: CGFloat = 9.0

    /// Medium / body font size (11pt).
    static let fontMD: CGFloat = 11.0

    /// Large font size (13pt).
    static let fontLG: CGFloat = 13.0

    // MARK: - Card Style Constants

    /// Standard corner radius for cards and panels.
    static let cornerRadius: CGFloat = 8.0

    /// Standard card background using the system control background.
    static var cardBackground: Color { Color(nsColor: .controlBackgroundColor) }

    // MARK: - Task Status Colors

    static func statusColor(_ status: TaskStatus) -> Color {
        switch status {
        case .assigned: return active
        case .acknowledged: return brand
        case .inProgress: return healthy
        case .blocked: return critical
        case .awaitingApproval: return warning
        case .complete: return healthy
        case .failed: return critical
        }
    }

    // MARK: - Task Priority Colors

    static func priorityColor(_ priority: TaskPriority) -> Color {
        switch priority {
        case .critical: return critical
        case .high: return warning
        case .normal: return active
        case .low: return muted
        }
    }

    // MARK: - Agent Health Colors

    static func healthColor(_ status: HealthStatus) -> Color {
        switch status {
        case .healthy: return healthy
        case .degraded: return degraded
        case .unhealthy: return critical
        case .unknown: return .gray
        }
    }

    // MARK: - Sentinel Level Colors

    static func levelColor(_ level: String) -> Color {
        switch level {
        case "error": return critical
        case "warn": return warning
        case "info": return active
        default: return muted
        }
    }
}

/// Backward-compatible typealias so existing `ConductorColors.xyz` call sites compile.
typealias ConductorColors = ConductorTheme
