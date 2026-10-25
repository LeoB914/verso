import AppKit
import Observation
import UniformTypeIdentifiers

/// App-wide state: the open project, TeX detection and global dialogs.
@Observable
final class AppModel {
    static let shared = AppModel()

    var workspace: Workspace?
    var tex = TexEnvironment()
    var texDetected = false
    var showNewProject = false
    var showWelcome = false
    var alertMessage: String?
    var texMissingAlert = false

    private init() {}

    func detectTex(force: Bool = false) async {
        if texDetected && !force { return }
        tex = await TexEnvironment.detect()
        texDetected = true
    }

    func showError(_ message: String) {
        alertMessage = message
    }

    func showTexMissing() {
        texMissingAlert = true
    }

    // MARK: Projects

    func open(_ url: URL) {
        let root = URL(fileURLWithPath: ProjectRegistry.canonical(url.path), isDirectory: true)
        if workspace?.root.path == root.path { return }
        do {
            let next = try Workspace(root: root)
            workspace?.close()
            workspace = next
            next.start()
            NSDocumentController.shared.noteNewRecentDocumentURL(root)
        } catch {
            showError(error.localizedDescription)
        }
    }

    func closeProject() {
        workspace?.close()
        workspace = nil
        ProjectRegistry.shared.load()
    }

    func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "Open"
        panel.message = "Choose a LaTeX project folder"
        if panel.runModal() == .OK, let url = panel.url { open(url) }
    }

    func createProject(from template: TemplateInfo, name: String, in parent: URL) {
        do {
            let url = try Templates.instantiate(template, name: name, parent: parent)
            showNewProject = false
            open(url)
        } catch {
            showError(error.localizedDescription)
        }
    }

    func openSampleProject() {
        guard let template = Templates.list().first(where: { $0.id == "sample-project" }) else { return }
        let parent = AppSettings.shared.effectiveProjectDirectory
        var name = "Welcome to Verso"
        var counter = 1
        while FileManager.default.fileExists(atPath: parent.appendingPathComponent(name).path) {
            counter += 1
            name = "Welcome to Verso \(counter)"
        }
        createProject(from: template, name: name, in: parent)
    }

    func importZip() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.zip]
        panel.message = "Import a project ZIP (e.g. downloaded from Overleaf)"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        importZip(url)
    }

    func importZip(_ url: URL) {
        Task {
            do {
                let project = try await ProjectFiles.importZip(url, into: AppSettings.shared.effectiveProjectDirectory)
                open(project)
            } catch {
                showError(error.localizedDescription)
            }
        }
    }

    func exportZip(_ root: URL) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.zip]
        panel.nameFieldStringValue = root.lastPathComponent + ".zip"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        workspace?.saveAll()
        Task {
            do {
                try await ProjectFiles.exportZip(root: root, to: url)
                NSWorkspace.shared.activateFileViewerSelecting([url])
            } catch {
                showError(error.localizedDescription)
            }
        }
    }

    func saveAsTemplate(_ root: URL) {
        guard let name = Prompt.text(title: "Save as Template", message: "Name of the new template:",
                                     defaultValue: root.lastPathComponent, confirm: "Save") else { return }
        do {
            try Templates.saveProject(root, asTemplateNamed: name)
        } catch {
            showError(error.localizedDescription)
        }
    }

    /// Ask before quitting/closing when buffers are dirty and autosave is off.
    func canTerminate() -> Bool {
        workspace?.saveAll()
        workspace?.persistUIState()
        return true
    }
}

/// Small modal text prompt (NSAlert with a text field).
enum Prompt {
    static func text(title: String, message: String = "", defaultValue: String = "", confirm: String = "OK") -> String? {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: confirm)
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = defaultValue
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        let value = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    static func confirm(_ title: String, message: String = "", confirm: String = "OK", destructive: Bool = false) -> Bool {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = destructive ? .warning : .informational
        let button = alert.addButton(withTitle: confirm)
        button.hasDestructiveAction = destructive
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn
    }
}
