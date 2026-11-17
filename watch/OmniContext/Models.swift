import Foundation

// Mirrors snapshot.json written by `omnicontext sync` (see src/store.js buildSnapshot).

struct Snapshot: Codable {
    var format: Int?
    var updatedAt: String?
    var profile: String?
    var projects: [Project]?
    var handoffs: [Handoff]?
    var inbox: [InboxItem]?
    var graph: GraphData?
}

/// Compact knowledge graph: nodes are [id, type, label], edges are [source, target, kind].
struct GraphData: Codable {
    var nodes: [[String]]
    var edges: [[String]]
}

struct GraphNode: Identifiable, Hashable {
    let id: String
    let type: String
    let label: String
}

/// Adjacency view over GraphData for walking one node at a time.
struct KnowledgeGraph {
    let nodes: [String: GraphNode]
    let neighbors: [String: [String]]

    init(_ data: GraphData?) {
        var nodes: [String: GraphNode] = [:]
        for n in data?.nodes ?? [] where n.count >= 3 {
            nodes[n[0]] = GraphNode(id: n[0], type: n[1], label: n[2])
        }
        var adj: [String: [String]] = [:]
        for e in data?.edges ?? [] where e.count >= 2 && nodes[e[0]] != nil && nodes[e[1]] != nil {
            adj[e[0], default: []].append(e[1])
            adj[e[1], default: []].append(e[0])
        }
        self.nodes = nodes
        self.neighbors = adj
    }

    /// Neighbours sorted so the most connected (usually projects) come first.
    func around(_ id: String) -> [GraphNode] {
        let order = ["you", "project", "topic", "tag", "handoff", "device", "inbox", "fact"]
        return (neighbors[id] ?? []).compactMap { nodes[$0] }.sorted {
            let a = order.firstIndex(of: $0.type) ?? 9, b = order.firstIndex(of: $1.type) ?? 9
            if a != b { return a < b }
            return (neighbors[$0.id]?.count ?? 0) > (neighbors[$1.id]?.count ?? 0)
        }
    }
}

struct Note: Codable, Hashable {
    var text: String
    var at: String?
    var device: String?
}

struct Project: Codable, Identifiable, Hashable {
    var name: String
    var slug: String
    var aliases: [String]?
    var tags: [String]?
    var status: String?
    var description: String?
    var repo: String?
    var devices: [String]?
    var notes: [Note]?
    var lastActiveAt: String?

    var id: String { slug }
}

struct GitState: Codable, Hashable {
    var branch: String?
    var commit: String?
    var uncommitted: [String]?
    var unpushed: Int?
}

struct Handoff: Codable, Identifiable, Hashable {
    var id: String
    var title: String
    var project: String?
    var summary: String?
    var nextSteps: [String]?
    var files: [String]?
    var device: String?
    var status: String?
    var createdAt: String?
    var git: GitState?

    var isOpen: Bool { (status ?? "open") == "open" }
}

struct InboxItem: Codable, Identifiable, Hashable {
    var id: String
    var text: String
    var project: String?
    var source: String?
    var createdAt: String?
}

enum ISO {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()

    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        return withFraction.date(from: s) ?? plain.date(from: s)
    }

    static func string(_ d: Date = Date()) -> String { withFraction.string(from: d) }

    /// "today", "yesterday", "5d ago".
    static func ago(_ s: String?) -> String {
        guard let d = date(s) else { return "" }
        let days = Date().timeIntervalSince(d) / 86400
        if days < 1 { return "today" }
        if days < 2 { return "yesterday" }
        return "\(Int(days))d ago"
    }

    /// Same shape as the CLI's ids: 20261116-234639-9cac
    static func newId() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyyMMdd-HHmmss"
        return "\(f.string(from: Date()))-\(String(format: "%04x", Int.random(in: 0..<0x10000)))"
    }
}
