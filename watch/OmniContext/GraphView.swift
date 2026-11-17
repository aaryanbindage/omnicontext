import SwiftUI

func nodeColor(_ type: String) -> Color {
    switch type {
    case "you", "project": return .accentColor
    case "tag": return .teal
    case "topic": return .purple
    case "handoff": return .orange
    case "device": return .gray
    case "fact": return .green
    case "inbox": return .pink
    default: return .secondary
    }
}

/// Walk the knowledge graph one node at a time: the current node in the middle, its links around it.
/// Tap any neighbour to move there.
struct GraphExplorer: View {
    @EnvironmentObject var model: AppModel
    @State var center: String
    @State private var trail: [String] = []

    var body: some View {
        let g = model.graph
        let node = g.nodes[center] ?? GraphNode(id: center, type: "you", label: "You")
        let around = g.around(center)

        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                EgoGraph(center: node, around: Array(around.prefix(10)), extra: max(0, around.count - 10)) { id in
                    go(id)
                }
                .frame(height: 150)

                if node.type == "project", let p = model.project(String(node.id.dropFirst("project:".count))) {
                    NavigationLink(value: Route.project(p)) {
                        Label("Open project", systemImage: "folder")
                    }
                }
                if node.type == "handoff", let h = model.snapshot?.handoffs?.first(where: { "handoff:\($0.id)" == node.id }) {
                    NavigationLink(value: Route.handoff(h)) {
                        Label("Open handoff", systemImage: "arrow.uturn.forward")
                    }
                }
                if let back = trail.last {
                    Button {
                        trail.removeLast()
                        withAnimation(.easeInOut(duration: 0.25)) { center = back }
                    } label: {
                        Label(g.nodes[back]?.label ?? "Back", systemImage: "chevron.backward")
                            .lineLimit(1)
                    }
                }

                Text("Linked (\(around.count))").font(.footnote).foregroundStyle(.secondary).padding(.top, 4)
                ForEach(around) { n in
                    Button {
                        go(n.id)
                    } label: {
                        HStack(spacing: 6) {
                            Circle().fill(nodeColor(n.type)).frame(width: 8, height: 8)
                            Text(n.label).font(.footnote).lineLimit(2)
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
        }
        .navigationTitle(node.label)
    }

    private func go(_ id: String) {
        guard id != center else { return }
        trail.append(center)
        withAnimation(.easeInOut(duration: 0.25)) { center = id }
    }
}

/// Radial picture of one node and its neighbours.
struct EgoGraph: View {
    let center: GraphNode
    let around: [GraphNode]
    let extra: Int
    let onTap: (String) -> Void

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let mid = CGPoint(x: w / 2, y: h / 2)
            let r = min(w, h) * 0.38
            let points: [CGPoint] = around.indices.map { i in
                let a = Double(i) / Double(max(around.count, 1)) * 2 * .pi - .pi / 2
                return CGPoint(x: mid.x + r * cos(a), y: mid.y + r * sin(a))
            }

            ZStack {
                Canvas { ctx, _ in
                    for p in points {
                        var path = Path()
                        path.move(to: mid)
                        path.addLine(to: p)
                        ctx.stroke(path, with: .color(.secondary.opacity(0.5)), lineWidth: 1)
                    }
                }

                ForEach(Array(around.enumerated()), id: \.element.id) { i, n in
                    Button { onTap(n.id) } label: {
                        VStack(spacing: 1) {
                            Circle().fill(nodeColor(n.type)).frame(width: 12, height: 12)
                            Text(n.label)
                                .font(.system(size: 9))
                                .lineLimit(1)
                                .frame(maxWidth: 58)
                        }
                    }
                    .buttonStyle(.plain)
                    .position(points[i])
                }

                VStack(spacing: 2) {
                    Circle().fill(nodeColor(center.type)).frame(width: 22, height: 22)
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                    Text(center.label).font(.system(size: 11, weight: .semibold)).lineLimit(1).frame(maxWidth: 80)
                }
                .position(mid)

                if extra > 0 {
                    Text("+\(extra)").font(.caption2).foregroundStyle(.secondary)
                        .position(x: w - 12, y: h - 8)
                }
            }
        }
    }
}
