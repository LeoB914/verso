import AppKit
import Observation

enum Compiler: String, Codable, CaseIterable, Identifiable {
    case pdflatex, xelatex, lualatex

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .pdflatex: "pdfLaTeX"
        case .xelatex: "XeLaTeX"
        case .lualatex: "LuaLaTeX"
        }
    }

    var latexmkFlag: String {
        switch self {
        case .pdflatex: "-pdf"
        case .xelatex: "-xelatex"
        case .lualatex: "-lualatex"
        }
    }
}

enum AppTheme: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum CiteCommand: String, CaseIterable, Identifiable {
    case cite, parencite, textcite, autocite, citep, citet
    var id: String { rawValue }
}

/// App-wide settings, persisted in UserDefaults. Every property applies live.
@Observable
final class AppSettings {
    static let shared = AppSettings()

    private let defaults = UserDefaults.standard

    // General
    var autosaveEnabled: Bool { didSet { save(autosaveEnabled, "autosaveEnabled") } }
    var autosaveDelayMs: Int { didSet { save(autosaveDelayMs, "autosaveDelayMs") } }
    var confirmBeforeDelete: Bool { didSet { save(confirmBeforeDelete, "confirmBeforeDelete") } }
    var defaultProjectDir: String { didSet { save(defaultProjectDir, "defaultProjectDir") } }
    var firstRunDone: Bool { didSet { save(firstRunDone, "firstRunDone") } }

    // Appearance
    var appTheme: AppTheme {
        didSet {
            save(appTheme.rawValue, "appTheme")
            applyAppearance()
        }
    }

    // Editor
    var editorFontName: String { didSet { save(editorFontName, "editorFontName") } }
    var editorFontSize: Double { didSet { save(editorFontSize, "editorFontSize") } }
    var editorLineHeight: Double { didSet { save(editorLineHeight, "editorLineHeight") } }
    var tabWidth: Int { didSet { save(tabWidth, "tabWidth") } }
    var softWrap: Bool { didSet { save(softWrap, "softWrap") } }
    var lineNumbers: Bool { didSet { save(lineNumbers, "lineNumbers") } }
    var highlightActiveLine: Bool { didSet { save(highlightActiveLine, "highlightActiveLine") } }
    var autocompleteEnabled: Bool { didSet { save(autocompleteEnabled, "autocompleteEnabled") } }
    var autocloseBrackets: Bool { didSet { save(autocloseBrackets, "autocloseBrackets") } }
    var spellEnabled: Bool { didSet { save(spellEnabled, "spellEnabled") } }

    // Compiler
    var defaultCompiler: Compiler { didSet { save(defaultCompiler.rawValue, "defaultCompiler") } }
    var autoCompileDelayMs: Int { didSet { save(autoCompileDelayMs, "autoCompileDelayMs") } }
    var compileTimeoutSeconds: Int { didSet { save(compileTimeoutSeconds, "compileTimeoutSeconds") } }
    var shellEscapeDefault: Bool { didSet { save(shellEscapeDefault, "shellEscapeDefault") } }

    // References
    var citeCommand: CiteCommand { didSet { save(citeCommand.rawValue, "citeCommand") } }

    private init() {
        let d = UserDefaults.standard
        func value<T>(_ key: String, _ fallback: T) -> T { d.object(forKey: key) as? T ?? fallback }

        autosaveEnabled = value("autosaveEnabled", true)
        autosaveDelayMs = value("autosaveDelayMs", 1000)
        confirmBeforeDelete = value("confirmBeforeDelete", true)
        defaultProjectDir = value("defaultProjectDir", "")
        firstRunDone = value("firstRunDone", false)
        appTheme = AppTheme(rawValue: value("appTheme", "system")) ?? .system
        editorFontName = value("editorFontName", "")
        editorFontSize = value("editorFontSize", 14.0)
        editorLineHeight = value("editorLineHeight", 1.4)
        tabWidth = value("tabWidth", 2)
        softWrap = value("softWrap", true)
        lineNumbers = value("lineNumbers", true)
        highlightActiveLine = value("highlightActiveLine", true)
        autocompleteEnabled = value("autocompleteEnabled", true)
        autocloseBrackets = value("autocloseBrackets", true)
        spellEnabled = value("spellEnabled", false)
        defaultCompiler = Compiler(rawValue: value("defaultCompiler", "pdflatex")) ?? .pdflatex
        autoCompileDelayMs = value("autoCompileDelayMs", 1500)
        compileTimeoutSeconds = value("compileTimeoutSeconds", 120)
        shellEscapeDefault = value("shellEscapeDefault", false)
        citeCommand = CiteCommand(rawValue: value("citeCommand", "cite")) ?? .cite
    }

    private func save(_ value: Any, _ key: String) {
        defaults.set(value, forKey: key)
    }

    /// Effective editor font (falls back to the system monospaced font).
    var editorFont: NSFont {
        let size = CGFloat(min(max(editorFontSize, 8), 32))
        if !editorFontName.isEmpty, let font = NSFont(name: editorFontName, size: size) {
            return font
        }
        return NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
    }

    /// Default location for new projects (`~/Documents/Verso`).
    var effectiveProjectDirectory: URL {
        if !defaultProjectDir.isEmpty { return URL(fileURLWithPath: defaultProjectDir) }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let legacy = documents.appendingPathComponent("OpenLeaf")
        if FileManager.default.fileExists(atPath: legacy.path) { return legacy }
        return documents.appendingPathComponent("Verso")
    }

    func applyAppearance() {
        switch appTheme {
        case .system: NSApp?.appearance = nil
        case .light: NSApp?.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp?.appearance = NSAppearance(named: .darkAqua)
        }
    }
}
