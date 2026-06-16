// AtriumTextView.swift — #atrium-textview
// A custom NSViewRepresentable wrapping an NSTextView subclass for the ATRIUM
// composer's reply field.
//
// WHY THIS EXISTS (founder-unblock, runtime failures):
//   The previous SwiftUI `TextField(axis:.vertical)` approach FAILED AT RUNTIME
//   inside the manually-created cockpit window (an NSHostingView in a bare
//   NSWindow on an LSUIElement accessory app):
//     • Copy/paste/cut (⌘C/⌘V/⌘X) did nothing — the standard clipboard selectors
//       are delivered through the app's Edit menu / responder chain, which does
//       not route reliably to a SwiftUI TextField hosted in this window.
//     • `.onKeyPress(.return)` never fired dependably, so neither Enter-to-send
//       nor Shift+Enter-newline worked.
//
//   This view sidesteps BOTH problems by owning an NSTextView and explicitly
//   handling key equivalents in `performKeyEquivalent(with:)` — clipboard/undo
//   work with NO dependency on the app menu. Return/Shift+Return are handled in
//   `doCommandBySelector` so submit-vs-newline is deterministic.
//
// CAPABILITIES (#atrium-thread, #atrium-textview):
//   • Multiline, scrollable; grows to ~6 lines then scrolls.
//   • ATRIUM styling: void/surface bg, ink text, monospaced ~13, amber caret.
//   • Plain Return → submit callback, NO newline inserted.
//   • Shift+Return → newline inserted normally.
//   • ⌘C/⌘V/⌘X/⌘A/⌘Z/⌘⇧Z handled directly.
//   • Two-way bound to SwiftUI state via Coordinator (textDidChange → binding).
//   • Imperative appendText(_:) / clear() for the voice dictation path.
//   • Auto-focuses (becomes first responder) on appear.

import AppKit
import SwiftUI

/// Imperative controller handed to callers (the composer, the voice controller)
/// so dictation can stream text in and clear after a send WITHOUT going through
/// the SwiftUI binding (which can lag the live NSTextView).
@MainActor
final class AtriumTextViewHandle: ObservableObject {
    fileprivate weak var textView: AtriumNSTextView?

    /// Append text to the current draft (space-joined if non-empty), then keep
    /// the insertion point at the end. Used by the voice dictation loop.
    func appendText(_ fragment: String) {
        textView?.appendDictation(fragment)
    }

    /// Clear the entire draft. Used after send / on cancel phrase.
    func clear() {
        textView?.clearText()
    }

    /// Force keyboard focus into the field.
    func focus() {
        textView?.makeFirstResponderNow()
    }
}

/// SwiftUI wrapper over `AtriumNSTextView` embedded in an `NSScrollView`.
struct AtriumTextView: NSViewRepresentable {
    @Binding var text: String

    /// Cap visible growth (~lines) before scrolling kicks in.
    var maxVisibleLines: Int = 6

    /// Called on plain Return (submit). The composer runs its send().
    var onSubmit: () -> Void

    /// Optional handle so callers get imperative append/clear/focus.
    var handle: AtriumTextViewHandle?

    private let log = ConductorLog.component("atrium-textview")

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let textView = AtriumNSTextView()
        textView.delegate = context.coordinator
        textView.onSubmit = onSubmit

        // --- Styling (ATRIUM palette) ---
        textView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.textColor = NSColor(AtriumTheme.ink)
        textView.insertionPointColor = NSColor(AtriumTheme.amber)
        textView.backgroundColor = NSColor(AtriumTheme.surface)
        textView.drawsBackground = true
        textView.selectedTextAttributes = [
            .backgroundColor: NSColor(AtriumTheme.amber).withAlphaComponent(0.30),
            .foregroundColor: NSColor(AtriumTheme.ink)
        ]

        // --- Behavior ---
        textView.isEditable = true
        textView.isSelectable = true
        textView.isRichText = false
        textView.allowsUndo = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.textContainerInset = NSSize(width: 8, height: 8)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(
            width: 0,
            height: CGFloat.greatestFiniteMagnitude
        )

        textView.string = text

        // --- Scroll view container ---
        let scrollView = NSScrollView()
        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.drawsBackground = true
        scrollView.backgroundColor = NSColor(AtriumTheme.surface)
        scrollView.borderType = .noBorder
        scrollView.automaticallyAdjustsContentInsets = false

        context.coordinator.textView = textView
        handle?.textView = textView

        log.info("AtriumTextView created (NSTextView in NSScrollView)")

