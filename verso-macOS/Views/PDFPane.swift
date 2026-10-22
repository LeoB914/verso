import PDFKit
import SwiftUI

/// PDFView that reports ⌘-clicks (and double-clicks) for SyncTeX backward search.
final class SyncPDFView: PDFView {
    var onSyncClick: ((_ pageIndex: Int, _ point: NSPoint) -> Void)?

    override func mouseDown(with event: NSEvent) {
        if event.modifierFlags.contains(.command) || event.clickCount == 2 {
            let point = convert(event.locationInWindow, from: nil)
            if let page = page(for: point, nearest: true), let document {
                onSyncClick?(document.index(for: page), convert(point, to: page))
                return
            }
        }
        super.mouseDown(with: event)
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()
        let point = convert(event.locationInWindow, from: nil)
        if let page = page(for: point, nearest: true), let document {
            let index = document.index(for: page)
            let pagePoint = convert(point, to: page)
            let item = NSMenuItem(title: "Jump to Source", action: #selector(jumpToSource(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = [index, pagePoint.x, pagePoint.y] as [Any]
            menu.insertItem(item, at: 0)
            menu.insertItem(.separator(), at: 1)
        }
        return menu
    }

    @objc private func jumpToSource(_ sender: NSMenuItem) {
        guard let values = sender.representedObject as? [Any], values.count == 3,
              let index = values[0] as? Int, let x = values[1] as? CGFloat, let y = values[2] as? CGFloat else { return }
        onSyncClick?(index, NSPoint(x: x, y: y))
    }
}

/// Bridge between the workspace and the PDFView.
final class PDFController {
    weak var view: SyncPDFView?
    private var highlight: PDFAnnotation?
    private var loadedURL: URL?

    /// Load (or reload) the PDF, keeping the visible page and position.
    func load(_ url: URL?) {
        guard let view else { return }
        guard let url, let data = try? Data(contentsOf: url), let document = PDFDocument(data: data) else {
            view.document = nil
            loadedURL = nil
            return
        }
        var restore: (page: Int, point: NSPoint)?
        if let current = view.currentDestination, let page = current.page, let old = view.document {
            restore = (old.index(for: page), current.point)
        }
        let scale = view.scaleFactor
        let autoScales = view.autoScales
        view.document = document
        if loadedURL == url, let restore, restore.page < document.pageCount, let page = document.page(at: restore.page) {
            if !autoScales { view.scaleFactor = scale }
            view.go(to: PDFDestination(page: page, at: restore.point))
        }
        loadedURL = url
    }

    /// Scroll to a SyncTeX position (y measured from the top of the page) and flash a marker.
    func reveal(page pageNumber: Int, x: Double, y: Double, width: Double, height: Double) {
        guard let view, let document = view.document, pageNumber >= 1, pageNumber <= document.pageCount,
              let page = document.page(at: pageNumber - 1) else { return }
        let bounds = page.bounds(for: .mediaBox)
        let baseline = bounds.maxY - CGFloat(y)
        let rect = NSRect(x: bounds.minX + CGFloat(x) - 2, y: baseline - 3,
                          width: min(max(CGFloat(width), 40), bounds.width) + 4, height: max(CGFloat(height), 10) + 6)
        let visibleHeight = view.bounds.height / max(view.scaleFactor, 0.1)
        view.go(to: PDFDestination(page: page, at: NSPoint(x: bounds.minX, y: min(bounds.maxY, rect.maxY + visibleHeight / 3))))

        if let highlight { highlight.page?.removeAnnotation(highlight) }
        let annotation = PDFAnnotation(bounds: rect, forType: .highlight, withProperties: nil)
        annotation.color = NSColor.systemYellow.withAlphaComponent(0.45)
        page.addAnnotation(annotation)
        highlight = annotation
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self, weak annotation] in
            guard let annotation else { return }
            annotation.page?.removeAnnotation(annotation)
            if self?.highlight === annotation { self?.highlight = nil }
        }
    }

    func zoomIn() { view?.zoomIn(nil) }
    func zoomOut() { view?.zoomOut(nil) }
    func fitWidth() { view?.autoScales = true }
    func previousPage() { view?.goToPreviousPage(nil) }
    func nextPage() { view?.goToNextPage(nil) }
    func go(toPage index: Int) {
        guard let view, let document = view.document, index >= 0, index < document.pageCount,
              let page = document.page(at: index) else { return }
        view.go(to: page)
    }
}

