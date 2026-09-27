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
  @State private var showLogs = false

  var body: some View {
    NavigationStack {
      ViewportView()
        .navigationTitle("rixse · movies")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .topBarLeading) {
            Button { movies.undo() } label: {
              Label("Undo", systemImage: "arrow.uturn backward")
            }
            .disabled(!movies.log.contains { !$0.undone })
          }
          ToolbarItem(placement: .topBarTrailing) {
            Button { showLogs = true } label: {
              Label("Logs", systemImage: "list.bullet.rectangle")
            }
          }
        }
        .safeAreaInset(edge: .bottom) {
          VoiceBar()
        }
        .sheet(isPresented: $showLogs) {
          LogsView()
        }
        .task {
          let args = ProcessInfo.processInfo.arguments
          guard let i = args.firstIndex(of: "-script"), args.count > i + 1 else { return }
          await movies.runScript(named: args[i + 1])
        }
        .background(
          Text(movies.scriptStatus)
            .accessibilityIdentifier("scriptStatus")
            .frame(width: 1, height: 1)
            .opacity(0.01)
        )
    }
  }
}
