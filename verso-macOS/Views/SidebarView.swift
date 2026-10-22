import SwiftUI
import UniformTypeIdentifiers

struct SidebarRail: View {
    @Bindable var workspace: Workspace

    var body: some View {
        VStack(spacing: 4) {
            ForEach(SidebarTab.allCases) { tab in
                let active = workspace.sidebarVisible && workspace.sidebarTab == tab
                Button {
                    if workspace.sidebarTab == tab { workspace.sidebarVisible.toggle() } else {
                        workspace.sidebarTab = tab
                        workspace.sidebarVisible = true
                    }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: tab.symbol).font(.system(size: 16))
                        Text(tab.title).font(.system(size: 10))
                    }
                    .frame(width: 56, height: 48)
                    .foregroundStyle(active ? Color.accentColor : .secondary)
                    .background(active ? Color.accentColor.opacity(0.15) : .clear, in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(tab.title)
            }
            Spacer()
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 6)
        .frame(width: 68)
        .background(.background.secondary)
    }
}

struct SidebarPanel: View {
    @Bindable var workspace: Workspace

    var body: some View {
        Group {
            switch workspace.sidebarTab {
            case .files: FileTreePanel(workspace: workspace)
            case .outline: OutlinePanel(workspace: workspace)
            case .search: SearchPanel(workspace: workspace)
            case .git: GitPanel(workspace: workspace)
            case .references: ReferencesPanel(workspace: workspace)
            case .symbols: SymbolsPanel(workspace: workspace)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(.background.secondary)
    }
}

struct PanelHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack {
            Text(title).font(.system(size: 11, weight: .semibold)).textCase(.uppercase).foregroundStyle(.secondary)
            Spacer()
            trailing
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .frame(height: 32)
    }
}

// MARK: - Files

struct FileTreePanel: View {
    @Bindable var workspace: Workspace
    @State private var selection: String?
    @State private var dropTargeted = false

    var body: some View {
        VStack(spacing: 0) {
            PanelHeader(title: workspace.name) {
                Button { newFile(in: "") } label: { Image(systemName: "doc.badge.plus") }.help("New File (⌘N)")
                Button { newFolder(in: "") } label: { Image(systemName: "folder.badge.plus") }.help("New Folder (⇧⌘N)")
                Button { importFiles(into: "") } label: { Image(systemName: "square.and.arrow.down") }.help("Add files to the project")
                Button { workspace.refreshTree() } label: { Image(systemName: "arrow.clockwise") }.help("Refresh")
            }
            Divider()
            List(selection: $selection) {
                OutlineGroup(workspace.tree.children ?? [], children: \.children) { node in
                    FileRow(node: node, isMain: node.relPath == workspace.config.mainFile)
                        .tag(node.relPath)
                        .contextMenu { menu(for: node) }
                        .onDrop(of: [.fileURL], isTargeted: nil) { providers in
                            drop(providers, into: node.isDirectory ? node.relPath : (node.relPath as NSString).deletingLastPathComponent)
                        }
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
            .contextMenu {
                Button("New File…") { newFile(in: "") }
                Button("New Folder…") { newFolder(in: "") }
                Button("Add Files…") { importFiles(into: "") }
                Divider()
                Button("Reveal Project in Finder") { NSWorkspace.shared.activateFileViewerSelecting([workspace.root]) }
            }
            .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in drop(providers, into: "") }
            .onChange(of: selection) { _, path in
                guard let path, let node = find(path, in: workspace.tree), !node.isDirectory else { return }
                workspace.openFile(path)
            }
            .onChange(of: workspace.activePath) { _, path in
                if selection != path { selection = path }
            }
            .onAppear { selection = workspace.activePath }
        }
        .overlay {
            if dropTargeted { RoundedRectangle(cornerRadius: 8).strokeBorder(Color.accentColor, lineWidth: 2).padding(4) }
        }
    }

    private func find(_ path: String, in node: FileNode) -> FileNode? {
        if node.relPath == path { return node }
        for child in node.children ?? [] {
            if let found = find(path, in: child) { return found }
        }
        return nil
    }

    @ViewBuilder
    private func menu(for node: FileNode) -> some View {
        let directory = node.isDirectory ? node.relPath : (node.relPath as NSString).deletingLastPathComponent
        if !node.isDirectory {
            Button("Open") { workspace.openFile(node.relPath) }
            if node.fileExtension == "tex" && node.relPath != workspace.config.mainFile {
                Button("Set as Main File") { workspace.setMainFile(node.relPath) }
            }
            Button("Open with Default App") {
                if let url = workspace.url(for: node.relPath) { NSWorkspace.shared.open(url) }
            }
            Divider()
        }
        Button("New File…") { newFile(in: directory) }
        Button("New Folder…") { newFolder(in: directory) }
        Button("Add Files…") { importFiles(into: directory) }
        Divider()
        Button("Rename…") {
            if let name = Prompt.text(title: "Rename", defaultValue: node.name, confirm: "Rename"), name != node.name {
                workspace.rename(node.relPath, to: name)
            }
        }
        Button("Copy Path") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(node.relPath, forType: .string)
        }
        Button("Reveal in Finder") { workspace.reveal(node.relPath) }
        Divider()
        Button("Move to Trash", role: .destructive) { workspace.trash(node.relPath) }
    }

