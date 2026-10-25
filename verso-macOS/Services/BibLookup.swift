import Foundation

/// "Add entry by identifier": DOI (doi.org content negotiation), arXiv (export API) or ISBN (Open Library).
enum BibLookup {
    enum Identifier: Equatable {
        case doi(String), arxiv(String), isbn(String)
    }

    static func classify(_ raw: String) -> Identifier? {
        let input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return nil }
        let arxivPatterns = [
            #"^(?:arxiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?$"#,
            #"^(?:https?://)?(?:www\.)?arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?/?$"#,
        ]
        for pattern in arxivPatterns {
            if let groups = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive).groups(in: input) {
                return .arxiv(groups[1])
            }
        }
        let isbn = input.replacingOccurrences(of: #"[-\s]"#, with: "", options: .regularExpression).uppercased()
        if isbn.range(of: #"^(?:\d{9}[\dX]|97[89]\d{10})$"#, options: .regularExpression) != nil { return .isbn(isbn) }
        let doi = input.replacingOccurrences(of: #"^(?:doi:\s*|https?://(?:dx\.)?doi\.org/)"#, with: "",
                                             options: [.regularExpression, .caseInsensitive])
        return .doi(doi)
    }

    /// Fetch a BibTeX entry; returns the entry text and its citation key.
    static func fetch(_ raw: String) async throws -> (bibtex: String, key: String) {
        guard let identifier = classify(raw) else { throw VersoError("Enter a DOI, arXiv id or ISBN.") }
        let session = URLSession(configuration: .ephemeral)
        switch identifier {
        case .arxiv(let id):
            var components = URLComponents(string: "https://export.arxiv.org/api/query")!
            components.queryItems = [URLQueryItem(name: "id_list", value: id)]
            let (data, _) = try await session.data(from: components.url!)
            return try arxivToBibtex(String(decoding: data, as: UTF8.self), id: id)
        case .isbn(let isbn):
            let (data, response) = try await session.data(from: URL(string: "https://openlibrary.org/isbn/\(isbn).json")!)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let book = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw VersoError("No book found for ISBN \(isbn).")
            }
            var authors: [String] = []
            for ref in (book["authors"] as? [[String: Any]]) ?? [] {
                if let key = ref["key"] as? String, let url = URL(string: "https://openlibrary.org\(key).json"),
                   let authorResponse = try? await session.data(from: url),
                   let author = try? JSONSerialization.jsonObject(with: authorResponse.0) as? [String: Any],
                   let name = author["name"] as? String {
                    authors.append(name)
                }
            }
            let year = (book["publish_date"] as? String)?.range(of: #"\d{4}"#, options: .regularExpression)
                .map { String((book["publish_date"] as! String)[$0]) } ?? ""
            let title = book["title"] as? String ?? ""
            let key = BibParser.generateKey(author: authors.first ?? "isbn", year: year, title: title)
            let bibtex = """
            @book{\(key),
              author = {\(authors.joined(separator: " and "))},
              title = {\(title)},
              year = {\(year)},
              isbn = {\(isbn)},
            }
            """
            return (bibtex, key)
        case .doi(let doi):
            let encoded = doi.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? doi
            guard let url = URL(string: "https://doi.org/\(encoded)") else { throw VersoError("Invalid DOI.") }
            var request = URLRequest(url: url, timeoutInterval: 15)
            request.setValue("application/x-bibtex; charset=utf-8", forHTTPHeaderField: "Accept")
            let (data, response) = try await session.data(for: request)
            let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            guard (response as? HTTPURLResponse)?.statusCode == 200, text.hasPrefix("@") else {
                throw VersoError("No entry found for DOI \(doi).")
            }
            let entry = BibParser.parse(text).first
            let key = BibParser.generateKey(author: entry?.fields["author"] ?? "", year: entry?.year ?? "", title: entry?.title ?? "")
            // Replace the publisher's key with a readable one and pretty-print the fields.
            var bibtex = text.replacingOccurrences(of: #"^@(\w+)\s*\{\s*[^,]*,"#, with: "@$1{\(key),", options: .regularExpression)
            bibtex = bibtex.replacingOccurrences(of: #",\s*(\w+)\s*=\s*"#, with: ",\n  $1 = ", options: .regularExpression)
            bibtex = bibtex.replacingOccurrences(of: #"\}\s*\}$"#, with: "}\n}", options: .regularExpression)
            return (bibtex, key)
        }
    }

    static func arxivToBibtex(_ xml: String, id: String) throws -> (bibtex: String, key: String) {
        func decode(_ value: String) -> String {
            value.replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
                .replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&apos;", with: "'")
                .replacingOccurrences(of: "&amp;", with: "&")
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
        }
        let options: NSRegularExpression.Options = [.caseInsensitive, .dotMatchesLineSeparators]
        guard let entry = try NSRegularExpression(pattern: #"<entry\b[^>]*>(.*?)</entry>"#, options: options).groups(in: xml)?[1],
              let rawTitle = try NSRegularExpression(pattern: #"<title\b[^>]*>(.*?)</title>"#, options: options).groups(in: entry)?[1] else {
            throw VersoError("No arXiv entry found for \(id).")
        }
        let authorRegex = try NSRegularExpression(pattern: #"<author\b[^>]*>.*?<name>(.*?)</name>"#, options: options)
        let ns = entry as NSString
        let authors = authorRegex.matches(in: entry, range: NSRange(location: 0, length: ns.length))
            .map { decode(ns.substring(with: $0.range(at: 1))) }
        let year = try NSRegularExpression(pattern: #"<published>(\d{4})"#).groups(in: entry)?[1] ?? ""
        let title = decode(rawTitle)
        let key = BibParser.generateKey(author: authors.first ?? "arxiv", year: year, title: title)
        let bibtex = """
        @article{\(key),
          author = {\(authors.joined(separator: " and "))},
          title = {\(title)},
          year = {\(year)},
          eprint = {\(id)},
          archivePrefix = {arXiv},
        }
        """
        return (bibtex, key)
    }
}
