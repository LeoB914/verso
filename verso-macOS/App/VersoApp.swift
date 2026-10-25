import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        AppSettings.shared.applyAppearance()
        UserDefaults.standard.set(false, forKey: "NSFullScreenMenuItemEverywhere")
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        AppModel.shared.canTerminate() ? .terminateNow : .terminateCancel
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            var isDir: ObjCBool = false
            FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
            if url.pathExtension.lowercased() == "zip" {
                AppModel.shared.importZip(url)
            } else {
                AppModel.shared.open(isDir.boolValue ? url : url.deletingLastPathComponent())
            }
        }
    }
}

@main
struct VersoApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    private let model = AppModel.shared

    var body: some Scene {
        Window("Verso", id: "main") {
            RootView()
                .frame(minWidth: 900, minHeight: 560)
        }
        .defaultSize(width: 1440, height: 900)
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands { VersoCommands(model: model) }

        Settings {
            SettingsView()
        }
    }
}

/// Menu bar with all commands and their keyboard shortcuts.
struct VersoCommands: Commands {
    let model: AppModel
    private var workspace: Workspace? { model.workspace }
    private var hasProject: Bool { model.workspace != nil }
    private var hasEditor: Bool { model.workspace?.activeDocument?.kind == .text }

    private func editor(_ action: (LatexTextView) -> Void) {
        // Editor-scoped commands only act while the editor has focus.
        guard let textView = workspace?.textView, hasEditor, textView.window?.firstResponder === textView else { return }
        action(textView)
    }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Project…") { model.closeProjectIfNeededThenNew() }
            Button("New File…") { promptNewFile() }
                .keyboardShortcut("n")
                .disabled(!hasProject)
            Button("New Folder…") { promptNewFolder() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .disabled(!hasProject)
            Divider()
            Button("Open Folder…") { model.chooseFolder() }
                .keyboardShortcut("o")
            Button("Import ZIP…") { model.importZip() }
        }
        CommandGroup(replacing: .saveItem) {
            Button("Close Tab") {
                if let workspace, let path = workspace.activePath { workspace.closeTab(path) }
                else { NSApp.keyWindow?.performClose(nil) }
            }
            .keyboardShortcut("w")
            Button("Close Window") { NSApp.keyWindow?.performClose(nil) }
                .keyboardShortcut("w", modifiers: [.command, .shift])
            Divider()
            Button("Save") { workspace?.saveActive() }
                .keyboardShortcut("s")
                .disabled(!hasEditor)
            Button("Save All") { workspace?.saveAll() }
                .keyboardShortcut("s", modifiers: [.command, .shift])
                .disabled(!hasProject)
            Divider()
            Button("Export Project as ZIP…") { if let root = workspace?.root { model.exportZip(root) } }
                .disabled(!hasProject)
            Button("Save Project as Template…") { if let root = workspace?.root { model.saveAsTemplate(root) } }
                .disabled(!hasProject)
            Divider()
            Button("Save All and Show Overview") { model.closeProject() }
                .disabled(!hasProject)
        }
        CommandGroup(replacing: .printItem) {}

        CommandGroup(after: .textEditing) {
            Divider()
            Button("Toggle Comment") { editor { $0.toggleComment() } }
                .keyboardShortcut("/")
                .disabled(!hasEditor)
            Button("Trigger Completion") { editor { $0.updateCompletion(explicit: true) } }
                .keyboardShortcut(" ", modifiers: .control)
                .disabled(!hasEditor)
        }

        CommandMenu("Format") {
            Group {
                Button("Bold") { editor { $0.wrapSelection(command: "\\textbf") } }
                    .keyboardShortcut("b")
                Button("Italic") { editor { $0.wrapSelection(command: "\\textit") } }
                    .keyboardShortcut("i")
                Button("Underline") { editor { $0.wrapSelection(command: "\\underline") } }
                    .keyboardShortcut("u")
                Button("Emphasis") { editor { $0.wrapSelection(command: "\\emph") } }
                Divider()
                Menu("Section Heading") {
                    ForEach(["\\part", "\\chapter", "\\section", "\\subsection", "\\subsubsection", "\\paragraph"], id: \.self) { command in
                        Button(String(command.dropFirst()).capitalized) { editor { $0.insertSection(command) } }
                    }
                }
                Menu("Font Size") {
                    ForEach(FormatToolbar.fontSizes, id: \.0) { command, label in
                        Button(label) { editor { $0.applyFontSize(command) } }
                    }
                }
            }
            .disabled(!hasEditor)
        }

