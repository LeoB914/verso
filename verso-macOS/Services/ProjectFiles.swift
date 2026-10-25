import CoreServices
import Foundation

/// A node in the project file tree.
nonisolated struct FileNode: Identifiable, Hashable {
    var name: String
    /// Path relative to the project root ("" for the root).
    var relPath: String
    var isDirectory: Bool
    var children: [FileNode]?

    var id: String { relPath.isEmpty ? "/" : relPath }
    var fileExtension: String { (name as NSString).pathExtension.lowercased() }
}

nonisolated enum FileKind {
    case text, image, pdf, binary

    static let textExtensions: Set<String> = [
        "tex", "ltx", "sty", "cls", "bib", "bst", "txt", "md", "csv", "tikz", "dtx", "ins", "cfg",
        "json", "log", "bbx", "cbx", "lbx", "def", "clo", "fd", "latexmkrc", "gitignore", "yml", "yaml", "xml", "",
    ]
    static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "tif", "tiff", "bmp", "heic", "webp", "svg", "eps"]

    static func of(_ path: String) -> FileKind {
        let ext = (path as NSString).pathExtension.lowercased()
        if ext == "pdf" { return .pdf }
        if imageExtensions.contains(ext) { return .image }
        if textExtensions.contains(ext) { return .text }
        return .binary
    }
}

/// How a text file is stored on disk.
nonisolated struct TextFormat: Equatable {
    var crlf = false
    var bom = false
    /// ISO Latin-1 instead of UTF-8.
    var latin1 = false
}

