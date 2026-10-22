import Foundation

nonisolated struct ProcessResult {
    var status: Int32
    var output: String
    var timedOut: Bool
}

/// Runs external tools (latexmk, synctex, git, …) with argument arrays — never a shell string.
nonisolated enum ProcessRunner {
    /// PATH used for every child process: login-shell PATH + known TeX locations.
    nonisolated(unsafe) static var searchPath: [String] = defaultKnownDirectories()

    nonisolated static func environment(extra: [String: String] = [:]) -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        var paths = searchPath
        for entry in (env["PATH"] ?? "").split(separator: ":").map(String.init) where !paths.contains(entry) {
            paths.append(entry)
        }
        env["PATH"] = paths.joined(separator: ":")
        if env["LANG"] == nil { env["LANG"] = "en_US.UTF-8" }
        for (key, value) in extra { env[key] = value }
        return env
    }

    /// Run a tool to completion and capture stdout + stderr.
    nonisolated static func run(_ executable: String, _ arguments: [String], cwd: URL? = nil,
                                timeout: TimeInterval = 30, extraEnv: [String: String] = [:],
                                stdin: String? = nil) async -> ProcessResult {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: executable)
                process.arguments = arguments
                if let cwd { process.currentDirectoryURL = cwd }
                process.environment = environment(extra: extraEnv)
                let pipe = Pipe()
                process.standardOutput = pipe
                process.standardError = pipe
                let input = Pipe()
                process.standardInput = stdin == nil ? FileHandle.nullDevice : input

                let buffer = OutputBuffer()
                pipe.fileHandleForReading.readabilityHandler = { handle in
                    buffer.append(handle.availableData)
                }
                do {
                    try process.run()
                } catch {
                    pipe.fileHandleForReading.readabilityHandler = nil
                    continuation.resume(returning: ProcessResult(status: -1, output: "Failed to start \(executable): \(error.localizedDescription)", timedOut: false))
                    return
                }
                if let stdin {
                    input.fileHandleForWriting.write(stdin.data(using: .utf8) ?? Data())
                    try? input.fileHandleForWriting.close()
                }
                var timedOut = false
                let deadline = DispatchTime.now() + timeout
                let group = DispatchGroup()
                group.enter()
                process.terminationHandler = { _ in group.leave() }
                if group.wait(timeout: deadline) == .timedOut {
                    timedOut = true
                    process.terminate()
                    group.wait()
                }
                pipe.fileHandleForReading.readabilityHandler = nil
                buffer.append(pipe.fileHandleForReading.readDataToEndOfFile())
                continuation.resume(returning: ProcessResult(status: process.terminationStatus,
                                                             output: buffer.string, timedOut: timedOut))
            }
        }
    }

    /// Locate an executable in the search path.
    nonisolated static func which(_ name: String) -> String? {
        for dir in environment()["PATH"]?.split(separator: ":") ?? [] {
            let candidate = "\(dir)/\(name)"
            if FileManager.default.isExecutableFile(atPath: candidate) { return candidate }
        }
        return nil
    }

    nonisolated static func defaultKnownDirectories() -> [String] {
        var dirs = ["/Library/TeX/texbin"]
        let texlive = "/usr/local/texlive"
        if let years = try? FileManager.default.contentsOfDirectory(atPath: texlive) {
            for year in years.sorted().reversed() {
                let binRoot = "\(texlive)/\(year)/bin"
                for arch in (try? FileManager.default.contentsOfDirectory(atPath: binRoot)) ?? [] {
                    dirs.append("\(binRoot)/\(arch)")
                }
            }
        }
        dirs += ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        return dirs.filter { FileManager.default.fileExists(atPath: $0) }
    }

    /// GUI apps do not inherit the interactive shell's PATH: ask the login shell once.
    nonisolated static func resolveLoginShellPath() async {
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let begin = "__VERSO_PATH_BEGIN__", end = "__VERSO_PATH_END__"
        let result = await run(shell, ["-ilc", "printf '\(begin)%s\(end)' \"$PATH\""], timeout: 4)
        var shellPaths: [String] = []
        if let b = result.output.range(of: begin, options: .backwards),
           let e = result.output.range(of: end, range: b.upperBound..<result.output.endIndex) {
            shellPaths = result.output[b.upperBound..<e.lowerBound].split(separator: ":").map(String.init)
        }
        var merged: [String] = []
        for dir in shellPaths + defaultKnownDirectories() where !merged.contains(dir) {
            merged.append(dir)
        }
        searchPath = merged
    }
}

/// Thread-safe byte accumulator for pipe output.
nonisolated final class OutputBuffer: @unchecked Sendable {
    private var data = Data()
    private let lock = NSLock()

    nonisolated init() {}

    nonisolated func append(_ chunk: Data) {
        guard !chunk.isEmpty else { return }
        lock.lock()
        data.append(chunk)
        if data.count > 400_000 { data = data.suffix(200_000) }
        lock.unlock()
    }

    nonisolated var string: String {
        lock.lock()
        defer { lock.unlock() }
        return String(decoding: data, as: UTF8.self)
    }
}

/// A located TeX tool.
nonisolated struct TexTool: Identifiable {
    var name: String
    var path: String
    var version: String?
    var id: String { name }
}

/// Detected TeX installation.
nonisolated struct TexEnvironment {
    var tools: [String: TexTool] = [:]

    var available: Bool {
        tools["latexmk"] != nil && (tools["pdflatex"] != nil || tools["xelatex"] != nil || tools["lualatex"] != nil)
    }

    static let toolNames = ["latexmk", "pdflatex", "xelatex", "lualatex", "biber", "bibtex", "synctex", "texcount", "perl"]

    nonisolated static func detect() async -> TexEnvironment {
        await ProcessRunner.resolveLoginShellPath()
        var env = TexEnvironment()
        for name in toolNames {
            guard let path = ProcessRunner.which(name) else { continue }
            let result = await ProcessRunner.run(path, ["--version"], timeout: 4)
            let firstLine = result.output.split(whereSeparator: \.isNewline)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .first { !$0.isEmpty }
            env.tools[name] = TexTool(name: name, path: path, version: firstLine.map { String($0.prefix(120)) })
        }
        return env
    }
}