        // Auto-focus on appear — defer to next runloop so the window is key.
        DispatchQueue.main.async { textView.makeFirstResponderNow() }

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? AtriumNSTextView else { return }
        textView.onSubmit = onSubmit
        // Re-bind handle in case of view recreation.
        handle?.textView = textView
        // Only push binding → view when they actually diverge (avoids clobbering
        // the live insertion point during normal typing).
        if textView.string != text {
            textView.string = text
        }
    }

    // MARK: - Coordinator

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        private let parent: AtriumTextView
        weak var textView: AtriumNSTextView?

        init(_ parent: AtriumTextView) {
            self.parent = parent
        }

        // Two-way bind: NSTextView edits → SwiftUI state.
        func textDidChange(_ notification: Notification) {
            guard let tv = notification.object as? NSTextView else { return }
            // Mutating @Binding from delegate is fine on the main actor.
            parent.text = tv.string
        }
    }
}

/// NSTextView subclass that handles clipboard/undo via `performKeyEquivalent`
/// (menu-independent) and Return-vs-Shift+Return via `doCommandBySelector`.
@MainActor
final class AtriumNSTextView: NSTextView {

    /// Submit callback (plain Return).
    var onSubmit: (() -> Void)?

    private let log = ConductorLog.component("atrium-textview")

    // MARK: - First responder

    override var acceptsFirstResponder: Bool { true }

    /// Make this view first responder, walking up to ensure the window is key.
    func makeFirstResponderNow() {
        guard let window = self.window else { return }
        if !window.isKeyWindow {
            window.makeKeyAndOrderFront(nil)
        }
        window.makeFirstResponder(self)
    }

    // MARK: - Imperative dictation API

    /// Append dictated text. Space-joins onto existing content; moves caret to end.
    func appendDictation(_ fragment: String) {
        let trimmed = fragment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let current = string
        let needsSpace = !current.isEmpty &&
            !(current.last?.isWhitespace ?? true)
        let addition = needsSpace ? " " + trimmed : trimmed

        // Use the proper text-storage edit so undo + binding both see it.
        let insertionRange = NSRange(location: current.utf16.count, length: 0)
        if shouldChangeText(in: insertionRange, replacementString: addition) {
            textStorage?.replaceCharacters(in: insertionRange, with: addition)
            didChangeText()
        }
        moveToEndOfDocument(nil)
        scrollRangeToVisible(NSRange(location: string.utf16.count, length: 0))
    }

    /// Clear the entire draft (registers undo + fires binding update).
    func clearText() {
        let full = NSRange(location: 0, length: string.utf16.count)
        if shouldChangeText(in: full, replacementString: "") {
            textStorage?.replaceCharacters(in: full, with: "")
            didChangeText()
        }
    }

    // MARK: - Return handling (submit vs newline)

    // `insertNewline(_:)` is the NSResponder action the text system invokes for the
    // Return key (routed through doCommandBySelector internally). Overriding it on
    // the NSTextView subclass is the supported hook: plain Return → submit and DO
    // NOT insert a newline; Shift+Return → insert a real newline. We inspect the
    // live modifier flags to distinguish the two.
    override func insertNewline(_ sender: Any?) {
        let shift = NSApp.currentEvent?.modifierFlags.contains(.shift) ?? false
        if shift {
            log.debug("Shift+Return → newline")
            super.insertNewline(sender)
        } else {
            log.debug("Return → submit")
            onSubmit?()
        }
    }

    // MARK: - Clipboard / undo (menu-independent guarantee)

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        // Only act on ⌘-based combos while we (or our field editor) are focused.
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let isCommand = flags.contains(.command)
        let isShift = flags.contains(.shift)
        guard isCommand, let chars = event.charactersIgnoringModifiers?.lowercased() else {
            return super.performKeyEquivalent(with: event)
        }

        switch chars {
        case "c":
            log.debug("⌘C → copy")
            copy(nil)
            return true
        case "v":
            log.debug("⌘V → paste")
            pasteAsPlainText(nil)
            return true
        case "x":
            log.debug("⌘X → cut")
            cut(nil)
            return true
        case "a":
            log.debug("⌘A → selectAll")
            selectAll(nil)
            return true
        case "z" where !isShift:
            log.debug("⌘Z → undo")
            undoManager?.undo()
            return true
        case "z" where isShift:
            log.debug("⌘⇧Z → redo")
            undoManager?.redo()
            return true
        default:
            return super.performKeyEquivalent(with: event)
        }
    }

    // Keep the standard responder selectors functional so an Edit menu (if
    // present) still drives Cut/Copy/Paste — belt and suspenders.
    override func validateUserInterfaceItem(_ item: NSValidatedUserInterfaceItem) -> Bool {
        super.validateUserInterfaceItem(item)
    }
}
