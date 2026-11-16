import SwiftUI

// MARK: - Sign in

struct SignInView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "brain.head.profile")
                    .font(.system(size: 34))
                    .foregroundStyle(.tint)
                Text("OmniContext").font(.headline)

                if let code = model.deviceCode {
                    Text("On any phone or computer, open").font(.footnote).foregroundStyle(.secondary)
                    Text(code.verification_uri.replacingOccurrences(of: "https://", with: ""))
                        .font(.footnote.bold())
                    Text("and enter").font(.footnote).foregroundStyle(.secondary)
                    Text(code.user_code)
                        .font(.system(.title3, design: .monospaced).bold())
                        .minimumScaleFactor(0.6)
                    ProgressView()
                    Button("Cancel", role: .cancel) { model.cancelSignIn() }
                } else {
                    Text("Read your memory from your private sync repo on GitHub, with no phone needed.")
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button {
                        model.startSignIn()
                    } label: {
                        Label("Sign in with GitHub", systemImage: "person.badge.key")
                    }
                    .buttonStyle(.borderedProminent)
                }

                if let error = model.error {
                    Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 4)
        }
    }
}

// MARK: - Home

struct HomeView: View {
    @EnvironmentObject var model: AppModel
    @State private var captured = false

    var body: some View {
        NavigationStack {
            List {
                if let error = model.error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }

                Section {
                    TextFieldLink(prompt: Text("What should Claude know?")) {
                        Label(captured ? "Captured ✓" : "Capture", systemImage: "mic.fill")
                            .foregroundStyle(.tint)
                    } onSubmit: { text in
                        Task {
                            captured = await model.capture(text)
                            try? await Task.sleep(nanoseconds: 2_000_000_000)
                            captured = false
                        }
                    }
                }

                Section("Resume") {
                    if model.openHandoffs.isEmpty {
                        Text("No open handoffs").foregroundStyle(.secondary)
                    }
                    ForEach(model.openHandoffs.prefix(5)) { h in
                        NavigationLink(value: Route.handoff(h)) { HandoffRow(handoff: h) }
                    }
                    if model.openHandoffs.count > 5 {
                        NavigationLink("All handoffs", value: Route.handoffs)
                    }
                }

                Section {
                    NavigationLink(value: Route.projects) {
                        CountRow(title: "Projects", icon: "folder", count: model.projects.count)
                    }
                    NavigationLink(value: Route.profile) {
                        Label("About me", systemImage: "person.crop.circle")
                    }
                    NavigationLink(value: Route.inbox) {
                        CountRow(title: "Inbox", icon: "tray", count: model.inbox.count)
                    }
                    NavigationLink(value: Route.settings) {
                        Label("Settings", systemImage: "gearshape")
                    }
                }

                Section {
                    footer
                }
            }
            .navigationTitle("OmniContext")
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .handoff(let h): HandoffDetail(handoff: h)
                case .handoffs: HandoffsList()
                case .projects: ProjectsList()
                case .project(let p): ProjectDetail(project: p)
                case .profile: ProfileView()
                case .inbox: InboxView()
                case .settings: SettingsView()
                }
            }
        }
    }

    @ViewBuilder private var footer: some View {
        Button {
            Task { await model.refresh() }
        } label: {
            HStack {
                Label("Refresh", systemImage: "arrow.clockwise")
                Spacer()
                if model.loading { ProgressView().frame(width: 20, height: 20) }
            }
        }
        .disabled(model.loading)
        if let last = model.lastRefresh {
            Text("Updated \(last, style: .relative) ago")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .listRowBackground(Color.clear)
        }
    }
}

struct CountRow: View {
    let title: String
    let icon: String
    let count: Int

    var body: some View {
        HStack {
            Label(title, systemImage: icon)
            Spacer()
            if count > 0 { Text("\(count)").foregroundStyle(.secondary) }
        }
    }
}

enum Route: Hashable {
    case handoff(Handoff)
    case handoffs
    case projects
    case project(Project)
    case profile
    case inbox
    case settings
}

// MARK: - Handoffs

struct HandoffRow: View {
    let handoff: Handoff

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(handoff.title).font(.headline).lineLimit(2)
            Text([handoff.project, handoff.device, ISO.ago(handoff.createdAt)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

struct HandoffsList: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        List {
            ForEach(model.snapshot?.handoffs ?? []) { h in
                NavigationLink(value: Route.handoff(h)) {
                    HandoffRow(handoff: h).opacity(h.isOpen ? 1 : 0.5)
                }
            }
        }
        .navigationTitle("Handoffs")
    }
}

struct HandoffDetail: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let handoff: Handoff
    @State private var working = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(handoff.title).font(.headline)
                Text("From \(handoff.device ?? "?"), \(ISO.ago(handoff.createdAt))")
                    .font(.footnote).foregroundStyle(.secondary)
                if let p = model.project(handoff.project) {
                    Label(p.name, systemImage: "folder").font(.footnote)
                }
                if let g = handoff.git, let branch = g.branch {
                    Label("\(branch) @ \(g.commit ?? "")", systemImage: "arrow.triangle.branch").font(.footnote)
                    if let n = g.unpushed, n > 0 {
                        Text("⚠ \(n) unpushed commit(s)").font(.footnote).foregroundStyle(.orange)
                    }
                    if let u = g.uncommitted, !u.isEmpty {
                        Text("⚠ \(u.count) uncommitted file(s)").font(.footnote).foregroundStyle(.orange)
                    }
                }
                if let next = handoff.nextSteps, !next.isEmpty {
                    Text("Next").font(.subheadline.bold()).padding(.top, 4)
                    ForEach(Array(next.enumerated()), id: \.offset) { _, step in
                        Text("• \(step)").font(.footnote)
                    }
                }
                if let summary = handoff.summary {
                    Text("Summary").font(.subheadline.bold()).padding(.top, 4)
                    Text(summary).font(.footnote)
                }
                Text("To continue, say “resume” in any Claude session.")
                    .font(.footnote).foregroundStyle(.secondary).padding(.top, 4)
                if handoff.isOpen {
                    Button {
                        Task {
                            working = true
                            await model.markDone(handoff)
                            working = false
                            dismiss()
                        }
                    } label: {
                        if working { ProgressView() } else { Label("Mark done", systemImage: "checkmark") }
                    }
                    .disabled(working)
                    .padding(.top, 4)
                }
            }
        }
        .navigationTitle("Handoff")
    }
}