nonisolated enum ProjectFiles {
    static let ignoredDirectories: Set<String> = [ProjectConfig.directoryName, ".git", "node_modules"]
    static let searchableExtensions: Set<String> = ["tex", "ltx", "sty", "cls", "bib", "txt", "md", "csv", "tikz", "dtx", "ins", "cfg", "json"]

    /// File tree with folders first, ignored/hidden entries skipped.
    nonisolated static func tree(root: URL, showHidden: Bool = false) -> FileNode {
        var budget = 5000
        func walk(_ url: URL, _ rel: String) -> [FileNode] {
            guard let names = try? FileManager.default.contentsOfDirectory(atPath: url.path) else { return [] }
            var nodes: [FileNode] = []
            for name in names {
                guard budget > 0 else { break }
                if ignoredDirectories.contains(name) || (!showHidden && name.hasPrefix(".")) { continue }
                let child = url.appendingPathComponent(name)
                let relPath = rel.isEmpty ? name : "\(rel)/\(name)"
                var isDir: ObjCBool = false
                guard FileManager.default.fileExists(atPath: child.path, isDirectory: &isDir) else { continue }
                budget -= 1
                if isDir.boolValue {
                    nodes.append(FileNode(name: name, relPath: relPath, isDirectory: true, children: walk(child, relPath)))
                } else {
                    nodes.append(FileNode(name: name, relPath: relPath, isDirectory: false, children: nil))
                }
            }
            return nodes.sorted { a, b in
                a.isDirectory != b.isDirectory ? a.isDirectory : a.name.localizedStandardCompare(b.name) == .orderedAscending
            }
        }
        return FileNode(name: root.lastPathComponent, relPath: "", isDirectory: true, children: walk(root, ""))
    }

    /// Relative paths of all files matching `filter` (ignored directories skipped).
    nonisolated static func collectFiles(root: URL, maxDepth: Int = 10, filter: (String) -> Bool) -> [String] {
        var result: [String] = []
        func walk(_ url: URL, _ rel: String, _ depth: Int) {
            guard depth <= maxDepth, result.count < 5000,
                  let names = try? FileManager.default.contentsOfDirectory(atPath: url.path) else { return }
            for name in names where !ignoredDirectories.contains(name) && !name.hasPrefix(".") {
                let child = url.appendingPathComponent(name)
                let relPath = rel.isEmpty ? name : "\(rel)/\(name)"
                var isDir: ObjCBool = false
                guard FileManager.default.fileExists(atPath: child.path, isDirectory: &isDir) else { continue }
                if isDir.boolValue { walk(child, relPath, depth + 1) } else if filter(name) { result.append(relPath) }
            }
        }
        walk(root, "", 0)
        return result.sorted()
    }

    /// Resolve a project-relative path, refusing anything that escapes the project —
    /// lexically (`..`, absolute paths) or through a symlink that points outside.
    nonisolated static func resolve(root: URL, _ relPath: String) -> URL? {
        let url = root.appendingPathComponent(relPath).standardizedFileURL
        guard isInside(url.path, root.standardizedFileURL.path) else { return nil }
        // The nearest existing ancestor (or the path itself) must stay inside the
        // project once symlinks are resolved; paths that do not exist yet are checked
        // through their parent folder.
        var existing = url
        while !FileManager.default.fileExists(atPath: existing.path) && existing.path != "/" {
            existing.deleteLastPathComponent()
        }
        let realRoot = root.resolvingSymlinksInPath().path
        if isSymlink(url), !FileManager.default.fileExists(atPath: url.path) { return nil } // dangling link
        guard isInside(existing.resolvingSymlinksInPath().path, realRoot) else { return nil }
        return url
    }

    nonisolated private static func isInside(_ path: String, _ root: String) -> Bool {
        let base = root.hasSuffix("/") ? String(root.dropLast()) : root
        return path == base || path.hasPrefix(base + "/")
    }

    nonisolated private static func isSymlink(_ url: URL) -> Bool {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType) == .typeSymbolicLink
    }

    /// Delete symlinks under `root` that point outside it or nowhere (e.g. from a ZIP).
    nonisolated static func removeEscapingSymlinks(in root: URL) {
        let realRoot = root.resolvingSymlinksInPath().path
        guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isSymbolicLinkKey]) else { return }
        for case let url as URL in enumerator {
            guard (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true else { continue }
            let target = url.resolvingSymlinksInPath()
            if !FileManager.default.fileExists(atPath: target.path) || !isInside(target.path, realRoot) {
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    /// Read a text file; keeps track of BOM, CRLF and Latin-1 so saving preserves them.
    nonisolated static func readText(_ url: URL) throws -> (text: String, format: TextFormat) {
        var data = try Data(contentsOf: url)
        var format = TextFormat()
        if data.starts(with: [0xEF, 0xBB, 0xBF]) {
            data.removeFirst(3)
            format.bom = true
        }
        var text: String
        if let utf8 = String(data: data, encoding: .utf8) {
            text = utf8
        } else {
            // Not valid UTF-8: older LaTeX files (inputenc latin1) — keep that encoding.
            text = String(data: data, encoding: .isoLatin1) ?? ""
            format.latin1 = true
        }
        format.crlf = text.contains("\r\n")
        if format.crlf { text = text.replacingOccurrences(of: "\r\n", with: "\n") }
        return (text, format)
    }

    /// Write a text file atomically in `format`. Returns the format actually written:
    /// text that Latin-1 cannot represent is saved as UTF-8 instead of losing characters.
    @discardableResult
    nonisolated static func writeText(_ text: String, to url: URL, format: TextFormat = TextFormat()) throws -> TextFormat {
        var written = format
        let output = format.crlf ? text.replacingOccurrences(of: "\n", with: "\r\n") : text
        var data: Data
        if format.latin1, let latin1 = output.data(using: .isoLatin1, allowLossyConversion: false) {
            data = latin1
        } else {
            written.latin1 = false
            data = Data(((format.bom && !format.latin1) ? "\u{FEFF}" : "").utf8) + Data(output.utf8)
        }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
        return written
    }

    /// Path of `target` relative to the folder `base` (both project-relative), e.g.
    /// from "thesis" to "figures/a" → "../figures/a".
    nonisolated static func relativePath(from base: String, to target: String) -> String {
        let baseParts = base.split(separator: "/").map(String.init)
        let targetParts = target.split(separator: "/").map(String.init)
        var common = 0
        while common < baseParts.count, common < targetParts.count - 1, baseParts[common] == targetParts[common] {
            common += 1
        }
        let ups = Array(repeating: "..", count: baseParts.count - common)
        return (ups + targetParts[common...]).joined(separator: "/")
    }

    /// Copy a project folder without build output, Git data and node_modules.
    static func copyProjectFolder(from source: URL, to target: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: target, withIntermediateDirectories: true)
        for name in try fm.contentsOfDirectory(atPath: source.path) {
            if name == ".git" || name == "node_modules" { continue }
            let from = source.appendingPathComponent(name), to = target.appendingPathComponent(name)
            if name == ProjectConfig.directoryName {
                try fm.createDirectory(at: to, withIntermediateDirectories: true)
                for inner in try fm.contentsOfDirectory(atPath: from.path) where inner != "build" {
                    try fm.copyItem(at: from.appendingPathComponent(inner), to: to.appendingPathComponent(inner))
                }
                continue
            }
            try fm.copyItem(at: from, to: to)
        }
    }

    /// Export a project as ZIP (without build output / Git) using `ditto`.
    static func exportZip(root: URL, to destination: URL) async throws {
        let staging = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let copy = staging.appendingPathComponent(root.lastPathComponent)
        try copyProjectFolder(from: root, to: copy)
        defer { try? FileManager.default.removeItem(at: staging) }
        try? FileManager.default.removeItem(at: destination)
        let result = await ProcessRunner.run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", copy.path, destination.path], timeout: 120)
        if result.status != 0 { throw VersoError("ZIP export failed: \(result.output)") }
    }

    /// Import a ZIP (e.g. an Overleaf download) into a new project folder.
    static func importZip(_ zip: URL, into parent: URL) async throws -> URL {
        let staging = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: staging) }
        let result = await ProcessRunner.run("/usr/bin/ditto", ["-x", "-k", zip.path, staging.path], timeout: 120)
        if result.status != 0 { throw VersoError("Could not extract the ZIP: \(result.output)") }
        var content = staging
        let entries = (try? FileManager.default.contentsOfDirectory(atPath: staging.path))?
            .filter { $0 != "__MACOSX" && !$0.hasPrefix(".") } ?? []
        var isDir: ObjCBool = false
        if entries.count == 1, FileManager.default.fileExists(atPath: staging.appendingPathComponent(entries[0]).path, isDirectory: &isDir), isDir.boolValue {
            content = staging.appendingPathComponent(entries[0])
        }
        try? FileManager.default.removeItem(at: content.appendingPathComponent("__MACOSX"))
        // ditto keeps symlinks from the archive; never let one point out of the project.
        removeEscapingSymlinks(in: content)
        let baseName = zip.deletingPathExtension().lastPathComponent
        var name = baseName
        var counter = 1
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        while FileManager.default.fileExists(atPath: parent.appendingPathComponent(name).path) {
            counter += 1
            name = "\(baseName) \(counter)"
        }
        let target = parent.appendingPathComponent(name)
        try FileManager.default.moveItem(at: content, to: target)
        return target
    }
}

