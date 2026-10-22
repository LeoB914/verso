import AppKit

/// Editor colors (Verso Light / Verso Dark), resolved for the current appearance.
enum EditorTheme {
    private static func dynamic(_ light: NSColor, _ dark: NSColor) -> NSColor {
        NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
        }
    }

    private static func hex(_ value: UInt32, alpha: CGFloat = 1) -> NSColor {
        NSColor(srgbRed: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255, alpha: alpha)
    }

    static let background = dynamic(hex(0xFFFFFF), hex(0x1E1E1E))
    static let foreground = dynamic(hex(0x1D1D1F), hex(0xF5F5F7))
    static let gutterForeground = dynamic(hex(0xAEAEB2), hex(0x6E6E73))
    static let gutterActive = dynamic(hex(0x1D1D1F), hex(0xF5F5F7))
    static let gutterBorder = dynamic(NSColor.black.withAlphaComponent(0.08), NSColor.white.withAlphaComponent(0.08))
    static let activeLine = dynamic(NSColor.black.withAlphaComponent(0.035), NSColor.white.withAlphaComponent(0.045))
    static let selection = dynamic(hex(0x0A84FF, alpha: 0.2), hex(0x0A84FF, alpha: 0.3))
    static let cursor = hex(0x0A84FF)
    static let matchingBracket = dynamic(hex(0x0A84FF, alpha: 0.18), hex(0x0A84FF, alpha: 0.3))
    static let syncHighlight = dynamic(hex(0xFFCC00, alpha: 0.35), hex(0xFFD60A, alpha: 0.3))

    static let comment = dynamic(hex(0x6E7681), hex(0x7F8C98))
    static let command = dynamic(hex(0x0B5CAD), hex(0x82AAFF))
    static let keyword = dynamic(hex(0xA626A4), hex(0xC792EA))
    static let argument = dynamic(hex(0xB76B01), hex(0xF78C6C))
    static let math = dynamic(hex(0x50A14F), hex(0xC3E88D))
    static let heading = dynamic(hex(0xE45649), hex(0xFF5370))
    static let error = dynamic(hex(0xE5484D), hex(0xFF6369))
    static let warning = dynamic(hex(0xD08700), hex(0xFFB224))
}

/// Regex-based LaTeX highlighting applied to the text storage after each edit
/// (only the edited paragraphs are re-highlighted).
final class LatexHighlighter: NSObject, NSTextStorageDelegate {
    private let settings = AppSettings.shared
    var enabled = true

    private static let command = NSRegularExpression(#"\\(?:[a-zA-Z@]+\*?|.)"#)
    private static let structural = NSRegularExpression(#"\\(?:begin|end|usepackage|RequirePackage|documentclass|label|ref|eqref|autoref|cref|Cref|pageref|cite[a-zA-Z]*|[a-zA-Z]*cite|input|include|includegraphics|addbibresource|bibliography|bibliographystyle|newcommand|renewcommand|newenvironment)\*?(?:\[[^\]\n]*\])*\{([^}\n]*)\}"#)
    private static let section = NSRegularExpression(#"\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]\n]*\])?\{([^\n]*)\}"#)
    private static let inlineMath = NSRegularExpression(#"(?<!\\)\$\$?(?:[^$\\\n]|\\.)+\$\$?|\\\((?:[^\n])*?\\\)|\\\[(?:[^\n])*?\\\]"#)
    private static let comment = NSRegularExpression(#"(?<!\\)%.*$"#, options: .anchorsMatchLines)
    private static let special = NSRegularExpression(#"[{}\[\]&]|(?<!\\)\\\\"#)

    var baseAttributes: [NSAttributedString.Key: Any] {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineHeightMultiple = CGFloat(min(max(settings.editorLineHeight, 1), 3))
        let font = settings.editorFont
        let spaceWidth = (" " as NSString).size(withAttributes: [.font: font]).width
        paragraph.defaultTabInterval = spaceWidth * CGFloat(settings.tabWidth)
        paragraph.tabStops = []
        return [.font: font, .foregroundColor: EditorTheme.foreground, .paragraphStyle: paragraph]
    }

    func textStorage(_ textStorage: NSTextStorage, didProcessEditing editedMask: NSTextStorageEditActions,
                     range editedRange: NSRange, changeInLength delta: Int) {
        guard editedMask.contains(.editedCharacters) else { return }
        let string = textStorage.string as NSString
        // Extend by one paragraph on each side: math and environment arguments rarely span more.
        var range = string.paragraphRange(for: editedRange)
        if range.location > 0 { range = string.paragraphRange(for: NSRange(location: range.location - 1, length: 0)).union(range) }
        if NSMaxRange(range) < string.length { range = range.union(string.paragraphRange(for: NSRange(location: NSMaxRange(range), length: 0))) }
        highlight(textStorage, in: range)
    }

    func highlightAll(_ textStorage: NSTextStorage) {
        textStorage.beginEditing()
        highlight(textStorage, in: NSRange(location: 0, length: textStorage.length))
        textStorage.endEditing()
    }

    func highlight(_ storage: NSTextStorage, in range: NSRange) {
        guard range.length > 0 else { return }
        let text = storage.string
        storage.setAttributes(baseAttributes, range: range)
        guard enabled else { return }
        let font = settings.editorFont
        let bold = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask)
        let italic = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask)

        Self.special.enumerateMatches(in: text, range: range) { match, _, _ in
            if let r = match?.range { storage.addAttribute(.foregroundColor, value: EditorTheme.keyword, range: r) }
        }
        Self.command.enumerateMatches(in: text, range: range) { match, _, _ in
            if let r = match?.range { storage.addAttribute(.foregroundColor, value: EditorTheme.command, range: r) }
        }
        Self.structural.enumerateMatches(in: text, range: range) { match, _, _ in
            if let r = match?.range(at: 1), r.location != NSNotFound {
                storage.addAttribute(.foregroundColor, value: EditorTheme.argument, range: r)
            }
        }
        Self.section.enumerateMatches(in: text, range: range) { match, _, _ in
            guard let match else { return }
            storage.addAttributes([.foregroundColor: EditorTheme.heading, .font: bold], range: match.range)
        }
        Self.inlineMath.enumerateMatches(in: text, range: range) { match, _, _ in
            if let r = match?.range { storage.addAttribute(.foregroundColor, value: EditorTheme.math, range: r) }
        }
        Self.comment.enumerateMatches(in: text, range: range) { match, _, _ in
            if let r = match?.range { storage.addAttributes([.foregroundColor: EditorTheme.comment, .font: italic], range: r) }
        }
    }
}
