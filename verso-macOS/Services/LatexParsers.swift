import Foundation

// MARK: - Regex helpers

nonisolated extension NSRegularExpression {
    convenience init(_ pattern: String, options: NSRegularExpression.Options = []) {
        // Patterns are compile-time constants; a failure is a programming error.
        try! self.init(pattern: pattern, options: options)
    }

    /// Capture groups of the first match (index 0 = whole match); nil groups become "".
    func groups(in text: String) -> [String]? {
        let ns = text as NSString
        guard let match = firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (0..<match.numberOfRanges).map { index in
            let range = match.range(at: index)
            return range.location == NSNotFound ? "" : ns.substring(with: range)
        }
    }

    func matches(_ text: String) -> Bool {
        firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
    }
}

// MARK: - Log parser

nonisolated enum LogLevel: String, CaseIterable {
    case error, warning, info

    var label: String {
        switch self {
        case .error: "Error"
        case .warning: "Warning"
        case .info: "Info"
        }
    }
}

nonisolated struct LogEntry: Identifiable, Hashable {
    let id = UUID()
    var level: LogLevel
    var file: String?
    var line: Int?
    var message: String
    var rawExcerpt: String?
}

/// LaTeX log parser for the `-file-line-error` output of pdfLaTeX/XeLaTeX/LuaLaTeX run by latexmk.
nonisolated enum LogParser {
    private static let fileLineError = NSRegularExpression(#"^(.+?\.(?:tex|ltx|sty|cls|bib)):(\d+): (.*)$"#)
    private static let bangError = NSRegularExpression(#"^! (.*)$"#)
    private static let lineRef = NSRegularExpression(#"^\s*l\.(\d+)"#)
    /// `(./main.tex` or `(/abs/path/main.tex` open-file markers.
    private static let openFile = NSRegularExpression(#"\((\.?/[^\s()]+\.tex)"#)
    private static let undefinedRef = NSRegularExpression(#"LaTeX Warning: (?:Reference|Label) [`']?([^']+)' on page \S+ undefined on input line (\d+)\."#)
    private static let undefinedCitation = NSRegularExpression(#"(?:LaTeX|Package natbib) Warning: Citation [`']?([^']+)' on page \S+ undefined on input line (\d+)\."#)
    private static let box = NSRegularExpression(#"^(Overfull|Underfull) \\[hv]box \((.*)\)"#)
    private static let packageWarning = NSRegularExpression(#"^Package (\S+) Warning: (.*)"#)
    private static let classWarning = NSRegularExpression(#"^Class (\S+) Warning: (.*)"#)
    private static let biberError = NSRegularExpression(#"Biber error: (.*)|^I found no \\[a-zA-Z]+ command|There were \d+ error messages"#)
    private static let emergency = NSRegularExpression(#"^! ==> (Fatal error occurred|Emergency stop)"#)

    static func parse(_ log: String) -> [LogEntry] {
        var entries: [LogEntry] = []
        var seen = Set<String>()
        var currentFile: String?
        let lines = log.components(separatedBy: .newlines)

        func clean(_ file: String?) -> String? {
            guard let file else { return nil }
            return file.hasPrefix("./") ? String(file.dropFirst(2)) : file
        }
        func push(_ level: LogLevel, _ file: String?, _ line: Int?, _ message: String, _ excerpt: String?) {
            let key = "\(level)|\(file ?? "")|\(line.map(String.init) ?? "")|\(message)"
            guard !seen.contains(key) else { return }
            seen.insert(key)
            entries.append(LogEntry(level: level, file: file, line: line, message: message, rawExcerpt: excerpt))
        }
        func excerpt(_ start: Int, _ count: Int) -> String {
            String(lines[start..<min(lines.count, start + count)].joined(separator: "\n").prefix(500))
        }

        var i = 0
        var inLatexmkSummary = false
        while i < lines.count {
            defer { i += 1 }
            let line = lines[i]
            if let open = openFile.groups(in: line) { currentFile = open[1] }

            if let m = fileLineError.groups(in: line) {
                push(.error, clean(m[1]), Int(m[2]), m[3].trimmingCharacters(in: .whitespaces), excerpt(i, 4))
                continue
            }
            if i + 1 < lines.count, let m = fileLineError.groups(in: line + lines[i + 1]),
               !fileLineError.matches(lines[i + 1]) {
                push(.error, clean(m[1]), Int(m[2]), m[3].trimmingCharacters(in: .whitespaces), excerpt(i + 1, 4))
                i += 1
                continue
            }
            if let m = bangError.groups(in: line), !emergency.matches(line) {
                var message = m[1].trimmingCharacters(in: .whitespaces)
                var j = i + 1
                while j < lines.count, !lineRef.matches(lines[j]),
                      !lines[j].trimmingCharacters(in: .whitespaces).isEmpty, !lines[j].hasPrefix("!") {
                    if !message.hasPrefix("LaTeX Error:"), lines[j].hasPrefix("LaTeX Error:") {
                        message = lines[j].trimmingCharacters(in: .whitespaces)
                    }
                    j += 1
                }
                var lineNumber: Int?
                for k in j..<min(lines.count, j + 5) {
                    if let ref = lineRef.groups(in: lines[k]) { lineNumber = Int(ref[1]); break }
                }
                push(.error, clean(currentFile), lineNumber, message, excerpt(i, 6))
                continue
            }
            if emergency.matches(line) {
                push(.error, clean(currentFile), nil, line.replacingOccurrences(of: "! ==> ", with: ""), nil)
                continue
            }
            if let m = undefinedRef.groups(in: line) {
                push(.warning, clean(currentFile), Int(m[2]), "Reference '\(m[1])' is undefined", line.trimmingCharacters(in: .whitespaces))
                continue
            }
            if let m = undefinedCitation.groups(in: line) {
                push(.warning, clean(currentFile), Int(m[2]), "Citation '\(m[1])' is undefined", line.trimmingCharacters(in: .whitespaces))
                continue
            }
            if let m = box.groups(in: line) {
                push(.info, clean(currentFile), nil, "\(m[1]) \\box (\(m[2]))", line.trimmingCharacters(in: .whitespaces))
                continue
            }
            if let m = packageWarning.groups(in: line) {
                push(.warning, clean(currentFile), nil, "Package \(m[1]): \(m[2].trimmingCharacters(in: .whitespaces))", line.trimmingCharacters(in: .whitespaces))
                continue
            }
            if let m = classWarning.groups(in: line) {
                push(.warning, clean(currentFile), nil, "Class \(m[1]): \(m[2].trimmingCharacters(in: .whitespaces))", line.trimmingCharacters(in: .whitespaces))
                continue
            }
            // latexmk's console summary names failing tools (e.g. Biber) that never reach the .log.
            if line.hasPrefix("Collected error summary") { inLatexmkSummary = true; continue }
            if inLatexmkSummary {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.isEmpty || line.hasPrefix("Latexmk:") { inLatexmkSummary = false } else {
                    push(.error, nil, nil, "latexmk: \(trimmed)", nil)
                }
                continue
            }
            if line.hasPrefix("Latexmk: Errors, so I did not complete making targets") ||
                line.range(of: #"^\S*biber: .*failed"#, options: .regularExpression) != nil {
                push(.error, nil, nil, line.trimmingCharacters(in: .whitespaces), nil)
                continue
            }
            if biberError.matches(line) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                push(.error, clean(currentFile), nil, "Biber: \(trimmed)", trimmed)
            }
        }
        return entries
    }
}

// MARK: - Error help database

struct ErrorHelp: Decodable {
    var id: String
    var pattern: String
    var title: String
    var explanation: String
    var fix: String
}

enum ErrorHelpDatabase {
    static let entries: [ErrorHelp] = {
        guard let url = Bundle.main.url(forResource: "latex-error-help", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([ErrorHelp].self, from: data)) ?? []
    }()

    private static var compiled: [(NSRegularExpression, ErrorHelp)] = entries.compactMap { entry in
        (try? NSRegularExpression(pattern: entry.pattern, options: .caseInsensitive)).map { ($0, entry) }
    }

    static func match(_ message: String) -> ErrorHelp? {
        compiled.first { $0.0.matches(message) }?.1
    }
}

// MARK: - SyncTeX output parser

nonisolated struct SynctexViewResult {
    var page: Int
    /// Left edge of the box in PDF points.
    var x: Double
    /// Baseline position in PDF points, measured from the top of the page.
    var y: Double
    var width: Double
    var height: Double
}

nonisolated struct SynctexEditResult {
    var file: String
    var line: Int
    var column: Int
}

nonisolated enum SynctexParser {
    private static func blocks(_ output: String) -> [String] {
        var result: [String] = []
        var rest = Substring(output)
        while let begin = rest.range(of: "SyncTeX result begin") {
            if let end = rest.range(of: "SyncTeX result end", range: begin.upperBound..<rest.endIndex) {
                result.append(String(rest[begin.upperBound..<end.lowerBound]))
                rest = rest[end.upperBound...]
            } else {
                result.append(String(rest[begin.upperBound...]))
                break
            }
        }
        if result.isEmpty && output.contains("Input:") { result.append(output) }
        return result
    }

    private static func field(_ block: String, _ name: String) -> String? {
        for line in block.split(whereSeparator: \.isNewline) where line.hasPrefix(name + ":") {
            return String(line.dropFirst(name.count + 1)).trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

    private static func number(_ block: String, _ name: String) -> Double? {
        field(block, name).flatMap(Double.init)
    }

    static func parseView(_ output: String) -> SynctexViewResult? {
        for block in blocks(output) {
            // h/v describe the box (left edge, baseline); x/y are a point inside it.
            guard let page = number(block, "Page"), let x = number(block, "h") ?? number(block, "x"),
                  let y = number(block, "v") ?? number(block, "y") else { continue }
            return SynctexViewResult(page: Int(page), x: x, y: y,
                                     width: number(block, "W") ?? 0, height: number(block, "H") ?? 0)
        }
        return nil
    }

    static func parseEdit(_ output: String) -> SynctexEditResult? {
        for block in blocks(output) {
            guard let file = field(block, "Input"), let line = number(block, "Line") else { continue }
            let cleaned = file.hasPrefix("./") ? String(file.dropFirst(2)) : file
            return SynctexEditResult(file: cleaned, line: Int(line), column: Int(number(block, "Column") ?? 0))
        }
        return nil
    }
}

// MARK: - texcount

nonisolated struct TexcountResult {
    struct FileCount: Identifiable {
        var file: String
        var words: Int
        var headers: Int
        var captions: Int
        var id: String { file }
    }

    var words: Int
    var headers: Int
    var captions: Int
    var files: [FileCount]

    /// Parse `texcount -brief` output: `words+headers+captions:file` lines.
    static func parseBrief(_ output: String) -> TexcountResult? {
        let regex = NSRegularExpression(#"^(\d+)\+(\d+)\+(\d+):(.*)$"#)
        var result = TexcountResult(words: 0, headers: 0, captions: 0, files: [])
        var matched = false
        for raw in output.split(whereSeparator: \.isNewline) {
            guard let m = regex.groups(in: raw.trimmingCharacters(in: .whitespaces)) else { continue }
            matched = true
            let w = Int(m[1]) ?? 0, h = Int(m[2]) ?? 0, c = Int(m[3]) ?? 0
            var file = m[4].trimmingCharacters(in: .whitespaces)
            if file.hasPrefix("./") { file.removeFirst(2) }
            if file.isEmpty || file.hasPrefix("File(s) total") { if file.hasPrefix("File(s) total") { continue }; file = "(main)" }
            result.words += w
            result.headers += h
            result.captions += c
            result.files.append(FileCount(file: file, words: w, headers: h, captions: c))
        }
        return matched ? result : nil
    }
}

// MARK: - Structure parser

nonisolated struct SectionNode: Identifiable, Hashable {
    var command: String
    /// 0 = part, 1 = chapter, 2 = section, …
    var level: Int
    var title: String
    var position: Int
    var line: Int
    var file: String = ""
    var id: String { "\(file):\(position)" }
}

nonisolated enum ReferenceKind {
    case label, ref, cite, input, includegraphics, bibliography, bibresource
}

nonisolated struct ReferenceUse {
    var kind: ReferenceKind
    var command: String
    var key: String
    var position: Int
    var line: Int
}

nonisolated struct DefinitionEntry: Hashable {
    enum Kind { case command, environment, operatorName }
    var kind: Kind
    var name: String
    var argCount: Int
}

nonisolated struct DocumentStructure {
    var sections: [SectionNode] = []
    var references: [ReferenceUse] = []
    var definitions: [DefinitionEntry] = []
}

/// LaTeX structure scanner (sections, labels/refs/cites, inputs, definitions),
/// ignoring comments and verbatim regions. Offsets are UTF-16 based, matching NSString.
nonisolated enum LatexStructure {
    static let sectionLevels: [String: Int] = [
        "part": 0, "chapter": 1, "section": 2, "subsection": 3,
        "subsubsection": 4, "paragraph": 5, "subparagraph": 6,
    ]
    private static let verbatimEnvironments: Set<String> = ["verbatim", "verbatim*", "lstlisting", "minted", "comment"]
    private static let refCommands: Set<String> = ["ref", "eqref", "autoref", "cref", "Cref", "pageref", "vref", "label"]
    private static let citeCommands: Set<String> = [
        "cite", "citep", "citet", "citeauthor", "citeyear", "Citep", "Citet", "parencite", "Parencite",
        "textcite", "Textcite", "autocite", "Autocite", "footcite", "footcitetext", "nocite",
    ]
    private static let inputCommands: Set<String> = ["input", "include", "subfile"]

    private static let backslash: UInt16 = 92, percent: UInt16 = 37, openBrace: UInt16 = 123,
                       closeBrace: UInt16 = 125, openBracket: UInt16 = 91, closeBracket: UInt16 = 93,
                       newline: UInt16 = 10, star: UInt16 = 42

    private static func isLetter(_ c: UInt16) -> Bool { (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c == 64 }
    private static func isSpace(_ c: UInt16) -> Bool { c == 32 || c == 9 || c == 10 || c == 13 }

    static func parse(_ text: String) -> DocumentStructure {
        let chars = Array(text.utf16)
        let n = chars.count
        var result = DocumentStructure()

        var lineStarts = [0]
        for (index, c) in chars.enumerated() where c == newline { lineStarts.append(index + 1) }
        func lineOf(_ pos: Int) -> Int {
            var low = 0, high = lineStarts.count - 1
            while low < high {
                let mid = (low + high + 1) / 2
                if lineStarts[mid] <= pos { low = mid } else { high = mid - 1 }
            }
            return low + 1
        }
        func string(_ from: Int, _ to: Int) -> String {
            String(utf16CodeUnits: Array(chars[from..<to]), count: to - from)
        }
        func readName(_ pos: Int) -> (name: String, end: Int)? {
            guard pos < n, chars[pos] == backslash, pos + 1 < n else { return nil }
            var end = pos + 1
            if isLetter(chars[end]) {
                while end < n && isLetter(chars[end]) { end += 1 }
                var name = string(pos + 1, end)
                if end < n && chars[end] == star { name += "*"; end += 1 }
                return (name, end)
            }
            end += 1
            return (string(pos + 1, end), end)
        }
        func readGroup(_ pos: Int, open: UInt16, close: UInt16) -> (value: String, end: Int)? {
            var i = pos
            while i < n && isSpace(chars[i]) { i += 1 }
            guard i < n, chars[i] == open else { return nil }
            let start = i + 1
            var depth = 1
            i += 1
            while i < n {
                let c = chars[i]
                if c == backslash { i += 2; continue }
                if c == open { depth += 1 } else if c == close {
                    depth -= 1
                    if depth == 0 { return (string(start, i), i + 1) }
                }
                i += 1
            }
            return nil
        }

        var i = 0
        while i < n {
            let c = chars[i]
            if c == percent {
                while i < n && chars[i] != newline { i += 1 }
                continue
            }
            guard c == backslash, let cmd = readName(i) else { i += 1; continue }
            let name = cmd.name

            // Verbatim-like regions are skipped entirely.
            if name == "verb" || name == "verb*" {
                var j = cmd.end
                if j < n {
                    let delimiter = chars[j]
                    j += 1
                    while j < n && chars[j] != delimiter && chars[j] != newline { j += 1 }
                }
                i = min(n, j + 1)
                continue
            }
            if name == "begin", let arg = readGroup(cmd.end, open: openBrace, close: closeBrace),
               verbatimEnvironments.contains(arg.value) {
                let marker = Array("\\end{\(arg.value)}".utf16)
                var j = arg.end
                while j + marker.count <= n && !chars[j..<(j + marker.count)].elementsEqual(marker) { j += 1 }
                i = min(n, j + marker.count)
                continue
            }

            let baseName = name.hasSuffix("*") ? String(name.dropLast()) : name
            if let level = sectionLevels[baseName] {
                let bracket = readGroup(cmd.end, open: openBracket, close: closeBracket)
                if let braced = readGroup(bracket?.end ?? cmd.end, open: openBrace, close: closeBrace) {
                    let title = braced.value.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                        .trimmingCharacters(in: .whitespaces)
                    result.sections.append(SectionNode(command: name, level: level, title: String(title.prefix(120)),
                                                       position: i, line: lineOf(i)))
                    i = braced.end
                    continue
                }
            }

            let isRef = refCommands.contains(name), isCite = citeCommands.contains(name)
            let isInput = inputCommands.contains(name)
            let isBib = name == "bibliography" || name == "addbibresource"
            if isRef || isCite || isInput || isBib || name == "includegraphics" {
                let bracket = readGroup(cmd.end, open: openBracket, close: closeBracket)
                var after = bracket?.end ?? cmd.end
                // natbib/biblatex allow a second optional argument.
                if isCite, let second = readGroup(after, open: openBracket, close: closeBracket) { after = second.end }
                if let braced = readGroup(after, open: openBrace, close: closeBrace) {
                    let kind: ReferenceKind = isRef ? (name == "label" ? .label : .ref)
                        : isCite ? .cite : isInput ? .input
                        : name == "includegraphics" ? .includegraphics
                        : name == "bibliography" ? .bibliography : .bibresource
                    let splitKeys = isCite || isBib || name == "cref" || name == "Cref"
                    let keys = splitKeys ? braced.value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                                         : [braced.value.trimmingCharacters(in: .whitespaces)]
                    for key in keys where !key.isEmpty {
                        result.references.append(ReferenceUse(kind: kind, command: name, key: key, position: i, line: lineOf(i)))
                    }
                    i = braced.end
                    continue
                }
            }

            if ["newcommand", "renewcommand", "providecommand", "DeclareMathOperator", "newcommand*", "renewcommand*", "DeclareMathOperator*"].contains(name) {
                var defName: String?
                var after = cmd.end
                if let braced = readGroup(cmd.end, open: openBrace, close: closeBrace) {
                    defName = braced.value
                    after = braced.end
                } else {
                    var j = cmd.end
                    while j < n && isSpace(chars[j]) { j += 1 }
                    if let short = readName(j) { defName = short.name; after = short.end }
                }
                if var defName {
                    if defName.hasPrefix("\\") { defName.removeFirst() }
                    var args = 0
                    if let bracket = readGroup(after, open: openBracket, close: closeBracket) {
                        args = Int(bracket.value.trimmingCharacters(in: .whitespaces)) ?? 0
                    }
                    result.definitions.append(DefinitionEntry(kind: name.hasPrefix("Declare") ? .operatorName : .command,
                                                              name: defName, argCount: args))
                }
                i = after
                continue
            }
            if name == "newenvironment" || name == "renewenvironment" {
                if let braced = readGroup(cmd.end, open: openBrace, close: closeBrace) {
                    var args = 0
                    if let bracket = readGroup(braced.end, open: openBracket, close: closeBracket) {
                        args = Int(bracket.value.trimmingCharacters(in: .whitespaces)) ?? 0
                    }
                    result.definitions.append(DefinitionEntry(kind: .environment,
                                                              name: braced.value.trimmingCharacters(in: .whitespaces), argCount: args))
                    i = braced.end
                    continue
                }
            }
            i = cmd.end
        }
        return result
    }
}

// MARK: - BibTeX parser

nonisolated struct BibEntry: Identifiable, Hashable {
    var type: String
    var key: String
    var fields: [String: String]
    /// 1-based line of the `@type{` start.
    var line: Int
    var file: String = ""
    var id: String { "\(file)#\(key)#\(line)" }

    var author: String { fields["author"] ?? fields["editor"] ?? "" }
    var title: String { fields["title"] ?? "" }
    var year: String { fields["year"] ?? String((fields["date"] ?? "").prefix(4)) }

    /// "Knuth (1984): The TeXbook"
    var summary: String {
        var prefix: [String] = []
        if !author.isEmpty {
            let names = author.components(separatedBy: " and ")
            var short = names.prefix(2).map { name in
                name.split(separator: ",").reversed().joined(separator: " ").trimmingCharacters(in: .whitespaces)
            }
            if names.count > 2 { short.append("et al.") }
            prefix.append(short.joined(separator: "; "))
        }
        if !year.isEmpty { prefix.append("(\(year))") }
        let head = prefix.joined(separator: " ")
        if title.isEmpty { return head.isEmpty ? key : head }
        return head.isEmpty ? title : "\(head): \(title)"
    }
}

nonisolated enum BibParser {
    static func parse(_ text: String, file: String = "") -> [BibEntry] {
        let chars = Array(text.utf16)
        let n = chars.count
        let at: UInt16 = 64, open: UInt16 = 123, close: UInt16 = 125, quote: UInt16 = 34,
            comma: UInt16 = 44, equals: UInt16 = 61, newline: UInt16 = 10

        func string(_ a: Int, _ b: Int) -> String {
            a >= b ? "" : String(utf16CodeUnits: Array(chars[a..<b]), count: b - a)
        }
        func skipGroup(_ openIndex: Int) -> Int {
            var depth = 0
            var i = openIndex
            while i < n {
                let c = chars[i]
                if c == open { depth += 1 } else if c == close {
                    depth -= 1
                    if depth == 0 { return i + 1 }
                }
                i += 1
            }
            return n
        }
        func firstIndex(of c: UInt16, from: Int, before limit: Int) -> Int? {
            var i = from
            while i < limit { if chars[i] == c { return i }; i += 1 }
            return nil
        }

        var entries: [BibEntry] = []
        var line = 1
        var lineCountedUntil = 0
        var i = 0
        while i < n {
            guard let atIndex = firstIndex(of: at, from: i, before: n) else { break }
            guard let brace = firstIndex(of: open, from: atIndex, before: n) else { break }
            let type = string(atIndex + 1, brace).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let groupEnd = skipGroup(brace)
            if ["comment", "preamble", "string"].contains(type) || type.contains(where: { !$0.isLetter }) {
                i = max(groupEnd, brace + 1)
                continue
            }
            guard let commaIndex = firstIndex(of: comma, from: brace, before: groupEnd) else { i = brace + 1; continue }
            for k in lineCountedUntil..<atIndex where chars[k] == newline { line += 1 }
            lineCountedUntil = atIndex
            let key = string(brace + 1, commaIndex).trimmingCharacters(in: .whitespacesAndNewlines)
            var fields: [String: String] = [:]
            var cursor = commaIndex + 1
            while cursor < groupEnd {
                guard let eq = firstIndex(of: equals, from: cursor, before: groupEnd) else { break }
                let name = string(cursor, eq).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                var start = eq + 1
                while start < groupEnd, [32, 9, 10, 13].contains(chars[start]) { start += 1 }
                var value = ""
                if start < n, chars[start] == open {
                    let end = skipGroup(start)
                    value = string(start + 1, max(start + 1, end - 1))
                    cursor = end
                } else if start < n, chars[start] == quote {
                    var end = start + 1
                    while end < n {
                        if chars[end] == open { end = skipGroup(end); continue }
                        if chars[end] == quote { break }
                        end += 1
                    }
                    value = string(start + 1, min(end, n))
                    cursor = end + 1
                } else {
                    var end = start
                    while end < groupEnd, ![44, 32, 10, 13, 9, 125].contains(chars[end]) { end += 1 }
                    value = string(start, end)
                    cursor = end
                }
                fields[name] = cleanValue(value)
                if let next = firstIndex(of: comma, from: cursor, before: groupEnd) { cursor = next + 1 } else { cursor = groupEnd }
            }
            entries.append(BibEntry(type: type, key: key, fields: fields, line: line, file: file))
            i = groupEnd
        }
        return entries
    }

    static func cleanValue(_ value: String) -> String {
        value.replacingOccurrences(of: "[{}]", with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// `knuth1984texbook` style key.
    static func generateKey(author: String, year: String, title: String) -> String {
        let first = author.components(separatedBy: " and ").first ?? "unknown"
        let last = first.contains(",") ? String(first.split(separator: ",")[0]) : (first.split(separator: " ").last.map(String.init) ?? "unknown")
        let cleanAuthor = last.filter { $0.isLetter && $0.isASCII }.lowercased()
        let cleanYear = String(year.filter(\.isNumber).prefix(4))
        let stop: Set<String> = ["the", "a", "an", "on", "of", "in", "and"]
        let word = title.replacingOccurrences(of: #"[{}\\]"#, with: "", options: .regularExpression)
            .split(separator: " ").map(String.init)
            .first { $0.contains(where: \.isLetter) && !stop.contains($0.lowercased()) } ?? ""
        return (cleanAuthor.isEmpty ? "unknown" : cleanAuthor) + cleanYear + word.filter { $0.isLetter && $0.isASCII }.lowercased()
    }
}

// MARK: - Line diff

nonisolated enum LineDiff {
    enum Op: Equatable { case same(String), added(String), removed(String) }

    /// LCS-based line diff (capped for very large inputs).
    static func diff(_ old: String, _ new: String) -> [Op] {
        let a = old.components(separatedBy: "\n"), b = new.components(separatedBy: "\n")
        let m = a.count, n = b.count
        if m > 4000 || n > 4000 || m * n > 6_000_000 {
            return a.map { .removed($0) } + b.map { .added($0) }
        }
        var table = [[Int32]](repeating: [Int32](repeating: 0, count: n + 1), count: m + 1)
        for i in stride(from: m - 1, through: 0, by: -1) {
            for j in stride(from: n - 1, through: 0, by: -1) {
                table[i][j] = a[i] == b[j] ? table[i + 1][j + 1] + 1 : max(table[i + 1][j], table[i][j + 1])
            }
        }
        var ops: [Op] = []
        var i = 0, j = 0
        while i < m && j < n {
            if a[i] == b[j] { ops.append(.same(a[i])); i += 1; j += 1 }
            else if table[i + 1][j] >= table[i][j + 1] { ops.append(.removed(a[i])); i += 1 }
            else { ops.append(.added(b[j])); j += 1 }
        }
        while i < m { ops.append(.removed(a[i])); i += 1 }
        while j < n { ops.append(.added(b[j])); j += 1 }
        return ops
    }

    static func stats(_ old: String, _ new: String) -> (added: Int, removed: Int) {
        var added = 0, removed = 0
        for op in diff(old, new) {
            switch op {
            case .added: added += 1
            case .removed: removed += 1
            case .same: break
            }
        }
        return (added, removed)
    }
}
