import Foundation

/// Locations of app data (`~/Library/Application Support/Verso`).
nonisolated enum AppPaths {
    static var supportDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Verso", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var registryFile: URL { supportDirectory.appendingPathComponent("projects.json") }
    static var userTemplatesDirectory: URL { supportDirectory.appendingPathComponent("templates", isDirectory: true) }
    static var historyDirectory: URL { supportDirectory.appendingPathComponent("history", isDirectory: true) }
}

/// Per-project configuration, stored in `<project>/.openleaf/project.json`
/// (same format as the Electron version, so existing projects keep working).
struct ProjectConfig: Codable, Equatable {
    var mainFile: String = ""
    var compiler: Compiler = .pdflatex
    var shellEscape: Bool = false
    var spellLanguage: String = "en"
    var autoCompile: Bool = false
    var spellEnabled: Bool = true

    init() {}

    /// Field-by-field decoding: an invalid value falls back to its default.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mainFile = (try? c.decode(String.self, forKey: .mainFile)) ?? ""
        compiler = (try? c.decode(Compiler.self, forKey: .compiler)) ?? .pdflatex
        shellEscape = (try? c.decode(Bool.self, forKey: .shellEscape)) ?? false
        let language = (try? c.decode(String.self, forKey: .spellLanguage)) ?? "en"
        spellLanguage = ["en", "de"].contains(language) ? language : "en"
        autoCompile = (try? c.decode(Bool.self, forKey: .autoCompile)) ?? false
        spellEnabled = (try? c.decode(Bool.self, forKey: .spellEnabled)) ?? true
    }

    static let directoryName = ".openleaf"

    static func configURL(root: URL) -> URL {
        root.appendingPathComponent(directoryName).appendingPathComponent("project.json")
    }

    static func buildDirectory(root: URL) -> URL {
        root.appendingPathComponent(directoryName).appendingPathComponent("build", isDirectory: true)
    }

    static func read(root: URL) -> ProjectConfig? {
        guard var data = try? Data(contentsOf: configURL(root: root)) else { return nil }
        if data.starts(with: [0xEF, 0xBB, 0xBF]) { data.removeFirst(3) }
        return try? JSONDecoder().decode(ProjectConfig.self, from: data)
    }

    func write(root: URL) throws {
        let url = Self.configURL(root: root)
        try FileManager.default.createDirectory(at: Self.buildDirectory(root: root), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(self)
        data.append(0x0A)
        try data.write(to: url, options: .atomic)
    }

    /// Pick the main `.tex` file: `main.tex`, then a file with `\documentclass`, then any `.tex`.
    static func detectMainFile(root: URL) -> String {
        let texFiles = ProjectFiles.collectFiles(root: root, maxDepth: 8) { $0.lowercased().hasSuffix(".tex") }
            .sorted { a, b in
                let da = a.split(separator: "/").count, db = b.split(separator: "/").count
                return da != db ? da < db : a.localizedStandardCompare(b) == .orderedAscending
            }
        if let main = texFiles.first(where: { ($0 as NSString).lastPathComponent.lowercased() == "main.tex" }) {
            return main
        }
        for file in texFiles {
            if let content = try? String(contentsOf: root.appendingPathComponent(file), encoding: .utf8),
               content.range(of: #"\\documentclass\s*[\[{]"#, options: .regularExpression) != nil {
                return file
            }
        }
        return texFiles.first ?? ""
    }
}

/// A known project shown on the dashboard.
struct RegistryEntry: Codable, Identifiable, Equatable {
    var path: String
    var name: String
    /// Milliseconds since 1970.
    var lastOpened: Double
    var tags: [String]
    var uiState: ProjectUIState?

    var id: String { path }
    var exists: Bool { FileManager.default.fileExists(atPath: path) }
    var lastOpenedDate: Date { Date(timeIntervalSince1970: lastOpened / 1000) }
}

/// Layout and open tabs, persisted per project.
struct ProjectUIState: Codable, Equatable {
    var openTabs: [String]?
    var activeTab: String?
    var cursorLocation: Int?
    var sidebarVisible: Bool?
    var pdfVisible: Bool?
    var problemsVisible: Bool?
}

/// Project registry persisted as JSON in Application Support.
@Observable
final class ProjectRegistry {
    static let shared = ProjectRegistry()

    private(set) var entries: [RegistryEntry] = []

    private init() { load() }