        CommandMenu("Insert") {
            Button("Citation…") { workspace?.showCitePicker = true }
                .keyboardShortcut("c", modifiers: [.command, .shift])
                .disabled(!hasEditor)
            Button("Table…") { workspace?.showTableDialog = true }
                .disabled(!hasEditor)
            Button("Image…") { workspace?.insertImage() }
                .disabled(!hasEditor)
            Button("Math Block") { editor { $0.insertMathBlock() } }
                .keyboardShortcut("m", modifiers: [.command, .shift])
                .disabled(!hasEditor)
            Button("Symbol Palette") {
                workspace?.sidebarVisible = true
                workspace?.sidebarTab = .symbols
            }
            .disabled(!hasProject)
        }

        CommandMenu("Compile") {
            Button("Compile") { Task { await workspace?.compile() } }
                .keyboardShortcut(.return)
                .disabled(!hasProject)
            Button("Recompile from Scratch") { workspace?.cleanBuild() }
                .keyboardShortcut(.return, modifiers: [.command, .option])
                .disabled(!hasProject)
            Button("Cancel Compilation") { workspace?.cancelCompile() }
                .keyboardShortcut(".")
                .disabled(workspace?.compileState.isCompiling != true)
            Divider()
            Toggle("Auto Compile", isOn: Binding(
                get: { workspace?.config.autoCompile ?? false },
                set: { workspace?.setAutoCompile($0) }))
                .disabled(!hasProject)
            Divider()
            Button("Jump to PDF (SyncTeX)") { workspace?.syncToPDF() }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
                .disabled(!hasEditor)
            Button("Word Count Details…") { workspace?.showWordCount = true }
                .disabled(!hasProject)
        }

        CommandGroup(before: .sidebar) {
            Button("Toggle Sidebar") { workspace?.sidebarVisible.toggle() }
                .keyboardShortcut("e", modifiers: [.command, .shift])
                .disabled(!hasProject)
            Button("Toggle PDF Pane") { workspace?.pdfVisible.toggle() }
                .keyboardShortcut("d", modifiers: [.command, .shift])
                .disabled(!hasProject)
            Button("Toggle Problems Panel") { workspace?.problemsVisible.toggle() }
                .keyboardShortcut("j", modifiers: [.command, .shift])
                .disabled(!hasProject)
            Divider()
        }

        CommandMenu("Go") {
            Button("Go to File…") { workspace?.palette = .files }
                .keyboardShortcut("p")
                .disabled(!hasProject)
            Button("Go to Section…") { workspace?.palette = .sections }
                .keyboardShortcut("r")
                .disabled(!hasProject)
            Button("Command Palette…") { workspace?.palette = .commands }
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .disabled(!hasProject)
            Button("Search in Project") {
                workspace?.sidebarVisible = true
                workspace?.sidebarTab = .search
            }
            .keyboardShortcut("f", modifiers: [.command, .shift])
            .disabled(!hasProject)
        }

        CommandMenu("History") {
            Button("Version History…") { workspace?.showHistory = true }
                .keyboardShortcut("h", modifiers: [.command, .shift])
                .disabled(!hasProject)
            Button("Save Labelled Version…") {
                guard let workspace, let label = Prompt.text(title: "Save Labelled Version", message: "Label for this version:", confirm: "Save") else { return }
                workspace.saveAll()
                workspace.takeSnapshot(reason: "Labelled version", label: label)
            }
            .disabled(!hasProject)
        }
    }

    private func promptNewFile() {
        guard let workspace, let name = Prompt.text(title: "New File", message: "File name (relative to the project root):",
                                                    defaultValue: "chapter.tex", confirm: "Create") else { return }
        let directory = (name as NSString).deletingLastPathComponent
        if !directory.isEmpty { try? FileManager.default.createDirectory(at: workspace.root.appendingPathComponent(directory), withIntermediateDirectories: true) }
        workspace.createFile(named: (name as NSString).lastPathComponent, in: directory)
    }

    private func promptNewFolder() {
        guard let workspace, let name = Prompt.text(title: "New Folder", message: "Folder name:", confirm: "Create") else { return }
        workspace.createFolder(named: name, in: "")
    }
}

extension AppModel {
    func closeProjectIfNeededThenNew() {
        if workspace != nil { closeProject() }
        // closeProject() keeps the project open when the user cancels.
        if workspace == nil { showNewProject = true }
    }
}
