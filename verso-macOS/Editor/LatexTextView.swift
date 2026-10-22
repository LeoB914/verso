import AppKit

/// NSTextView with LaTeX editing behaviour: bracket pairing, smart `$`,
/// `\begin{}` → `\end{}`, list continuation, snippets and autocompletion.
final class LatexTextView: NSTextView {
    /// Provides completions for the current cursor position (nil = nothing to complete).
    var completionProvider: ((_ textBeforeCursor: String, _ location: Int) -> CompletionResult?)?
    var onSelectionChange: (() -> Void)?

    private let settings = AppSettings.shared
    private let popup = CompletionPopup()
    private var completionFrom = 0
    /// Remaining snippet tab stops (document ranges), consumed by Tab.
    private var snippetStops: [NSRange] = []
    /// Temporary highlight of a jump target (SyncTeX / problem navigation).
    private var flashRange: NSRange?

    override init(frame frameRect: NSRect, textContainer container: NSTextContainer?) {
        super.init(frame: frameRect, textContainer: container)
        popup.onAccept = { [weak self] item in self?.accept(item) }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    // MARK: Drawing

    override func drawBackground(in rect: NSRect) {
        super.drawBackground(in: rect)
        guard let layoutManager, let textContainer else { return }
        let ns = string as NSString
        if let flashRange, NSMaxRange(flashRange) <= ns.length {
            EditorTheme.syncHighlight.setFill()
            lineRect(for: flashRange, layoutManager, textContainer).fill()
        }
        guard settings.highlightActiveLine, window?.firstResponder === self else { return }
        let selection = selectedRange()
        guard selection.length == 0 else { return }
        EditorTheme.activeLine.setFill()
        lineRect(for: NSRange(location: selection.location, length: 0), layoutManager, textContainer).fill()
    }

    private func lineRect(for range: NSRange, _ layoutManager: NSLayoutManager, _ container: NSTextContainer) -> NSRect {
        let ns = string as NSString
        if range.location >= ns.length && (ns.length == 0 || ns.character(at: ns.length - 1) == 10) {
            var rect = layoutManager.extraLineFragmentRect
            rect.origin.x = 0
            rect.size.width = bounds.width
            rect.origin.y += textContainerInset.height
            return rect
        }
        let lineRange = ns.lineRange(for: NSRange(location: min(range.location, ns.length), length: range.length))
        let glyphs = layoutManager.glyphRange(forCharacterRange: lineRange, actualCharacterRange: nil)
        var rect = layoutManager.boundingRect(forGlyphRange: glyphs, in: container)
        rect.origin.x = 0
        rect.size.width = bounds.width
        rect.origin.y += textContainerInset.height
        return rect
    }

    override func setSelectedRanges(_ ranges: [NSValue], affinity: NSSelectionAffinity, stillSelecting: Bool) {
        super.setSelectedRanges(ranges, affinity: affinity, stillSelecting: stillSelecting)
        needsDisplay = true
        // The gutter highlights the current line number.
        if !stillSelecting { onSelectionChange?() }
    }

    override func becomeFirstResponder() -> Bool {
        needsDisplay = true
        return super.becomeFirstResponder()
    }

    override func resignFirstResponder() -> Bool {
        popup.hide()
        needsDisplay = true
        return super.resignFirstResponder()
    }

    /// Briefly highlight a line (jump targets).
    func flash(range: NSRange) {
        flashRange = range
        needsDisplay = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in
            guard let self, self.flashRange == range else { return }
            self.flashRange = nil
            self.needsDisplay = true
        }
    }

    // MARK: Typing

    private var ns: NSString { string as NSString }

    private func character(at location: Int) -> String? {
        guard location >= 0, location < ns.length else { return nil }
        return ns.substring(with: NSRange(location: location, length: 1))
    }

    /// Replace a range with undo support and the given resulting selection.
    func replace(_ range: NSRange, with text: String, select selection: NSRange? = nil) {
        guard shouldChangeText(in: range, replacementString: text) else { return }
        textStorage?.replaceCharacters(in: range, with: text)
        didChangeText()
        setSelectedRange(selection ?? NSRange(location: range.location + (text as NSString).length, length: 0))
        scrollRangeToVisible(selectedRange())
    }

