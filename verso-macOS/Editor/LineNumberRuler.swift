import AppKit

/// Line-number gutter with compile-problem markers (TextKit 1). A plain view next to
/// the scroll view rather than an NSRulerView: it is clipped to its own bounds and is
/// redrawn completely whenever the editor scrolls or relayouts.
final class LineNumberGutter: NSView {
    /// 1-based line → severity (error wins over warning).
    var problemMarkers: [Int: LogLevel] = [:] { didSet { needsDisplay = true } }
    /// Called when the required width changes (more digits).
    var onWidthChange: (() -> Void)?

    private weak var textView: NSTextView?
    private var lineStarts: [Int] = [0]
    private var cachedText: String = ""
    private(set) var requiredWidth: CGFloat = 40

    init(textView: NSTextView, scrollView: NSScrollView) {
        self.textView = textView
        super.init(frame: .zero)
        wantsLayer = true
        clipsToBounds = true
        scrollView.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(redraw),
                                               name: NSView.boundsDidChangeNotification, object: scrollView.contentView)
        textView.postsFrameChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(redraw),
                                               name: NSView.frameDidChangeNotification, object: textView)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }

    @objc private func redraw() { needsDisplay = true }

    func invalidateLineStarts() {
        cachedText = ""
        needsDisplay = true
    }

    private var numberFont: NSFont {
        NSFont.monospacedDigitSystemFont(ofSize: max(9, AppSettings.shared.editorFont.pointSize - 2), weight: .regular)
    }

    private func updateLineStarts() {
        guard let text = textView?.string, text != cachedText else { return }
        cachedText = text
        var starts = [0]
        let ns = text as NSString
        let length = ns.length
        var index = 0
        while index < length {
            let range = ns.range(of: "\n", options: .literal, range: NSRange(location: index, length: length - index))
            if range.location == NSNotFound { break }
            starts.append(range.location + 1)
            index = range.location + 1
        }
        lineStarts = starts
        let digits = max(3, String(starts.count).count)
        let width = ceil(("8" as NSString).size(withAttributes: [.font: numberFont]).width * CGFloat(digits) + 22)
        if abs(requiredWidth - width) > 0.5 {
            requiredWidth = width
            DispatchQueue.main.async { [weak self] in self?.onWidthChange?() }
        }
    }

    func lineNumber(at location: Int) -> Int {
        updateLineStarts()
        var low = 0, high = lineStarts.count - 1
        while low < high {
            let mid = (low + high + 1) / 2
            if lineStarts[mid] <= location { low = mid } else { high = mid - 1 }
        }
        return low + 1
    }

    override func draw(_ dirtyRect: NSRect) {
        EditorTheme.background.setFill()
        bounds.fill()
        EditorTheme.gutterBorder.setFill()
        NSRect(x: bounds.maxX - 1, y: bounds.minY, width: 1, height: bounds.height).fill()

        guard let textView, let layoutManager = textView.layoutManager, let container = textView.textContainer else { return }
        updateLineStarts()
        let font = numberFont
        let editorLineHeight = layoutManager.defaultLineHeight(for: AppSettings.shared.editorFont)
        let ns = textView.string as NSString
        let origin = textView.textContainerOrigin
        // Visible part of the text view, in container coordinates.
        var visible = textView.visibleRect
        visible.origin.y -= origin.y
        layoutManager.ensureLayout(forBoundingRect: visible, in: container)
        let glyphRange = layoutManager.glyphRange(forBoundingRect: visible, in: container)
        let charRange = layoutManager.characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)
        let selectionLine = lineNumber(at: textView.selectedRange().location)

        func draw(line: Int, fragment: NSRect) {
            let top = convert(NSPoint(x: 0, y: fragment.minY + origin.y), from: textView).y
            guard top < bounds.maxY, top + fragment.height > bounds.minY else { return }
            // lineHeightMultiple adds its extra space above the glyphs: align to the bottom.
            let textLineHeight = min(fragment.height, editorLineHeight)
            var color = line == selectionLine ? EditorTheme.gutterActive : EditorTheme.gutterForeground
            if let marker = problemMarkers[line] {
                color = marker == .error ? EditorTheme.error : EditorTheme.warning
                color.setFill()
                NSBezierPath(ovalIn: NSRect(x: 4, y: top + fragment.height - textLineHeight / 2 - 3, width: 6, height: 6)).fill()
            }
            let label = "\(line)" as NSString
            let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
            let size = label.size(withAttributes: attributes)
            label.draw(at: NSPoint(x: bounds.width - size.width - 8,
                                   y: top + fragment.height - textLineHeight + (textLineHeight - size.height) / 2),
                       withAttributes: attributes)
        }

        if ns.length == 0 {
            draw(line: 1, fragment: layoutManager.extraLineFragmentRect)
            return
        }
        var line = lineNumber(at: charRange.location)
        while line - 1 < lineStarts.count {
            let charIndex = lineStarts[line - 1]
            if charIndex > NSMaxRange(charRange) { break }
            if charIndex >= ns.length {
                // Empty last line after a trailing newline.
                let extra = layoutManager.extraLineFragmentRect
                if extra.height > 0 { draw(line: line, fragment: extra) }
                break
            }
            let glyphIndex = layoutManager.glyphIndexForCharacter(at: charIndex)
            draw(line: line, fragment: layoutManager.lineFragmentRect(forGlyphAt: glyphIndex, effectiveRange: nil))
            line += 1
        }
    }

    /// Click selects the whole line.
    override func mouseDown(with event: NSEvent) {
        guard let textView, let layoutManager = textView.layoutManager, let container = textView.textContainer else { return }
        let point = textView.convert(event.locationInWindow, from: nil)
        let glyph = layoutManager.glyphIndex(for: NSPoint(x: 0, y: point.y - textView.textContainerOrigin.y), in: container)
        let line = lineNumber(at: layoutManager.characterIndexForGlyph(at: glyph))
        let start = lineStarts[line - 1]
        let end = line < lineStarts.count ? lineStarts[line] : (textView.string as NSString).length
        textView.setSelectedRange(NSRange(location: start, length: end - start))
        textView.window?.makeFirstResponder(textView)
    }

    deinit { NotificationCenter.default.removeObserver(self) }
}

/// Gutter + scroll view side by side, clipped to the editor area.
final class EditorContainerView: NSView {
    let scrollView: NSScrollView
    let gutter: LineNumberGutter
    var showsGutter = true { didSet { gutter.isHidden = !showsGutter; needsLayout = true } }

    init(scrollView: NSScrollView, gutter: LineNumberGutter) {
        self.scrollView = scrollView
        self.gutter = gutter
        super.init(frame: .zero)
        wantsLayer = true
        clipsToBounds = true
        addSubview(scrollView)
        addSubview(gutter)
        gutter.onWidthChange = { [weak self] in self?.needsLayout = true }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        let width = showsGutter ? gutter.requiredWidth : 0
        gutter.frame = NSRect(x: 0, y: 0, width: width, height: bounds.height)
        scrollView.frame = NSRect(x: width, y: 0, width: max(0, bounds.width - width), height: bounds.height)
        gutter.needsDisplay = true
    }
}
