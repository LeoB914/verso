import SwiftUI

struct ReferencesPanel: View {
    let workspace: Workspace
    @State private var filter = ""
    @State private var showAdd = false
    @State private var showReport = false

    private var entries: [BibEntry] {
        let all = workspace.bibEntries
        guard !filter.isEmpty else { return all }
        return all.filter {
            $0.key.localizedCaseInsensitiveContains(filter) || $0.author.localizedCaseInsensitiveContains(filter)
                || $0.title.localizedCaseInsensitiveContains(filter) || $0.year.contains(filter)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            PanelHeader(title: "References") {
                Button { showReport = true } label: { Image(systemName: "checklist") }
                    .help("Bibliography report: missing, unused and duplicate entries")
                    .popover(isPresented: $showReport, arrowEdge: .bottom) { BibReport(workspace: workspace) }
                Button { showAdd = true } label: { Image(systemName: "plus") }
                    .help("Add entry by DOI, arXiv id or ISBN")
                    .popover(isPresented: $showAdd, arrowEdge: .bottom) { AddBibEntry(workspace: workspace, isPresented: $showAdd) }
            }
            TextField("Filter by key, author, title, year", text: $filter)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
            Divider()
            if workspace.bibEntries.isEmpty {
                VStack(spacing: 6) {
                    Text("No .bib entries in this project.").font(.callout).foregroundStyle(.secondary)
                    Button("Add Entry…") { showAdd = true }
                }
                .padding()
                Spacer()
            } else {
                List(entries) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.key).font(.system(size: 12, weight: .medium, design: .monospaced))
                        Text(entry.summary).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2)
                    }
                    .padding(.vertical, 2)
                    .contentShape(Rectangle())
                    .onTapGesture(count: 2) { workspace.jump(to: entry.file, line: entry.line) }
                    .onTapGesture { insertCitation([entry.key], in: workspace) }
                    .help("Click to insert a citation, double-click to open the .bib entry")
                    .contextMenu {
                        Button("Insert Citation") { insertCitation([entry.key], in: workspace) }
                        Button("Open in \((entry.file as NSString).lastPathComponent)") { workspace.jump(to: entry.file, line: entry.line) }
                        Button("Copy Key") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(entry.key, forType: .string)
                        }
                    }
                }
                .listStyle(.sidebar)
                .scrollContentBackground(.hidden)
            }
        }
    }
}

/// Insert `\cite{a,b}` (configured command) — or add keys to the citation the cursor is in.
@MainActor
func insertCitation(_ keys: [String], in workspace: Workspace) {
    guard let textView = workspace.textView, workspace.activeDocument?.kind == .text, !keys.isEmpty else { return }
    let ns = textView.string as NSString
    let location = textView.selectedRange().location
    let lineStart = ns.lineRange(for: NSRange(location: location, length: 0)).location
    let before = ns.substring(with: NSRange(location: lineStart, length: location - lineStart))
    if before.range(of: #"\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{[^}]*$"#, options: .regularExpression) != nil {
        let prefix = before.hasSuffix("{") || before.hasSuffix(",") ? "" : ","
        textView.replace(NSRange(location: location, length: 0), with: prefix + keys.joined(separator: ","))
    } else {
        textView.replace(textView.selectedRange(), with: "\\\(AppSettings.shared.citeCommand.rawValue){\(keys.joined(separator: ","))}")
    }
    textView.window?.makeFirstResponder(textView)
}

private struct AddBibEntry: View {
    let workspace: Workspace
    @Binding var isPresented: Bool
    @State private var identifier = ""
    @State private var preview = ""
    @State private var key = ""
    @State private var loading = false
    @State private var error: String?
    @State private var targetFile = ""

