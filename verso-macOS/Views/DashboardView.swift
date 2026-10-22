import SwiftUI
import UniformTypeIdentifiers

/// Project overview shown when no project is open.
struct DashboardView: View {
    @Bindable private var model = AppModel.shared
    private var registry = ProjectRegistry.shared
    @State private var query = ""
    @State private var activeTag: String?
    @AppStorage("dashboardGrid") private var gridView = true
    @State private var dropTargeted = false

    private var allTags: [String] {
        Array(Set(registry.entries.flatMap(\.tags))).sorted()
    }

    private var filtered: [RegistryEntry] {
        var list = registry.entries
        if let activeTag { list = list.filter { $0.tags.contains(activeTag) } }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty { list = list.filter { $0.name.lowercased().contains(q) } }
        return list.sorted { $0.lastOpened > $1.lastOpened }
    }

    var body: some View {
        HStack(spacing: 0) {
            tagSidebar
            Divider()
            ZStack {
                AppLogo(size: 420)
                    .opacity(0.05)
                    .allowsHitTesting(false)
                content
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
                for provider in providers {
                    _ = provider.loadObject(ofClass: URL.self) { url, _ in
                        guard let url else { return }
                        DispatchQueue.main.async {
                            var isDir: ObjCBool = false
                            FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
                            if isDir.boolValue { model.open(url) }
                            else if url.pathExtension.lowercased() == "zip" { model.importZip(url) }
                        }
                    }
                }
                return true
            }
            .overlay {
                if dropTargeted {
                    RoundedRectangle(cornerRadius: 12).strokeBorder(Color.accentColor, lineWidth: 2).padding(8)
                }
            }
        }
        .navigationTitle("Verso")
        .toolbar {
            ToolbarItem(placement: .navigation) {
                HStack(spacing: 8) {
                    AppLogo(size: 22)
                    Text("Verso").font(.system(size: 15, weight: .semibold))
                }
                .fixedSize()
                .padding(.horizontal, 8)
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Picker("View", selection: $gridView) {
                    Image(systemName: "square.grid.2x2").tag(true)
                    Image(systemName: "list.bullet").tag(false)
                }
                .pickerStyle(.segmented)
                .help("Toggle view")
                Button { model.chooseFolder() } label: { Label("Open Folder…", systemImage: "folder") }
                    .help("Open an existing LaTeX folder")
                Button { model.importZip() } label: { Label("Import ZIP", systemImage: "square.and.arrow.down") }
                    .help("Import a ZIP (e.g. from Overleaf)")
                Button { model.showNewProject = true } label: { Label("New Project", systemImage: "plus") }
                    .help("Create a project from a template")
            }
        }
        .searchable(text: $query, placement: .toolbar, prompt: "Search projects…")
        .onAppear { registry.load() }
    }

    private var tagSidebar: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("Tags", systemImage: "tag")
                .font(.system(size: 11, weight: .semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)
            tagButton(nil, title: "All projects")
            ForEach(allTags, id: \.self) { tag in tagButton(tag, title: tag) }
            Spacer()
        }
        .padding(12)
        .frame(width: 180)
        .background(.background.secondary)
    }

    private func tagButton(_ tag: String?, title: String) -> some View {
        Button { activeTag = tag } label: {
            HStack {
                if let tag { Circle().fill(TagColor.color(tag)).frame(width: 7, height: 7) }
                Text(title).lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(activeTag == tag ? Color.accentColor.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var content: some View {
        if filtered.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: "folder").font(.system(size: 34)).foregroundStyle(.tertiary)
                Text(query.isEmpty ? (activeTag == nil ? "No projects yet." : "No projects with this tag.")
                                   : "No projects match “\(query)”.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                Text(query.isEmpty ? "Create a new project from a template, open a folder, import a ZIP (e.g. from Overleaf), or drag a folder or ZIP here."
                                   : "Search matches project names only.")
                    .font(.callout)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 380)
                if query.isEmpty {
                    HStack {
                        Button("New Project") { model.showNewProject = true }.buttonStyle(.borderedProminent)
                        Button("Open Sample Project") { model.openSampleProject() }
                    }
                    .padding(.top, 6)
                }
            }
        } else if gridView {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                    ForEach(filtered) { entry in
                        ProjectCard(entry: entry)
                    }
                }
                .padding(16)
            }
        } else {
            List(filtered) { entry in
                ProjectRow(entry: entry)
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
        }
    }
}

enum TagColor {
    static let palette: [Color] = [.blue, .green, .orange, .red, .purple, .pink, .teal]

