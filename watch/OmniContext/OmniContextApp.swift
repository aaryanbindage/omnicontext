import SwiftUI

@main
struct OmniContextApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Group {
                if model.signedIn {
                    HomeView()
                } else {
                    SignInView()
                }
            }
            .environmentObject(model)
            .onChange(of: phase) { _, newPhase in
                if newPhase == .active { Task { await model.refresh(ifOlderThan: 120) } }
            }
        }
    }
}