    override func insertText(_ insertString: Any, replacementRange: NSRange) {
        guard let typed = (insertString as? String) ?? (insertString as? NSAttributedString)?.string,
              replacementRange.location == NSNotFound, !hasMarkedText() else {
            super.insertText(insertString, replacementRange: replacementRange)
            return
        }
        let selection = selectedRange()
        let before = character(at: selection.location - 1)
        let after = character(at: selection.location)
        let pairs = ["{": "}", "[": "]", "(": ")"]

        if settings.autocloseBrackets {
            if let close = pairs[typed], before != "\\" {
                if selection.length > 0 {
                    let inner = ns.substring(with: selection)
                    replace(selection, with: typed + inner + close,
                            select: NSRange(location: selection.location + 2 + (inner as NSString).length, length: 0))
                    return
                }
                let nextIsBoundary = after == nil || after!.rangeOfCharacter(from: .whitespacesAndNewlines) != nil
                    || ["}", "]", ")", ",", "$"].contains(after!)
                if nextIsBoundary {
                    replace(selection, with: typed + close, select: NSRange(location: selection.location + 1, length: 0))
                    updateCompletion()
                    return
                }
            }
            if ["}", "]", ")"].contains(typed), selection.length == 0, after == typed {
                setSelectedRange(NSRange(location: selection.location + 1, length: 0))
                updateCompletion()
                return
            }
            if typed == "$", before != "\\" {
                if selection.length > 0 {
                    let inner = ns.substring(with: selection)
                    replace(selection, with: "$\(inner)$", select: NSRange(location: selection.location + 2 + (inner as NSString).length, length: 0))
                    return
                }
                if after == "$" {
                    setSelectedRange(NSRange(location: selection.location + 1, length: 0))
                    return
                }
                replace(selection, with: "$$", select: NSRange(location: selection.location + 1, length: 0))
                return
            }
        }
        super.insertText(insertString, replacementRange: replacementRange)
        updateCompletion()
    }

    override func deleteBackward(_ sender: Any?) {
        let selection = selectedRange()
        if settings.autocloseBrackets, selection.length == 0, selection.location > 0,
           let before = character(at: selection.location - 1), let after = character(at: selection.location),
           ["{}", "[]", "()", "$$"].contains(before + after),
           character(at: selection.location - 2) != "\\" {
            replace(NSRange(location: selection.location - 1, length: 2), with: "")
            updateCompletion(onlyIfVisible: true)
            return
        }
        super.deleteBackward(sender)
        updateCompletion(onlyIfVisible: true)
    }

