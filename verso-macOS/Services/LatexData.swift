import Foundation

/// Completion catalogue loaded from `latex-commands.json` (shared with the Electron version).
enum LatexData {
    struct Command: Decodable {
        var label: String
        var detail: String
        var apply: String?
        var snippet: Bool?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            label = try c.decode(String.self, forKey: .label)
            detail = (try? c.decode(String.self, forKey: .detail)) ?? ""
            apply = try? c.decode(String.self, forKey: .apply)
            snippet = try? c.decode(Bool.self, forKey: .snippet)
        }

        private enum CodingKeys: String, CodingKey { case label, detail, apply, snippet }
    }

    struct Environment: Decodable {
        var label: String
        var detail: String
    }

    private struct Catalogue: Decodable {
        var commands: [Command]
        var environments: [Environment]
        var packages: [String]
    }

    private static let catalogue: Catalogue = {
        guard let url = Bundle.main.url(forResource: "latex-commands", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(Catalogue.self, from: data) else {
            return Catalogue(commands: [], environments: [], packages: [])
        }
        return decoded
    }()

    static var commands: [Command] { catalogue.commands }
    static var environments: [Environment] { catalogue.environments }
    static var packages: [String] { catalogue.packages }
}

/// Symbol palette entries, rendered with their Unicode glyph.
struct LatexSymbol: Identifiable, Hashable {
    var name: String
    var command: String
    var glyph: String
    var category: String
    var id: String { command }

