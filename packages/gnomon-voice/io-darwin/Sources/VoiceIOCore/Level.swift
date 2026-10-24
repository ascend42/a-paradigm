// Level meter and output-route math of gnomon-voice-io:v1 (#gnomon-voice-io). Pure.

import Foundation

public enum Level {
    /// The floor reported for digital silence.
    public static let floorDBFS: Double = -120

    /// RMS in dBFS of Int16 samples (full scale = 32768).
    public static func rmsDBFS(_ samples: [Int16]) -> Double {
        guard !samples.isEmpty else { return floorDBFS }
        var acc = 0.0
        for s in samples { let v = Double(s) / 32768.0; acc += v * v }
        return dbfs(meanSquare: acc / Double(samples.count))
    }

    public static func dbfs(meanSquare: Double) -> Double {
        guard meanSquare > 0 else { return floorDBFS }
        return max(floorDBFS, 10 * log10(meanSquare))
    }
}

/// Accumulates mean square over a window and emits one reading per window
/// (about 15 Hz at 16 kHz: 1067 samples).
public struct LevelMeter {
    public let windowSamples: Int
    private var acc = 0.0
    private var count = 0
    private var peak: Int32 = 0

    public init(sampleRate: Int = 16_000, hz: Int = 15) {
        windowSamples = max(1, sampleRate / max(1, hz))
    }

    /// Feeds samples; returns each completed window's (rmsDBFS, peakDBFS).
    public mutating func feed(_ samples: [Int16]) -> [(rms: Double, peak: Double)] {
        var out: [(Double, Double)] = []
        for s in samples {
            let v = Double(s) / 32768.0
            acc += v * v
            peak = max(peak, abs(Int32(s)))
            count += 1
            if count == windowSamples {
                let p = Double(peak) / 32768.0
                out.append((Level.dbfs(meanSquare: acc / Double(count)), Level.dbfs(meanSquare: p * p)))
                acc = 0; count = 0; peak = 0
            }
        }
        return out
    }
}

public enum RouteKind: String, Sendable {
    case speakers
    case headphones
    case external
    case unknown
}

public enum AecMode: String, Sendable {
    /// voice processing (VoiceProcessingIO) is active and the output is not headphones
    case vpio
    /// the output is headphones: no acoustic path from output to mic
    case headphones
    /// neither: speaker output with no echo cancellation (conversation mode must refuse)
    case none
}

public enum RouteMath {
    /// transport: CoreAudio kAudioDevicePropertyTransportType as a FourCC string
    /// ("bltn", "blue", "blea", "usb ", "hdmi", "dprt", "airp", …); dataSource:
    /// kAudioDevicePropertyDataSource of the built-in output ("ispk" speaker,
    /// "hdpn" headphone jack), nil when the device has none.
    public static func classify(transport: String?, dataSource: String?) -> RouteKind {
        switch transport {
        case "bltn":
            switch dataSource {
            case "hdpn": return .headphones
            case "ispk", nil: return .speakers
            default: return .speakers
            }
        // Bluetooth output is taken as headphones (AirPods, Beats): a Bluetooth
        // SPEAKER is misread here, which the founder's P7 run would show as a leak.
        case "blue", "blea": return .headphones
        case "usb ", "hdmi", "dprt", "airp", "thun", "pci ", "fwre": return .external
        case nil: return .unknown
        default: return .external
        }
    }

    public static func aec(kind: RouteKind, voiceProcessing: Bool) -> AecMode {
        if kind == .headphones { return .headphones }
        return voiceProcessing ? .vpio : .none
    }

    public static func fourCC(_ v: UInt32) -> String {
        let bytes = [UInt8((v >> 24) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)]
        return String(bytes: bytes.map { (0x20...0x7E).contains($0) ? $0 : 0x3F }, encoding: .ascii) ?? "????"
    }
}
