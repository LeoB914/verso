import PDFKit
import SwiftUI

struct WorkspaceView: View {
    @Bindable var workspace: Workspace
    private let settings = AppSettings.shared
    private var model: AppModel { AppModel.shared }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                SidebarRail(workspace: workspace)
                Divider()
                PaneLayout(workspace: workspace)
            }
            Divider()
            StatusBar(workspace: workspace)
        }
        .navigationTitle(workspace.name)
        .toolbar { toolbar }
        .sheet(item: $workspace.palette) { mode in CommandPalette(workspace: workspace, mode: mode) }
        .sheet(isPresented: $workspace.showHistory) { HistorySheet(workspace: workspace) }
        .sheet(isPresented: $workspace.showWordCount) { WordCountSheet(workspace: workspace) }
        .sheet(isPresented: $workspace.showTableDialog) { TableSheet(workspace: workspace) }
        .sheet(isPresented: $workspace.showCitePicker) { CitePickerSheet(workspace: workspace) }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willResignActiveNotification)) { _ in
            workspace.saveAll()
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button {
                model.closeProject()
            } label: {
                Label("Overview", systemImage: "house")
            }
            .labelStyle(.titleAndIcon)
            .help("Save all files and return to the project overview")
        }
        ToolbarItem(placement: .navigation) {
            HStack(spacing: 7) {
                AppLogo(size: 20)
                Text(workspace.name + (workspace.activeDocument?.isDirty == true ? " •" : ""))
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
            }
            .fixedSize()
            .padding(.horizontal, 8)
        }
        ToolbarItem(placement: .primaryAction) {
            Picker("Compiler", selection: Binding(get: { workspace.config.compiler }, set: { workspace.setCompiler($0) })) {
                ForEach(Compiler.allCases) { Text($0.displayName).tag($0) }
            }
            .pickerStyle(.menu)
            .fixedSize()
            .padding(.horizontal, 4)
            .help("TeX engine used by latexmk")
        }
        ToolbarItem(placement: .primaryAction) {
            Toggle(isOn: Binding(get: { workspace.config.autoCompile }, set: { workspace.setAutoCompile($0) })) {
                Label("Auto", systemImage: "bolt")
            }
            .toggleStyle(.button)
            .labelStyle(.titleAndIcon)
            .help("Compile automatically after you stop typing")
        }
        if workspace.compileState != .idle {
            ToolbarItem(placement: .primaryAction) {
                CompileStatusView(state: workspace.compileState)
                    .fixedSize()
                    .padding(.horizontal, 8)
            }
        }
        ToolbarItem(placement: .primaryAction) {
            if workspace.compileState.isCompiling {
                Button { workspace.cancelCompile() } label: { Label("Cancel", systemImage: "stop.fill") }
                    .labelStyle(.titleAndIcon)
                    .help("Cancel compilation (⌘.)")
            } else {
                Menu {
                    Button("Compile") { Task { await workspace.compile() } }
                    Button("Recompile from Scratch (clears the build directory)") { workspace.cleanBuild() }
                    Divider()
                    Button("Show Build Folder in Finder") {
                        NSWorkspace.shared.activateFileViewerSelecting([workspace.buildDirectory])
                    }
                } label: {
                    Label("Compile", systemImage: "play.fill")
                } primaryAction: {
                    Task { await workspace.compile() }
                }
                .menuStyle(.button)
                .buttonStyle(.borderedProminent)
                .labelStyle(.titleAndIcon)
                .fixedSize()
                .help("Compile the document (⌘↩)")
            }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button { workspace.showHistory = true } label: { Label("History", systemImage: "clock.arrow.circlepath") }
                .help("Version History (⇧⌘H)")
            Button { workspace.pdfVisible.toggle() } label: { Label("PDF", systemImage: "sidebar.right") }
                .help("Toggle PDF pane (⇧⌘D)")
        }
    }
}

private struct CompileStatusView: View {
    let state: CompileState

    var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .compiling:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Compiling…").foregroundStyle(.secondary)
            }
            .font(.system(size: 12))
        case .success(let duration):
            Label(String(format: "Compiled in %.1f s", duration), systemImage: "checkmark.circle")
                .labelStyle(.titleAndIcon)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        case .failed(let message):
            Label(message, systemImage: "xmark.octagon")
                .labelStyle(.titleAndIcon)
                .font(.system(size: 12))
                .foregroundStyle(.red)
        case .canceled:
            Text("Compile canceled").font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }
}

