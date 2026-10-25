import AppKit
import Observation
import UniformTypeIdentifiers

/// An open file (tab).
@Observable
final class EditorDocument: Identifiable {
    var relPath: String
    let kind: FileKind
    var isDirty = false
    /// The file changed on disk while this tab had unsaved edits; saving is paused
    /// until the user keeps one version.
    var hasConflict = false

    @ObservationIgnored let storage = NSTextStorage()
    @ObservationIgnored let undoManager = UndoManager()
    @ObservationIgnored let highlighter = LatexHighlighter()
    @ObservationIgnored var savedText = ""
    @ObservationIgnored var format = TextFormat()
    @ObservationIgnored var selection = NSRange(location: 0, length: 0)
    /// Vertical scroll position of the editor (nil = never shown).
    @ObservationIgnored var scrollY: CGFloat?

    var id: String { relPath }
    var name: String { (relPath as NSString).lastPathComponent }
    var text: String { storage.string }

    init(relPath: String, kind: FileKind) {
        self.relPath = relPath
        self.kind = kind
        let ext = (relPath as NSString).pathExtension.lowercased()
        highlighter.enabled = ["tex", "ltx", "sty", "cls", "tikz", "bib", "dtx", "bbx", "cbx"].contains(ext)
        storage.delegate = highlighter
    }

    func load(text: String) {
        storage.beginEditing()
        storage.replaceCharacters(in: NSRange(location: 0, length: storage.length), with: text)
        storage.endEditing()
        highlighter.highlightAll(storage)
        savedText = text
        isDirty = false
    }

    /// Replace the content after an external change, keeping the cursor nearby.
    func reload(text: String) {
        guard text != storage.string else { return }
        storage.beginEditing()
        storage.replaceCharacters(in: NSRange(location: 0, length: storage.length), with: text)
        storage.endEditing()
        highlighter.highlightAll(storage)
        savedText = text
        isDirty = false
        hasConflict = false
        selection = NSRange(location: min(selection.location, storage.length), length: 0)
    }

    func restyle() { highlighter.highlightAll(storage) }
}

enum CompileState: Equatable {
    case idle
    case compiling
    case success(TimeInterval)
    case failed(String)
    case canceled

    var isCompiling: Bool { self == .compiling }
}

enum SidebarTab: String, CaseIterable, Identifiable {
    case files, outline, search, git, references, symbols
    var id: String { rawValue }

    var title: String {
        switch self {
        case .files: "Files"
        case .outline: "Outline"
        case .search: "Search"
        case .git: "Git"
        case .references: "Refs"
        case .symbols: "Symbols"
        }
    }

    var symbol: String {
        switch self {
        case .files: "doc.text"
        case .outline: "list.bullet.indent"
        case .search: "magnifyingglass"
        case .git: "arrow.triangle.branch"
        case .references: "book"
        case .symbols: "sum"
        }
    }
}

nonisolated struct LabelInfo: Hashable {
    var key: String
    var file: String
    var line: Int
}

enum PaletteMode: String, Identifiable {
    case commands, files, sections
    var id: String { rawValue }
}

/// An open project: files, tabs, compile state, project index and UI state.
@Observable
final class Workspace {
    let root: URL
    var name: String
    var config: ProjectConfig
    var tree: FileNode
    var documents: [EditorDocument] = []
    var activePath: String?

    // Layout
    var sidebarVisible = true { didSet { persistUIState() } }
    var pdfVisible = true { didSet { persistUIState() } }
    var problemsVisible = false { didSet { persistUIState() } }
    var sidebarTab: SidebarTab = .files

    // Compile
    var compileState: CompileState = .idle
    var logEntries: [LogEntry] = []
    var compileOutput = ""
    var pdfVersion = 0
    var wordCount: TexcountResult?

    // Project index
    var outline: [SectionNode] = []
    var labels: [LabelInfo] = []
    var bibEntries: [BibEntry] = []
    var definitions: [DefinitionEntry] = []

    // Status / sheets
    var cursorLine = 1
    var cursorColumn = 1
    var palette: PaletteMode?
    var showHistory = false
    var showWordCount = false
    var showTableDialog = false
    var showCitePicker = false

    @ObservationIgnored weak var textView: LatexTextView?
    @ObservationIgnored let pdf = PDFController()
    @ObservationIgnored private var watcher: FileWatcher?
    @ObservationIgnored private var runner: CompileRunner?
    @ObservationIgnored private var pendingCompile = false
    @ObservationIgnored private var autosaveWork: [String: DispatchWorkItem] = [:]
    @ObservationIgnored private var autoCompileWork: DispatchWorkItem?
    @ObservationIgnored private var reindexWork: DispatchWorkItem?
    @ObservationIgnored private var watcherWork: DispatchWorkItem?
    @ObservationIgnored private var snapshotTimer: Timer?
    @ObservationIgnored private var restoringState = true
    @ObservationIgnored private var reindexGeneration = 0