    private var bibFiles: [String] {
        ProjectFiles.collectFiles(root: workspace.root) { $0.lowercased().hasSuffix(".bib") }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Add Bibliography Entry").font(.headline)
            HStack {
                TextField("DOI, arXiv id or ISBN", text: $identifier)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(lookup)
                Button("Look Up", action: lookup).disabled(identifier.isEmpty || loading)
            }
            if loading { ProgressView().controlSize(.small) }
            if let error { Text(error).foregroundStyle(.red).font(.callout) }
            if !preview.isEmpty {
                TextEditor(text: $preview)
                    .font(.system(size: 11, design: .monospaced))
                    .frame(height: 160)
                    .border(Color.primary.opacity(0.15))
                Picker("Add to", selection: $targetFile) {
                    ForEach(bibFiles.isEmpty ? ["references.bib"] : bibFiles, id: \.self) { Text($0).tag($0) }
                }
                HStack {
                    Spacer()
                    Button("Cancel") { isPresented = false }
                    Button("Add & Cite") { add(cite: true) }
                    Button("Add") { add(cite: false) }.keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(16)
        .frame(width: 460)
        .onAppear { targetFile = bibFiles.first ?? "references.bib" }
    }

    private func lookup() {
        loading = true
        error = nil
        Task {
            do {
                let result = try await BibLookup.fetch(identifier)
                preview = result.bibtex
                key = result.key
            } catch {
                self.error = error.localizedDescription
            }
            loading = false
        }
    }

    private func add(cite: Bool) {
        guard let url = workspace.url(for: targetFile) else { return }
        let existingKeys = Set(workspace.bibEntries.map(\.key))
        var bibtex = preview.trimmingCharacters(in: .whitespacesAndNewlines)
        var finalKey = BibParser.parse(bibtex).first?.key ?? key
        if existingKeys.contains(finalKey) {
            var suffix = Character("a")
            while existingKeys.contains(finalKey + String(suffix)) { suffix = Character(UnicodeScalar(suffix.unicodeScalars.first!.value + 1)!) }
            bibtex = bibtex.replacingOccurrences(of: "{\(finalKey),", with: "{\(finalKey)\(suffix),")
            finalKey += String(suffix)
        }
        workspace.saveAll()
        let existing = (try? ProjectFiles.readText(url)) ?? (text: "", format: TextFormat())
        var content = existing.text
        if !content.isEmpty && !content.hasSuffix("\n") { content += "\n" }
        if !content.isEmpty { content += "\n" }
        content += bibtex + "\n"
        do {
            try ProjectFiles.writeText(content, to: url, format: existing.format)
            workspace.refreshTree()
            workspace.reloadOpenDocuments([targetFile])
            if cite { insertCitation([finalKey], in: workspace) }
            isPresented = false
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct BibReport: View {
    let workspace: Workspace

    var body: some View {
        let cited = citedKeys()
        let defined = Set(workspace.bibEntries.map(\.key))
        let missing = cited.subtracting(defined).sorted()
        let unused = defined.subtracting(cited).sorted()
        let duplicates = duplicateGroups()
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Bibliography Report").font(.headline)
                section("Cited but not defined", missing, color: .red)
                section("Defined but never cited", unused, color: .orange)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Possible duplicates (\(duplicates.count))").font(.subheadline.weight(.semibold))
                    if duplicates.isEmpty { Text("None").foregroundStyle(.secondary).font(.callout) }
                    ForEach(duplicates, id: \.self) { group in
                        Text(group.joined(separator: ", ")).font(.system(size: 11, design: .monospaced))
                    }
                }
            }
            .padding(16)
        }
        .frame(width: 380, height: 360)
    }

    private func section(_ title: String, _ keys: [String], color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(title) (\(keys.count))").font(.subheadline.weight(.semibold))
            if keys.isEmpty { Text("None").foregroundStyle(.secondary).font(.callout) }
            ForEach(keys, id: \.self) { key in
                Text(key).font(.system(size: 11, design: .monospaced)).foregroundStyle(color)
            }
        }
    }

    private func citedKeys() -> Set<String> {
        var keys = Set<String>()
        let files = ProjectFiles.collectFiles(root: workspace.root) { $0.lowercased().hasSuffix(".tex") }
        for file in files {
            guard let text = workspace.content(of: file) else { continue }
            for reference in LatexStructure.parse(text).references where reference.kind == .cite && reference.key != "*" {
                keys.insert(reference.key)
            }
        }
        return keys
    }

    private func duplicateGroups() -> [[String]] {
        var byDoi: [String: [String]] = [:]
        var byTitle: [String: [String]] = [:]
        for entry in workspace.bibEntries {
            if let doi = entry.fields["doi"]?.lowercased(), !doi.isEmpty {
                byDoi[doi.replacingOccurrences(of: #"^https?://(dx\.)?doi\.org/"#, with: "", options: .regularExpression), default: []].append(entry.key)
            }
            let title = entry.title.lowercased().replacingOccurrences(of: #"[^a-z0-9 ]"#, with: "", options: .regularExpression)
            if title.count > 10 { byTitle[title, default: []].append(entry.key) }
        }
        var groups = byDoi.values.filter { $0.count > 1 }
        for keys in byTitle.values where keys.count > 1 && !groups.contains(where: { $0.contains(keys[0]) }) {
            groups.append(keys)
        }
        return groups
    }
}

/// ⇧⌘C: searchable citation picker (multiple selection).
struct CitePickerSheet: View {
    let workspace: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var selection = Set<String>()

    private var entries: [BibEntry] {
        guard !query.isEmpty else { return workspace.bibEntries }
        return workspace.bibEntries.filter {
            $0.key.localizedCaseInsensitiveContains(query) || $0.summary.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        VStack(spacing: 10) {
            TextField("Search references", text: $query)
                .textFieldStyle(.roundedBorder)
                .onSubmit(insert)
            List(entries, id: \.key, selection: $selection) { entry in
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.key).font(.system(size: 12, weight: .medium, design: .monospaced))
                    Text(entry.summary).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(minHeight: 280)
            HStack {
                Text(workspace.bibEntries.isEmpty ? "No .bib entries in this project." : "Select one or more entries.")
                    .font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Insert", action: insert).keyboardShortcut(.defaultAction)
                    .disabled(selection.isEmpty && entries.count != 1)
            }
        }
        .padding(16)
        .frame(width: 520, height: 420)
    }

    private func insert() {
        let keys = selection.isEmpty ? (entries.count == 1 ? [entries[0].key] : []) : workspace.bibEntries.map(\.key).filter { selection.contains($0) }
        guard !keys.isEmpty else { return }
        dismiss()
        DispatchQueue.main.async { insertCitation(keys, in: workspace) }
    }
}
