import Foundation
import Testing
@testable import Verso

struct PathSafetyTests {
    @Test func acceptsPathsInsideTheProject() throws {
        let folder = try TemporaryFolder()
        try folder.write("chapters/intro.tex", "x")
        #expect(ProjectFiles.resolve(root: folder.url, "chapters/intro.tex") != nil)
        #expect(ProjectFiles.resolve(root: folder.url, "chapters/new.tex") != nil)
        #expect(ProjectFiles.resolve(root: folder.url, "new-folder/new.tex") != nil)
    }

    @Test func rejectsTraversal() throws {
        let folder = try TemporaryFolder()
        #expect(ProjectFiles.resolve(root: folder.url, "../outside.tex") == nil)
        #expect(ProjectFiles.resolve(root: folder.url, "a/../../outside.tex") == nil)
    }

    @Test func rejectsSymlinksPointingOutside() throws {
        let project = try TemporaryFolder(), outside = try TemporaryFolder()
        try outside.write("secret.txt", "secret")
        let fm = FileManager.default
        try fm.createSymbolicLink(at: project.url.appendingPathComponent("link.tex"),
                                  withDestinationURL: outside.url.appendingPathComponent("secret.txt"))
        try fm.createSymbolicLink(at: project.url.appendingPathComponent("figures"), withDestinationURL: outside.url)
        try fm.createSymbolicLink(at: project.url.appendingPathComponent("dangling.tex"),
                                  withDestinationURL: outside.url.appendingPathComponent("missing.tex"))
        #expect(ProjectFiles.resolve(root: project.url, "link.tex") == nil)
        #expect(ProjectFiles.resolve(root: project.url, "figures/new.png") == nil)
        #expect(ProjectFiles.resolve(root: project.url, "dangling.tex") == nil)
    }

    @Test func allowsSymlinksInsideTheProject() throws {
        let folder = try TemporaryFolder()
        try folder.write("real/main.tex", "x")
        try FileManager.default.createSymbolicLink(at: folder.url.appendingPathComponent("alias"),
                                                   withDestinationURL: folder.url.appendingPathComponent("real"))
        #expect(ProjectFiles.resolve(root: folder.url, "alias/main.tex") != nil)
    }

    @Test func zipImportDropsSymlinksThatEscape() async throws {
        let work = try TemporaryFolder(), parent = try TemporaryFolder()
        try work.write("proj/main.tex", "\\documentclass{article}")
        try FileManager.default.createSymbolicLink(at: work.url.appendingPathComponent("proj/hosts.tex"),
                                                   withDestinationURL: URL(fileURLWithPath: "/etc/hosts"))
        // A relative link stays inside the project after import.
        try FileManager.default.createSymbolicLink(atPath: work.url.appendingPathComponent("proj/inside.tex").path,
                                                   withDestinationPath: "main.tex")
        let zip = work.url.appendingPathComponent("proj.zip")
        try shell("/usr/bin/ditto", ["-c", "-k", "--keepParent", "proj", zip.path], in: work.url)

        let project = try await ProjectFiles.importZip(zip, into: parent.url)
        let fm = FileManager.default
        #expect(fm.fileExists(atPath: project.appendingPathComponent("main.tex").path))
        #expect((try? fm.destinationOfSymbolicLink(atPath: project.appendingPathComponent("hosts.tex").path)) == nil)
        #expect((try? fm.destinationOfSymbolicLink(atPath: project.appendingPathComponent("inside.tex").path)) != nil)
    }

    @Test func relativePathFromTheMainFileFolder() {
        #expect(ProjectFiles.relativePath(from: "", to: "figures/a") == "figures/a")
        #expect(ProjectFiles.relativePath(from: "thesis", to: "thesis/figures/a") == "figures/a")
        #expect(ProjectFiles.relativePath(from: "thesis", to: "figures/a") == "../figures/a")
        #expect(ProjectFiles.relativePath(from: "a/b", to: "a/c/img") == "../c/img")
    }
}

struct TextFormatTests {
    @Test func latin1FilesStayLatin1() throws {
        let folder = try TemporaryFolder()
        let url = folder.url.appendingPathComponent("alt.tex")
        try "Größe\n".data(using: .isoLatin1)!.write(to: url)
        let file = try ProjectFiles.readText(url)
        #expect(file.text == "Größe\n")
        #expect(file.format.latin1)
        let written = try ProjectFiles.writeText("Größe ändern\n", to: url, format: file.format)
        #expect(written.latin1)
        #expect(try Data(contentsOf: url) == "Größe ändern\n".data(using: .isoLatin1)!)
    }

    @Test func latin1FallsBackToUTF8WithoutLosingCharacters() throws {
        let folder = try TemporaryFolder()
        let url = folder.url.appendingPathComponent("alt.tex")
        let written = try ProjectFiles.writeText("Preis: 5 €\n", to: url, format: TextFormat(latin1: true))
        #expect(!written.latin1)
        #expect(try String(contentsOf: url, encoding: .utf8) == "Preis: 5 €\n")
    }

    @Test func crlfAndBOMArePreserved() throws {
        let folder = try TemporaryFolder()
        let url = folder.url.appendingPathComponent("win.tex")
        try Data([0xEF, 0xBB, 0xBF] + Array("a\r\nb\r\n".utf8)).write(to: url)
        let file = try ProjectFiles.readText(url)
        #expect(file.text == "a\nb\n")
        #expect(file.format == TextFormat(crlf: true, bom: true, latin1: false))
        try ProjectFiles.writeText("a\nb\nc\n", to: url, format: file.format)
        #expect(try Data(contentsOf: url) == Data([0xEF, 0xBB, 0xBF] + Array("a\r\nb\r\nc\r\n".utf8)))
    }
}