    func load() {
        if !FileManager.default.fileExists(atPath: AppPaths.registryFile.path) {
            importElectronRegistry()
        }
        guard let data = try? Data(contentsOf: AppPaths.registryFile),
              let decoded = try? JSONDecoder().decode([RegistryEntry].self, from: data) else {
            entries = []
            return
        }
        entries = dedupe(decoded)
    }

    /// The Electron version kept its registry in `config.json` in the same
    /// Application Support folder; take it over on first launch.
    private func importElectronRegistry() {
        let legacy = AppPaths.supportDirectory.appendingPathComponent("config.json")
        guard let data = try? Data(contentsOf: legacy),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let projects = object["projects"] as? [[String: Any]] else { return }
        let imported: [RegistryEntry] = projects.compactMap { item in
            guard let path = item["path"] as? String else { return nil }
            return RegistryEntry(path: path,
                                 name: item["name"] as? String ?? (path as NSString).lastPathComponent,
                                 lastOpened: (item["lastOpened"] as? NSNumber)?.doubleValue ?? 0,
                                 tags: item["tags"] as? [String] ?? [],
                                 uiState: nil)
        }
        if let data = try? JSONEncoder().encode(imported) {
            try? data.write(to: AppPaths.registryFile, options: .atomic)
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(entries) {
            try? data.write(to: AppPaths.registryFile, options: .atomic)
        }
    }

    static func canonical(_ path: String) -> String { canonicalPath(path) }

    nonisolated static func canonicalPath(_ path: String) -> String {
        var url = URL(fileURLWithPath: path).standardizedFileURL
        url.resolveSymlinksInPath()
        var result = url.path
        while result.count > 1 && result.hasSuffix("/") { result.removeLast() }
        return result
    }

    private func dedupe(_ list: [RegistryEntry]) -> [RegistryEntry] {
        var seen: [String: Int] = [:]
        var result: [RegistryEntry] = []
        for var entry in list {
            entry.path = Self.canonical(entry.path)
            if let index = seen[entry.path] {
                if entry.lastOpened > result[index].lastOpened { result[index].lastOpened = entry.lastOpened }
                result[index].tags = Array(Set(result[index].tags + entry.tags)).sorted()
            } else {
                seen[entry.path] = result.count
                result.append(entry)
            }
        }
        return result
    }

    func register(_ path: String) {
        let canonical = Self.canonical(path)
        let now = Date().timeIntervalSince1970 * 1000
        if let index = entries.firstIndex(where: { $0.path == canonical }) {
            entries[index].lastOpened = now
        } else {
            entries.append(RegistryEntry(path: canonical, name: (canonical as NSString).lastPathComponent,
                                         lastOpened: now, tags: [], uiState: nil))
        }
        persist()
    }

    func remove(_ path: String) {
        let canonical = Self.canonical(path)
        entries.removeAll { $0.path == canonical }
        persist()
    }

    func setTags(_ path: String, tags: [String]) {
        let canonical = Self.canonical(path)
        guard let index = entries.firstIndex(where: { $0.path == canonical }) else { return }
        entries[index].tags = tags
        persist()
    }

    func uiState(for path: String) -> ProjectUIState? {
        entries.first(where: { $0.path == Self.canonical(path) })?.uiState
    }

    func saveUIState(_ state: ProjectUIState, for path: String) {
        let canonical = Self.canonical(path)
        guard let index = entries.firstIndex(where: { $0.path == canonical }) else { return }
        guard entries[index].uiState != state else { return }
        entries[index].uiState = state
        persist()
    }

    /// Point an entry at a new folder location (rename, move, "Locate…").
    func move(from oldPath: String, to newPath: String) {
        let old = Self.canonical(oldPath), new = Self.canonical(newPath)
        if let index = entries.firstIndex(where: { $0.path == old }) {
            entries[index].path = new
            entries[index].name = (new as NSString).lastPathComponent
        } else {
            register(new)
        }
        entries = dedupe(entries)
        persist()
        HistoryStore.moveHistory(from: old, to: new)
    }

    func renameFolder(_ path: String, to newName: String) throws -> String {
        guard !newName.isEmpty, !newName.contains("/"), !newName.hasPrefix(".") else {
            throw VersoError("\"\(newName)\" is not a valid folder name.")
        }
        let newPath = ((path as NSString).deletingLastPathComponent as NSString).appendingPathComponent(newName)
        guard !FileManager.default.fileExists(atPath: newPath) else {
            throw VersoError("\"\(newName)\" already exists.")
        }
        try FileManager.default.moveItem(atPath: path, toPath: newPath)
        move(from: path, to: newPath)
        return newPath
    }

    func duplicate(_ path: String) throws -> String {
        let parent = (path as NSString).deletingLastPathComponent
        let base = (path as NSString).lastPathComponent
        var candidate = "\(base) copy"
        var index = 1
        while FileManager.default.fileExists(atPath: (parent as NSString).appendingPathComponent(candidate)) {
            index += 1
            candidate = "\(base) copy \(index)"
        }
        let newPath = (parent as NSString).appendingPathComponent(candidate)
        try ProjectFiles.copyProjectFolder(from: URL(fileURLWithPath: path), to: URL(fileURLWithPath: newPath))
        let tags = entries.first(where: { $0.path == Self.canonical(path) })?.tags ?? []
        register(newPath)
        setTags(newPath, tags: tags)
        return newPath
    }

    func trash(_ path: String) throws {
        try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
        remove(path)
    }
}

/// Template metadata (`template.json`).
struct TemplateInfo: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var description: String
    var mainFile: String
    var compiler: Compiler
    var builtIn: Bool = true
    var directory: URL?