    override func insertNewline(_ sender: Any?) {
        if popup.isVisible, let item = popup.selectedItem {
            accept(item)
            return
        }
        snippetStops = []
        let selection = selectedRange()
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        var lineText = ns.substring(with: lineRange)
        if lineText.hasSuffix("\n") { lineText.removeLast() }
        let column = selection.location - lineRange.location
        let beforeCursor = (lineText as NSString).substring(to: min(column, (lineText as NSString).length))
        let afterCursor = (lineText as NSString).substring(from: min(column, (lineText as NSString).length))
        let indent = String(lineText.prefix { $0 == " " || $0 == "\t" })

        // Lists: Enter continues an \item, Enter on an empty \item leaves the list item.
        if let itemMatch = beforeCursor.range(of: #"^\s*\\item\b\s*"#, options: .regularExpression) {
            let rest = beforeCursor[itemMatch.upperBound...] + afterCursor
            if rest.trimmingCharacters(in: .whitespaces).isEmpty {
                replace(NSRange(location: lineRange.location, length: (lineText as NSString).length), with: indent)
                return
            }
            replace(selection, with: "\n\(indent)\\item ")
            return
        }
        // \begin{env} + Enter → insert the matching \end{env}.
        if let match = beforeCursor.range(of: #"\\begin\{([^}]+)\}(\[[^\]]*\])?(\{[^}]*\})?\s*$"#, options: .regularExpression),
           afterCursor.trimmingCharacters(in: .whitespaces).isEmpty {
            let env = String(beforeCursor[match]).replacingOccurrences(of: #"^\\begin\{([^}]+)\}.*$"#, with: "$1", options: .regularExpression)
            if !hasMatchingEnd(env, after: NSMaxRange(lineRange)) {
                let unit = "\t"
                let insert = "\n\(indent)\(unit)\n\(indent)\\end{\(env)}"
                replace(selection, with: insert, select: NSRange(location: selection.location + 1 + (indent as NSString).length + (unit as NSString).length, length: 0))
                return
            }
        }
        replace(selection, with: "\n" + indent)
    }

    /// Is there already an unmatched `\end{env}` for a `\begin{env}` ending at `location`?
    private func hasMatchingEnd(_ env: String, after location: Int) -> Bool {
        let rest = ns.substring(from: min(location, ns.length))
        let escaped = NSRegularExpression.escapedPattern(for: env)
        guard let regex = try? NSRegularExpression(pattern: #"\\(begin|end)\{"# + escaped + #"\}"#) else { return false }
        var depth = 1
        for match in regex.matches(in: rest, range: NSRange(location: 0, length: (rest as NSString).length)) {
            depth += (rest as NSString).substring(with: match.range(at: 1)) == "begin" ? 1 : -1
            if depth == 0 { return true }
        }
        return false
    }

    override func insertTab(_ sender: Any?) {
        if popup.isVisible, let item = popup.selectedItem {
            accept(item)
            return
        }
        if !snippetStops.isEmpty {
            let next = snippetStops.removeFirst()
            setSelectedRange(next)
            return
        }
        super.insertTab(sender)
    }

    override func doCommand(by selector: Selector) {
        if popup.isVisible {
            switch selector {
            case #selector(moveUp(_:)): popup.moveSelection(by: -1); return
            case #selector(moveDown(_:)): popup.moveSelection(by: 1); return
            case #selector(pageUp(_:)), #selector(scrollPageUp(_:)): popup.moveSelection(by: -8); return
            case #selector(pageDown(_:)), #selector(scrollPageDown(_:)): popup.moveSelection(by: 8); return
            case #selector(cancelOperation(_:)): popup.hide(); return
            case #selector(moveLeft(_:)), #selector(moveRight(_:)): popup.hide()
            default: break
            }
        }
        if selector == #selector(cancelOperation(_:)), !snippetStops.isEmpty {
            snippetStops = []
            return
        }
        super.doCommand(by: selector)
    }

    override func mouseDown(with event: NSEvent) {
        popup.hide()
        snippetStops = []
        super.mouseDown(with: event)
    }

    /// Explicit completion request (Esc / Ctrl+Space / F5 in NSTextView terms).
    override func complete(_ sender: Any?) {
        updateCompletion(explicit: true)
    }

    // MARK: Completion

    func updateCompletion(onlyIfVisible: Bool = false, explicit: Bool = false) {
        guard settings.autocompleteEnabled || explicit, let provider = completionProvider else { return }
        if onlyIfVisible && !popup.isVisible { return }
        let selection = selectedRange()
        guard selection.length == 0 else { popup.hide(); return }
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        let before = ns.substring(with: NSRange(location: lineRange.location, length: selection.location - lineRange.location))
        guard let result = provider(before, selection.location), !result.items.isEmpty,
              let window, let layoutManager, let textContainer else {
            popup.hide()
            return
        }
        completionFrom = result.from
        let glyph = layoutManager.glyphIndexForCharacter(at: max(0, min(result.from, ns.length - 1)))
        var rect = layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 0), in: textContainer)
        if result.from >= ns.length { rect = layoutManager.extraLineFragmentRect }
        rect.origin.x += textContainerOrigin.x
        rect.origin.y += textContainerOrigin.y
        let windowRect = convert(rect, to: nil)
        let screenRect = window.convertToScreen(windowRect)
        popup.show(items: result.items, at: NSPoint(x: screenRect.minX, y: screenRect.minY),
                   lineHeight: rect.height, parent: window)
    }

    func hideCompletion() { popup.hide() }