// MARK: - Projects

struct ProjectsList: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        List {
            if model.projects.isEmpty { Text("No projects yet").foregroundStyle(.secondary) }
            ForEach(model.projects) { p in
                NavigationLink(value: Route.project(p)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name).font(.headline)
                        if let a = p.aliases, !a.isEmpty {
                            Text(a.map { "“\($0)”" }.joined(separator: ", "))
                                .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .opacity((p.status ?? "active") == "active" ? 1 : 0.6)
                }
            }
        }
        .navigationTitle("Projects")
    }
}

struct ProjectDetail: View {
    @EnvironmentObject var model: AppModel
    let project: Project
    @State private var noted = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text(project.name).font(.headline)
                if let status = project.status, status != "active" {
                    Text(status.capitalized).font(.footnote).foregroundStyle(.orange)
                }
                if let d = project.description, !d.isEmpty { Text(d).font(.footnote) }
                if let a = project.aliases, !a.isEmpty {
                    Text("Aka " + a.joined(separator: ", ")).font(.footnote).foregroundStyle(.secondary)
                }
                if let devices = project.devices, !devices.isEmpty {
                    Label(devices.joined(separator: ", "), systemImage: "laptopcomputer").font(.footnote)
                }

                TextFieldLink(prompt: Text("Note for \(project.name)")) {
                    Label(noted ? "Captured ✓" : "Add note", systemImage: "mic.fill")
                } onSubmit: { text in
                    Task {
                        noted = await model.capture(text, project: project.slug)
                        try? await Task.sleep(nanoseconds: 2_000_000_000)
                        noted = false
                    }
                }
                .padding(.vertical, 4)

                let notes = Array((project.notes ?? []).reversed())
                if !notes.isEmpty {
                    Text("Notes").font(.subheadline.bold())
                    ForEach(Array(notes.enumerated()), id: \.offset) { _, n in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(n.text).font(.footnote)
                            Text([n.device, ISO.ago(n.at)].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        .padding(.bottom, 2)
                    }
                }

                let handoffs = (model.snapshot?.handoffs ?? []).filter { $0.project == project.slug }
                if !handoffs.isEmpty {
                    Text("Handoffs").font(.subheadline.bold())
                    ForEach(handoffs) { h in
                        NavigationLink(value: Route.handoff(h)) { HandoffRow(handoff: h) }
                    }
                }
            }
        }
        .navigationTitle("Project")
    }
}

// MARK: - Profile, inbox, settings

struct ProfileView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                let lines = (model.snapshot?.profile ?? "").components(separatedBy: "\n")
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    MarkdownLine(line: line)
                }
            }
        }
        .navigationTitle("About me")
    }
}

/// Just enough markdown for profile.md: headings, bullets, inline emphasis.
struct MarkdownLine: View {
    let line: String

    var body: some View {
        let t = line.trimmingCharacters(in: .whitespaces)
        if t.isEmpty {
            Spacer().frame(height: 2)
        } else if t.hasPrefix("#") {
            Text(inline(t.drop { $0 == "#" }.trimmingCharacters(in: .whitespaces))).font(.headline).padding(.top, 4)
        } else if t.hasPrefix("- ") || t.hasPrefix("* ") {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("•")
                Text(inline(String(t.dropFirst(2)))).font(.footnote)
            }
        } else {
            Text(inline(t)).font(.footnote)
        }
    }

    private func inline(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s)) ?? AttributedString(s)
    }
}

struct InboxView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        List {
            if model.inbox.isEmpty {
                Text("Empty. Captures wait here until a Claude session files them.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(model.inbox) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.text).font(.footnote)
                    Text([item.project, item.source, ISO.ago(item.createdAt)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Inbox")
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        Form {
            Section("Data repo") {
                TextField("owner/omnicontext-data", text: $model.repo)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await model.refresh() } }
            }
            Section {
                if let login = model.login { Text("Signed in as \(login)").font(.footnote) }
                Button("Sign out", role: .destructive) { model.signOut() }
            }
            Section {
                Text("OmniContext \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
    }
}