struct PDFKitView: NSViewRepresentable {
    let workspace: Workspace
    let version: Int

    func makeNSView(context: Context) -> SyncPDFView {
        let view = SyncPDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displaysPageBreaks = true
        view.backgroundColor = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? NSColor(white: 0.13, alpha: 1) : NSColor(white: 0.93, alpha: 1)
        }
        view.onSyncClick = { [weak workspace, weak view] index, point in
            guard let workspace, let page = view?.document?.page(at: index) else { return }
            let bounds = page.bounds(for: .mediaBox)
            workspace.syncFromPDF(page: index + 1, x: Double(point.x - bounds.minX), y: Double(bounds.maxY - point.y))
        }
        workspace.pdf.view = view
        workspace.pdf.load(workspace.pdfURL)
        context.coordinator.version = version
        return view
    }

    func updateNSView(_ view: SyncPDFView, context: Context) {
        workspace.pdf.view = view
        if context.coordinator.version != version {
            context.coordinator.version = version
            workspace.pdf.load(workspace.pdfURL)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var version = -1
    }
}

struct PDFPane: View {
    @Bindable var workspace: Workspace
    @State private var pageIndex = 0
    @State private var pageCount = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button { workspace.pdf.previousPage() } label: { Image(systemName: "chevron.left") }
                    .help("Previous page")
                Text(pageCount > 0 ? "\(pageIndex + 1) / \(pageCount)" : "– / –")
                    .monospacedDigit()
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 50)
                Button { workspace.pdf.nextPage() } label: { Image(systemName: "chevron.right") }
                    .help("Next page")
                Divider().frame(height: 14)
                Button { workspace.pdf.zoomOut() } label: { Image(systemName: "minus.magnifyingglass") }
                    .help("Zoom out")
                Button { workspace.pdf.fitWidth() } label: { Image(systemName: "arrow.left.and.right") }
                    .help("Fit width")
                Button { workspace.pdf.zoomIn() } label: { Image(systemName: "plus.magnifyingglass") }
                    .help("Zoom in")
                Spacer()
                Button { workspace.syncToPDF() } label: { Image(systemName: "arrow.right.doc.on.clipboard") }
                    .help("Jump from the cursor to the PDF (⌥⌘→)")
                    .disabled(workspace.pdfURL == nil)
                Button {
                    if let url = workspace.pdfURL { NSWorkspace.shared.open(url) }
                } label: { Image(systemName: "arrow.up.forward.square") }
                    .help("Open PDF in Preview")
                    .disabled(workspace.pdfURL == nil)
            }
            .buttonStyle(.borderless)
            .padding(.horizontal, 10)
            .frame(height: 32)
            Divider()
            ZStack {
                PDFKitView(workspace: workspace, version: workspace.pdfVersion)
                if workspace.pdfURL == nil {
                    VStack(spacing: 8) {
                        Image(systemName: "doc.richtext")
                            .font(.system(size: 34))
                            .foregroundStyle(.tertiary)
                        Text("No PDF yet").font(.headline)
                        Text("Compile your document to see the result here (⌘↩).")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(nsColor: .windowBackgroundColor))
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .PDFViewPageChanged)) { note in
            updatePage(note.object as? PDFView)
        }
        .onReceive(NotificationCenter.default.publisher(for: .PDFViewDocumentChanged)) { note in
            updatePage(note.object as? PDFView)
        }
    }

    private func updatePage(_ view: PDFView?) {
        guard let view, view === workspace.pdf.view else { return }
        pageCount = view.document?.pageCount ?? 0
        if let page = view.currentPage, let document = view.document { pageIndex = document.index(for: page) }
    }
}
