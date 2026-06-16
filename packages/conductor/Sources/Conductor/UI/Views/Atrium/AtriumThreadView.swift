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

    /// The rail is visible when a sub-agent is live OR the founder pinned it open
    /// (and there is at least one sub-agent to show when pinned).
    private var chorusVisible: Bool {
        let anyLive = session.subAgents.contains { $0.status.isLive }
        return anyLive || (chorusPinned && !session.subAgents.isEmpty)
    }

    var body: some View {
        HStack(spacing: 0) {
            conversationColumn
            // PUSH layout: the rail occupies real width when visible (the column
            // above narrows to fit), sliding in/out over 220ms. No overlay.
            if chorusVisible {
                AtriumChorusRail(session: session, pinned: $chorusPinned)
                    .transition(.move(edge: .trailing))
            }
        }
        .animation(.easeInOut(duration: 0.22), value: chorusVisible)
        .background(AtriumTheme.void)
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
                            AtriumMessageView(message: message)
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