/// One file-system event from the watcher.
nonisolated struct FileEvent {
    var path: String
    var flags: FSEventStreamEventFlags

    private func has(_ flag: Int) -> Bool { flags & FSEventStreamEventFlags(flag) != 0 }

    /// Files or folders appeared, disappeared or were renamed (the tree must be rebuilt).
    var changesStructure: Bool {
        has(kFSEventStreamEventFlagItemCreated) || has(kFSEventStreamEventFlagItemRemoved)
            || has(kFSEventStreamEventFlagItemRenamed) || mustRescan
    }

    /// FSEvents could not report details — re-check everything.
    var mustRescan: Bool {
        has(kFSEventStreamEventFlagMustScanSubDirs) || has(kFSEventStreamEventFlagRootChanged)
            || has(kFSEventStreamEventFlagUserDropped) || has(kFSEventStreamEventFlagKernelDropped)
    }
}

/// FSEvents-based recursive watcher for the project folder.
nonisolated final class FileWatcher {
    private var stream: FSEventStreamRef?
    private let callback: ([FileEvent]) -> Void

    init(path: String, callback: @escaping ([FileEvent]) -> Void) {
        self.callback = callback
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
                                           retain: nil, release: nil, copyDescription: nil)
        let flags = UInt32(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagUseCFTypes)
        stream = FSEventStreamCreate(nil, { _, info, count, paths, eventFlags, _ in
            guard let info else { return }
            let watcher = Unmanaged<FileWatcher>.fromOpaque(info).takeUnretainedValue()
            let array = Unmanaged<CFArray>.fromOpaque(paths).takeUnretainedValue() as? [String] ?? []
            let events = array.prefix(count).enumerated().map { index, path in
                // FSEvents reports real paths (/private/var/… for /var/…).
                FileEvent(path: URL(fileURLWithPath: path).resolvingSymlinksInPath().path, flags: eventFlags[index])
            }
            watcher.callback(events)
        }, &context, [path] as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.3, flags)
        if let stream {
            FSEventStreamSetDispatchQueue(stream, DispatchQueue.main)
            FSEventStreamStart(stream)
        }
    }

    func stop() {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
        self.stream = nil
    }

    deinit { stop() }
}
