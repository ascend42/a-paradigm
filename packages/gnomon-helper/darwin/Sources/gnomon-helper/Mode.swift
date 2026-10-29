// gnomon-helper (darwin) 1.11.0 — the stored presence mode (TD-2026-10-29-340/-894, G-HLP-04): the global Touch ID
// switch as the HELPER holds it, in its own item `gnomon-presence-mode` (Items.swift). The kernel's word is never
// enough to switch it off: OFF is stored only after decision.sign signed a presence.mode card whose row says off (one
// Touch ID), with the row hash = sha256 of that exact signed root message. ON needs no presence (presence.mode.on, or a
// presence.mode row saying on) and revokes every click key. No item = ON (the default). An unreadable or malformed
// item is an error, never a mode: click.open fails closed on it.

import Foundation

let presenceModeAccount = "gnomon-presence-mode"

struct StoredMode: Equatable {
    let mode: String        // "on" | "off"
    let rowHash: String?    // the signed presence.mode row (off: required)
    let cardId: String?
}

final class ModeStore {
    let items: ItemStore

    init(items: ItemStore) { self.items = items }

    func read() throws -> StoredMode {
        guard let d = try items.read(presenceModeAccount) else { return StoredMode(mode: "on", rowHash: nil, cardId: nil) }
        guard let o = (try? JSONSerialization.jsonObject(with: d)) as? Json, let m = o["mode"] as? String, m == "on" || m == "off" else {
            throw HelperError("mode-unreadable", "the stored presence mode is malformed")
        }
        let h = o["rowHash"] as? String
        if m == "off" { guard let hh = h, fullMatch(hh, "^sha256:[0-9a-f]{64}$") else { throw HelperError("mode-unreadable", "an OFF mode without its row hash") } }
        return StoredMode(mode: m, rowHash: h, cardId: o["cardId"] as? String)
    }

    func store(_ m: StoredMode) throws {
        var o: Json = ["mode": m.mode]
        if let h = m.rowHash { o["rowHash"] = h }
        if let c = m.cardId { o["cardId"] = c }
        try items.write(presenceModeAccount, canonicalJSON(o))
    }
}

/// What a signed presence.mode batch stores: the mode its row says and the hash of the exact root message signed.
func storedModeOf(_ b: DecisionBatch) -> StoredMode? {
    guard b.cardKind == "presence.mode", b.rows.count == 2, b.root.count == 2, let m = b.rows[1]["mode"] as? String else { return nil }
    return StoredMode(mode: m, rowHash: sha256Tag(b.root[1]), cardId: b.anchor.cardId)
}