// MARK: - Pane layout

/// Sidebar | editor | PDF with draggable dividers; sizes persist across launches.
private struct PaneLayout: View {
    @Bindable var workspace: Workspace
    @AppStorage("sidebarWidth") private var sidebarWidth = 250.0
    @AppStorage("pdfFraction") private var pdfFraction = 0.5

    var body: some View {
        GeometryReader { geometry in
            let total = geometry.size.width
            let sidebar = workspace.sidebarVisible ? min(max(sidebarWidth, 180), 480) : 0
            let remaining = total - sidebar - (workspace.sidebarVisible ? 1 : 0)
            let pdf = workspace.pdfVisible ? min(max(remaining * pdfFraction, 240), max(240, remaining - 300)) : 0
            HStack(spacing: 0) {
                if workspace.sidebarVisible {
                    SidebarPanel(workspace: workspace)
                        .frame(width: sidebar)
                    Splitter(axis: .horizontal, value: $sidebarWidth, range: 180...480)
                }
                EditorColumn(workspace: workspace)
                    .frame(width: max(0, remaining - pdf - (workspace.pdfVisible ? 1 : 0)))
                if workspace.pdfVisible {
                    Splitter(axis: .horizontal, value: Binding(
                        get: { pdf },
                        set: { pdfFraction = min(max($0 / max(remaining, 1), 0.15), 0.85) }),
                             range: 240...max(240, remaining - 300), invert: true)
                    PDFPane(workspace: workspace)
                        .frame(width: pdf)
                }
            }
        }
    }
}

/// 1-pt divider with a wider invisible drag handle.
struct Splitter: View {
    enum Axis { case horizontal, vertical }
    let axis: Axis
    @Binding var value: Double
    let range: ClosedRange<Double>
    /// Dragging right/down shrinks the value (panes after the divider).
    var invert = false
    @State private var start: Double?

    var body: some View {
        Rectangle()
            .fill(Color(nsColor: .separatorColor))
            .frame(width: axis == .horizontal ? 1 : nil, height: axis == .vertical ? 1 : nil)
            .overlay {
                Color.clear
                    .frame(width: axis == .horizontal ? 8 : nil, height: axis == .vertical ? 8 : nil)
                    .contentShape(Rectangle())
                    .onHover { inside in
                        if inside { (axis == .horizontal ? NSCursor.resizeLeftRight : NSCursor.resizeUpDown).push() } else { NSCursor.pop() }
                    }
                    .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                        .onChanged { drag in
                            if start == nil { start = value }
                            let delta = Double(axis == .horizontal ? drag.translation.width : drag.translation.height)
                            value = min(max((start ?? value) + (invert ? -delta : delta), range.lowerBound), range.upperBound)
                        }
                        .onEnded { _ in start = nil })
            }
            .zIndex(1)
    }
}

// MARK: - Editor column

struct EditorColumn: View {
    @Bindable var workspace: Workspace
    @AppStorage("problemsHeight") private var problemsHeight = 190.0

    var body: some View {
        VStack(spacing: 0) {
            TabsBar(workspace: workspace)
            Divider()
            // The editor keeps its position in the hierarchy, so toggling problems never recreates it.
            editorContent
                .frame(maxHeight: .infinity)
            if workspace.problemsVisible {
                Splitter(axis: .vertical, value: $problemsHeight, range: 90...600, invert: true)
                ProblemsPanel(workspace: workspace)
                    .frame(height: min(max(problemsHeight, 90), 600))
            } else {
                ProblemsStrip(workspace: workspace)
            }
        }
    }

    @ViewBuilder
    private var editorContent: some View {
        if let document = workspace.activeDocument {
            switch document.kind {
            case .text:
                VStack(spacing: 0) {
                    FormatToolbar(workspace: workspace)
                    Divider()
                    EditorView(workspace: workspace, document: document, appearance: .current,
                               markers: workspace.markers(for: document.relPath))
                }
            case .image:
                ImagePreview(url: workspace.url(for: document.relPath))
            case .pdf:
                PDFPreview(url: workspace.url(for: document.relPath))
            case .binary:
                Text("This file cannot be displayed.").foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            VStack(spacing: 8) {
                Image(systemName: "doc.text").font(.system(size: 32)).foregroundStyle(.tertiary)
                Text("No file open").font(.headline)
                Text("Pick a file in the sidebar or press ⌘P.").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: EditorTheme.background))
        }
    }
}

