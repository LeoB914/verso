import SwiftUI

// MARK: - Command palette / Go to file / Go to section

struct PaletteItem: Identifiable {
    var id: String
    var title: String
    var detail: String
    var symbol: String
    var action: () -> Void
}

struct CommandPalette: View {
    let workspace: Workspace
    let mode: PaletteMode
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var selected = 0
    @FocusState private var focused: Bool

    private var items: [PaletteItem] {
        switch mode {
        case .files:
            return ProjectFiles.collectFiles(root: workspace.root) { _ in true }.map { path in
                PaletteItem(id: path, title: (path as NSString).lastPathComponent, detail: path, symbol: FileIcon.symbol(for: path)) {
                    workspace.openFile(path)
                }
            }
        case .sections:
            return workspace.outline.map { section in
                PaletteItem(id: section.id, title: String(repeating: "  ", count: max(0, section.level - 1)) + section.title,
                            detail: "\(section.file):\(section.line)", symbol: "number") {
                    workspace.jump(to: section.file, line: section.line)
                }
            }
        case .commands:
            return commands()
        }
    }

    private var filtered: [PaletteItem] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return items }
        return items
            .compactMap { item -> (PaletteItem, Int)? in
                let haystack = (item.title + " " + item.detail).lowercased()
                if let score = fuzzyScore(q, haystack) { return (item, score) }
                return nil
            }
            .sorted { $0.1 > $1.1 }
            .map(\.0)
    }

    /// Subsequence match; consecutive and word-start hits score higher.
    private func fuzzyScore(_ query: String, _ text: String) -> Int? {
        if text.contains(query) { return 1000 - text.count }
        var score = 0
        var index = text.startIndex
        var previousMatched = false
        for char in query {
            guard let found = text[index...].firstIndex(of: char) else { return nil }
            score += previousMatched && found == index ? 5 : 1
            if found == text.startIndex || " /_-.".contains(text[text.index(before: found)]) { score += 3 }
            previousMatched = true
            index = text.index(after: found)
        }
        return score
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: mode == .commands ? "command" : mode == .files ? "doc.text.magnifyingglass" : "number")
                    .foregroundStyle(.secondary)
                TextField(mode == .commands ? "Type a command" : mode == .files ? "Go to file" : "Go to section", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15))
                    .focused($focused)
                    .onSubmit(runSelected)
                    .onKeyPress(.downArrow) { selected = min(selected + 1, max(0, filtered.count - 1)); return .handled }
                    .onKeyPress(.upArrow) { selected = max(selected - 1, 0); return .handled }
                    .onKeyPress(.escape) { dismiss(); return .handled }
            }
            .padding(12)
            Divider()
            ScrollViewReader { proxy in
                List(Array(filtered.prefix(200).enumerated()), id: \.element.id) { index, item in
                    HStack {
                        Image(systemName: item.symbol).frame(width: 18).foregroundStyle(.secondary)
                        Text(item.title).lineLimit(1)
                        Spacer()
                        Text(item.detail).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .padding(.vertical, 2)
                    .listRowBackground(index == selected ? Color.accentColor.opacity(0.2) : Color.clear)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        selected = index
                        runSelected()
                    }
                    .id(index)
                }
                .listStyle(.plain)
                .onChange(of: selected) { _, value in proxy.scrollTo(value) }
            }
        }
        .frame(width: 600, height: 420)
        .onAppear { focused = true }
        .onChange(of: query) { selected = 0 }
    }

    private func runSelected() {
        let list = filtered
        guard selected < list.count else { return }
        let item = list[selected]
        dismiss()
        DispatchQueue.main.async { item.action() }
    }

    private func commands() -> [PaletteItem] {
        let model = AppModel.shared
        func editor(_ action: @escaping (LatexTextView) -> Void) -> () -> Void {
            { [weak workspace] in
                guard let textView = workspace?.textView else { return }
                textView.window?.makeFirstResponder(textView)
                action(textView)
            }
        }
        var list: [PaletteItem] = [
            PaletteItem(id: "compile", title: "Compile", detail: "⌘↩", symbol: "play") { Task { await workspace.compile() } },
            PaletteItem(id: "compile.fresh", title: "Recompile from Scratch", detail: "⌥⌘↩", symbol: "arrow.clockwise") { workspace.cleanBuild() },
            PaletteItem(id: "compile.auto", title: "Toggle Auto Compile", detail: workspace.config.autoCompile ? "On" : "Off", symbol: "bolt") {
                workspace.setAutoCompile(!workspace.config.autoCompile)
            },
            PaletteItem(id: "synctex", title: "Jump to PDF (SyncTeX)", detail: "⌥⌘→", symbol: "arrow.right.doc.on.clipboard") { workspace.syncToPDF() },
            PaletteItem(id: "save", title: "Save", detail: "⌘S", symbol: "square.and.arrow.down") { workspace.saveActive() },
            PaletteItem(id: "saveAll", title: "Save All", detail: "⇧⌘S", symbol: "square.and.arrow.down.on.square") { workspace.saveAll() },
            PaletteItem(id: "goFile", title: "Go to File…", detail: "⌘P", symbol: "doc.text.magnifyingglass") { workspace.palette = .files },
            PaletteItem(id: "goSection", title: "Go to Section…", detail: "⌘R", symbol: "number") { workspace.palette = .sections },
            PaletteItem(id: "search", title: "Search in Project", detail: "⇧⌘F", symbol: "magnifyingglass") {
                workspace.sidebarVisible = true
                workspace.sidebarTab = .search
            },
            PaletteItem(id: "sidebar", title: "Toggle Sidebar", detail: "⇧⌘E", symbol: "sidebar.left") { workspace.sidebarVisible.toggle() },
            PaletteItem(id: "pdf", title: "Toggle PDF Pane", detail: "⇧⌘D", symbol: "sidebar.right") { workspace.pdfVisible.toggle() },
            PaletteItem(id: "problems", title: "Toggle Problems Panel", detail: "⇧⌘J", symbol: "exclamationmark.triangle") { workspace.problemsVisible.toggle() },
            PaletteItem(id: "bold", title: "Bold", detail: "⌘B", symbol: "bold") { editor { $0.wrapSelection(command: "\\textbf") }() },
            PaletteItem(id: "italic", title: "Italic", detail: "⌘I", symbol: "italic") { editor { $0.wrapSelection(command: "\\textit") }() },
            PaletteItem(id: "comment", title: "Toggle Comment", detail: "⌘/", symbol: "percent") { editor { $0.toggleComment() }() },
            PaletteItem(id: "math", title: "Insert Math Block", detail: "⇧⌘M", symbol: "function") { editor { $0.insertMathBlock() }() },
            PaletteItem(id: "cite", title: "Insert Citation…", detail: "⇧⌘C", symbol: "quote.opening") { workspace.showCitePicker = true },
            PaletteItem(id: "table", title: "Insert Table…", detail: "", symbol: "tablecells") { workspace.showTableDialog = true },
            PaletteItem(id: "image", title: "Insert Image…", detail: "", symbol: "photo") { workspace.insertImage() },
            PaletteItem(id: "symbols", title: "Symbol Palette", detail: "", symbol: "sum") {
                workspace.sidebarVisible = true
                workspace.sidebarTab = .symbols
            },
            PaletteItem(id: "history", title: "Version History", detail: "⇧⌘H", symbol: "clock.arrow.circlepath") { workspace.showHistory = true },
            PaletteItem(id: "label", title: "Save Labelled Version…", detail: "", symbol: "bookmark") {
                if let label = Prompt.text(title: "Save Labelled Version", message: "Label for this version:", confirm: "Save") {
                    workspace.saveAll()
                    workspace.takeSnapshot(reason: "Labelled version", label: label)
                }
            },
            PaletteItem(id: "wordcount", title: "Word Count Details…", detail: "", symbol: "textformat.123") { workspace.showWordCount = true },
            PaletteItem(id: "zip", title: "Export Project as ZIP…", detail: "", symbol: "doc.zipper") { model.exportZip(workspace.root) },
            PaletteItem(id: "template", title: "Save Project as Template…", detail: "", symbol: "square.on.square") { model.saveAsTemplate(workspace.root) },
            PaletteItem(id: "reveal", title: "Reveal Project in Finder", detail: "", symbol: "folder") {
                NSWorkspace.shared.activateFileViewerSelecting([workspace.root])
            },
            PaletteItem(id: "overview", title: "Save All and Show Overview", detail: "", symbol: "house") { model.closeProject() },
            PaletteItem(id: "settings", title: "Settings…", detail: "⌘,", symbol: "gearshape") {
                NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
            },
        ]
        for compiler in Compiler.allCases {
            list.append(PaletteItem(id: "compiler.\(compiler.rawValue)", title: "Use \(compiler.displayName)",
                                    detail: workspace.config.compiler == compiler ? "current" : "", symbol: "gearshape.2") {
                workspace.setCompiler(compiler)
            })
        }
        return list
    }
}