    private let settings = AppSettings.shared
    private var app: AppModel { AppModel.shared }

    var activeDocument: EditorDocument? { documents.first { $0.relPath == activePath } }
    var buildDirectory: URL { ProjectConfig.buildDirectory(root: root) }
    var pdfURL: URL? {
        guard !config.mainFile.isEmpty else { return nil }
        let base = ((config.mainFile as NSString).lastPathComponent as NSString).deletingPathExtension
        let url = buildDirectory.appendingPathComponent(base + ".pdf")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    var dirtyCount: Int { documents.filter(\.isDirty).count }

    // MARK: Lifecycle

    init(root: URL) throws {
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDir), isDir.boolValue else {
            throw VersoError("The folder \(root.path) does not exist.")
        }
        self.root = root
        name = root.lastPathComponent
        var config = ProjectConfig.read(root: root) ?? {
            var fresh = ProjectConfig()
            fresh.compiler = AppSettings.shared.defaultCompiler
            fresh.shellEscape = AppSettings.shared.shellEscapeDefault
            return fresh
        }()
        if config.mainFile.isEmpty || !FileManager.default.fileExists(atPath: root.appendingPathComponent(config.mainFile).path) {
            config.mainFile = ProjectConfig.detectMainFile(root: root)
        }
        try? config.write(root: root)
        self.config = config
        tree = ProjectFiles.tree(root: root)
    }