private struct ImagePreview: View {
    let url: URL?
    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            if let url, let image = NSImage(contentsOf: url) {
                Image(nsImage: image).padding(20)
            } else {
                Text("Cannot load the image.").foregroundStyle(.secondary).padding(40)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .underPageBackgroundColor))
    }
}

private struct PDFPreview: NSViewRepresentable {
    let url: URL?
    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        if let url { view.document = PDFDocument(url: url) }
        return view
    }
    func updateNSView(_ view: PDFView, context: Context) {
        if view.document?.documentURL != url, let url { view.document = PDFDocument(url: url) }
    }
}

struct TabsBar: View {
    @Bindable var workspace: Workspace

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(workspace.documents) { document in
                    TabItem(document: document, active: document.relPath == workspace.activePath,
                            isMain: document.relPath == workspace.config.mainFile,
                            select: { workspace.activate(document.relPath) },
                            close: { workspace.closeTab(document.relPath) })
                        .contextMenu {
                            Button("Close") { workspace.closeTab(document.relPath) }
                            Button("Close Other Tabs") { workspace.closeOtherTabs(document.relPath) }
                            Divider()
                            Button("Reveal in Finder") { workspace.reveal(document.relPath) }
                            if document.relPath.hasSuffix(".tex") && document.relPath != workspace.config.mainFile {
                                Button("Set as Main File") { workspace.setMainFile(document.relPath) }
                            }
                        }
                }
            }
        }
        .frame(height: 32)
        .background(.background.secondary)
    }
}

private struct TabItem: View {
    let document: EditorDocument
    let active: Bool
    let isMain: Bool
    let select: () -> Void
    let close: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: FileIcon.symbol(for: document.name))
                .font(.system(size: 11))
                .foregroundStyle(FileIcon.color(for: document.name))
            Text(document.name)
                .font(.system(size: 12, weight: active ? .medium : .regular))
                .lineLimit(1)
            ZStack {
                if document.isDirty && !hovering {
                    Circle().fill(.secondary).frame(width: 7, height: 7)
                } else {
                    Button(action: close) {
                        Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                    }
                    .buttonStyle(.borderless)
                    .opacity(hovering || active ? 1 : 0)
                    .help("Close Tab (⌘W)")
                }
            }
            .frame(width: 14)
        }
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .frame(height: 32)
        .background(active ? Color(nsColor: EditorTheme.background) : .clear)
        .overlay(alignment: .bottom) {
            if active { Rectangle().fill(Color.accentColor).frame(height: 2) }
        }
        .overlay(alignment: .trailing) { Divider().frame(height: 18) }
        .contentShape(Rectangle())
        .onTapGesture(perform: select)
        .onHover { hovering = $0 }
        .help(document.relPath + (isMain ? " (main file)" : ""))
    }
}

/// Compact formatting bar above the editor.
struct FormatToolbar: View {
    let workspace: Workspace

    static let fontSizes: [(String, String)] = [
        ("\\tiny", "Tiny"), ("\\scriptsize", "Script"), ("\\footnotesize", "Footnote"), ("\\small", "Small"),
        ("\\normalsize", "Normal"), ("\\large", "Large"), ("\\Large", "Larger"), ("\\LARGE", "Largest"),
        ("\\huge", "Huge"), ("\\Huge", "Hugest"),
    ]
    static let sections: [(String, String)] = [
        ("\\section", "Section"), ("\\subsection", "Subsection"), ("\\subsubsection", "Subsubsection"), ("\\paragraph", "Paragraph"),
    ]

    private func run(_ action: (LatexTextView) -> Void) {
        guard let textView = workspace.textView else { return }
        action(textView)
        textView.window?.makeFirstResponder(textView)
    }

