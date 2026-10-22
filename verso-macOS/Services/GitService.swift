import Foundation

nonisolated struct GitFileStatus: Identifiable, Hashable {
    var path: String
    /// Porcelain status letter of the index (staged) or the work tree.
    var indexStatus: Character
    var workTreeStatus: Character

    var id: String { path }
    var isStaged: Bool { indexStatus != " " && indexStatus != "?" }
    var isUnstaged: Bool { workTreeStatus != " " }
    var displayStatus: String {
        if indexStatus == "?" { return "U" }
        if isStaged { return String(indexStatus) }
        return String(workTreeStatus)
    }
}

nonisolated struct GitStatus {
    var branch: String?
    var ahead = 0
    var behind = 0
    var files: [GitFileStatus] = []
}

nonisolated struct GitCommit: Identifiable, Hashable {
    var hash: String
    var shortHash: String
    var author: String
    var date: Date
    var subject: String
    var id: String { hash }
}

/// Thin wrapper around the system `git` binary. Credentials come from the
/// user's own SSH agent / credential helper.
nonisolated enum GitService {
    static var gitPath: String? { ProcessRunner.which("git") }

    static func isRepo(_ root: URL) -> Bool {
        FileManager.default.fileExists(atPath: root.appendingPathComponent(".git").path)
    }

    @discardableResult
    static func run(_ root: URL, _ args: [String], timeout: TimeInterval = 60) async throws -> String {
        guard let git = gitPath else { throw VersoError("Git is not installed (install the Xcode command line tools).") }
        let result = await ProcessRunner.run(git, args, cwd: root, timeout: timeout,
                                             extraEnv: ["GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"])
        if result.status != 0 {
            throw VersoError(result.output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                             ? "git \(args.first ?? "") failed" : result.output.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return result.output
    }

    static func status(_ root: URL) async throws -> GitStatus {
        let output = try await run(root, ["status", "--porcelain=v1", "-b", "-uall"])
        var status = GitStatus()
        for line in output.split(separator: "\n", omittingEmptySubsequences: true) {
            if line.hasPrefix("## ") {
                let header = line.dropFirst(3)
                let branchPart = header.split(separator: " ").first.map(String.init) ?? ""
                status.branch = branchPart.components(separatedBy: "...").first
                if status.branch?.hasPrefix("No commits yet on ") == true || header.hasPrefix("No commits yet on ") {
                    status.branch = header.replacingOccurrences(of: "No commits yet on ", with: "")
                }
                if let ahead = header.range(of: #"ahead (\d+)"#, options: .regularExpression) {
                    status.ahead = Int(header[ahead].filter(\.isNumber)) ?? 0
                }
                if let behind = header.range(of: #"behind (\d+)"#, options: .regularExpression) {
                    status.behind = Int(header[behind].filter(\.isNumber)) ?? 0
                }
                continue
            }
            guard line.count > 3 else { continue }
            let chars = Array(line)
            var path = String(line.dropFirst(3))
            if let arrow = path.range(of: " -> ") { path = String(path[arrow.upperBound...]) }
            if path.hasPrefix("\"") && path.hasSuffix("\"") { path = String(path.dropFirst().dropLast()) }
            status.files.append(GitFileStatus(path: path, indexStatus: chars[0], workTreeStatus: chars[1]))
        }
        return status
    }

    static func log(_ root: URL, limit: Int = 50) async throws -> [GitCommit] {
        let output = try await run(root, ["log", "-n", "\(limit)", "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s"])
        return output.split(separator: "\n").compactMap { line in
            let parts = line.components(separatedBy: "\u{1F}")
            guard parts.count == 5 else { return nil }
            return GitCommit(hash: parts[0], shortHash: parts[1], author: parts[2],
                             date: Date(timeIntervalSince1970: Double(parts[3]) ?? 0), subject: parts[4])
        }
    }

    static func branches(_ root: URL) async throws -> [String] {
        let output = try await run(root, ["branch", "--format=%(refname:short)"])
        return output.split(separator: "\n").map(String.init)
    }

    static let latexGitignore = """
    # LaTeX build artifacts
    *.aux
    *.log
    *.out
    *.toc
    *.synctex.gz
    *.fls
    *.fdb_latexmk
    *.blg
    *.bbl

    # Verso
    .openleaf/build/

    # OS junk
    .DS_Store
    Thumbs.db

    """

    static func initRepo(_ root: URL) async throws {
        try await run(root, ["init"])
        let ignore = root.appendingPathComponent(".gitignore")
        let existing = (try? String(contentsOf: ignore, encoding: .utf8)) ?? ""
        if !existing.contains(".openleaf/build/") {
            let existingLines = Set(existing.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) })
            let missing = latexGitignore.components(separatedBy: "\n").filter { !$0.isEmpty && !existingLines.contains($0) }
            var content = existing
            if !content.isEmpty && !content.hasSuffix("\n") { content += "\n" }
            content += missing.joined(separator: "\n") + "\n"
            try content.write(to: ignore, atomically: true, encoding: .utf8)
        }
    }

    static func show(_ root: URL, commit: String) async throws -> String {
        try await run(root, ["show", "--stat", "--patch", "--format=fuller", commit])
    }
}
