// AtriumGraphView.swift — #atrium-graph-view
// Native SwiftUI Canvas render of a bounded symbol ego-graph (#agent-visual
// kind == .graph) inside THE LIGHTBOX (#atrium-visual-canvas). STATIC, closed-form
// RING layout: the focus (root) node sits at center, every other node is placed
// evenly on a ring (angle = 2π·i/count, fixed radius shrunk to fit the 380pt
// canvas). Edges draw under nodes as straight lines (center → ring). Nodes are
// filled shapes colored by GraphSymbolKind via Mika's accent mapping:
//   component → ink     (calm high-contrast rounded rect)
//   flow      → user    (blue stadium)
//   gate      → amber   (diamond)
//   signal    → running (teal small circle)
//   aspect    → tool    (violet dashed outline)
// The focus node gets a soft translucent halo. Labels are the symbol id, drawn at a
// small scaled size. A "+N more" affordance appears when the slice is truncated.
//
// DISCIPLINE (this cut): NO force simulation, NO drag/zoom, NO hover, NO interaction.
// The Canvas closure is a synchronous draw and captures only the resolved payload.

import SwiftUI

struct AtriumGraphView: View {
    let payload: GraphPayload

    /// Observe the user font scale so labels re-render live on ⌘= / ⌘-.
    @AppStorage(AtriumFontScale.key) private var fontScale: Double = AtriumFontScale.defaultValue

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
                Canvas { ctx, size in
                    draw(in: &ctx, size: size)
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
            footer
        }
        .background(AtriumTheme.sunken)
    }

    // MARK: - Footer (freshness + truncation)

    private var footer: some View {
        HStack(spacing: 10) {
            if payload.truncated {
                Text("+\(max(payload.nodes.count - 1, 0)) more — slice bounded")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.amber)
            }
            Spacer()
            if payload.stale {
                Text("stale index")
                    .font(AtriumTheme.footerFont)
                    .foregroundColor(AtriumTheme.amber)
            }
            Text(rootLabel)
                .font(AtriumTheme.footerFont)
                .foregroundColor(AtriumTheme.inkMuted)
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(AtriumTheme.surface)
        .overlay(Rectangle().frame(height: 1).foregroundColor(AtriumTheme.hairline), alignment: .top)
    }

    private var rootLabel: String {
        payload.nodes.first(where: { $0.id == payload.root })?.label ?? payload.root
    }

    // MARK: - Layout

    /// Resolved positions: the root at center, the rest on a ring.
    private func positions(for size: CGSize) -> [String: CGPoint] {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        // Shrink the radius to fit the canvas with margin for node + label.
        let margin: CGFloat = 56
        let radius = max(40, min(120, min(size.width, size.height) / 2 - margin))

        var out: [String: CGPoint] = [payload.root: center]
        let ring = payload.nodes.filter { $0.id != payload.root }
        let count = max(ring.count, 1)
        for (i, node) in ring.enumerated() {
            // Start at the top (−π/2) so the ring reads clockwise from 12 o'clock.
            let angle = (2 * Double.pi * Double(i) / Double(count)) - (Double.pi / 2)
            out[node.id] = CGPoint(
                x: center.x + radius * CGFloat(cos(angle)),
                y: center.y + radius * CGFloat(sin(angle))
            )
        }
        return out
    }

    // MARK: - Draw

    private func draw(in ctx: inout GraphicsContext, size: CGSize) {
        let pos = positions(for: size)

        // 1. Edges first (under nodes).
        for edge in payload.edges {
            guard let a = pos[edge.source], let b = pos[edge.target] else { continue }
            var path = Path()
            path.move(to: a)
            path.addLine(to: b)
            ctx.stroke(path, with: .color(AtriumTheme.hairline.opacity(0.7)), lineWidth: 1)
        }

        // 2. Focus halo (behind the root node).
        if let c = pos[payload.root] {
            let haloR: CGFloat = 34
            let halo = Path(ellipseIn: CGRect(x: c.x - haloR, y: c.y - haloR,
                                              width: haloR * 2, height: haloR * 2))
            ctx.fill(halo, with: .color(AtriumTheme.amber.opacity(0.12)))
        }

        // 3. Nodes + labels.
        for node in payload.nodes {
            guard let p = pos[node.id] else { continue }
            let isFocus = node.id == payload.root
            drawNode(in: &ctx, at: p, node: node, isFocus: isFocus)
            drawLabel(in: &ctx, at: p, node: node, isFocus: isFocus)
        }
    }

    /// Mika's color mapping by symbol kind.
    private func color(for kind: GraphSymbolKind) -> Color {
        switch kind {
        case .component: return AtriumTheme.ink
        case .flow:      return AtriumTheme.user
        case .gate:      return AtriumTheme.amber
        case .signal:    return AtriumTheme.running
        case .aspect:    return AtriumTheme.tool
        }
    }

    /// Draw the node shape. Each kind has a distinct silhouette so the graph reads
    /// without relying solely on color.
    private func drawNode(in ctx: inout GraphicsContext, at p: CGPoint,
                          node: GraphNode, isFocus: Bool) {
        let c = color(for: node.kind)
        let r: CGFloat = isFocus ? 13 : 9

        switch node.kind {
        case .component:
            // Calm high-contrast rounded rect.
            let rect = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
            let path = Path(roundedRect: rect, cornerRadius: 4)
            ctx.fill(path, with: .color(c.opacity(isFocus ? 0.95 : 0.85)))
            ctx.stroke(path, with: .color(AtriumTheme.void.opacity(0.6)), lineWidth: 1)

        case .flow:
            // Blue stadium (wide capsule).
            let rect = CGRect(x: p.x - r * 1.6, y: p.y - r * 0.85,
                              width: r * 3.2, height: r * 1.7)
            let path = Path(roundedRect: rect, cornerRadius: rect.height / 2)
            ctx.fill(path, with: .color(c.opacity(0.9)))

        case .gate:
            // Amber diamond.
            var path = Path()
            path.move(to: CGPoint(x: p.x, y: p.y - r))
            path.addLine(to: CGPoint(x: p.x + r, y: p.y))
            path.addLine(to: CGPoint(x: p.x, y: p.y + r))
            path.addLine(to: CGPoint(x: p.x - r, y: p.y))
            path.closeSubpath()
            ctx.fill(path, with: .color(c.opacity(0.92)))

        case .signal:
            // Small teal circle.
            let rr = r * 0.85
            let path = Path(ellipseIn: CGRect(x: p.x - rr, y: p.y - rr,
                                              width: rr * 2, height: rr * 2))
            ctx.fill(path, with: .color(c.opacity(0.95)))

        case .aspect:
            // Violet dashed outline (hollow).
            let rect = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
            let path = Path(roundedRect: rect, cornerRadius: 4)
            ctx.fill(path, with: .color(c.opacity(0.14)))
            ctx.stroke(path, with: .color(c.opacity(0.9)),
                       style: StrokeStyle(lineWidth: 1.4, dash: [3, 2]))
        }
    }

    /// Draw the symbol id under the node, small + scaled.
    private func drawLabel(in ctx: inout GraphicsContext, at p: CGPoint,
                           node: GraphNode, isFocus: Bool) {
        let size = AtriumTheme.scaled(isFocus ? 11 : 9.5)
        let text = Text(node.id)
            .font(.system(size: size, weight: isFocus ? .semibold : .regular, design: .monospaced))
            .foregroundColor(isFocus ? AtriumTheme.ink : AtriumTheme.inkMuted)
        // Place the label below the node glyph.
        ctx.draw(text, at: CGPoint(x: p.x, y: p.y + (isFocus ? 26 : 20)), anchor: .center)
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Graph slice: #atrium-decision-card") {
    AtriumGraphView(payload: GraphPayload(
        root: "#atrium-decision-card",
        nodes: [
            GraphNode(id: "#atrium-decision-card", kind: .component, label: "Atrium Decision Card", path: nil),
            GraphNode(id: "#agent-decision", kind: .component, label: "Agent Decision", path: nil),
            GraphNode(id: "$decision-exchange", kind: .flow, label: "Decision Exchange", path: nil),
            GraphNode(id: "^authenticated", kind: .gate, label: "Authenticated", path: nil),
            GraphNode(id: "!decision-answered", kind: .signal, label: "Decision Answered", path: nil),
            GraphNode(id: "~audit-required", kind: .aspect, label: "Audit Required", path: nil),
        ],
        edges: [
            GraphEdge(source: "#atrium-decision-card", target: "#agent-decision", kind: .uses),
            GraphEdge(source: "#atrium-decision-card", target: "$decision-exchange", kind: .inFlow),
            GraphEdge(source: "#atrium-decision-card", target: "^authenticated", kind: .gatedBy),
            GraphEdge(source: "#atrium-decision-card", target: "!decision-answered", kind: .uses),
            GraphEdge(source: "#atrium-decision-card", target: "~audit-required", kind: .uses),
        ],
        truncated: false,
        generatedAt: "2026-06-17T22:18:42.232Z",
        stale: false
    ))
    .frame(width: 380, height: 460)
}
#endif