    static func color(_ tag: String) -> Color {
        var hash: UInt32 = 0
        for scalar in tag.unicodeScalars { hash = hash &* 31 &+ scalar.value }
        return palette[Int(hash % UInt32(palette.count))]
    }
}

private struct ProjectCard: View {
    let entry: RegistryEntry
    @State private var hovering = false

    var body: some View {
        Button { open(entry) } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Image(systemName: "doc.text.fill").foregroundStyle(Color.accentColor)
                    Text(entry.name).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                }
                Text(abbreviate(entry.path))
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(entry.exists ? "Opened \(entry.lastOpenedDate.formatted(date: .abbreviated, time: .omitted))" : "Folder missing")
                    .font(.system(size: 11))
                    .foregroundStyle(entry.exists ? Color.secondary : Color.red)
                if !entry.tags.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(entry.tags, id: \.self) { tag in
                            Text(tag)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 1)
                                .background(TagColor.color(tag), in: Capsule())
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.background, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(hovering ? Color.accentColor : Color.primary.opacity(0.1)))
            .opacity(entry.exists ? 1 : 0.55)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .contextMenu { ProjectMenu(entry: entry) }
    }
}

private struct ProjectRow: View {
    let entry: RegistryEntry

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "folder.fill").foregroundStyle(Color.accentColor)
            Text(entry.name).fontWeight(.medium).frame(width: 200, alignment: .leading).lineLimit(1)
            Text(abbreviate(entry.path)).foregroundStyle(.tertiary).lineLimit(1).truncationMode(.middle)
            Spacer()
            ForEach(entry.tags, id: \.self) { tag in
                Text(tag).font(.system(size: 10)).padding(.horizontal, 6).padding(.vertical, 1)
                    .background(TagColor.color(tag).opacity(0.25), in: Capsule())
            }
            Text(entry.exists ? entry.lastOpenedDate.formatted(date: .abbreviated, time: .omitted) : "missing")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
        .opacity(entry.exists ? 1 : 0.55)
        .contentShape(Rectangle())
        .onTapGesture { open(entry) }
        .contextMenu { ProjectMenu(entry: entry) }
    }
}

private func abbreviate(_ path: String) -> String {
    (path as NSString).abbreviatingWithTildeInPath
}

@MainActor
private func open(_ entry: RegistryEntry) {
    if entry.exists {
        AppModel.shared.open(URL(fileURLWithPath: entry.path))
    } else {
        locate(entry)
    }
}

@MainActor
private func locate(_ entry: RegistryEntry) {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.message = "Locate the folder of “\(entry.name)”"
    guard panel.runModal() == .OK, let url = panel.url else { return }
    ProjectRegistry.shared.move(from: entry.path, to: url.path)
}

private struct ProjectMenu: View {
    let entry: RegistryEntry
    private var model: AppModel { AppModel.shared }
    private var registry: ProjectRegistry { ProjectRegistry.shared }

    var body: some View {
        Button("Open") { open(entry) }.disabled(!entry.exists)
        Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: entry.path)]) }
            .disabled(!entry.exists)
        Button("Locate…") { locate(entry) }
        Divider()
        Button("Duplicate") {
            do { _ = try registry.duplicate(entry.path) } catch { model.showError(error.localizedDescription) }
        }
        .disabled(!entry.exists)
        Button("Rename…") {
            guard let name = Prompt.text(title: "Rename Project", defaultValue: entry.name, confirm: "Rename"), name != entry.name else { return }
            do { _ = try registry.renameFolder(entry.path, to: name) } catch { model.showError(error.localizedDescription) }
        }
        .disabled(!entry.exists)
        Button("Edit Tags…") {
            guard let tags = Prompt.text(title: "Edit Tags", message: "Comma-separated tags", defaultValue: entry.tags.joined(separator: ", "), confirm: "Save") else {
                return
            }
            registry.setTags(entry.path, tags: tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
        }
        Divider()
        Button("Export as ZIP…") { model.exportZip(URL(fileURLWithPath: entry.path)) }.disabled(!entry.exists)
        Button("Save as Template…") { model.saveAsTemplate(URL(fileURLWithPath: entry.path)) }.disabled(!entry.exists)
        Divider()
        Button("Move to Trash…") {
            guard Prompt.confirm("Move “\(entry.name)” to the Trash?", message: "The project folder and all its files will be moved to the Trash.",
                                 confirm: "Move to Trash", destructive: true) else { return }
            do { try registry.trash(entry.path) } catch { model.showError(error.localizedDescription) }
        }
        .disabled(!entry.exists)
        Button("Remove from List") { registry.remove(entry.path) }
    }
}

