// AtriumAttachmentChip.swift — #atrium-attachment
// A removable attachment chip for files dragged into the ATRIUM composer.
// Shows a file-type SF Symbol + truncated filename + an ✕ to remove. Styled to
// the ATRIUM palette (surfaceRaised bg, mono ink filename, tool-violet accent).

import SwiftUI
import UniformTypeIdentifiers

struct AtriumAttachmentChip: View {
    let url: URL
    let onRemove: () -> Void

    private var filename: String { url.lastPathComponent }

    /// Pick an SF Symbol that hints at the file type.
    private var symbol: String {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "swift": return "swift"
        case "png", "jpg", "jpeg", "gif", "heic", "webp", "tiff", "bmp":
            return "photo"
        case "pdf": return "doc.richtext"
        case "md", "markdown", "txt", "rtf": return "doc.text"
        case "json", "yaml", "yml", "toml", "xml", "plist":
            return "curlybraces"
        case "js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "c", "cpp", "h", "java", "sh":
            return "chevron.left.forwardslash.chevron.right"
        case "zip", "tar", "gz", "dmg":
            return "doc.zipper"
        case "mp3", "wav", "m4a", "aac":
            return "waveform"
        case "mp4", "mov", "avi", "mkv":
            return "film"
        default:
            // Directories vs files.
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
                return "folder"
            }
            return "doc"
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(AtriumTheme.tool)

            Text(filename)
                .font(AtriumTheme.chipFont)
                .foregroundColor(AtriumTheme.ink)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 160)

            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(AtriumTheme.inkMuted)
            }
            .buttonStyle(.plain)
            .help("Remove attachment")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(AtriumTheme.surfaceRaised)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(AtriumTheme.hairline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .help(url.path)
    }
}
