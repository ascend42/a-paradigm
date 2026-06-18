// AtriumDecisionCard.swift — #atrium-decision-card
// Inline card for a host-rendered AgentDecision ($decision-exchange). PENDING shows
// the question + stacked option cards (radio single / checkbox multi) + an "Other…"
// field when allowOther, plus the two escape affordances (compose your own / just
// reply). A ★ marks an agent-recommended lean; a ▸ "view" opens a linked visual in
// the LIGHTBOX. On submit it calls onAnswer → session.answerDecision.
//
// Temperature law (Mika): a PENDING decision paints an AMBER leading rail on the
// turn; on answer it settles to a calm TEAL collapsed "✓ you chose …" with a
// reopen affordance.

import SwiftUI

struct AtriumDecisionCard: View {
    let decision: AgentDecision
    /// Submit: (chosenOptionIds, otherText?).
    let onAnswer: ([String], String?) -> Void
    /// Open a linked visual in the LIGHTBOX by id.
    let onViewVisual: (String) -> Void
    /// The human reopened an already-SETTLED decision via the "change" affordance —
    /// fires the divergence watchdog (#decision-divergence-journal). UI-only besides
    /// this signal: the card re-expands locally (forceExpanded). Defaulted so existing
    /// call sites / previews compile unchanged.
    var onReopen: () -> Void = {}
    /// Hovering an option row lights up its affectedSymbols in the LIGHTBOX graph
    /// (empty = rest). READ-ONLY — never changes selection or commits. Defaulted so
    /// existing call sites / previews compile unchanged.
    var onHoverSymbols: (Set<String>) -> Void = { _ in }

    @State private var selected: Set<String> = []
    @State private var otherText: String = ""
    @State private var showOther = false
    /// Local override so an answered card can be re-expanded to change the pick.
    @State private var forceExpanded = false
    /// Observe the user font scale so the card re-renders live on ⌘= / ⌘-.
    @AppStorage(AtriumFontScale.key) private var fontScale: Double = AtriumFontScale.defaultValue

    private var isAnswered: Bool { decision.answer != nil && !forceExpanded }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            // Leading temperature rail: amber while pending, teal once settled.
            RoundedRectangle(cornerRadius: 2)
                .fill(decision.isPending ? AtriumTheme.amber : AtriumTheme.running)
                .frame(width: 3)
                .padding(.vertical, 2)

            VStack(alignment: .leading, spacing: 10) {
                if isAnswered {
                    answeredView
                } else {
                    pendingView
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(AtriumTheme.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke((decision.isPending ? AtriumTheme.amber : AtriumTheme.hairline).opacity(0.4), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Pending

    private var pendingView: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(decision.question)
                .font(AtriumTheme.bodyFont)
                .fontWeight(.semibold)
                .foregroundColor(AtriumTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(decision.options) { option in
                    optionRow(option)
                }
            }

            if decision.allowOther {
                otherAffordance
            }

            HStack(spacing: 12) {
                Button(action: submit) {
                    Text(decision.multiSelect ? "Submit" : "Choose")
                        .font(AtriumTheme.chipFont)
                        .foregroundColor(canSubmit ? AtriumTheme.void : AtriumTheme.inkMuted)
                        .padding(.horizontal, 12).padding(.vertical, 5)
                        .background(canSubmit ? AtriumTheme.amber : AtriumTheme.surfaceRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .disabled(!canSubmit)

                // Escape affordance: "just reply" — dismiss the card's claim on you
                // by leaving it; the founder types a normal turn in the composer.
                Text("…or just reply below")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.inkMuted)
            }
        }
    }

    private func optionRow(_ option: DecisionOption) -> some View {
        Button {
            toggle(option.id)
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Text(glyph(for: option.id))
                    .font(AtriumTheme.chipFont)
                    .foregroundColor(selected.contains(option.id) ? AtriumTheme.amber : AtriumTheme.inkMuted)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        if option.recommended {
                            Text("★").font(AtriumTheme.chipFont).foregroundColor(AtriumTheme.amber)
                        }
                        Text(option.label)
                            .font(AtriumTheme.chipFont)
                            .foregroundColor(AtriumTheme.ink)
                        if let vid = option.visualId {
                            Button { onViewVisual(vid) } label: {
                                Text("▸ view")
                                    .font(AtriumTheme.footerFont)
                                    .foregroundColor(AtriumTheme.tool)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if let desc = option.description, !desc.isEmpty {
                        // The description is the worst offender for tiny text — read
                        // it at the mono baseline (was micro/footer).
                        Text(desc)
                            .font(AtriumTheme.monoFont)
                            .foregroundColor(AtriumTheme.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected.contains(option.id) ? AtriumTheme.surfaceRaised : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        // Hover lights up this option's symbols in the LIGHTBOX graph; hover-out
        // (empty set) eases the graph back to rest. Runs on the main actor; never
        // touches selection or commit — clicking the row is still the only commit path.
        .onHover { hovering in
            onHoverSymbols(hovering ? Set(option.affectedSymbols) : [])
        }
    }

    private var otherAffordance: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button { showOther.toggle() } label: {
                Text(showOther ? "▾ Other…" : "▸ Other… (compose your own)")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.user)
            }
            .buttonStyle(.plain)
            if showOther {
                TextField("Type a different answer", text: $otherText)
                    .textFieldStyle(.plain)
                    .font(AtriumTheme.chipFont)
                    .foregroundColor(AtriumTheme.ink)
                    .padding(6)
                    .background(AtriumTheme.sunken)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    // MARK: - Answered (settled)

    private var answeredView: some View {
        HStack(spacing: 8) {
            Text("✓")
                .font(AtriumTheme.chipFont)
                .foregroundColor(AtriumTheme.running)
            Text("you chose \(chosenLabel)")
                .font(AtriumTheme.chipFont)
                .foregroundColor(AtriumTheme.inkMuted)
                .lineLimit(2)
            Spacer()
            Button {
                forceExpanded = true
                onReopen() // divergence watchdog (#decision-divergence-journal)
            } label: {
                Text("change")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.user)
            }
            .buttonStyle(.plain)
        }
    }

    private var chosenLabel: String {
        guard let answer = decision.answer else { return "" }
        let labels = answer.chosenOptionIds.compactMap { id in
            decision.options.first(where: { $0.id == id })?.label
        }
        var parts = labels
        if let other = answer.otherText, !other.isEmpty { parts.append(other) }
        return parts.isEmpty ? "(no selection)" : parts.joined(separator: ", ")
    }

    // MARK: - Selection logic

    private func glyph(for id: String) -> String {
        if decision.multiSelect { return selected.contains(id) ? "☑" : "☐" }
        return selected.contains(id) ? "◉" : "○"
    }

    private func toggle(_ id: String) {
        if decision.multiSelect {
            if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
        } else {
            selected = [id]
        }
    }

    private var canSubmit: Bool {
        !selected.isEmpty || (showOther && !otherText.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    private func submit() {
        guard canSubmit else { return }
        // Preserve option order from the decision for a readable reply.
        let ordered = decision.options.map(\.id).filter { selected.contains($0) }
        let other = showOther ? otherText.trimmingCharacters(in: .whitespacesAndNewlines) : nil
        forceExpanded = false
        onAnswer(ordered, (other?.isEmpty == false) ? other : nil)
    }
}