// MARK: - Version history

struct HistorySheet: View {
    let workspace: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var snapshots: [Snapshot] = []
    @State private var selected: Snapshot?
    @State private var contents: [String: String] = [:]
    @State private var selectedFile: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Version History").font(.headline)
                Text("Snapshots are taken on open, after each successful compile and every 5 minutes while you work.")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Save Labelled Version…") {
                    if let label = Prompt.text(title: "Save Labelled Version", message: "Label for this version:", confirm: "Save") {
                        workspace.saveAll()
                        HistoryStore.create(root: workspace.root, reason: "Labelled version", label: label, overrides: workspace.dirtyOverrides())
                        load()
                    }
                }
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(12)
            Divider()
            HSplitView {
                List(snapshots.reversed(), selection: Binding(get: { selected?.id }, set: { id in
                    selected = snapshots.first { $0.id == id }
                })) { snapshot in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            if let label = snapshot.label {
                                Image(systemName: "bookmark.fill").foregroundStyle(Color.accentColor).font(.system(size: 10))
                                Text(label).fontWeight(.semibold)
                            } else {
                                Text(snapshot.reason)
                            }
                        }
                        .font(.system(size: 12))
                        Text(snapshot.date.formatted(date: .abbreviated, time: .shortened))
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                    .tag(snapshot.id)
                }
                .frame(minWidth: 220, idealWidth: 240, maxWidth: 320)

                VStack(spacing: 0) {
                    if let selected {
                        HStack {
                            Picker("File", selection: $selectedFile) {
                                ForEach(contents.keys.sorted(), id: \.self) { file in
                                    Text(file + changeBadge(file)).tag(Optional(file))
                                }
                            }
                            .frame(maxWidth: 360)
                            Spacer()
                            Button("Restore This File") {
                                guard let file = selectedFile else { return }
                                restore(selected, only: file)
                            }
                            .disabled(selectedFile == nil)
                            Button("Restore Whole Project") { restore(selected, only: nil) }
                        }
                        .padding(8)
                        Divider()
                        if let file = selectedFile {
                            SnapshotDiff(old: contents[file] ?? "", new: workspace.content(of: file) ?? "")
                        }
                    } else {
                        Text(snapshots.isEmpty ? "No snapshots yet." : "Select a snapshot to compare it with the current files.")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(minWidth: 480)
            }
        }
        .frame(width: 980, height: 640)
        .onAppear(perform: load)
        .onChange(of: selected) { _, snapshot in
            guard let snapshot else { contents = [:]; return }
            contents = HistoryStore.contents(root: workspace.root, snapshot: snapshot)
            let changed = contents.keys.sorted().first { (workspace.content(of: $0) ?? "") != contents[$0] }
            selectedFile = changed ?? (contents[workspace.activePath ?? ""] != nil ? workspace.activePath : contents.keys.sorted().first)
        }
    }

    private func changeBadge(_ file: String) -> String {
        guard let old = contents[file] else { return "" }
        let current = workspace.content(of: file) ?? ""
        if old == current { return "" }
        let stats = LineDiff.stats(old, current)
        return "  (+\(stats.added) −\(stats.removed))"
    }

    private func load() {
        snapshots = HistoryStore.list(ProjectRegistry.canonical(workspace.root.path))
    }

    private func restore(_ snapshot: Snapshot, only file: String?) {
        let what = file.map { "“\($0)”" } ?? "the whole project"
        guard Prompt.confirm("Restore \(what) to the version from \(snapshot.date.formatted(date: .abbreviated, time: .shortened))?",
                             message: "The current state is saved as a snapshot first, so this can be undone.", confirm: "Restore") else { return }
        let overrides = workspace.dirtyOverrides()
        workspace.saveAll()
        let restored = HistoryStore.restore(root: workspace.root, snapshot: snapshot, only: file, overrides: overrides)
        workspace.reloadOpenDocuments(restored)
        workspace.refreshTree()
        load()
    }
}