    enum CodingKeys: String, CodingKey { case id, name, description, mainFile, compiler }
}

enum Templates {
    static var builtInDirectory: URL? {
        Bundle.main.url(forResource: "Templates", withExtension: "bundle")
    }

    static func list() -> [TemplateInfo] {
        var result: [TemplateInfo] = []
        let sources: [(URL?, Bool)] = [(builtInDirectory, true), (AppPaths.userTemplatesDirectory, false)]
        for (dir, builtIn) in sources {
            guard let dir, let items = try? FileManager.default.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: [.isDirectoryKey]) else { continue }
            for item in items.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
                guard let data = try? Data(contentsOf: item.appendingPathComponent("template.json")),
                      var info = try? JSONDecoder().decode(TemplateInfo.self, from: data) else { continue }
                info.id = item.lastPathComponent
                info.builtIn = builtIn
                info.directory = item
                result.append(info)
            }
        }
        // Blank first, the sample project last — like the original dialog order.
        return result.sorted { a, b in
            func rank(_ t: TemplateInfo) -> Int { t.id == "blank" ? 0 : (t.id == "sample-project" ? 2 : 1) }
            return rank(a) != rank(b) ? rank(a) < rank(b) : (a.builtIn && !b.builtIn)
        }
    }

    /// Copy a template into `<parent>/<name>`; returns the new project folder.
    static func instantiate(_ template: TemplateInfo, name: String, parent: URL) throws -> URL {
        guard !name.isEmpty, !name.contains("/"), !name.contains("\\") else {
            throw VersoError("The name cannot contain / or \\.")
        }
        guard let source = template.directory else { throw VersoError("Template not found.") }
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        let target = parent.appendingPathComponent(name, isDirectory: true)
        guard !FileManager.default.fileExists(atPath: target.path) else {
            throw VersoError("A project named \"\(name)\" already exists.")
        }
        try FileManager.default.copyItem(at: source, to: target)
        try? FileManager.default.removeItem(at: target.appendingPathComponent("template.json"))
        if ProjectConfig.read(root: target) == nil {
            var config = ProjectConfig()
            config.mainFile = template.mainFile
            config.compiler = template.compiler
            try? config.write(root: target)
        }
        return target
    }

    /// Save a project as a reusable user template (without build output and Git data).
    static func saveProject(_ root: URL, asTemplateNamed name: String) throws {
        let id = name.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        guard !id.isEmpty else { throw VersoError("Please enter a template name.") }
        let target = AppPaths.userTemplatesDirectory.appendingPathComponent(id, isDirectory: true)
        guard !FileManager.default.fileExists(atPath: target.path) else {
            throw VersoError("A template named \"\(name)\" already exists.")
        }
        try FileManager.default.createDirectory(at: AppPaths.userTemplatesDirectory, withIntermediateDirectories: true)
        try ProjectFiles.copyProjectFolder(from: root, to: target)
        let config = ProjectConfig.read(root: root) ?? ProjectConfig()
        let manifest: [String: String] = [
            "id": id, "name": name,
            "description": "User template from \(root.lastPathComponent)",
            "mainFile": config.mainFile.isEmpty ? "main.tex" : config.mainFile,
            "compiler": config.compiler.rawValue,
        ]
        let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: target.appendingPathComponent("template.json"))
    }

    static func deleteUserTemplate(_ template: TemplateInfo) {
        guard !template.builtIn, let dir = template.directory else { return }
        try? FileManager.default.removeItem(at: dir)
    }
}

nonisolated struct VersoError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
