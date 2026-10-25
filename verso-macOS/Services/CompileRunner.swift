import Foundation

nonisolated struct CompileOutcome {
    var status: Int32
    var canceled: Bool
    var timedOut: Bool
    var output: String
}

/// One latexmk run. `cancel()` terminates latexmk and the TeX processes it spawned.
nonisolated final class CompileRunner: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var canceled = false

    func run(executable: String, arguments: [String], cwd: URL, timeout: TimeInterval) async -> CompileOutcome {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async { [self] in
                let process = Process()
                process.executableURL = URL(fileURLWithPath: executable)
                process.arguments = arguments
                process.currentDirectoryURL = cwd
                // Keep TeX from wrapping log lines at 79 characters (breaks file:line: parsing).
                process.environment = ProcessRunner.environment(extra: ["max_print_line": "4096"])
                process.standardInput = FileHandle.nullDevice
                let pipe = Pipe()
                process.standardOutput = pipe
                process.standardError = pipe
                let buffer = OutputBuffer()
                pipe.fileHandleForReading.readabilityHandler = { buffer.append($0.availableData) }

                let group = DispatchGroup()
                group.enter()
                process.terminationHandler = { _ in group.leave() }
                do {
                    try process.run()
                } catch {
                    pipe.fileHandleForReading.readabilityHandler = nil
                    continuation.resume(returning: CompileOutcome(status: -1, canceled: false, timedOut: false,
                                                                  output: "Failed to start latexmk: \(error.localizedDescription)"))
                    return
                }
                lock.lock()
                self.process = process
                let alreadyCanceled = canceled
                lock.unlock()
                if alreadyCanceled { killTree(process.processIdentifier) }

                var timedOut = false
                if group.wait(timeout: .now() + timeout) == .timedOut {
                    timedOut = true
                    killTree(process.processIdentifier)
                    group.wait()
                }
                pipe.fileHandleForReading.readabilityHandler = nil
                buffer.append(pipe.fileHandleForReading.readDataToEndOfFile())
                lock.lock()
                let wasCanceled = canceled
                self.process = nil
                lock.unlock()
                continuation.resume(returning: CompileOutcome(status: process.terminationStatus, canceled: wasCanceled,
                                                              timedOut: timedOut, output: buffer.string))
            }
        }
    }

    func cancel() {
        lock.lock()
        canceled = true
        let pid = process?.processIdentifier
        lock.unlock()
        if let pid { killTree(pid) }
    }

    /// Terminate a process and all of its descendants (latexmk → pdflatex/biber).
    private func killTree(_ pid: Int32) {
        for child in childPIDs(of: pid) { killTree(child) }
        kill(pid, SIGTERM)
        DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { kill(pid, SIGKILL) }
    }

    private func childPIDs(of pid: Int32) -> [Int32] {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        task.arguments = ["-P", String(pid)]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        guard (try? task.run()) != nil else { return [] }
        task.waitUntilExit()
        let output = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        return output.split(whereSeparator: \.isNewline).compactMap { Int32($0) }
    }
}