    var body: some View {
        HStack(spacing: 2) {
            Menu {
                ForEach(Self.fontSizes, id: \.0) { command, label in
                    Button(label) { run { $0.applyFontSize(command) } }
                }
            } label: { Label("Size", systemImage: "textformat.size") }
                .help("Font size")
                .fixedSize()
            Menu {
                ForEach(Self.sections, id: \.0) { command, label in
                    Button(label) { run { $0.insertSection(command) } }
                }
            } label: { Label("Section", systemImage: "number") }
                .help("Insert section heading")
                .fixedSize()
            divider
            iconButton("bold", "Bold (⌘B)") { run { $0.wrapSelection(command: "\\textbf") } }
            iconButton("italic", "Italic (⌘I)") { run { $0.wrapSelection(command: "\\textit") } }
            iconButton("function", "Display math block (⇧⌘M)") { run { $0.insertMathBlock() } }
            divider
            iconButton("photo", "Insert image") { workspace.insertImage() }
            iconButton("tablecells", "Insert table") { workspace.showTableDialog = true }
            iconButton("quote.opening", "Insert citation (⇧⌘C)") { workspace.showCitePicker = true }
            divider
            iconButton("arrow.uturn.backward", "Undo (⌘Z)") { run { $0.undoManager?.undo() } }
            iconButton("arrow.uturn.forward", "Redo (⇧⌘Z)") { run { $0.undoManager?.redo() } }
            Spacer()
            iconButton("text.page.badge.magnifyingglass", "Jump to PDF (⌥⌘→)") { workspace.syncToPDF() }
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.borderless)
        .labelStyle(.titleAndIcon)
        .font(.system(size: 12))
        .padding(.horizontal, 8)
        .frame(height: 30)
        .background(Color(nsColor: EditorTheme.background))
    }

    private var divider: some View {
        Divider().frame(height: 14).padding(.horizontal, 4)
    }

    private func iconButton(_ symbol: String, _ help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).frame(width: 22, height: 22)
        }
        .help(help)
    }
}

// MARK: - Problems

private struct ProblemsStrip: View {
    let workspace: Workspace

    var body: some View {
        let errors = workspace.logEntries.filter { $0.level == .error }.count
        let warnings = workspace.logEntries.filter { $0.level == .warning }.count
        Button { workspace.problemsVisible = true } label: {
            HStack(spacing: 10) {
                Image(systemName: "chevron.up").font(.system(size: 9, weight: .bold))
                Text(workspace.logEntries.isEmpty ? "No problems" : "\(workspace.logEntries.count) problem\(workspace.logEntries.count == 1 ? "" : "s")")
                Label("\(errors)", systemImage: "xmark.octagon").foregroundStyle(errors > 0 ? .red : .secondary)
                Label("\(warnings)", systemImage: "exclamationmark.triangle").foregroundStyle(warnings > 0 ? .orange : .secondary)
                Spacer()
            }
            .font(.system(size: 11))
            .padding(.horizontal, 10)
            .frame(height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(.background.secondary)
        .overlay(alignment: .top) { Divider() }
    }
}

struct ProblemsPanel: View {
    @Bindable var workspace: Workspace
    @State private var levels: Set<LogLevel> = Set(LogLevel.allCases)
    @State private var filter = ""
    @State private var selection: LogEntry.ID?
    @State private var showRawLog = false

    private var entries: [LogEntry] {
        workspace.logEntries.filter { entry in
            levels.contains(entry.level) && (filter.isEmpty || entry.message.localizedCaseInsensitiveContains(filter)
                                            || (entry.file ?? "").localizedCaseInsensitiveContains(filter))
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button { workspace.problemsVisible = false } label: { Image(systemName: "chevron.down") }
                    .buttonStyle(.borderless)
                    .help("Hide problems (⇧⌘J)")
                Text(workspace.logEntries.isEmpty ? "No problems" : "\(workspace.logEntries.count) problems")
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
                    .fixedSize()
                ForEach(LogLevel.allCases, id: \.self) { level in
                    let count = workspace.logEntries.filter { $0.level == level }.count
                    Toggle(isOn: Binding(get: { levels.contains(level) }, set: { on in
                        if on { levels.insert(level) } else { levels.remove(level) }
                    })) {
                        Label("\(count)", systemImage: level == .error ? "xmark.octagon" : level == .warning ? "exclamationmark.triangle" : "info.circle")
                            .labelStyle(.titleAndIcon)
                    }
                    .toggleStyle(.button)
                    .controlSize(.small)
                    .help("Show \(level.label.lowercased())s")
                }
                TextField("Filter…", text: $filter)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.small)
                    .frame(maxWidth: 180)
                Spacer()
                Toggle(isOn: $showRawLog) { Image(systemName: "terminal") }
                    .toggleStyle(.button)
                    .controlSize(.small)
                    .help("Show the raw latexmk output")
                Button { 
                    let base = ((workspace.config.mainFile as NSString).lastPathComponent as NSString).deletingPathExtension
                    let log = workspace.buildDirectory.appendingPathComponent(base + ".log")
                    if FileManager.default.fileExists(atPath: log.path) { NSWorkspace.shared.open(log) }
                } label: { Image(systemName: "doc.text.magnifyingglass") }
                .controlSize(.small)
                .help("Open the .log file")
            }
            .font(.system(size: 11))
            .padding(.horizontal, 8)
            .frame(height: 28)
            Divider()
            if showRawLog {
                ScrollView {
                    Text(workspace.compileOutput.isEmpty ? "No compiler output yet." : workspace.compileOutput)
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                }
            } else if entries.isEmpty {
                Text(workspace.logEntries.isEmpty ? "No problems — compile to check your document." : "No problems match the filter.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(entries, selection: $selection) { entry in
                    ProblemRow(entry: entry)
                        .tag(entry.id)
                        .contentShape(Rectangle())
                        .onTapGesture { open(entry) }
                }
                .listStyle(.plain)
            }
        }
        .background(.background)
    }