    private func accept(_ item: CompletionItem) {
        popup.hide()
        let selection = selectedRange()
        let range = NSRange(location: completionFrom, length: max(0, selection.location - completionFrom))
        if item.kind == .environment {
            // Complete the name, step over the closing brace and (after \begin) add the matching \end.
            let lineRange = ns.lineRange(for: NSRange(location: range.location, length: 0))
            let prefix = ns.substring(with: NSRange(location: lineRange.location, length: range.location - lineRange.location))
            var replaceRange = range
            if character(at: NSMaxRange(range)) == "}" { replaceRange.length += 1 }
            let lineEnd = lineRange.location + (ns.substring(with: lineRange).hasSuffix("\n") ? lineRange.length - 1 : lineRange.length)
            let rest = ns.substring(with: NSRange(location: NSMaxRange(replaceRange), length: max(0, lineEnd - NSMaxRange(replaceRange))))
            let name = item.insert
            if prefix.hasSuffix("\\begin{"), rest.trimmingCharacters(in: .whitespaces).isEmpty,
               !hasMatchingEnd(name, after: NSMaxRange(lineRange)) {
                let indent = String(prefix.prefix { $0 == " " || $0 == "\t" })
                let text = "\(name)}\n\(indent)\t\n\(indent)\\end{\(name)}"
                replace(replaceRange, with: text,
                        select: NSRange(location: range.location + (name as NSString).length + 2 + (indent as NSString).length + 1, length: 0))
            } else {
                replace(replaceRange, with: name + "}")
            }
            return
        }
        insertSnippet(item.insert, replacing: range)
    }

