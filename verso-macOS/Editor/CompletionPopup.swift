import AppKit

struct CompletionItem {
    enum Kind { case command, environment, label, citation, file, package, user }

    var label: String
    var detail: String
    /// Text to insert; may contain `${1:placeholder}` / `$0` snippet stops.
    var insert: String
    var kind: Kind
}

struct CompletionResult {
    /// Start of the replaced range (UTF-16 offset in the document).
    var from: Int
    var items: [CompletionItem]
}

/// Borderless child window listing completion candidates under the cursor.
final class CompletionPopup: NSObject, NSTableViewDataSource, NSTableViewDelegate {
    private var panel: NSPanel?
    private let tableView = NSTableView()
    private(set) var items: [CompletionItem] = []
    var onAccept: ((CompletionItem) -> Void)?

    var isVisible: Bool { panel?.isVisible == true }
    var selectedItem: CompletionItem? {
        let row = tableView.selectedRow
        return row >= 0 && row < items.count ? items[row] : nil
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 440, height: 200),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isFloatingPanel = true
        panel.hasShadow = true
        panel.backgroundColor = .clear
        panel.isOpaque = false

        let effect = NSVisualEffectView()
        effect.material = .popover
        effect.state = .active
        effect.wantsLayer = true
        effect.layer?.cornerRadius = 8
        effect.layer?.masksToBounds = true
        effect.layer?.borderWidth = 0.5
        effect.layer?.borderColor = NSColor.separatorColor.cgColor

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("item"))
        tableView.addTableColumn(column)
        tableView.headerView = nil
        tableView.rowHeight = 22
        tableView.intercellSpacing = NSSize(width: 0, height: 0)
        tableView.backgroundColor = .clear
        tableView.style = .plain
        tableView.selectionHighlightStyle = .regular
        tableView.dataSource = self
        tableView.delegate = self
        tableView.target = self
        tableView.doubleAction = #selector(doubleClicked)

        let scroll = NSScrollView()
        scroll.documentView = tableView
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.autohidesScrollers = true
        scroll.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: effect.topAnchor, constant: 4),
            scroll.bottomAnchor.constraint(equalTo: effect.bottomAnchor, constant: -4),
        ])
        panel.contentView = effect
        return panel
    }

    func show(items: [CompletionItem], at screenPoint: NSPoint, lineHeight: CGFloat, parent: NSWindow) {
        self.items = items
        let panel = self.panel ?? makePanel()
        self.panel = panel
        tableView.reloadData()
        tableView.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false)
        tableView.scrollRowToVisible(0)
        let height = CGFloat(min(items.count, 10)) * tableView.rowHeight + 8
        var origin = NSPoint(x: screenPoint.x - 6, y: screenPoint.y - height - 2)
        if let screen = parent.screen, origin.y < screen.visibleFrame.minY {
            origin.y = screenPoint.y + lineHeight + 2
        }
        panel.setFrame(NSRect(origin: origin, size: NSSize(width: 440, height: height)), display: true)
        if panel.parent == nil { parent.addChildWindow(panel, ordered: .above) }
        panel.orderFront(nil)
    }

    func hide() {
        guard let panel, panel.isVisible else { return }
        panel.parent?.removeChildWindow(panel)
        panel.orderOut(nil)
    }

    func moveSelection(by delta: Int) {
        guard !items.isEmpty else { return }
        let row = max(0, min(items.count - 1, tableView.selectedRow + delta))
        tableView.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
        tableView.scrollRowToVisible(row)
    }

    @objc private func doubleClicked() {
        if let item = selectedItem { onAccept?(item) }
    }

    func numberOfRows(in tableView: NSTableView) -> Int { items.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let item = items[row]
        let identifier = NSUserInterfaceItemIdentifier("cell")
        let cell = tableView.makeView(withIdentifier: identifier, owner: nil) as? CompletionCell ?? CompletionCell()
        cell.identifier = identifier
        cell.configure(item)
        return cell
    }
}

private final class CompletionCell: NSTableCellView {
    private let icon = NSImageView()
    private let label = NSTextField(labelWithString: "")
    private let detail = NSTextField(labelWithString: "")

    init() {
        super.init(frame: .zero)
        for view in [icon, label, detail] as [NSView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        label.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        label.lineBreakMode = .byTruncatingTail
        detail.font = .systemFont(ofSize: 11)
        detail.textColor = .secondaryLabelColor
        detail.lineBreakMode = .byTruncatingTail
        detail.alignment = .right
        icon.contentTintColor = .secondaryLabelColor
        label.setContentCompressionResistancePriority(.defaultHigh, for: .horizontal)
        detail.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 14),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 6),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            detail.leadingAnchor.constraint(greaterThanOrEqualTo: label.trailingAnchor, constant: 10),
            detail.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            detail.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func configure(_ item: CompletionItem) {
        label.stringValue = item.label
        detail.stringValue = item.detail
        let symbol: String
        switch item.kind {
        case .command: symbol = "function"
        case .environment: symbol = "curlybraces"
        case .label: symbol = "tag"
        case .citation: symbol = "book"
        case .file: symbol = "doc"
        case .package: symbol = "shippingbox"
        case .user: symbol = "person.crop.square"
        }
        icon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
    }
}
