// gnomon-helper (darwin) 1.11.0 — the helper's own keychain items (G-HLP-03/04): the anchor `gnomon-head`, the
// stored presence mode `gnomon-presence-mode` and the kernel-cert rate window `gnomon-kernel-cert-rate`. Generic
// passwords in the data-protection keychain, ONLY in the explicit production group SW4BMQ8PNL.gnomon.prod (never the
// default app-ID group), AfterFirstUnlockThisDeviceOnly. Only this signed helper is entitled to that group, so no
// same-user process (a Claude session included) can write them.

import CryptoKit
import Foundation
import Security

let itemService = "gnomon-helper"

/// The seam (production: KeychainItemStore; tests: MemoryItemStore). read: nil = no item; throws = unreadable.
protocol ItemStore: AnyObject {
    func read(_ account: String) throws -> Data?
    func write(_ account: String, _ value: Data) throws
}

final class KeychainItemStore: ItemStore {
    private func query(_ account: String) -> Json {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: itemService,
         kSecAttrAccount as String: account,
         kSecAttrAccessGroup as String: accessGroup,
         kSecUseDataProtectionKeychain as String: true]
    }

    func read(_ account: String) throws -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        var item: CFTypeRef?
        let st = SecItemCopyMatching(q as CFDictionary, &item)
        if st == errSecItemNotFound { return nil }
        guard st == errSecSuccess, let d = item as? Data else { throw HelperError("keychain", "\(account) is unreadable", status: Int(st)) }
        return d
    }

    func write(_ account: String, _ value: Data) throws {
        let upd = SecItemUpdate(query(account) as CFDictionary, [kSecValueData as String: value] as CFDictionary)
        if upd == errSecSuccess { return }
        guard upd == errSecItemNotFound else { throw HelperError("keychain", "\(account) was not written", status: Int(upd)) }
        var add = query(account)
        add[kSecValueData as String] = value
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let st = SecItemAdd(add as CFDictionary, nil)
        guard st == errSecSuccess else { throw HelperError("keychain", "\(account) was not written", status: Int(st)) }
    }
}

final class MemoryItemStore: ItemStore {
    var items: [String: Data] = [:]
    var unreadable = Set<String>()
    func read(_ account: String) throws -> Data? {
        if unreadable.contains(account) { throw HelperError("keychain", "\(account) is unreadable") }
        return items[account]
    }
    func write(_ account: String, _ value: Data) throws { items[account] = value }
}

/// Canonical JSON (sorted keys, no spaces, `/` unescaped): the TS canonicalJson for the ASCII strings, whole numbers,
/// booleans, arrays and objects the helper composes.
func canonicalJSON(_ obj: Any) -> Data {
    (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed])) ?? Data()
}

/// ISO 8601 with milliseconds, UTC (JavaScript's toISOString).
func isoMs(_ d: Date) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    f.timeZone = TimeZone(identifier: "UTC")
    return f.string(from: d)
}

func parseIso(_ s: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: s)
}

/// A sliding-window rate limit (in memory unless persisted by its owner).
struct RateWindow {
    let limit: Int
    let seconds: TimeInterval
    var stamps: [Date] = []

    init(limit: Int, seconds: TimeInterval, stamps: [Date] = []) {
        self.limit = limit
        self.seconds = seconds
        self.stamps = stamps
    }

    /// Take one slot at `now`; false = over the limit (nothing taken).
    mutating func take(_ now: Date) -> Bool {
        stamps.removeAll { now.timeIntervalSince($0) >= seconds } // a stamp in the future (clock set back) still counts
        guard stamps.count < limit else { return false }
        stamps.append(now)
        return true
    }
}