    /// Called once after the workspace became the app's current project.
    func start() {
        ProjectRegistry.shared.register(root.path)
        watcher = FileWatcher(path: root.path) { [weak self] events in self?.filesChanged(events) }
        restoreUIState()
        reindex()
        refreshWordCount()
        takeSnapshot(reason: "Opened project")
        let root = self.root
        Task.detached(priority: .background) { HistoryStore.prune(root: root) }
        snapshotTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.takeSnapshot(reason: HistoryStore.autoReason) }
        }
    }

    func close() {
        saveAll()
        persistUIState()
        runner?.cancel()
        watcher?.stop()
        watcher = nil
        snapshotTimer?.invalidate()
        autoCompileWork?.cancel()
        reindexWork?.cancel()
        autosaveWork.values.forEach { $0.cancel() }
    }

    private func restoreUIState() {
        let state = ProjectRegistry.shared.uiState(for: root.path)
        sidebarVisible = state?.sidebarVisible ?? true
        pdfVisible = state?.pdfVisible ?? true
        problemsVisible = state?.problemsVisible ?? false
        for path in state?.openTabs ?? [] where FileManager.default.fileExists(atPath: root.appendingPathComponent(path).path) {
            openFile(path, activate: false)
        }
        if let active = state?.activeTab, documents.contains(where: { $0.relPath == active }) {
            activePath = active
            if let location = state?.cursorLocation, let doc = activeDocument {
                doc.selection = NSRange(location: min(location, doc.storage.length), length: 0)
            }
        } else if !config.mainFile.isEmpty {
            openFile(config.mainFile)
        } else {
            activePath = documents.first?.relPath
        }
        restoringState = false
        persistUIState()
    }

    func persistUIState() {
        guard !restoringState else { return }
        let state = ProjectUIState(openTabs: documents.map(\.relPath), activeTab: activePath,
                                   cursorLocation: activeDocument?.selection.location,
                                   sidebarVisible: sidebarVisible, pdfVisible: pdfVisible, problemsVisible: problemsVisible)
        ProjectRegistry.shared.saveUIState(state, for: root.path)
    }

    // MARK: Files & tabs

    func url(for relPath: String) -> URL? { ProjectFiles.resolve(root: root, relPath) }

    func refreshTree() {
        tree = ProjectFiles.tree(root: root)
    }

    @discardableResult
    func openFile(_ relPath: String, activate: Bool = true) -> EditorDocument? {
        if let existing = documents.first(where: { $0.relPath == relPath }) {
            if activate { activePath = relPath }
            return existing
        }
        guard let url = url(for: relPath), FileManager.default.fileExists(atPath: url.path) else { return nil }
        let kind = FileKind.of(relPath)
        if kind == .binary {
            NSWorkspace.shared.open(url)
            return nil
        }
        let document = EditorDocument(relPath: relPath, kind: kind)
        if kind == .text {
            do {
                let file = try ProjectFiles.readText(url)
                document.load(text: file.text)
                document.format = file.format
            } catch {
                app.showError("Could not open \(relPath): \(error.localizedDescription)")
                return nil
            }
        }
        documents.append(document)
        if activate { activePath = relPath }
        persistUIState()
        return document
    }

    func activate(_ relPath: String) {
        activePath = relPath
        persistUIState()
    }

    func closeTab(_ relPath: String) {
        guard let index = documents.firstIndex(where: { $0.relPath == relPath }) else { return }
        let document = documents[index]
        if document.isDirty {
            if settings.autosaveEnabled {
                save(document)
            } else {
                let alert = NSAlert()
                alert.messageText = "Do you want to save the changes to \(document.name)?"
                alert.informativeText = "Your changes will be lost if you don't save them."
                alert.addButton(withTitle: "Save")
                alert.addButton(withTitle: "Cancel")
                alert.addButton(withTitle: "Don't Save")
                switch alert.runModal() {
                case .alertFirstButtonReturn: save(document)
                case .alertSecondButtonReturn: return
                default: document.isDirty = false
                }
            }
            // Saving can be refused (file changed on disk) — never drop the edits silently.
            if document.isDirty, !Prompt.confirm("\(document.name) could not be saved.",
                                                 message: document.hasConflict ? "The file was changed on disk by another program. Closing discards your unsaved edits (they stay in Version History)." : "Closing discards your unsaved edits.",
                                                 confirm: "Close Without Saving", destructive: true) {
                return
            }
            if document.isDirty { takeSnapshotNow(reason: "Before closing unsaved tab") }
        }
        documents.remove(at: index)
        if activePath == relPath {
            activePath = documents.isEmpty ? nil : documents[max(0, index - 1)].relPath
        }
        persistUIState()
    }

    func closeOtherTabs(_ relPath: String) {
        for document in documents where document.relPath != relPath { closeTab(document.relPath) }
    }

    /// Save a tab. Refuses (and flags a conflict) when another program changed the
    /// file since it was opened or last saved, unless `force` is set.
    func save(_ document: EditorDocument, force: Bool = false) {
        guard document.kind == .text, let url = url(for: document.relPath) else { return }
        autosaveWork[document.relPath]?.cancel()
        if !force, let disk = try? ProjectFiles.readText(url), disk.text != document.savedText {
            document.hasConflict = true
            return
        }
        let text = document.text
        do {
            let written = try ProjectFiles.writeText(text, to: url, format: document.format)
            if document.format.latin1 && !written.latin1 {
                app.showError("\(document.relPath) contains characters that Latin-1 cannot store, so it was saved as UTF-8. Update \\usepackage[latin1]{inputenc} if the document uses it.")
            }
            document.format = written
            document.savedText = text
            document.isDirty = false
            document.hasConflict = false
        } catch {
            app.showError("Could not save \(document.relPath): \(error.localizedDescription)")
        }
    }

    /// Conflict resolution: overwrite the file on disk with the editor's text.
    func keepMyVersion(_ document: EditorDocument) {
        save(document, force: true)
    }

    /// Conflict resolution: replace the editor's text with the file on disk.
    /// The unsaved edits are kept in a snapshot first.
    func loadDiskVersion(_ document: EditorDocument) {
        guard let url = url(for: document.relPath), let file = try? ProjectFiles.readText(url) else { return }
        takeSnapshotNow(reason: "Before loading external changes")
        document.format = file.format
        document.reload(text: file.text)
        scheduleReindex()
    }

    func saveActive() {
        if let document = activeDocument { save(document) }
    }

    func saveAll() {
        for document in documents where document.isDirty { save(document) }
    }

    /// Called by the editor after every text change.
    func documentDidChange(_ document: EditorDocument) {
        let dirty = document.text != document.savedText
        if document.isDirty != dirty { document.isDirty = dirty }
        if dirty && settings.autosaveEnabled {
            autosaveWork[document.relPath]?.cancel()
            let work = DispatchWorkItem { [weak self, weak document] in
                guard let self, let document, document.isDirty else { return }
                self.save(document)
            }
            autosaveWork[document.relPath] = work
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(max(200, settings.autosaveDelayMs)), execute: work)
        }
        if config.autoCompile { scheduleAutoCompile() }
        scheduleReindex()
    }

    // MARK: File operations

    func createFile(named name: String, in directory: String) {
        let relPath = directory.isEmpty ? name : "\(directory)/\(name)"
        guard let url = url(for: relPath) else { return }
        guard !FileManager.default.fileExists(atPath: url.path) else {
            app.showError("\"\(name)\" already exists.")
            return
        }
        do {
            try ProjectFiles.writeText("", to: url)
            refreshTree()
            openFile(relPath)
        } catch {
            app.showError(error.localizedDescription)
        }
    }

    func createFolder(named name: String, in directory: String) {
        let relPath = directory.isEmpty ? name : "\(directory)/\(name)"
        guard let url = url(for: relPath) else { return }
        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
            refreshTree()
        } catch {
            app.showError(error.localizedDescription)
        }
    }

    func rename(_ relPath: String, to newName: String) {
        guard !newName.isEmpty, !newName.contains("/"), let from = url(for: relPath) else { return }
        let parent = (relPath as NSString).deletingLastPathComponent
        let newRel = parent.isEmpty ? newName : "\(parent)/\(newName)"
        guard let to = url(for: newRel) else { return }
        do {
            saveAll()
            try FileManager.default.moveItem(at: from, to: to)
            for document in documents {
                if document.relPath == relPath { document.relPath = newRel }
                else if document.relPath.hasPrefix(relPath + "/") {
                    document.relPath = newRel + document.relPath.dropFirst(relPath.count)
                }
            }
            if let active = activePath {
                if active == relPath { activePath = newRel }
                else if active.hasPrefix(relPath + "/") { activePath = newRel + active.dropFirst(relPath.count) }
            }
            if config.mainFile == relPath { setMainFile(newRel) }
            refreshTree()
            persistUIState()
        } catch {
            app.showError(error.localizedDescription)
        }
    }

    func trash(_ relPath: String) {
        guard let url = url(for: relPath) else { return }
        if settings.confirmBeforeDelete {
            let alert = NSAlert()
            alert.messageText = "Move \"\((relPath as NSString).lastPathComponent)\" to the Trash?"
            alert.addButton(withTitle: "Move to Trash")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        do {
            try FileManager.default.trashItem(at: url, resultingItemURL: nil)
            for document in documents where document.relPath == relPath || document.relPath.hasPrefix(relPath + "/") {
                document.isDirty = false
                closeTab(document.relPath)
            }
            refreshTree()
        } catch {
            app.showError(error.localizedDescription)
        }
    }

    func setMainFile(_ relPath: String) {
        config.mainFile = relPath
        saveConfig()
        reindex()
    }

    func saveConfig() {
        try? config.write(root: root)
    }

    /// Copy files (Finder drop / import) into a project folder.
    func importFiles(_ urls: [URL], into directory: String) {
        guard let target = url(for: directory) else { return }
        for source in urls {
            var destination = target.appendingPathComponent(source.lastPathComponent)
            var counter = 1
            while FileManager.default.fileExists(atPath: destination.path) {
                counter += 1
                let base = source.deletingPathExtension().lastPathComponent
                let ext = source.pathExtension
                destination = target.appendingPathComponent(ext.isEmpty ? "\(base) \(counter)" : "\(base) \(counter).\(ext)")
            }
            do { try FileManager.default.copyItem(at: source, to: destination) } catch { app.showError(error.localizedDescription) }
        }
        refreshTree()
    }

    func reveal(_ relPath: String) {
        if let url = url(for: relPath) { NSWorkspace.shared.activateFileViewerSelecting([url]) }
    }

    /// Image picker for "Insert image": copies into `figures/` when needed, inserts a figure block.
    func insertImage() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .pdf, .gif, .tiff]
        panel.directoryURL = root
        guard panel.runModal() == .OK, let picked = panel.url else { return }
        var relPath: String
        let rootPath = root.standardizedFileURL.path + "/"
        if picked.standardizedFileURL.path.hasPrefix(rootPath) {
            relPath = String(picked.standardizedFileURL.path.dropFirst(rootPath.count))
        } else {
            let figures = root.appendingPathComponent("figures")
            try? FileManager.default.createDirectory(at: figures, withIntermediateDirectories: true)
            let destination = figures.appendingPathComponent(picked.lastPathComponent)
            if !FileManager.default.fileExists(atPath: destination.path) {
                try? FileManager.default.copyItem(at: picked, to: destination)
            }
            relPath = "figures/\(picked.lastPathComponent)"
            refreshTree()
        }
        // \includegraphics resolves paths from the main file's folder.
        let mainDir = (config.mainFile as NSString).deletingLastPathComponent
        let withoutExt = ProjectFiles.relativePath(from: mainDir, to: (relPath as NSString).deletingPathExtension)
        let base = (withoutExt as NSString).lastPathComponent
        textView?.insertSnippet("""
        \\begin{figure}[ht]
          \\centering
          \\includegraphics[width=\\linewidth]{\(withoutExt)}
          \\caption{${1:\(base)}}
          \\label{fig:\(base)}
        \\end{figure}

        """)
    }

    @ObservationIgnored private var pendingEvents: [FileEvent] = []

    private func filesChanged(_ events: [FileEvent]) {
        let buildPath = buildDirectory.resolvingSymlinksInPath().path
        let gitPath = root.appendingPathComponent(".git").resolvingSymlinksInPath().path
        let relevant = events.filter { !$0.path.hasPrefix(buildPath) && !$0.path.hasPrefix(gitPath) }
        guard !relevant.isEmpty else { return }
        pendingEvents += relevant
        watcherWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let events = self.pendingEvents
            self.pendingEvents = []
            // A plain content change (e.g. our own autosave) needs no new file tree.
            if events.contains(where: \.changesStructure) { self.refreshTree() }
            let rootPath = self.root.resolvingSymlinksInPath().path
            let touched = Set(events.map(\.path))
            let rescanAll = events.contains(where: \.mustRescan)
            for document in self.documents where document.kind == .text {
                guard let url = self.url(for: document.relPath),
                      rescanAll || touched.contains(rootPath + "/" + document.relPath),
                      let file = try? ProjectFiles.readText(url), file.text != document.savedText else { continue }
                if document.isDirty {
                    document.hasConflict = true
                } else {
                    document.format = file.format
                    document.reload(text: file.text)
                }
            }
            self.scheduleReindex()
        }
        watcherWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    // MARK: Compile

    func setCompiler(_ compiler: Compiler) {
        config.compiler = compiler
        saveConfig()
    }

    func setAutoCompile(_ enabled: Bool) {
        config.autoCompile = enabled
        saveConfig()
        if enabled { scheduleAutoCompile() } else { autoCompileWork?.cancel() }
    }

    private func scheduleAutoCompile() {
        autoCompileWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.config.autoCompile else { return }
            Task { await self.compile() }
        }
        autoCompileWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(min(max(settings.autoCompileDelayMs, 500), 10_000)), execute: work)
    }

    func compile(fresh: Bool = false) async {
        if compileState.isCompiling {
            pendingCompile = true
            return
        }
        guard let latexmk = app.tex.tools["latexmk"] else {
            compileState = .failed("latexmk not found")
            app.showTexMissing()
            return
        }
        saveAll()
        if config.mainFile.isEmpty { config.mainFile = ProjectConfig.detectMainFile(root: root); saveConfig() }
        guard !config.mainFile.isEmpty, let mainURL = url(for: config.mainFile),
              FileManager.default.fileExists(atPath: mainURL.path) else {
            compileState = .failed("No main .tex file")
            return
        }
        try? FileManager.default.createDirectory(at: buildDirectory, withIntermediateDirectories: true)
        compileState = .compiling
        let started = Date()
        var arguments: [String] = []
        if fresh { arguments.append("-gg") }
        arguments += [config.compiler.latexmkFlag, "-synctex=1", "-interaction=nonstopmode", "-file-line-error"]
        if config.shellEscape { arguments.append("-shell-escape") }
        arguments += ["-outdir=\(buildDirectory.path)", mainURL.path]

        let runner = CompileRunner()
        self.runner = runner
        let outcome = await runner.run(executable: latexmk.path, arguments: arguments,
                                       cwd: mainURL.deletingLastPathComponent(),
                                       timeout: TimeInterval(min(max(settings.compileTimeoutSeconds, 10), 600)))
        self.runner = nil
        compileOutput = outcome.output

        if outcome.canceled {
            compileState = .canceled
            pendingCompile = false
            return
        }
        let base = mainURL.deletingPathExtension().lastPathComponent
        let logURL = buildDirectory.appendingPathComponent(base + ".log")
        let log = (try? String(contentsOf: logURL, encoding: .utf8))
            ?? (try? String(contentsOf: logURL, encoding: .isoLatin1)) ?? ""
        var entries = LogParser.parse(log)
        if log.isEmpty || outcome.status != 0 {
            // Biber / latexmk problems only show up on the console.
            for entry in LogParser.parse(outcome.output) where entry.level == .error && !entries.contains(where: { $0.message == entry.message }) {
                entries.append(entry)
            }
        }
        // Paths in the log are relative to the main file's folder; make them project-relative.
        let mainDir = (config.mainFile as NSString).deletingLastPathComponent
        logEntries = entries.map { entry in
            var entry = entry
            if let file = entry.file {
                if file.hasPrefix("/") {
                    let rootPath = root.standardizedFileURL.path + "/"
                    entry.file = file.hasPrefix(rootPath) ? String(file.dropFirst(rootPath.count)) : file
                } else if !mainDir.isEmpty {
                    entry.file = (mainDir as NSString).appendingPathComponent(file)
                }
            }
            return entry
        }
        let errors = logEntries.filter { $0.level == .error }.count
        let pdfExists = pdfURL.map { url in
            ((try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate] as? Date) ?? .distantPast) >= started.addingTimeInterval(-1)
        } ?? false

        if outcome.timedOut {
            compileState = .failed("Timed out after \(settings.compileTimeoutSeconds) s")
            problemsVisible = true
        } else if outcome.status == 0 && pdfURL != nil {
            compileState = .success(Date().timeIntervalSince(started))
            pdfVersion += 1
            takeSnapshot(reason: "Compiled")
            refreshWordCount()
        } else {
            compileState = .failed(errors > 0 ? "\(errors) error\(errors == 1 ? "" : "s")" : "Compilation failed")
            problemsVisible = true
            if pdfExists { pdfVersion += 1 }
        }
        if pendingCompile {
            pendingCompile = false
            Task { await compile() }
        }
    }

    func cancelCompile() {
        runner?.cancel()
        pendingCompile = false
    }

    /// Delete the build directory and compile again.
    func cleanBuild() {
        try? FileManager.default.removeItem(at: buildDirectory)
        Task { await compile(fresh: true) }
    }

    func markers(for relPath: String) -> [Int: LogLevel] {
        var result: [Int: LogLevel] = [:]
        for entry in logEntries where entry.file == relPath && entry.level != .info {
            guard let line = entry.line else { continue }
            if result[line] != .error { result[line] = entry.level }
        }
        return result
    }

    func refreshWordCount() {
        guard let texcount = app.tex.tools["texcount"], let mainURL = url(for: config.mainFile),
              FileManager.default.fileExists(atPath: mainURL.path) else { return }
        Task {
            let result = await ProcessRunner.run(texcount.path, ["-inc", "-sum", "-utf8", "-brief", mainURL.path],
                                                 cwd: mainURL.deletingLastPathComponent(), timeout: 15)
            self.wordCount = TexcountResult.parseBrief(result.output)
        }
    }

    // MARK: SyncTeX

    /// Source → PDF for the cursor position.
    func syncToPDF() {
        guard let synctex = app.tex.tools["synctex"], let pdfURL, let document = activeDocument,
              let fileURL = url(for: document.relPath), let textView else { return }
        let location = textView.selectedRange().location
        let line = textView.lineNumber(at: location)
        if !pdfVisible { pdfVisible = true }
        Task {
            let result = await ProcessRunner.run(synctex.path, ["view", "-i", "\(line):0:\(fileURL.path)", "-o", pdfURL.path],
                                                 cwd: buildDirectory, timeout: 10)
            if let view = SynctexParser.parseView(result.output) {
                self.pdf.reveal(page: view.page, x: view.x, y: view.y, width: view.width, height: view.height)
            } else {
                NSSound.beep()
            }
        }
    }

    /// PDF → source for a click in the PDF (1-based page, PDF points from the top-left).
    func syncFromPDF(page: Int, x: Double, y: Double) {
        guard let synctex = app.tex.tools["synctex"], let pdfURL else { return }
        Task {
            let result = await ProcessRunner.run(synctex.path, ["edit", "-o", "\(page):\(x):\(y):\(pdfURL.path)"],
                                                 cwd: buildDirectory, timeout: 10)
            guard let edit = SynctexParser.parseEdit(result.output) else { NSSound.beep(); return }
            var file = edit.file
            if !file.hasPrefix("/") {
                let mainDir = root.appendingPathComponent((self.config.mainFile as NSString).deletingLastPathComponent)
                file = mainDir.appendingPathComponent(file).standardizedFileURL.path
            }
            file = URL(fileURLWithPath: file).standardizedFileURL.path
            let rootPath = self.root.standardizedFileURL.path + "/"
            guard file.hasPrefix(rootPath) else { return }
            self.jump(to: String(file.dropFirst(rootPath.count)), line: edit.line)
        }
    }

    /// Open a file and move the cursor to a line.
    func jump(to relPath: String, line: Int, column: Int = 0) {
        guard openFile(relPath) != nil else { return }
        // The editor swaps documents asynchronously after activation.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.activePath == relPath else { return }
            self.textView?.goToLine(line, column: column)
        }
    }

    // MARK: Project index

    private func scheduleReindex() {
        reindexWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.reindex() }
        reindexWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
    }

    /// Current content of a project file (open buffer wins over disk).
    func content(of relPath: String) -> String? {
        if let document = documents.first(where: { $0.relPath == relPath }), document.kind == .text { return document.text }
        guard let url = url(for: relPath) else { return nil }
        return try? ProjectFiles.readText(url).text
    }

    /// Rebuild labels, macros, outline and bibliography. Reading and parsing run in the
    /// background; only the open buffers are captured on the main thread.
    func reindex() {
        var openTexts: [String: String] = [:]
        for document in documents where document.kind == .text { openTexts[document.relPath] = document.text }
        reindexGeneration += 1
        let generation = reindexGeneration
        let root = self.root, mainFile = config.mainFile, activePath = self.activePath
        Task { [weak self] in
            let index = await Task.detached(priority: .userInitiated) {
                ProjectIndex.build(root: root, mainFile: mainFile, fallbackFile: activePath, openTexts: openTexts)
            }.value
            // A newer reindex may have started meanwhile; only the latest result counts.
            guard let self, self.reindexGeneration == generation else { return }
            self.labels = index.labels
            self.definitions = index.definitions
            self.outline = index.outline
            self.bibEntries = index.bibEntries
        }
    }

    /// Completion candidates for the editor.
    func completions(before: String, location: Int) -> CompletionResult? {
        func result(_ match: String, _ items: [CompletionItem], prefix: String) -> CompletionResult? {
            let lowered = prefix.lowercased()
            var filtered = items.filter { lowered.isEmpty || $0.label.lowercased().hasPrefix(lowered) }
            if filtered.count < 50, !lowered.isEmpty {
                filtered += items.filter { !$0.label.lowercased().hasPrefix(lowered) && $0.label.lowercased().contains(lowered) }
            }
            guard !filtered.isEmpty else { return nil }
            // Hide the popup when the only candidate is exactly what was typed.
            if filtered.count == 1, filtered[0].label == prefix, filtered[0].insert == prefix { return nil }
            return CompletionResult(from: location - (match as NSString).length, items: Array(filtered.prefix(200)))
        }
        func lastGroup(_ pattern: String) -> String? {
            guard let regex = try? NSRegularExpression(pattern: pattern),
                  let groups = regex.groups(in: before) else { return nil }
            return groups[1]
        }

        if let partial = lastGroup(#"\\(?:begin|end)\{([^}]*)$"#) {
            let user = definitions.filter { $0.kind == .environment }
                .map { CompletionItem(label: $0.name, detail: "user-defined", insert: $0.name, kind: .environment) }
            let builtIn = LatexData.environments.map { CompletionItem(label: $0.label, detail: $0.detail, insert: $0.label, kind: .environment) }
            return result(partial, user + builtIn, prefix: partial)
        }
        if let partial = lastGroup(#"\\(?:ref|eqref|autoref|cref|Cref|pageref|vref|nameref)\{([^}]*)$"#) {
            let items = labels.map { CompletionItem(label: $0.key, detail: "\($0.file):\($0.line)", insert: $0.key, kind: .label) }
            return result(partial, items, prefix: partial)
        }
        if let inside = lastGroup(#"\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{([^}]*)$"#) {
            let partial = inside.components(separatedBy: ",").last?.trimmingCharacters(in: .whitespaces) ?? ""
            let items = bibEntries.map { CompletionItem(label: $0.key, detail: String($0.summary.prefix(80)), insert: $0.key, kind: .citation) }
            return result(partial, items, prefix: partial)
        }
        if let partial = lastGroup(#"\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{(?:[^}]*,)?([^},]*)$"#) {
            let items = LatexData.packages.map { CompletionItem(label: $0, detail: "package", insert: $0, kind: .package) }
            return result(partial, items, prefix: partial)
        }
        if let partial = lastGroup(#"\\(?:input|include|subfile|includegraphics|addbibresource|bibliography)(?:\[[^\]]*\])?\{([^}]*)$"#) {
            let graphics = before.range(of: #"\\includegraphics(?:\[[^\]]*\])?\{[^}]*$"#, options: .regularExpression) != nil
            let bib = before.range(of: #"\\(?:addbibresource|bibliography)\{[^}]*$"#, options: .regularExpression) != nil
            let files = ProjectFiles.collectFiles(root: root) { name in
                let ext = (name as NSString).pathExtension.lowercased()
                if graphics { return FileKind.imageExtensions.contains(ext) || ext == "pdf" }
                if bib { return ext == "bib" }
                return ext == "tex"
            }
            let items = files.map { path -> CompletionItem in
                let label = bib && before.contains("\\bibliography{") ? (path as NSString).deletingPathExtension
                    : (path.hasSuffix(".tex") ? String(path.dropLast(4)) : path)
                return CompletionItem(label: label, detail: path, insert: label, kind: .file)
            }
            return result(partial, items, prefix: partial)
        }
        if let command = lastGroup(#"(\\[a-zA-Z]*)$"#) {
            // A bare backslash only completes once a letter follows.
            guard command.count >= 2 else { return nil }
            let user = definitions.filter { $0.kind != .environment }.map { definition -> CompletionItem in
                let args = definition.argCount > 0 ? (1...definition.argCount).map { "{${\($0)}}" }.joined() : ""
                return CompletionItem(label: "\\" + definition.name,
                                      detail: "user-defined" + (definition.argCount > 0 ? ", \(definition.argCount) arg\(definition.argCount == 1 ? "" : "s")" : ""),
                                      insert: "\\" + definition.name + args, kind: .user)
            }
            let builtIn = LatexData.commands.map {
                CompletionItem(label: $0.label, detail: $0.detail, insert: $0.apply ?? $0.label, kind: .command)
            }
            return result(command, user + builtIn, prefix: command)
        }
        return nil
    }

    // MARK: History

    func dirtyOverrides() -> [String: String] {
        var result: [String: String] = [:]
        for document in documents where document.isDirty && document.kind == .text { result[document.relPath] = document.text }
        return result
    }

    /// Snapshot synchronously — use before the app itself rewrites files, so the
    /// snapshot is guaranteed to hold the state before the change.
    func takeSnapshotNow(reason: String, label: String? = nil) {
        HistoryStore.create(root: root, reason: reason, label: label, overrides: dirtyOverrides())
    }

    func takeSnapshot(reason: String, label: String? = nil) {
        let root = self.root
        let overrides = dirtyOverrides()
        Task.detached(priority: .utility) {
            HistoryStore.create(root: root, reason: reason, label: label, overrides: overrides)
        }
    }

    /// Reload open, unmodified buffers after the app itself rewrote files (restore, replace all).
    func reloadOpenDocuments(_ relPaths: [String]) {
        for document in documents where relPaths.contains(document.relPath) {
            guard let url = url(for: document.relPath), let file = try? ProjectFiles.readText(url) else { continue }
            document.format = file.format
            document.reload(text: file.text)
        }
        reindex()
    }
}

/// Project index (labels, macros, outline, bibliography), built off the main thread.
nonisolated struct ProjectIndex {
    var labels: [LabelInfo] = []
    var definitions: [DefinitionEntry] = []
    var outline: [SectionNode] = []
    var bibEntries: [BibEntry] = []

    /// `openTexts` (relPath → text) overrides the disk content of open tabs.
    static func build(root: URL, mainFile: String, fallbackFile: String?, openTexts: [String: String]) -> ProjectIndex {
        func content(_ relPath: String) -> String? {
            if let text = openTexts[relPath] { return text }
            guard let url = ProjectFiles.resolve(root: root, relPath) else { return nil }
            return try? ProjectFiles.readText(url).text
        }
        var index = ProjectIndex()
        let texFiles = ProjectFiles.collectFiles(root: root) { ["tex", "ltx", "sty", "cls"].contains(($0 as NSString).pathExtension.lowercased()) }
        var definitions = Set<DefinitionEntry>()
        var structures: [String: DocumentStructure] = [:]
        for file in texFiles {
            guard let text = content(file) else { continue }
            let structure = LatexStructure.parse(text)
            structures[file] = structure
            for reference in structure.references where reference.kind == .label {
                index.labels.append(LabelInfo(key: reference.key, file: file, line: reference.line))
            }
            definitions.formUnion(structure.definitions)
        }
        index.definitions = Array(definitions)

        // Outline in document order, following \input / \include from the main file.
        var visited = Set<String>()
        func resolveInput(_ key: String, from file: String) -> String? {
            var target = key
            if (target as NSString).pathExtension.isEmpty { target += ".tex" }
            let dir = (file as NSString).deletingLastPathComponent
            let candidates = [target, dir.isEmpty ? target : "\(dir)/\(target)"]
                .map { ($0 as NSString).standardizingPath }
            return candidates.first { structures[$0] != nil }
        }
        func visit(_ file: String) {
            guard !visited.contains(file), let structure = structures[file] else { return }
            visited.insert(file)
            let inputs = structure.references.filter { $0.kind == .input }
            var sectionIndex = 0, inputIndex = 0
            while sectionIndex < structure.sections.count || inputIndex < inputs.count {
                let nextSection = sectionIndex < structure.sections.count ? structure.sections[sectionIndex].position : Int.max
                let nextInput = inputIndex < inputs.count ? inputs[inputIndex].position : Int.max
                if nextSection < nextInput {
                    var section = structure.sections[sectionIndex]
                    section.file = file
                    index.outline.append(section)
                    sectionIndex += 1
                } else {
                    if let target = resolveInput(inputs[inputIndex].key, from: file) { visit(target) }
                    inputIndex += 1
                }
            }
        }
        if !mainFile.isEmpty { visit(mainFile) }
        if index.outline.isEmpty, let file = fallbackFile, structures[file] != nil { visit(file) }

        for file in ProjectFiles.collectFiles(root: root, filter: { $0.lowercased().hasSuffix(".bib") }) {
            if let text = content(file) { index.bibEntries += BibParser.parse(text, file: file) }
        }
        return index
    }
}