    private func newFile(in directory: String) {
        if let name = Prompt.text(title: "New File", message: directory.isEmpty ? "" : "In \(directory)/", defaultValue: "untitled.tex", confirm: "Create") {
            workspace.createFile(named: name, in: directory)
        }
    }

    private func newFolder(in directory: String) {
        if let name = Prompt.text(title: "New Folder", message: directory.isEmpty ? "" : "In \(directory)/", confirm: "Create") {
            workspace.createFolder(named: name, in: directory)
        }
    }

    private func importFiles(into directory: String) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.prompt = "Add"
        if panel.runModal() == .OK { workspace.importFiles(panel.urls, into: directory) }
    }

    private func drop(_ providers: [NSItemProvider], into directory: String) -> Bool {
        var urls: [URL] = []
        let group = DispatchGroup()
        let lock = NSLock()
        for provider in providers {
            group.enter()
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                if let url { lock.lock(); urls.append(url); lock.unlock() }
                group.leave()
            }
        }
        group.notify(queue: .main) {
            let rootPath = workspace.root.standardizedFileURL.path + "/"
            // Ignore drags that originate inside the project itself.
            let external = urls.filter { !$0.standardizedFileURL.path.hasPrefix(rootPath) }
            if !external.isEmpty { workspace.importFiles(external, into: directory) }
        }
        return true
    }
}

private struct FileRow: View {
    let node: FileNode
    let isMain: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: node.isDirectory ? "folder" : FileIcon.symbol(for: node.name))
                .foregroundStyle(node.isDirectory ? Color.accentColor : FileIcon.color(for: node.name))
                .frame(width: 16)
            Text(node.name).lineLimit(1)
            Spacer()
            if isMain {
                Text("Main")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Color.accentColor, in: Capsule())
            }
        }
    }
}

// MARK: - Outline

struct OutlinePanel: View {
    let workspace: Workspace
    @State private var filter = ""

    private var sections: [SectionNode] {
        filter.isEmpty ? workspace.outline : workspace.outline.filter { $0.title.localizedCaseInsensitiveContains(filter) }
    }

    var body: some View {
        VStack(spacing: 0) {
            PanelHeader(title: "Outline") {
                Button { workspace.reindex() } label: { Image(systemName: "arrow.clockwise") }.help("Refresh")
            }
            TextField("Filter sections", text: $filter)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
            Divider()
            if sections.isEmpty {
                Text(workspace.outline.isEmpty ? "No sections in the main document yet." : "No sections match.")
                    .font(.callout).foregroundStyle(.secondary).padding()
                Spacer()
            } else {
                let minLevel = workspace.outline.map(\.level).min() ?? 0
                List(sections) { section in
                    Button { workspace.jump(to: section.file, line: section.line) } label: {
                        HStack(spacing: 6) {
                            Text(section.title.isEmpty ? "(untitled)" : section.title)
                                .font(.system(size: 12, weight: section.level - minLevel == 0 ? .semibold : .regular))
                                .lineLimit(1)
                            Spacer()
                            if section.file != workspace.config.mainFile {
                                Text((section.file as NSString).lastPathComponent)
                                    .font(.system(size: 10)).foregroundStyle(.tertiary)
                            }
                        }
                        .padding(.leading, CGFloat(section.level - minLevel) * 14)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.sidebar)
                .scrollContentBackground(.hidden)
            }
        }
    }
}

// MARK: - Search

struct SearchResult: Identifiable {
    var relPath: String
    var line: Int
    var column: Int
    var length: Int
    var preview: String
    var id: String { "\(relPath):\(line):\(column)" }
}

struct SearchPanel: View {
    let workspace: Workspace
    @State private var query = ""
    @State private var replacement = ""
    @State private var caseSensitive = false
    @State private var wholeWord = false
    @State private var useRegex = false
    @State private var showReplace = false
    @State private var results: [SearchResult] = []
    @State private var searched = false
    @FocusState private var focused: Bool

