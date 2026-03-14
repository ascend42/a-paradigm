// FileRequestNotificationView.swift — #file-request-notification
// Banner card for pending file requests with Approve/Deny/Redact actions.

import SwiftUI

struct FileRequestNotificationView: View {
    let requests: [FileRequestRecord]
    let onApprove: (String) -> Void
    let onDeny: (String) -> Void
    let onApproveRedacted: (String) -> Void

    var body: some View {
        if !requests.isEmpty {
            VStack(spacing: 6) {
                HStack {
                    Image(systemName: "doc.badge.arrow.up")
                        .foregroundStyle(.orange)
                    Text("File Requests")
                        .font(.caption.bold())
                    Spacer()
                    Text("\(requests.count) pending")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                ForEach(requests, id: \.request.requestId) { record in
                    fileRequestCard(record)
                }
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.08)))
        }
    }

    private func fileRequestCard(_ record: FileRequestRecord) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(record.request.filePath)
                    .font(.caption.monospaced())
                    .lineLimit(1)
                Spacer()
                if record.request.urgency == .urgent {
                    Text("URGENT")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(.red))
                }
            }

            Text("From: \(record.request.requester.name)")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Text(record.request.reason)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            HStack(spacing: 8) {
                Button("Approve") {
                    onApprove(record.request.requestId)
                }
                .controlSize(.small)
                .buttonStyle(.borderedProminent)
                .tint(.green)

                Button("Redact") {
                    onApproveRedacted(record.request.requestId)
                }
                .controlSize(.small)
                .buttonStyle(.bordered)

                Button("Deny") {
                    onDeny(record.request.requestId)
                }
                .controlSize(.small)
                .buttonStyle(.bordered)
                .tint(.red)
            }
            .padding(.top, 2)
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 6).fill(.background.opacity(0.6)))
    }
}
