// rixse on iOS: the Movies demo. One viewport lays out the components from
// layout() using its own container width; chat and taps change state through
// the same door (APS 2); the agent sees wire state, never pixels.
import SwiftUI
import Rixse

@main
struct RixseMoviesApp: App {
  var body: some Scene {
    WindowGroup {
      RootView()
    }
  }
}

struct RootView: View {
  @State private var store: MovieStore?
  @State private var failed: String?

  var body: some View {
    Group {
      if let store {
        ContentView()
          .environmentObject(store)
      } else if let failed {
        ContentUnavailableView("zega failed to load", systemImage: "exclamationmark.triangle", description: Text(failed))
      } else {
        ProgressView("loading the movies database…")
      }
    }
    .task {
      guard store == nil, failed == nil else { return }
      do {
        let engine = try await Task.detached(priority: .userInitiated) { try Zega.load() }.value
        store = try MovieStore(catalogue: MoviesCatalogue(engine: engine))
      } catch {
        failed = "\(error)"
      }
    }
  }
}

struct ContentView: View {
  @EnvironmentObject var movies: MovieStore
  @State private var showSettings = false

  var body: some View {
    NavigationStack {
      ViewportView()
        .navigationTitle("rixse · movies")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Button { showSettings = true } label: {
              Label("Settings", systemImage: "gearshape")
            }
            .accessibilityIdentifier("settingsButton")
          }
        }
        .safeAreaInset(edge: .bottom) {
          VoiceBar()
        }
        .sheet(isPresented: $showSettings) {
          SettingsView()
        }
        .task {
          let args = ProcessInfo.processInfo.arguments
          guard let i = args.firstIndex(of: "-script"), args.count > i + 1 else { return }
          await movies.runScript(named: args[i + 1])
        }
        .background(
          ZStack {
            Text(movies.scriptStatus)
              .accessibilityIdentifier("scriptStatus")
            Text(viewportDebug)
              .accessibilityIdentifier("viewportDebug")
          }
          .frame(width: 1, height: 1)
          .opacity(0.01)
        )
    }
  }

  /// What the UI tests read: the views in order with their kinds, then the
  /// component the agent last changed — "v1:bar|v2:table>v2".
  private var viewportDebug: String {
    let views = movies.state.order.map { "\($0):\(movies.state.items[$0]?.kind ?? "?")" }.joined(separator: "|")
    return "\(views)>\(movies.lastChange?.view ?? "-")"
  }
}
