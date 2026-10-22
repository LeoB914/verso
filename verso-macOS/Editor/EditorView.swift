import AppKit
import SwiftUI

/// Settings that require reconfiguring the text view when they change.
struct EditorAppearance: Equatable {
    var fontName: String
    var fontSize: Double
    var lineHeight: Double
    var tabWidth: Int
    var softWrap: Bool
    var lineNumbers: Bool
    var spellcheck: Bool

    @MainActor static var current: EditorAppearance {
        let s = AppSettings.shared
        return EditorAppearance(fontName: s.editorFontName, fontSize: s.editorFontSize, lineHeight: s.editorLineHeight,
                                tabWidth: s.tabWidth, softWrap: s.softWrap, lineNumbers: s.lineNumbers, spellcheck: s.spellEnabled)
    }
}

/// Hosts one LatexTextView; switching tabs swaps the document's text storage in.
struct EditorView: NSViewRepresentable {
    let workspace: Workspace
    let document: EditorDocument
    let appearance: EditorAppearance
    let markers: [Int: LogLevel]

    func makeCoordinator() -> Coordinator { Coordinator(workspace: workspace) }

    func makeNSView(context: Context) -> EditorContainerView {
        let layoutManager = NSLayoutManager()
        // Contiguous layout keeps line fragments (and the gutter) consistent while scrolling.
        layoutManager.allowsNonContiguousLayout = false
        let container = NSTextContainer(size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        layoutManager.addTextContainer(container)
        document.storage.addLayoutManager(layoutManager)

        let textView = LatexTextView(frame: NSRect(x: 0, y: 0, width: 600, height: 600), textContainer: container)
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isAutomaticLinkDetectionEnabled = false
        textView.smartInsertDeleteEnabled = false
        textView.isGrammarCheckingEnabled = false
        textView.drawsBackground = true
        textView.backgroundColor = EditorTheme.background
        textView.insertionPointColor = EditorTheme.cursor
        textView.selectedTextAttributes = [.backgroundColor: EditorTheme.selection]
        textView.textContainerInset = NSSize(width: 6, height: 8)
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.delegate = context.coordinator
        textView.completionProvider = { [weak workspace] before, location in
            workspace?.completions(before: before, location: location)
        }
        textView.onSelectionChange = { [weak coordinator = context.coordinator] in coordinator?.selectionChanged() }

        let scroll = NSScrollView()
        scroll.documentView = textView
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = true
        scroll.backgroundColor = EditorTheme.background
        scroll.automaticallyAdjustsContentInsets = false
        scroll.contentInsets = NSEdgeInsets()
        let gutter = LineNumberGutter(textView: textView, scrollView: scroll)
        let containerView = EditorContainerView(scrollView: scroll, gutter: gutter)

        context.coordinator.textView = textView
        context.coordinator.ruler = gutter
        context.coordinator.container = containerView
        context.coordinator.document = document
        workspace.textView = textView
        apply(appearance, to: textView, scroll: scroll, coordinator: context.coordinator)
        restore(document, in: textView, scroll: scroll)
        DispatchQueue.main.async { textView.window?.makeFirstResponder(textView) }
        return containerView
    }

    static func dismantleNSView(_ containerView: EditorContainerView, coordinator: Coordinator) {
        let scroll = containerView.scrollView
        guard let textView = coordinator.textView, let layoutManager = textView.layoutManager,
              let document = coordinator.document else { return }
        document.selection = textView.selectedRange()
        document.scrollY = scroll.contentView.bounds.origin.y
        textView.hideCompletion()
        document.storage.removeLayoutManager(layoutManager)
        coordinator.document = nil
    }

    func updateNSView(_ containerView: EditorContainerView, context: Context) {
        let scroll = containerView.scrollView
        let coordinator = context.coordinator
        guard let textView = coordinator.textView, let layoutManager = textView.layoutManager else { return }
        workspace.textView = textView
        if coordinator.document !== document {
            if let old = coordinator.document {
                old.selection = textView.selectedRange()
                old.scrollY = scroll.contentView.bounds.origin.y
                old.storage.removeLayoutManager(layoutManager)
            }
            textView.hideCompletion()
            document.storage.addLayoutManager(layoutManager)
            coordinator.document = document
            coordinator.ruler?.invalidateLineStarts()
            textView.typingAttributes = document.highlighter.baseAttributes
            restore(document, in: textView, scroll: scroll)
            DispatchQueue.main.async { textView.window?.makeFirstResponder(textView) }
        }
        if coordinator.appearance != appearance {
            apply(appearance, to: textView, scroll: scroll, coordinator: coordinator)
        }
        if coordinator.ruler?.problemMarkers != markers { coordinator.ruler?.problemMarkers = markers }
    }

    private func restore(_ document: EditorDocument, in textView: LatexTextView, scroll: NSScrollView) {
        let length = document.storage.length
        let selection = NSRange(location: min(document.selection.location, length),
                                length: min(document.selection.length, max(0, length - min(document.selection.location, length))))
        textView.setSelectedRange(selection)
        // Only the vertical position is restored.
        guard let savedY = document.scrollY else {
            DispatchQueue.main.async { textView.scrollRangeToVisible(selection) }
            return
        }
        DispatchQueue.main.async {
            var origin = scroll.contentView.bounds.origin
            origin.y = savedY
            scroll.contentView.scroll(to: origin)
            scroll.reflectScrolledClipView(scroll.contentView)
        }
    }

    private func apply(_ appearance: EditorAppearance, to textView: LatexTextView, scroll: NSScrollView, coordinator: Coordinator) {
        let fontChanged = coordinator.appearance.map {
            $0.fontName != appearance.fontName || $0.fontSize != appearance.fontSize
                || $0.lineHeight != appearance.lineHeight || $0.tabWidth != appearance.tabWidth
        } ?? false
        coordinator.appearance = appearance
        if fontChanged {
            for document in workspace.documents where document.kind == .text { document.restyle() }
        }
        textView.typingAttributes = document.highlighter.baseAttributes
        textView.isContinuousSpellCheckingEnabled = appearance.spellcheck
        coordinator.container?.showsGutter = appearance.lineNumbers
        guard let container = textView.textContainer else { return }
        if appearance.softWrap {
            scroll.hasHorizontalScroller = false
            textView.isHorizontallyResizable = false
            container.widthTracksTextView = true
            container.containerSize = NSSize(width: scroll.contentSize.width, height: CGFloat.greatestFiniteMagnitude)
            textView.frame.size.width = scroll.contentSize.width
        } else {
            scroll.hasHorizontalScroller = true
            textView.isHorizontallyResizable = true
            container.widthTracksTextView = false
            container.containerSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        }
        coordinator.ruler?.invalidateLineStarts()
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        let workspace: Workspace
        weak var textView: LatexTextView?
        weak var ruler: LineNumberGutter?
        weak var container: EditorContainerView?
        var document: EditorDocument?
        var appearance: EditorAppearance?

        init(workspace: Workspace) { self.workspace = workspace }

        func textDidChange(_ notification: Notification) {
            guard let document else { return }
            ruler?.needsDisplay = true
            workspace.documentDidChange(document)
        }

        func undoManager(for view: NSTextView) -> UndoManager? {
            document?.undoManager
        }

        func selectionChanged() {
            guard let textView, let document else { return }
            let selection = textView.selectedRange()
            document.selection = selection
            let ns = textView.string as NSString
            let lineRange = ns.lineRange(for: NSRange(location: min(selection.location, ns.length), length: 0))
            let line = ruler?.lineNumber(at: selection.location) ?? textView.lineNumber(at: selection.location)
            let column = selection.location - lineRange.location + 1
            if workspace.cursorLine != line { workspace.cursorLine = line }
            if workspace.cursorColumn != column { workspace.cursorColumn = column }
            ruler?.needsDisplay = true
        }
    }
}