private struct SnapshotDiff: View {
    let old: String
    let new: String

    var body: some View {
        let ops = LineDiff.diff(old, new)
        if old == new {
            Text("This file is unchanged since the snapshot.")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView([.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(ops.enumerated()), id: \.offset) { _, op in
                        switch op {
                        case .same(let line): row(" ", line, .clear, .primary)
                        case .removed(let line): row("−", line, Color.red.opacity(0.14), .primary)
                        case .added(let line): row("+", line, Color.green.opacity(0.16), .primary)
                        }
                    }
                }
                .padding(.vertical, 6)
                .textSelection(.enabled)
            }
            .background(Color(nsColor: .textBackgroundColor))
            .overlay(alignment: .topTrailing) {
                Text("− snapshot   + current").font(.caption).foregroundStyle(.secondary).padding(6)
            }
        }
    }

    private func row(_ marker: String, _ line: String, _ background: Color, _ color: Color) -> some View {
        HStack(spacing: 6) {
            Text(marker).foregroundStyle(.secondary).frame(width: 12)
            Text(line.isEmpty ? " " : line).foregroundStyle(color)
        }
        .font(.system(size: 11.5, design: .monospaced))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .background(background)
    }
}

// MARK: - Word count

struct WordCountSheet: View {
    let workspace: Workspace
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Word Count").font(.headline)
            if let count = workspace.wordCount {
                Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 6) {
                    GridRow {
                        Text("File").fontWeight(.semibold)
                        Text("Words").fontWeight(.semibold)
                        Text("Headings").fontWeight(.semibold)
                        Text("Captions").fontWeight(.semibold)
                    }
                    Divider()
                    ForEach(count.files) { file in
                        GridRow {
                            Text(file.file)
                            Text("\(file.words)").monospacedDigit()
                            Text("\(file.headers)").monospacedDigit()
                            Text("\(file.captions)").monospacedDigit()
                        }
                    }
                    Divider()
                    GridRow {
                        Text("Total").fontWeight(.semibold)
                        Text("\(count.words)").monospacedDigit().fontWeight(.semibold)
                        Text("\(count.headers)").monospacedDigit()
                        Text("\(count.captions)").monospacedDigit()
                    }
                }
                .font(.system(size: 12))
            } else if AppModel.shared.tex.tools["texcount"] == nil {
                Text("texcount was not found in your TeX installation.").foregroundStyle(.secondary)
            } else {
                Text("No word count yet — compile the document first.").foregroundStyle(.secondary)
            }
            HStack {
                Button("Refresh") { workspace.refreshWordCount() }
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}

