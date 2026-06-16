// AtriumThreadView.swift — #atrium-thread
// Root of the ATRIUM custom thread: a scrolling conversation (auto-pinned to the
// newest message), a reply composer, and a cost/usage footer. Renders a single
// observed ClaudeStreamSession.

import SwiftUI

struct AtriumThreadView: View {
    @ObservedObject var session: ClaudeStreamSession

    var body: some View {
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
            }

            Divider().overlay(AtriumTheme.hairline)
            AtriumComposer(session: session)
            Divider().overlay(AtriumTheme.hairline)
            AtriumFooter(session: session)
        }
        .background(AtriumTheme.void)
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

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
    }
}
