// AtriumThreadView.swift — #atrium-thread
// Root of the ATRIUM custom thread: a scrolling conversation (auto-pinned to the
// newest message), a reply composer, and a cost/usage footer. Renders a single
// observed ClaudeStreamSession.
//
// THE CHORUS (#atrium-chorus): when the model fans out into sub-agents, two
// surfaces light up — (1) an INLINE FAN-OUT block in the conversation (lives in
// history), and (2) the right-side CHORUS RAIL. The rail uses a PUSH layout: the
// conversation column narrows to make room (no overlay), eased over 220ms. The
// rail AUTO-APPEARS while ≥1 sub-agent is live and slides away when all idle; a
// pin keeps it open when idle.

import SwiftUI

struct AtriumThreadView: View {
    @ObservedObject var session: ClaudeStreamSession

    /// Pin state for the CHORUS rail — keeps it open when no sub-agents are live.
    @State private var chorusPinned = false

    /// The AgentVisual currently open in the LIGHTBOX (#atrium-visual-canvas), if
    /// any. The lightbox shares the right zone with the chorus and renders OVER it
    /// (chorus stays mounted underneath; PUSH-consistent layout).
    @State private var openVisual: AgentVisual?

    /// Symbols currently hovered on a decision option row — drives the LIGHTBOX
    /// graph "spotlight the set, dim the room" highlight (#atrium-graph-view).
    /// Kept SEPARATE from the Equatable AgentVisual so hover only redraws the Canvas;
    /// folding it into the visual would re-identify the LIGHTBOX on every hover.
    /// READ-ONLY: hover never changes selection or commits anything.
    @State private var hoveredSymbols: Set<String> = []

    /// The rail is visible when a sub-agent is live OR the founder pinned it open
    /// (and there is at least one sub-agent to show when pinned).
    private var chorusVisible: Bool {
        let anyLive = session.subAgents.contains { $0.status.isLive }
        return anyLive || (chorusPinned && !session.subAgents.isEmpty)
    }

    /// The right zone is occupied when EITHER the lightbox is open OR the chorus is
    /// visible. A single switch/container drives the PUSH (Mika: lightbox over chorus).
    private var rightZoneVisible: Bool { openVisual != nil || chorusVisible }

    var body: some View {
        HStack(spacing: 0) {
            conversationColumn
            // PUSH layout: the right zone occupies real width when visible (the
            // column narrows to fit), sliding in/out over 220ms. No overlay on the
            // conversation. Within the zone, the LIGHTBOX renders OVER the chorus.
            if rightZoneVisible {
                rightZone
                    .transition(.move(edge: .trailing))
            }
        }
        .animation(.easeInOut(duration: 0.22), value: rightZoneVisible)
        .background(AtriumTheme.void)
    }

    /// The shared right zone: the CHORUS rail, with the LIGHTBOX layered on top when
    /// a visual is open (chorus stays mounted underneath per Mika).
    private var rightZone: some View {
        ZStack(alignment: .trailing) {
            if chorusVisible {
                AtriumChorusRail(session: session, pinned: $chorusPinned)
            }
            if let visual = openVisual {
                AtriumVisualCanvas(
                    visual: visual,
                    highlightedSymbols: hoveredSymbols,
                    onClose: { openVisual = nil }
                )
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.15), value: openVisual?.id)
    }

    /// The conversation column: header, scrolling thread (+ inline fan-out block),
    /// composer, footer. Narrows when the chorus rail pushes in.
    private var conversationColumn: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(AtriumTheme.hairline)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        // Control messages (suppressed host→agent TaskStop turn,
                        // #atrium-shells) are excluded from the rendered thread.
                        ForEach(session.messages.filter { !$0.isControl }) { message in
                            AtriumMessageView(
                                message: message,
                                onAnswerDecision: { decisionId, optionIds, otherText in
                                    session.answerDecision(
                                        messageId: message.id,
                                        decisionId: decisionId,
                                        optionIds: optionIds,
                                        otherText: otherText
                                    )
                                },
                                onOpenVisual: { openVisual = $0 },
                                onHoverSymbols: { hoveredSymbols = $0 }
                            )
                            .id(message.id)
                        }
                        // INLINE FAN-OUT block (#atrium-chorus) — born in the
                        // conversation when sub-agents are spawned; settles to a
                        // one-line summary and stays in history.
                        if !session.subAgents.isEmpty {
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                AtriumFanOutBlock(
                                    subAgents: session.subAgents,
                                    now: context.date,
                                    onStop: { session.stopSubAgent(id: $0) }
                                )
                            }
                            .id(Self.fanOutAnchor)
                        }
                        // Anchor for pin-to-bottom.
                        Color.clear
                            .frame(height: 1)
                            .id(Self.bottomAnchor)
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .onChange(of: session.messages.count) {
                    scrollToBottom(proxy)
                }
                .onChange(of: session.messages.last?.text) {
                    scrollToBottom(proxy)
                }
                .onChange(of: session.subAgents.count) {
                    scrollToBottom(proxy)
                }
            }

            Divider().overlay(AtriumTheme.hairline)
            AtriumComposer(session: session)
            Divider().overlay(AtriumTheme.hairline)
            AtriumFooter(session: session)
        }
        .frame(maxWidth: .infinity)
    }

    /// Thin top bar carrying the background-shell inspector affordance
    /// (#atrium-shells), right-aligned so the conversation stays the focus.
    private var header: some View {
        HStack(spacing: 8) {
            Spacer()
            AtriumShellsButton(session: session)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(AtriumTheme.sunken)
    }

    private static let bottomAnchor = "atrium-bottom-anchor"
    private static let fanOutAnchor = "atrium-fanout-anchor"

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
    }
}
