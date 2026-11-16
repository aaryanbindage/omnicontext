import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var snapshot: Snapshot?
    @Published var lastRefresh: Date?
    @Published var loading = false
    @Published var error: String?
    @Published var login: String?
    @Published var deviceCode: GitHub.DeviceCode?
    @Published var repo: String {
        didSet { UserDefaults.standard.set(repo, forKey: "repo") }
    }

    @Published private(set) var signedIn = false
    private var token: String? {
        didSet {
            Keychain.set("token", token)
            signedIn = token != nil
        }
    }
    private var gh: GitHub { GitHub(token: token) }
    private var signInTask: Task<Void, Never>?

    private static let cacheURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("snapshot.json")
    }()

    init() {
        repo = UserDefaults.standard.string(forKey: "repo") ?? ""
        login = UserDefaults.standard.string(forKey: "login")
        token = Keychain.get("token")
        signedIn = token != nil
        lastRefresh = UserDefaults.standard.object(forKey: "lastRefresh") as? Date
        if let data = try? Data(contentsOf: Self.cacheURL) {
            snapshot = try? JSONDecoder().decode(Snapshot.self, from: data)
        }
    }

    var openHandoffs: [Handoff] { (snapshot?.handoffs ?? []).filter(\.isOpen) }
    var projects: [Project] { snapshot?.projects ?? [] }
    var inbox: [InboxItem] { snapshot?.inbox ?? [] }

    func project(_ slug: String?) -> Project? {
        guard let slug else { return nil }
        return projects.first { $0.slug == slug }
    }

    // MARK: Sign-in

    func startSignIn() {
        error = nil
        signInTask?.cancel()
        signInTask = Task {
            do {
                let code = try await GitHub.startDeviceFlow()
                deviceCode = code
                let t = try await GitHub.waitForToken(code)
                token = t
                deviceCode = nil
                let name = try await gh.login()
                login = name
                UserDefaults.standard.set(name, forKey: "login")
                if repo.isEmpty { repo = "\(name)/omnicontext-data" }
                await refresh()
            } catch is CancellationError {
                deviceCode = nil
            } catch {
                deviceCode = nil
                self.error = error.localizedDescription
            }
        }
    }

    func cancelSignIn() {
        signInTask?.cancel()
        deviceCode = nil
    }

    func signOut() {
        token = nil
        login = nil
        snapshot = nil
        UserDefaults.standard.removeObject(forKey: "login")
        try? FileManager.default.removeItem(at: Self.cacheURL)
    }

    // MARK: Data

    /// Refresh unless we did so in the last `ifOlderThan` seconds.
    func refresh(ifOlderThan age: TimeInterval = 0) async {
        guard signedIn, !repo.isEmpty, !loading else { return }
        if age > 0, let last = lastRefresh, Date().timeIntervalSince(last) < age { return }
        loading = true
        defer { loading = false }
        do {
            let data = try await gh.file(repo, "snapshot.json")
            let snap = try JSONDecoder().decode(Snapshot.self, from: data)
            snapshot = snap
            try? data.write(to: Self.cacheURL, options: .atomic)
            lastRefresh = Date()
            UserDefaults.standard.set(lastRefresh, forKey: "lastRefresh")
            error = nil
        } catch GitHub.Failure.http(404, _) {
            error = "No snapshot.json in \(repo) yet. Update OmniContext on a computer to 0.2.0 or later and run a sync."
        } catch GitHub.Failure.http(401, _) {
            token = nil
            error = GitHub.Failure.http(401, "").localizedDescription
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveCache() {
        if let snapshot, let data = try? JSONEncoder().encode(snapshot) {
            try? data.write(to: Self.cacheURL, options: .atomic)
        }
    }

    /// Dictated note → inbox/<id>.json in the data repo. The next Claude session offers to file it.
    func capture(_ text: String, project: String? = nil) async -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let item = InboxItem(id: ISO.newId(), text: trimmed, project: project ?? "", source: "Apple Watch", createdAt: ISO.string())
        do {
            let enc = JSONEncoder()
            enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            var data = try enc.encode(item)
            data.append(0x0A)
            try await gh.put(repo, "inbox/\(item.id).json", data, message: "capture from Apple Watch")
            snapshot?.inbox = (snapshot?.inbox ?? []) + [item]
            saveCache()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    /// Mark a handoff done by editing handoffs/<id>.json in place (other fields untouched).
    func markDone(_ h: Handoff) async {
        do {
            let path = "handoffs/\(h.id).json"
            let (content, sha) = try await gh.fileWithSha(repo, path)
            guard var obj = try JSONSerialization.jsonObject(with: content) as? [String: Any] else { return }
            obj["status"] = "done"
            obj["doneAt"] = ISO.string()
            var data = try JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
            data.append(0x0A)
            try await gh.put(repo, path, data, message: "handoff done from Apple Watch", sha: sha)
            if let i = snapshot?.handoffs?.firstIndex(where: { $0.id == h.id }) {
                snapshot?.handoffs?[i].status = "done"
            }
            saveCache()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