    static let all: [LatexSymbol] = {
        let groups: [(String, [(String, String, String)])] = [
            ("Greek", [
                ("alpha", "\\alpha", "α"), ("beta", "\\beta", "β"), ("gamma", "\\gamma", "γ"), ("delta", "\\delta", "δ"),
                ("epsilon", "\\epsilon", "ϵ"), ("varepsilon", "\\varepsilon", "ε"), ("zeta", "\\zeta", "ζ"), ("eta", "\\eta", "η"),
                ("theta", "\\theta", "θ"), ("iota", "\\iota", "ι"), ("kappa", "\\kappa", "κ"), ("lambda", "\\lambda", "λ"),
                ("mu", "\\mu", "μ"), ("nu", "\\nu", "ν"), ("xi", "\\xi", "ξ"), ("pi", "\\pi", "π"), ("rho", "\\rho", "ρ"),
                ("sigma", "\\sigma", "σ"), ("tau", "\\tau", "τ"), ("phi", "\\phi", "ϕ"), ("varphi", "\\varphi", "φ"),
                ("chi", "\\chi", "χ"), ("psi", "\\psi", "ψ"), ("omega", "\\omega", "ω"),
                ("Gamma", "\\Gamma", "Γ"), ("Delta", "\\Delta", "Δ"), ("Theta", "\\Theta", "Θ"), ("Lambda", "\\Lambda", "Λ"),
                ("Xi", "\\Xi", "Ξ"), ("Pi", "\\Pi", "Π"), ("Sigma", "\\Sigma", "Σ"), ("Phi", "\\Phi", "Φ"),
                ("Psi", "\\Psi", "Ψ"), ("Omega", "\\Omega", "Ω"),
            ]),
            ("Operators", [
                ("sum", "\\sum", "∑"), ("prod", "\\prod", "∏"), ("int", "\\int", "∫"), ("iint", "\\iint", "∬"),
                ("oint", "\\oint", "∮"), ("lim", "\\lim", "lim"), ("partial", "\\partial", "∂"), ("nabla", "\\nabla", "∇"),
                ("infty", "\\infty", "∞"), ("cdot", "\\cdot", "·"), ("times", "\\times", "×"), ("div", "\\div", "÷"),
                ("pm", "\\pm", "±"), ("mp", "\\mp", "∓"), ("circ", "\\circ", "∘"), ("oplus", "\\oplus", "⊕"),
                ("otimes", "\\otimes", "⊗"), ("frac", "\\frac{a}{b}", "a⁄b"), ("sqrt", "\\sqrt{x}", "√x"),
            ]),
            ("Relations", [
                ("leq", "\\leq", "≤"), ("geq", "\\geq", "≥"), ("neq", "\\neq", "≠"), ("approx", "\\approx", "≈"),
                ("equiv", "\\equiv", "≡"), ("sim", "\\sim", "∼"), ("simeq", "\\simeq", "≃"), ("cong", "\\cong", "≅"),
                ("propto", "\\propto", "∝"), ("ll", "\\ll", "≪"), ("gg", "\\gg", "≫"), ("perp", "\\perp", "⊥"),
                ("parallel", "\\parallel", "∥"), ("mid", "\\mid", "∣"),
            ]),
            ("Sets & logic", [
                ("in", "\\in", "∈"), ("notin", "\\notin", "∉"), ("subset", "\\subset", "⊂"), ("subseteq", "\\subseteq", "⊆"),
                ("supset", "\\supset", "⊃"), ("supseteq", "\\supseteq", "⊇"), ("cup", "\\cup", "∪"), ("cap", "\\cap", "∩"),
                ("setminus", "\\setminus", "∖"), ("emptyset", "\\emptyset", "∅"), ("forall", "\\forall", "∀"),
                ("exists", "\\exists", "∃"), ("neg", "\\neg", "¬"), ("land", "\\land", "∧"), ("lor", "\\lor", "∨"),
                ("mathbb R", "\\mathbb{R}", "ℝ"), ("mathbb N", "\\mathbb{N}", "ℕ"), ("mathbb Z", "\\mathbb{Z}", "ℤ"),
                ("mathbb Q", "\\mathbb{Q}", "ℚ"), ("mathbb C", "\\mathbb{C}", "ℂ"),
            ]),
            ("Arrows", [
                ("to (right arrow)", "\\to", "→"), ("leftarrow", "\\leftarrow", "←"), ("Rightarrow", "\\Rightarrow", "⇒"),
                ("Leftarrow", "\\Leftarrow", "⇐"), ("leftrightarrow", "\\leftrightarrow", "↔"),
                ("Leftrightarrow", "\\Leftrightarrow", "⇔"), ("mapsto", "\\mapsto", "↦"), ("uparrow", "\\uparrow", "↑"),
                ("downarrow", "\\downarrow", "↓"), ("implies", "\\implies", "⟹"), ("iff", "\\iff", "⟺"),
            ]),
            ("Accents", [
                ("hat", "\\hat{x}", "x̂"), ("bar", "\\bar{x}", "x̄"), ("tilde", "\\tilde{x}", "x̃"), ("vec", "\\vec{x}", "x⃗"),
                ("dot", "\\dot{x}", "ẋ"), ("ddot", "\\ddot{x}", "ẍ"), ("overline", "\\overline{x}", "x̅"),
            ]),
            ("Delimiters", [
                ("left right parens", "\\left( x \\right)", "( )"), ("left right brackets", "\\left[ x \\right]", "[ ]"),
                ("left right braces", "\\left\\{ x \\right\\}", "{ }"), ("langle rangle", "\\langle x \\rangle", "⟨ ⟩"),
                ("norm", "\\| x \\|", "‖ ‖"), ("lfloor rfloor", "\\lfloor x \\rfloor", "⌊ ⌋"), ("lceil rceil", "\\lceil x \\rceil", "⌈ ⌉"),
            ]),
            ("Misc", [
                ("dots", "\\dots", "…"), ("cdots", "\\cdots", "⋯"), ("vdots", "\\vdots", "⋮"), ("ddots", "\\ddots", "⋱"),
                ("text in math", "\\text{text}", "T"), ("quad space", "\\quad", "␣"), ("degree", "^\\circ", "°"),
                ("hbar", "\\hbar", "ℏ"), ("ell", "\\ell", "ℓ"), ("aleph", "\\aleph", "ℵ"),
            ]),
        ]
        return groups.flatMap { category, items in
            items.map { LatexSymbol(name: $0.0, command: $0.1, glyph: $0.2, category: category) }
        }
    }()
}
