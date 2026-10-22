import CryptoKit
import Foundation

/// A snapshot of all text files in a project.
nonisolated struct Snapshot: Codable, Identifiable, Hashable {
    var id: String
    /// Milliseconds since 1970.
    var timestamp: Double
    /// relPath → blob hash
    var files: [String: String]
    var images: [String: String]?
    var label: String?
    var reason: String

    var date: Date { Date(timeIntervalSince1970: timestamp / 1000) }
}

/// Snapshot history, independent of Git. Same on-disk format as the Electron
/// version: `history/<projectId>/index.json` + gzip blobs addressed by sha256.
nonisolated enum HistoryStore {
    static let autoReason = "Auto snapshot"
    private static let textExtensions: Set<String> = ["tex", "ltx", "sty", "cls", "bib", "txt", "md", "csv", "tikz", "json", "cfg"]
    private static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "svg", "webp"]
    private static let lock = NSLock()

    static func projectId(_ root: String) -> String {
        let digest = SHA256.hash(data: Data(root.utf8))
        return String(digest.map { String(format: "%02x", $0) }.joined().prefix(16))
    }

    static func directory(_ root: String) -> URL {
        AppPaths.historyDirectory.appendingPathComponent(projectId(root), isDirectory: true)
    }

    private static func blobs(_ root: String) -> URL { directory(root).appendingPathComponent("blobs", isDirectory: true) }
    private static func indexURL(_ root: String) -> URL { directory(root).appendingPathComponent("index.json") }

    static func list(_ root: String) -> [Snapshot] {
        guard let data = try? Data(contentsOf: indexURL(root)) else { return [] }
        return (try? JSONDecoder().decode([Snapshot].self, from: data)) ?? []
    }

    private static func writeIndex(_ root: String, _ snapshots: [Snapshot]) throws {
        try FileManager.default.createDirectory(at: directory(root), withIntermediateDirectories: true)
        try JSONEncoder().encode(snapshots).write(to: indexURL(root), options: .atomic)
    }

    static func hash(_ content: String) -> String {
        SHA256.hash(data: Data(content.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func storeBlob(_ root: String, _ content: String) -> String {
        let digest = hash(content)
        let url = blobs(root).appendingPathComponent(digest + ".gz")
        if !FileManager.default.fileExists(atPath: url.path) {
            try? FileManager.default.createDirectory(at: blobs(root), withIntermediateDirectories: true)
            try? Gzip.compress(Data(content.utf8)).write(to: url, options: .atomic)
        }
        return digest
    }

    static func readBlob(_ root: String, _ hash: String) -> String? {
        guard let data = try? Data(contentsOf: blobs(root).appendingPathComponent(hash + ".gz")),
              let raw = Gzip.decompress(data) else { return nil }
        return String(decoding: raw, as: UTF8.self)
    }

    private static func collect(_ root: URL, extensions: Set<String>) -> [String] {
        ProjectFiles.collectFiles(root: root) { extensions.contains(($0 as NSString).pathExtension.lowercased()) }
    }

    /// Create a snapshot. `overrides` carries unsaved editor content (relPath → text).
    @discardableResult
    static func create(root: URL, reason: String, label: String? = nil, overrides: [String: String] = [:]) -> Snapshot? {
        lock.lock()
        defer { lock.unlock() }
        let key = ProjectRegistry.canonicalPath(root.path)
        var files: [String: String] = [:]
        for rel in collect(root, extensions: textExtensions) {
            guard let content = try? ProjectFiles.readText(root.appendingPathComponent(rel)).text,
                  content.utf16.count <= 2_000_000 else { continue }
            files[rel] = content
        }
        for (rel, content) in overrides { files[rel] = content }
        guard !files.isEmpty else { return nil }
        var stored: [String: String] = [:]
        for (rel, content) in files { stored[rel] = storeBlob(key, content) }
        var storedImages: [String: String] = [:]
        for rel in collect(root, extensions: imageExtensions) {
            guard let data = try? Data(contentsOf: root.appendingPathComponent(rel)), data.count <= 10_000_000 else { continue }
            storedImages[rel] = storeBlob(key, data.base64EncodedString())
        }

        var snapshots = list(key)
        // Periodic and on-open snapshots only record actual changes.
        if [autoReason, "Opened project"].contains(reason), label == nil, let latest = snapshots.last,
           latest.files == stored, (latest.images ?? [:]) == storedImages {
            return latest
        }
        let now = Date().timeIntervalSince1970 * 1000
        let id = String(Int(now), radix: 36) + "-" + String(format: "%06x", Int.random(in: 0..<0xFFFFFF))
        let snapshot = Snapshot(id: id, timestamp: now, files: stored, images: storedImages, label: label, reason: reason)
        snapshots.append(snapshot)
        try? writeIndex(key, snapshots)
        return snapshot
    }

    static func contents(root: URL, snapshot: Snapshot) -> [String: String] {
        let key = ProjectRegistry.canonicalPath(root.path)
        var result: [String: String] = [:]
        for (rel, hash) in snapshot.files {
            if let content = readBlob(key, hash) { result[rel] = content }
        }
        return result
    }

    /// Restore files from a snapshot (all when `only` is nil). The current state is snapshotted first.
    static func restore(root: URL, snapshot: Snapshot, only: String? = nil, overrides: [String: String] = [:]) -> [String] {
        let contents = contents(root: root, snapshot: snapshot)
        create(root: root, reason: "Before restore", overrides: overrides)
        var restored: [String] = []
        for (rel, content) in contents where only == nil || only == rel {
            guard let url = ProjectFiles.resolve(root: root, rel) else { continue }
            let existing = try? ProjectFiles.readText(url)
            if existing?.text == content { continue }
            try? ProjectFiles.writeText(content, to: url, crlf: existing?.crlf ?? false, bom: existing?.bom ?? false)
            restored.append(rel)
        }
        return restored
    }

    /// Retention: keep labelled snapshots, everything from the last 7 days, then one per day for 90 days.
    static func prune(root: URL) {
        lock.lock()
        defer { lock.unlock() }
        let key = ProjectRegistry.canonicalPath(root.path)
        let snapshots = list(key)
        let now = Date().timeIntervalSince1970 * 1000
        let day = 86_400_000.0
        var keep: [Snapshot] = []
        var lastPerDay: [String: Snapshot] = [:]
        let formatter = ISO8601DateFormatter()
        for snapshot in snapshots {
            let age = (now - snapshot.timestamp) / day
            if snapshot.label != nil || age <= 7 { keep.append(snapshot); continue }
            if age <= 97 {
                let dayKey = String(formatter.string(from: snapshot.date).prefix(10))
                if let previous = lastPerDay[dayKey], previous.timestamp >= snapshot.timestamp { continue }
                lastPerDay[dayKey] = snapshot
            }
        }
        keep.append(contentsOf: lastPerDay.values)
        keep.sort { $0.timestamp < $1.timestamp }
        guard keep.count < snapshots.count else { return }
        try? writeIndex(key, keep)
        var referenced = Set<String>()
        for snapshot in keep {
            referenced.formUnion(snapshot.files.values)
            referenced.formUnion((snapshot.images ?? [:]).values)
        }
        for blob in (try? FileManager.default.contentsOfDirectory(atPath: blobs(key).path)) ?? [] {
            if !referenced.contains(blob.replacingOccurrences(of: ".gz", with: "")) {
                try? FileManager.default.removeItem(at: blobs(key).appendingPathComponent(blob))
            }
        }
    }

    /// History follows a project when its folder is renamed or located again.
    static func moveHistory(from oldPath: String, to newPath: String) {
        let from = directory(oldPath), to = directory(newPath)
        guard from != to, FileManager.default.fileExists(atPath: from.path),
              !FileManager.default.fileExists(atPath: to.path) else { return }
        try? FileManager.default.moveItem(at: from, to: to)
    }
}

/// Minimal gzip (RFC 1952) wrapper around the system DEFLATE implementation.
nonisolated enum Gzip {
    private static let crcTable: [UInt32] = (0..<256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func crc32(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in data { crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8) }
        return crc ^ 0xFFFF_FFFF
    }

    static func compress(_ data: Data) throws -> Data {
        let deflated = try (data as NSData).compressed(using: .zlib) as Data
        var out = Data([0x1F, 0x8B, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0x03])
        out.append(deflated)
        var crc = crc32(data).littleEndian
        var size = UInt32(truncatingIfNeeded: data.count).littleEndian
        out.append(Data(bytes: &crc, count: 4))
        out.append(Data(bytes: &size, count: 4))
        return out
    }

    static func decompress(_ data: Data) -> Data? {
        let bytes = [UInt8](data)
        guard bytes.count > 18, bytes[0] == 0x1F, bytes[1] == 0x8B, bytes[2] == 8 else { return nil }
        let flags = bytes[3]
        var index = 10
        if flags & 0x04 != 0 { index += 2 + Int(bytes[index]) | (Int(bytes[index + 1]) << 8) }
        if flags & 0x08 != 0 { while index < bytes.count && bytes[index] != 0 { index += 1 }; index += 1 }
        if flags & 0x10 != 0 { while index < bytes.count && bytes[index] != 0 { index += 1 }; index += 1 }
        if flags & 0x02 != 0 { index += 2 }
        guard index < bytes.count - 8 else { return nil }
        let body = Data(bytes[index..<(bytes.count - 8)])
        return try? (body as NSData).decompressed(using: .zlib) as Data
    }
}
