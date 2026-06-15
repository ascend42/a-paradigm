// AtriumThreadView.swift — #atrium-thread
// Root of the ATRIUM custom thread: a scrolling conversation (auto-pinned to the
// newest message), a reply composer, and a cost/usage footer. Renders a single
// observed ClaudeStreamSession.

import SwiftUI

struct AtriumThreadView: View {
    @ObservedObject var session: ClaudeStreamSession

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        ForEach(session.messages) { message in
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

    private static let bottomAnchor = "atrium-bottom-anchor"

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(Self.bottomAnchor, anchor: .bottom)
        }
    }
}