    private var regex: NSRegularExpression? {
        guard !query.isEmpty else { return nil }
        var pattern = useRegex ? query : NSRegularExpression.escapedPattern(for: query)
        if wholeWord { pattern = "(?<![\\w])\(pattern)(?![\\w])" }
        return try? NSRegularExpression(pattern: pattern, options: caseSensitive ? [] : [.caseInsensitive])
    }

    private var grouped: [(String, [SearchResult])] {
        var order: [String] = []
        var map: [String: [SearchResult]] = [:]
        for result in results {
            if map[result.relPath] == nil { order.append(result.relPath) }
            map[result.relPath, default: []].append(result)
        }
        return order.map { ($0, map[$0]!) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            PanelHeader(title: "Search") {
                Button { showReplace.toggle() } label: { Image(systemName: "arrow.left.arrow.right") }.help("Toggle replace")
            }
            VStack(spacing: 6) {
                TextField("Search in project", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .focused($focused)
                    .onSubmit(search)
                if showReplace {
                    HStack {
                        TextField("Replace", text: $replacement).textFieldStyle(.roundedBorder)
                        Button("All") { replaceAll() }
                            .disabled(results.isEmpty)
                            .help("Replace all matches in all files")
                    }
                }
                HStack(spacing: 4) {
                    Toggle("Aa", isOn: $caseSensitive).help("Match case")
                    Toggle("W", isOn: $wholeWord).help("Whole word")
                    Toggle(".*", isOn: $useRegex).help("Regular expression")
                    Spacer()
                    if searched { Text("\(results.count) results").font(.system(size: 11)).foregroundStyle(.secondary) }
                }
                .toggleStyle(.button)
                .controlSize(.small)
            }
            .padding(.horizontal, 10)
            Divider()
            if useRegex && !query.isEmpty && regex == nil {
                Text("Invalid regular expression").foregroundStyle(.red).font(.callout).padding(.horizontal, 10)
            }
            List {
                ForEach(grouped, id: \.0) { file, matches in
                    Section {
                        ForEach(matches) { match in
                            Button { workspace.jump(to: match.relPath, line: match.line, column: match.column - 1) } label: {
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Text("\(match.line)").font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
                                        .frame(minWidth: 24, alignment: .trailing)
                                    Text(highlighted(match)).font(.system(size: 11, design: .monospaced)).lineLimit(1)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    } header: {
                        Label("\(file) (\(matches.count))", systemImage: FileIcon.symbol(for: file)).font(.system(size: 11, weight: .semibold))
                    }
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
        .onChange(of: query) { scheduleSearch() }
        .onChange(of: caseSensitive) { search() }
        .onChange(of: wholeWord) { search() }
        .onChange(of: useRegex) { search() }
        .onAppear {
            focused = true
            if let textView = workspace.textView, textView.selectedRange().length > 0, textView.selectedRange().length < 100 {
                query = (textView.string as NSString).substring(with: textView.selectedRange())
            }
        }
    }

    @State private var pending: DispatchWorkItem?

    private func scheduleSearch() {
        pending?.cancel()
        let work = DispatchWorkItem { search() }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: work)
    }

    private func highlighted(_ match: SearchResult) -> AttributedString {
        let preview = match.preview
        var result = AttributedString(preview)
        let ns = preview as NSString
        let start = match.column - 1
        guard start >= 0, start + match.length <= ns.length,
              let range = Range(NSRange(location: start, length: match.length), in: preview),
              let attributed = Range(range, in: result) else { return result }
        result[attributed].backgroundColor = .yellow.opacity(0.35)
        result[attributed].font = .system(size: 11, weight: .bold, design: .monospaced)
        return result
    }

    private func search() {
        guard let regex else {
            results = []
            searched = false
            return
        }
        searched = true
        var found: [SearchResult] = []
        let files = ProjectFiles.collectFiles(root: workspace.root) { ProjectFiles.searchableExtensions.contains(($0 as NSString).pathExtension.lowercased()) }
        for file in files {
            guard let text = workspace.content(of: file) else { continue }
            for (index, line) in text.components(separatedBy: "\n").enumerated() {
                let ns = line as NSString
                for match in regex.matches(in: line, range: NSRange(location: 0, length: ns.length)) where match.range.length > 0 {
                    let previewStart = max(0, match.range.location - 40)
                    let preview = ns.substring(from: previewStart)
                    found.append(SearchResult(relPath: file, line: index + 1, column: match.range.location - previewStart + 1,
                                              length: match.range.length, preview: String(preview.prefix(160))))
                    if found.count >= 2000 { break }
                }
            }
            if found.count >= 2000 { break }
        }
        results = found
    }

    private func replaceAll() {
        guard let regex else { return }
        let files = Set(results.map(\.relPath))
        guard Prompt.confirm("Replace \(results.count) matches in \(files.count) file\(files.count == 1 ? "" : "s")?",
                             message: "Open files are updated too. A snapshot is taken first, so you can undo this in Version History.",
                             confirm: "Replace All") else { return }
        workspace.saveAll()
        workspace.takeSnapshot(reason: "Before replace all")
        var changed: [String] = []
        let template = useRegex ? replacement : NSRegularExpression.escapedTemplate(for: replacement)
        for file in files {
            guard let url = workspace.url(for: file), let content = try? ProjectFiles.readText(url) else { continue }
            let replaced = regex.stringByReplacingMatches(in: content.text, range: NSRange(location: 0, length: (content.text as NSString).length), withTemplate: template)
            guard replaced != content.text else { continue }
            try? ProjectFiles.writeText(replaced, to: url, crlf: content.crlf, bom: content.bom)
            changed.append(file)
        }
        workspace.reloadOpenDocuments(changed)
        search()
    }
}

// MARK: - Symbols

struct SymbolsPanel: View {
    let workspace: Workspace
    @State private var query = ""
    @AppStorage("recentSymbols") private var recentStorage = ""

    private var recent: [LatexSymbol] {
        recentStorage.split(separator: "\u{1F}").compactMap { command in LatexSymbol.all.first { $0.command == command } }
    }

    private var filtered: [LatexSymbol] {
        query.isEmpty ? LatexSymbol.all : LatexSymbol.all.filter {
            $0.name.localizedCaseInsensitiveContains(query) || $0.command.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            PanelHeader(title: "Symbols") { EmptyView() }
            TextField("Search symbols", text: $query)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if query.isEmpty && !recent.isEmpty { group("Recent", recent) }
                    let categories = filtered.reduce(into: [String]()) { list, symbol in
                        if !list.contains(symbol.category) { list.append(symbol.category) }
                    }
                    ForEach(categories, id: \.self) { category in
                        group(category, filtered.filter { $0.category == category })
                    }
                }
                .padding(10)
            }
        }
    }

    private func group(_ title: String, _ symbols: [LatexSymbol]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 38), spacing: 4)], spacing: 4) {
                ForEach(symbols) { symbol in
                    Button { insert(symbol) } label: {
                        Text(symbol.glyph)
                            .font(.system(size: symbol.glyph.count > 2 ? 11 : 17, design: .serif))
                            .frame(width: 38, height: 34)
                            .background(.background, in: RoundedRectangle(cornerRadius: 6))
                            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Color.primary.opacity(0.1)))
                    }
                    .buttonStyle(.plain)
                    .help("\(symbol.name)  —  \(symbol.command)")
                }
            }
        }
    }

    private func insert(_ symbol: LatexSymbol) {
        guard let textView = workspace.textView, workspace.activeDocument?.kind == .text else { return }
        var text = symbol.command
        // Placeholders in templates such as \frac{a}{b} become snippet stops.
        var index = 0
        if let regex = try? NSRegularExpression(pattern: #"\{([a-z]+)\}"#) {
            let ns = text as NSString
            var output = ""
            var cursor = 0
            for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
                index += 1
                output += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
                output += "{${\(index):\(ns.substring(with: match.range(at: 1)))}}"
                cursor = NSMaxRange(match.range)
            }
            output += ns.substring(from: cursor)
            text = output
        }
        textView.insertSnippet(text)
        textView.window?.makeFirstResponder(textView)
        var list = recent.map(\.command).filter { $0 != symbol.command }
        list.insert(symbol.command, at: 0)
        recentStorage = list.prefix(12).joined(separator: "\u{1F}")
    }
}
