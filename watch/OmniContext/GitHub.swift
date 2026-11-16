import Foundation

/// Minimal GitHub client: device-flow sign-in plus the contents API on the user's private data repo.
/// Everything goes straight from the watch to GitHub over Wi-Fi or cellular; no phone involved.
struct GitHub {
    var token: String?

    static var clientID: String {
        (Bundle.main.object(forInfoDictionaryKey: "OCGitHubClientID") as? String ?? "").trimmingCharacters(in: .whitespaces)
    }

    enum Failure: LocalizedError {
        case http(Int, String)
        case notConfigured
        case denied
        case expired

        var errorDescription: String? {
            switch self {
            case .http(404, _): return "Not found. Check the data repo name in Settings, and that sync has run at least once."
            case .http(401, _): return "GitHub sign-in expired. Sign in again."
            case let .http(code, msg): return "GitHub error \(code): \(msg)"
            case .notConfigured: return "This build has no GitHub client ID. See watch/README.md."
            case .denied: return "Sign-in was cancelled."
            case .expired: return "The code expired. Try again."
            }
        }
    }

    // MARK: Device flow

    struct DeviceCode: Decodable {
        let device_code: String
        let user_code: String
        let verification_uri: String
        let expires_in: Int
        let interval: Int
    }

    private struct TokenReply: Decodable {
        let access_token: String?
        let error: String?
        let interval: Int?
    }

    static func startDeviceFlow() async throws -> DeviceCode {
        guard !clientID.isEmpty else { throw Failure.notConfigured }
        let data = try await form("https://github.com/login/device/code", ["client_id": clientID, "scope": "repo"])
        return try JSONDecoder().decode(DeviceCode.self, from: data)
    }

    /// Polls until the user approves the code on another device. Returns the access token.
    static func waitForToken(_ code: DeviceCode) async throws -> String {
        var interval = max(code.interval, 5)
        let deadline = Date().addingTimeInterval(TimeInterval(code.expires_in))
        while Date() < deadline {
            try await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000_000)
            let data = try await form("https://github.com/login/oauth/access_token", [
                "client_id": clientID,
                "device_code": code.device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            ])
            let reply = try JSONDecoder().decode(TokenReply.self, from: data)
            if let token = reply.access_token { return token }
            switch reply.error {
            case "authorization_pending": continue
            case "slow_down": interval = reply.interval ?? interval + 5
            case "access_denied": throw Failure.denied
            case "expired_token": throw Failure.expired
            default: throw Failure.http(400, reply.error ?? "unknown")
            }
        }
        throw Failure.expired
    }

    private static func form(_ url: String, _ fields: [String: String]) async throws -> Data {
        var req = URLRequest(url: URL(string: url)!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var comps = URLComponents()
        comps.queryItems = fields.map { URLQueryItem(name: $0.key, value: $0.value) }
        req.httpBody = Data((comps.percentEncodedQuery ?? "").utf8)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else { throw Failure.http(code, String(decoding: data, as: UTF8.self)) }
        return data
    }

    // MARK: REST

    func call(_ path: String, method: String = "GET", accept: String = "application/vnd.github+json", json: Any? = nil) async throws -> Data {
        var req = URLRequest(url: URL(string: "https://api.github.com" + path)!)
        req.httpMethod = method
        req.timeoutInterval = 30
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue(accept, forHTTPHeaderField: "Accept")
        req.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let json {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: json)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
            throw Failure.http(code, msg ?? "request failed")
        }
        return data
    }

    func login() async throws -> String {
        let data = try await call("/user")
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["login"] as? String ?? ""
    }

    /// Raw file contents from the default branch.
    func file(_ repo: String, _ path: String) async throws -> Data {
        try await call("/repos/\(repo)/contents/\(path)", accept: "application/vnd.github.raw+json")
    }

    /// File contents plus its blob sha, needed to update it.
    func fileWithSha(_ repo: String, _ path: String) async throws -> (Data, String) {
        let data = try await call("/repos/\(repo)/contents/\(path)")
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let b64 = (obj["content"] as? String ?? "").replacingOccurrences(of: "\n", with: "")
        guard let sha = obj["sha"] as? String, let content = Data(base64Encoded: b64) else { throw Failure.http(500, "unexpected response") }
        return (content, sha)
    }

    func put(_ repo: String, _ path: String, _ content: Data, message: String, sha: String? = nil) async throws {
        var body: [String: Any] = ["message": message, "content": content.base64EncodedString()]
        if let sha { body["sha"] = sha }
        _ = try await call("/repos/\(repo)/contents/\(path)", method: "PUT", json: body)
    }
}
