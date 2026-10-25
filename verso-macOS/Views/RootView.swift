import SwiftUI

struct RootView: View {
    @Bindable private var model = AppModel.shared
    private let settings = AppSettings.shared

    var body: some View {
        Group {
            if let workspace = model.workspace {
                WorkspaceView(workspace: workspace)
                    .id(workspace.root)
            } else {
                DashboardView()
            }
        }
        .background(WindowConfigurator())
        .task {
            await model.detectTex()
            if !settings.firstRunDone && model.workspace == nil { model.showWelcome = true }
        }
        .sheet(isPresented: $model.showWelcome) { WelcomeSheet() }
        .sheet(isPresented: $model.showNewProject) { NewProjectSheet() }
        .alert("Verso", isPresented: Binding(get: { model.alertMessage != nil }, set: { if !$0 { model.alertMessage = nil } })) {
            Button("OK") { model.alertMessage = nil }
        } message: {
            Text(model.alertMessage ?? "")
        }
        .alert("LaTeX toolchain not found", isPresented: $model.texMissingAlert) {
            Button("Re-check") { Task { await model.detectTex(force: true) } }
            Button("Get MacTeX") { NSWorkspace.shared.open(URL(string: "https://www.tug.org/mactex/")!) }
            Button("OK", role: .cancel) {}
        } message: {
            Text("Verso needs a TeX distribution with latexmk. Install MacTeX (tug.org/mactex) and re-check.")
        }
    }
}

/// The app icon as a view.
struct AppLogo: View {
    var size: CGFloat
    var body: some View {
        Image("Logo")
            .resizable()
            .interpolation(.high)
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous))
    }
}

/// Content starts below the toolbar instead of scrolling underneath it, so pane
/// backgrounds (file list, tab bar, PDF) never show through the title bar.
private struct WindowConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { WindowObservingView() }
    func updateNSView(_ view: NSView, context: Context) {}

    private final class WindowObservingView: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window else { return }
            window.styleMask.remove(.fullSizeContentView)
            window.titlebarAppearsTransparent = false
            window.titlebarSeparatorStyle = .line
        }
    }
}