    private func open(_ entry: LogEntry) {
        selection = entry.id
        guard let file = entry.file else { return }
        workspace.jump(to: file, line: entry.line ?? 1)
    }
}

private struct ProblemRow: View {
    let entry: LogEntry
    @State private var expanded = false

    var body: some View {
        let help = ErrorHelpDatabase.match(entry.message)
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: entry.level == .error ? "xmark.octagon.fill" : entry.level == .warning ? "exclamationmark.triangle.fill" : "info.circle.fill")
                    .foregroundStyle(entry.level == .error ? .red : entry.level == .warning ? .orange : .blue)
                    .font(.system(size: 11))
                Text(entry.message).font(.system(size: 12)).lineLimit(expanded ? nil : 2)
                Spacer()
                if let file = entry.file {
                    Text(entry.line.map { "\(file):\($0)" } ?? file)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                if help != nil || entry.rawExcerpt != nil {
                    Button { expanded.toggle() } label: { Image(systemName: expanded ? "chevron.up" : "questionmark.circle") }
                        .buttonStyle(.borderless)
                        .help("Explain this problem")
                }
            }
            if expanded {
                if let help {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(help.title).font(.system(size: 12, weight: .semibold))
                        Text(help.explanation).font(.system(size: 11))
                        Text("Fix: " + help.fix).font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    .padding(8)
                    .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
                }
                if let excerpt = entry.rawExcerpt {
                    Text(excerpt)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Status bar

struct StatusBar: View {
    let workspace: Workspace
    private var model: AppModel { AppModel.shared }

    var body: some View {
        HStack(spacing: 14) {
            if workspace.activeDocument?.kind == .text {
                Text("Ln \(workspace.cursorLine), Col \(workspace.cursorColumn)")
            }
            if let count = workspace.wordCount {
                Button("\(count.words) words") { workspace.showWordCount = true }
                    .buttonStyle(.plain)
                    .help("Word count details (texcount)")
            }
            if model.texDetected {
                if let latexmk = model.tex.tools["latexmk"] {
                    Text("TeX: " + (latexmk.version ?? "latexmk")).lineLimit(1)
                } else {
                    Button { model.showTexMissing() } label: {
                        Label("TeX not found", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer()
            if let path = workspace.activePath {
                Text(path).lineLimit(1).truncationMode(.middle)
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .frame(height: 24)
        .background(.background.secondary)
    }
}

/// File-type icons shared by tabs and the file tree.
enum FileIcon {
    static func symbol(for name: String) -> String {
        switch (name as NSString).pathExtension.lowercased() {
        case "tex", "ltx": "doc.text"
        case "bib": "book.closed"
        case "sty", "cls": "gearshape"
        case "pdf": "doc.richtext"
        case "png", "jpg", "jpeg", "gif", "tif", "tiff", "svg", "eps", "webp", "heic": "photo"
        case "md", "txt": "doc.plaintext"
        case "zip": "doc.zipper"
        default: "doc"
        }
    }

    static func color(for name: String) -> Color {
        switch (name as NSString).pathExtension.lowercased() {
        case "tex", "ltx": .accentColor
        case "bib": .orange
        case "pdf": .red
        case "png", "jpg", "jpeg", "gif", "tif", "tiff", "svg", "eps", "webp", "heic": .purple
        default: .secondary
        }
    }
}