// MARK: - Table

struct TableSheet: View {
    let workspace: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var rows = 3
    @State private var columns = 3
    @State private var header = true
    @State private var booktabs = true
    @State private var floating = true
    @State private var alignment = "l"
    @State private var caption = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Insert Table").font(.headline)
            Form {
                Stepper("Rows: \(rows)", value: $rows, in: 1...50)
                Stepper("Columns: \(columns)", value: $columns, in: 1...20)
                Picker("Alignment", selection: $alignment) {
                    Text("Left").tag("l")
                    Text("Center").tag("c")
                    Text("Right").tag("r")
                }
                .pickerStyle(.segmented)
                Toggle("Header row", isOn: $header)
                Toggle("Booktabs rules (\\toprule, \\midrule, \\bottomrule)", isOn: $booktabs)
                Toggle("Floating table environment with caption", isOn: $floating)
                if floating { TextField("Caption", text: $caption) }
            }
            ScrollView {
                Text(latex).font(.system(size: 11, design: .monospaced)).frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 140)
            .padding(6)
            .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
            if booktabs {
                Text("Requires \\usepackage{booktabs} in the preamble.").font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Insert") {
                    let snippet = latex
                    dismiss()
                    DispatchQueue.main.async {
                        guard let textView = workspace.textView else { return }
                        textView.window?.makeFirstResponder(textView)
                        textView.insertSnippet(snippet)
                    }
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 480)
    }

    private var latex: String {
        let spec = String(repeating: alignment, count: columns)
        var lines: [String] = []
        let indent = floating ? "  " : ""
        if floating { lines += ["\\begin{table}[ht]", "  \\centering"] }
        lines.append("\(indent)\\begin{tabular}{\(spec)}")
        lines.append(indent + "  " + (booktabs ? "\\toprule" : "\\hline"))
        var stop = 1
        for row in 0..<rows {
            let cells = (0..<columns).map { column -> String in
                defer { stop += 1 }
                let placeholder = row == 0 && header ? "Header \(column + 1)" : ""
                return "${\(stop):\(placeholder)}"
            }
            lines.append(indent + "  " + cells.joined(separator: " & ") + " \\\\")
            if row == 0 && header { lines.append(indent + "  " + (booktabs ? "\\midrule" : "\\hline")) }
        }
        lines.append(indent + "  " + (booktabs ? "\\bottomrule" : "\\hline"))
        lines.append("\(indent)\\end{tabular}")
        if floating {
            lines.append("  \\caption{${\(stop):\(caption.isEmpty ? "Caption" : caption)}}")
            lines.append("  \\label{tab:${\(stop + 1):label}}")
            lines.append("\\end{table}")
        }
        return lines.joined(separator: "\n") + "\n"
    }
}

