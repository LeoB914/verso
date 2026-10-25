import Foundation
import Testing
@testable import Verso

struct GitServiceTests {
    @Test func statusKeepsUmlautsAndSpacesVerbatim() async throws {
        let folder = try TemporaryFolder()
        let root = folder.url
        try shell("/usr/bin/git", ["init", "-q", "-b", "main"], in: root)
        try shell("/usr/bin/git", ["config", "user.email", "test@example.com"], in: root)
        try shell("/usr/bin/git", ["config", "user.name", "Test"], in: root)
        try folder.write("Übung.tex", "a\n")
        try folder.write("mit leerzeichen.tex", "b\n")
        try folder.write("alt.tex", "c\n")
        try shell("/usr/bin/git", ["add", "alt.tex"], in: root)
        try shell("/usr/bin/git", ["commit", "-q", "-m", "init"], in: root)
        try shell("/usr/bin/git", ["mv", "alt.tex", "neu.tex"], in: root)

        let status = try await GitService.status(root)
        #expect(status.branch == "main")
        let paths = Set(status.files.map(\.path))
        #expect(paths == ["Übung.tex", "mit leerzeichen.tex", "neu.tex"])

        // The reported path works for staging (it failed with "\303\234bung.tex").
        try await GitService.run(root, ["add", "--", "Übung.tex"])
        let staged = try await GitService.status(root).files.first { $0.path == "Übung.tex" }
        #expect(staged?.isStaged == true)
    }

    @Test func parsesBranchHeaderAndRenames() {
        let output = "## main...origin/main [ahead 2, behind 1]\0R  new name.tex\0old name.tex\0 M Kapitel ä.tex\0?? x.tex\0"
        let status = GitService.parseStatus(output)
        #expect(status.branch == "main")
        #expect(status.ahead == 2 && status.behind == 1)
        #expect(status.files.map(\.path) == ["new name.tex", "Kapitel ä.tex", "x.tex"])
        #expect(status.files[0].isStaged && !status.files[1].isStaged)
    }

    @Test func parsesUnbornBranch() {
        #expect(GitService.parseStatus("## No commits yet on main\0").branch == "main")
    }
}