/// Template picker with project location.
struct NewProjectSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var templates: [TemplateInfo] = []
    @State private var selection: TemplateInfo?
    @State private var name = "Untitled Project"
    @State private var location = AppSettings.shared.effectiveProjectDirectory

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New Project").font(.title2.weight(.semibold))
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 10)], spacing: 10) {
                    ForEach(templates) { template in
                        Button {
                            selection = template
                            if name == "Untitled Project" || templates.contains(where: { "\($0.name) Project" == name }) {
                                name = template.id == "blank" ? "Untitled Project" : "\(template.name) Project"
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(template.name).font(.system(size: 13, weight: .semibold))
                                    Spacer()
                                    if !template.builtIn {
                                        Button {
                                            if Prompt.confirm("Delete the template “\(template.name)”?", message: "Projects created from it are not affected.", confirm: "Delete", destructive: true) {
                                                Templates.deleteUserTemplate(template)
                                                templates = Templates.list()
                                            }
                                        } label: { Image(systemName: "trash") }
                                        .buttonStyle(.borderless)
                                        .help("Delete template")
                                    }
                                }
                                Text(template.description).font(.system(size: 11)).foregroundStyle(.secondary)
                                    .lineLimit(2, reservesSpace: true)
                                Text("\(template.builtIn ? "Built-in" : "User template") · \(template.compiler.displayName)")
                                    .font(.system(size: 10)).foregroundStyle(.tertiary)
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.background, in: RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(selection == template ? Color.accentColor : Color.primary.opacity(0.12), lineWidth: selection == template ? 2 : 1))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(minHeight: 220)
            Form {
                TextField("Name", text: $name)
                LabeledContent("Location") {
                    HStack {
                        Text((location.path as NSString).abbreviatingWithTildeInPath)
                            .lineLimit(1).truncationMode(.middle).foregroundStyle(.secondary)
                        Spacer()
                        Button("Choose…") { chooseLocation() }
                    }
                }
            }
            HStack {
                Button("Open Existing Folder…") {
                    dismiss()
                    AppModel.shared.chooseFolder()
                }
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Create") {
                    guard let selection else { return }
                    AppModel.shared.createProject(from: selection, name: name.trimmingCharacters(in: .whitespaces), in: location)
                }
                .keyboardShortcut(.defaultAction)
                .disabled(selection == nil || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 640, height: 560)
        .onAppear {
            templates = Templates.list()
            selection = templates.first
        }
    }

    private func chooseLocation() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.directoryURL = location
        panel.prompt = "Choose"
        if panel.runModal() == .OK, let url = panel.url { location = url }
    }
}

/// First-run sheet: TeX check, project folder, sample project.
struct WelcomeSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var dontShowAgain = true
    @State private var checking = false
    private var model: AppModel { AppModel.shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                AppLogo(size: 48)
                VStack(alignment: .leading) {
                    Text("Welcome to Verso").font(.title2.weight(.semibold))
                    Text("A local, offline-first LaTeX editor. Three steps to get started:")
                        .foregroundStyle(.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("1. TeX installation").fontWeight(.medium)
                if !model.texDetected || checking {
                    Text("Checking…").foregroundStyle(.secondary)
                } else if model.tex.available {
                    Label("LaTeX toolchain found — you are ready to compile.", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } else {
                    Label("No LaTeX toolchain found. Install MacTeX (tug.org/mactex).", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                    HStack {
                        Button("Get MacTeX") { NSWorkspace.shared.open(URL(string: "https://www.tug.org/mactex/")!) }
                        Button("Re-check") {
                            checking = true
                            Task {
                                await model.detectTex(force: true)
                                checking = false
                            }
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("2. Default project folder").fontWeight(.medium)
                Text("New projects are created in \((AppSettings.shared.effectiveProjectDirectory.path as NSString).abbreviatingWithTildeInPath) (configurable in Settings).")
                    .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("3. Try the sample project").fontWeight(.medium)
                Button("Open Sample Project") {
                    finish()
                    model.openSampleProject()
                }
                .buttonStyle(.borderedProminent)
            }
            Divider()
            HStack {
                Toggle("Don’t show this again", isOn: $dontShowAgain)
                Spacer()
                Button("Skip") { finish() }.keyboardShortcut(.cancelAction)
            }
        }
        .padding(24)
        .frame(width: 540)
    }

    private func finish() {
        if dontShowAgain { AppSettings.shared.firstRunDone = true }
        dismiss()
    }
}