    /// Insert snippet text with `${n:placeholder}` / `$n` stops; selects the first stop.
    func insertSnippet(_ snippet: String, replacing range: NSRange? = nil) {
        let target = range ?? selectedRange()
        var plain = ""
        var stops: [(index: Int, range: NSRange)] = []
        let regex = NSRegularExpression(#"\$\{(\d+):([^}]*)\}|\$\{(\d+)\}|\$(\d+)"#)
        let source = snippet as NSString
        var cursor = 0
        for match in regex.matches(in: snippet, range: NSRange(location: 0, length: source.length)) {
            plain += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            var index = 0
            var placeholder = ""
            if match.range(at: 1).location != NSNotFound {
                index = Int(source.substring(with: match.range(at: 1))) ?? 0
                placeholder = source.substring(with: match.range(at: 2))
            } else if match.range(at: 3).location != NSNotFound {
                index = Int(source.substring(with: match.range(at: 3))) ?? 0
            } else {
                index = Int(source.substring(with: match.range(at: 4))) ?? 0
            }
            let start = target.location + (plain as NSString).length
            stops.append((index == 0 ? Int.max : index, NSRange(location: start, length: (placeholder as NSString).length)))
            plain += placeholder
            cursor = NSMaxRange(match.range)
        }
        plain += source.substring(from: cursor)
        var ordered = stops.sorted { $0.index < $1.index }.map(\.range)
        let end = NSRange(location: target.location + (plain as NSString).length, length: 0)
        // Without an explicit $0, Tab after the last placeholder leaves the snippet.
        if !ordered.isEmpty && !stops.contains(where: { $0.index == Int.max }) { ordered.append(end) }
        let first = ordered.first ?? end
        replace(target, with: plain, select: first)
        snippetStops = Array(ordered.dropFirst())
    }

    // MARK: Formatting commands

    /// `\textbf{selection}` — cursor inside when the selection is empty.
    func wrapSelection(command: String) {
        let selection = selectedRange()
        let inner = ns.substring(with: selection)
        let text = "\(command){\(inner)}"
        replace(selection, with: text, select: selection.length == 0
                ? NSRange(location: selection.location + (command as NSString).length + 1, length: 0)
                : NSRange(location: selection.location + (text as NSString).length, length: 0))
    }

    func applyFontSize(_ command: String) {
        let selection = selectedRange()
        let inner = ns.substring(with: selection)
        replace(selection, with: "{\(command) \(inner)}",
                select: NSRange(location: selection.location + (command as NSString).length + 2 + (inner as NSString).length, length: 0))
    }

    func insertSection(_ command: String) {
        let selection = selectedRange()
        if selection.length > 0 {
            replace(selection, with: "\(command){\(ns.substring(with: selection))}")
            return
        }
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
        if line.trimmingCharacters(in: .whitespaces).isEmpty {
            let range = NSRange(location: lineRange.location, length: (line as NSString).length)
            replace(range, with: "\(command){}", select: NSRange(location: lineRange.location + (command as NSString).length + 1, length: 0))
        } else {
            let end = lineRange.location + (line as NSString).length
            replace(NSRange(location: end, length: 0), with: "\n\n\(command){}\n",
                    select: NSRange(location: end + 2 + (command as NSString).length + 1, length: 0))
        }
    }

    func insertMathBlock() {
        let selection = selectedRange()
        if selection.length > 0 {
            replace(selection, with: "\\[\n\(ns.substring(with: selection))\n\\]")
            return
        }
        let lineRange = ns.lineRange(for: NSRange(location: selection.location, length: 0))
        let line = ns.substring(with: lineRange).trimmingCharacters(in: .newlines)
        if line.trimmingCharacters(in: .whitespaces).isEmpty {
            replace(NSRange(location: lineRange.location, length: (line as NSString).length), with: "\\[\n\n\\]",
                    select: NSRange(location: lineRange.location + 3, length: 0))
        } else {
            let end = lineRange.location + (line as NSString).length
            replace(NSRange(location: end, length: 0), with: "\n\n\\[\n\n\\]", select: NSRange(location: end + 5, length: 0))
        }
    }

    /// Toggle `% ` comments on all selected lines.
    func toggleComment() {
        let selection = selectedRange()
        let linesRange = ns.lineRange(for: selection)
        let block = ns.substring(with: linesRange)
        var lines = block.components(separatedBy: "\n")
        let trailingNewline = block.hasSuffix("\n")
        if trailingNewline { lines.removeLast() }
        let nonEmpty = lines.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        let allCommented = !nonEmpty.isEmpty && nonEmpty.allSatisfy { $0.trimmingCharacters(in: .whitespaces).hasPrefix("%") }
        let result = lines.map { line -> String in
            if allCommented {
                return line.replacingOccurrences(of: #"^(\s*)% ?"#, with: "$1", options: .regularExpression)
            }
            return line.trimmingCharacters(in: .whitespaces).isEmpty ? line : "% " + line
        }.joined(separator: "\n") + (trailingNewline ? "\n" : "")
        replace(linesRange, with: result, select: NSRange(location: linesRange.location, length: (result as NSString).length - (trailingNewline ? 1 : 0)))
    }

    // MARK: Navigation

    /// 1-based line number of a character offset.
    func lineNumber(at location: Int) -> Int {
        var line = 1
        let limit = min(location, ns.length)
        var index = 0
        while index < limit {
            let range = ns.range(of: "\n", options: .literal, range: NSRange(location: index, length: limit - index))
            if range.location == NSNotFound { break }
            line += 1
            index = range.location + 1
        }
        return line
    }

    /// Range of a 1-based line (without its newline).
    func rangeOfLine(_ line: Int) -> NSRange {
        var current = 1
        var index = 0
        while current < line {
            let range = ns.range(of: "\n", options: .literal, range: NSRange(location: index, length: ns.length - index))
            if range.location == NSNotFound { break }
            index = range.location + 1
            current += 1
        }
        let lineRange = ns.lineRange(for: NSRange(location: min(index, ns.length), length: 0))
        var length = lineRange.length
        if length > 0, NSMaxRange(lineRange) <= ns.length, ns.character(at: NSMaxRange(lineRange) - 1) == 10 { length -= 1 }
        return NSRange(location: lineRange.location, length: length)
    }

    func goToLine(_ line: Int, column: Int = 0, flash: Bool = true) {
        let range = rangeOfLine(max(1, line))
        let location = range.location + min(max(0, column), range.length)
        setSelectedRange(NSRange(location: location, length: 0))
        scrollRangeToVisible(range)
        // Center the target line.
        if let layoutManager, let textContainer, let scroll = enclosingScrollView {
            let glyphs = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let rect = layoutManager.boundingRect(forGlyphRange: glyphs, in: textContainer)
            let y = max(0, rect.midY + textContainerInset.height - scroll.contentView.bounds.height / 2)
            scroll.contentView.scroll(to: NSPoint(x: scroll.contentView.bounds.origin.x, y: y))
            scroll.reflectScrolledClipView(scroll.contentView)
        }
        window?.makeFirstResponder(self)
        if flash { self.flash(range: range) }
    }
}