// MARK: - Settings

struct SettingsView: View {
    @Bindable private var settings = AppSettings.shared
    @Bindable private var model = AppModel.shared

    var body: some View {
        TabView {
            Form {
                Toggle("Save automatically", isOn: $settings.autosaveEnabled)
                Stepper("Autosave delay: \(settings.autosaveDelayMs) ms", value: $settings.autosaveDelayMs, in: 200...30_000, step: 100)
                    .disabled(!settings.autosaveEnabled)
                Toggle("Confirm before moving files to the Trash", isOn: $settings.confirmBeforeDelete)
                LabeledContent("Default project folder") {
                    HStack {
                        Text((settings.effectiveProjectDirectory.path as NSString).abbreviatingWithTildeInPath)
                            .lineLimit(1).truncationMode(.middle).foregroundStyle(.secondary)
                        Button("Choose…") {
                            let panel = NSOpenPanel()
                            panel.canChooseDirectories = true
                            panel.canChooseFiles = false
                            panel.canCreateDirectories = true
                            if panel.runModal() == .OK, let url = panel.url { settings.defaultProjectDir = url.path }
                        }
                    }
                }
                Picker("Appearance", selection: $settings.appTheme) {
                    ForEach(AppTheme.allCases) { Text($0.label).tag($0) }
                }
                Button("Show Welcome Screen Again") {
                    settings.firstRunDone = false
                }
            }
            .formStyle(.grouped)
            .tabItem { Label("General", systemImage: "gearshape") }

            Form {
                Picker("Font", selection: $settings.editorFontName) {
                    Text("System Monospaced (SF Mono)").tag("")
                    ForEach(monospacedFonts, id: \.self) { Text($0).tag($0) }
                }
                Stepper("Font size: \(Int(settings.editorFontSize)) pt", value: $settings.editorFontSize, in: 8...32)
                Stepper(String(format: "Line height: %.1f", settings.editorLineHeight), value: $settings.editorLineHeight, in: 1...3, step: 0.1)
                Stepper("Tab width: \(settings.tabWidth)", value: $settings.tabWidth, in: 2...8)
                Toggle("Wrap long lines", isOn: $settings.softWrap)
                Toggle("Show line numbers", isOn: $settings.lineNumbers)
                Toggle("Highlight the current line", isOn: $settings.highlightActiveLine)
                Toggle("Autocomplete commands, environments, labels and citations", isOn: $settings.autocompleteEnabled)
                Toggle("Auto-close brackets and $", isOn: $settings.autocloseBrackets)
                Toggle("Check spelling while typing", isOn: $settings.spellEnabled)
                Picker("Citation command", selection: $settings.citeCommand) {
                    ForEach(CiteCommand.allCases) { Text("\\" + $0.rawValue).tag($0) }
                }
            }
            .formStyle(.grouped)
            .tabItem { Label("Editor", systemImage: "character.cursor.ibeam") }

            Form {
                Picker("Default compiler for new projects", selection: $settings.defaultCompiler) {
                    ForEach(Compiler.allCases) { Text($0.displayName).tag($0) }
                }
                Stepper("Auto-compile delay: \(settings.autoCompileDelayMs) ms", value: $settings.autoCompileDelayMs, in: 500...10_000, step: 100)
                Stepper("Compile timeout: \(settings.compileTimeoutSeconds) s", value: $settings.compileTimeoutSeconds, in: 10...600, step: 10)
                Toggle("Enable shell escape for new projects", isOn: $settings.shellEscapeDefault)
                if let workspace = model.workspace {
                    Section("Current project: \(workspace.name)") {
                        Toggle("Shell escape (-shell-escape, needed by minted)", isOn: Binding(
                            get: { workspace.config.shellEscape },
                            set: { workspace.config.shellEscape = $0; workspace.saveConfig() }))
                        Picker("Main file", selection: Binding(get: { workspace.config.mainFile }, set: { workspace.setMainFile($0) })) {
                            ForEach(ProjectFiles.collectFiles(root: workspace.root) { $0.hasSuffix(".tex") }, id: \.self) { Text($0).tag($0) }
                        }
                    }
                }
                Section("TeX installation") {
                    if model.tex.tools.isEmpty {
                        Text(model.texDetected ? "No TeX tools found. Install MacTeX from tug.org/mactex." : "Detecting…")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(TexEnvironment.toolNames, id: \.self) { name in
                        LabeledContent(name) {
                            if let tool = model.tex.tools[name] {
                                Text(tool.path).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                                    .lineLimit(1).truncationMode(.middle).help(tool.version ?? "")
                            } else {
                                Text("not found").foregroundStyle(.orange)
                            }
                        }
                    }
                    Button("Re-check") { Task { await model.detectTex(force: true) } }
                }
            }
            .formStyle(.grouped)
            .tabItem { Label("Compiler", systemImage: "hammer") }
        }
        .frame(width: 560, height: 520)
    }

    private var monospacedFonts: [String] {
        NSFontManager.shared.availableFontFamilies.filter { family in
            guard let font = NSFont(name: family, size: 12) else { return false }
            return font.isFixedPitch || family.localizedCaseInsensitiveContains("mono")
        }
    }
}
