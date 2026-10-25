import Foundation

/// A fresh temporary folder (real path, symlinks resolved) that is deleted afterwards.
final class TemporaryFolder {
    let url: URL

    init() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("verso-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        url = base.resolvingSymlinksInPath()
    }

    deinit { try? FileManager.default.removeItem(at: url) }

    @discardableResult
    func write(_ relPath: String, _ content: String) throws -> URL {
        let file = url.appendingPathComponent(relPath)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(content.utf8).write(to: file)
        return file
    }

    func read(_ relPath: String) throws -> String {
        try String(contentsOf: url.appendingPathComponent(relPath), encoding: .utf8)
    }
}

/// Run a command synchronously (test setup only).
@discardableResult
func shell(_ executable: String, _ arguments: [String], in directory: URL) throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.currentDirectoryURL = directory
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    try process.run()
    process.waitUntilExit()
    return String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
}
