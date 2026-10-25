import AppKit
import Foundation
import Testing
@testable import Verso

@MainActor
struct WorkspaceTests {
    private func makeProject() throws -> (TemporaryFolder, Workspace) {
        let folder = try TemporaryFolder()
        try folder.write(".verso/project.json", #"{"mainFile":"main.tex","compiler":"pdflatex"}"#)
        try folder.write("main.tex", "\\documentclass{article}\n\\begin{document}\nHallo\n\\end{document}\n")
        return (folder, try Workspace(root: folder.url))
    }

    private func type(_ text: String, into document: EditorDocument) {
        document.storage.replaceCharacters(in: NSRange(location: document.storage.length, length: 0), with: text)
        document.isDirty = true
    }

    @Test func savingNeverOverwritesAnExternalChange() throws {
        let (folder, workspace) = try makeProject()
        let document = try #require(workspace.openFile("main.tex"))
        type("% my edit\n", into: document)
        try folder.write("main.tex", "changed by another program\n")

        workspace.save(document)
        #expect(document.hasConflict)
        #expect(document.isDirty)
        #expect(try folder.read("main.tex") == "changed by another program\n")

        workspace.keepMyVersion(document)
        #expect(!document.hasConflict && !document.isDirty)
        #expect(try folder.read("main.tex").hasSuffix("% my edit\n"))
    }

    @Test func loadingTheDiskVersionResolvesTheConflict() throws {
        let (folder, workspace) = try makeProject()
        let document = try #require(workspace.openFile("main.tex"))
        type("% my edit\n", into: document)
        try folder.write("main.tex", "from disk\n")
        workspace.save(document)
        workspace.loadDiskVersion(document)
        #expect(document.text == "from disk\n")
        #expect(!document.hasConflict && !document.isDirty)
    }

    @Test func normalSavesStillWork() throws {
        let (folder, workspace) = try makeProject()
        let document = try #require(workspace.openFile("main.tex"))
        type("% one\n", into: document)
        workspace.save(document)
        type("% two\n", into: document)
        workspace.save(document)
        #expect(!document.hasConflict)
        #expect(try folder.read("main.tex").hasSuffix("% one\n% two\n"))
    }

    @Test func projectSettingsLiveInDotVerso() throws {
        let (folder, workspace) = try makeProject()
        #expect(ProjectConfig.directoryName == ".verso")
        #expect(workspace.buildDirectory.path.hasPrefix(folder.url.path + "/.verso/"))
    }
}

struct ProjectIndexTests {
    @Test func openBuffersWinOverDiskAndInputsAreFollowed() throws {
        let folder = try TemporaryFolder()
        try folder.write("main.tex", "\\section{Intro}\n\\input{chapters/one}\n\\section{End}\n")
        try folder.write("chapters/one.tex", "\\section{On disk}\n\\label{sec:disk}\n")
        try folder.write("refs.bib", "@book{knuth, title={TeX}}\n")
        let index = ProjectIndex.build(root: folder.url, mainFile: "main.tex", fallbackFile: nil,
                                       openTexts: ["chapters/one.tex": "\\section{Unsaved}\n\\label{sec:open}\n"])
        #expect(index.outline.map(\.title) == ["Intro", "Unsaved", "End"])
        #expect(index.labels.map(\.key) == ["sec:open"])
        #expect(index.bibEntries.map(\.key) == ["knuth"])
    }
}

struct ProcessIdentityTests {
    @Test func identifiesTheSameProcessOnly() {
        let me = ProcessIdentity.startTime(of: getpid())
        #expect(me != nil)
        #expect(ProcessIdentity.startTime(of: getpid()) == me)
        #expect(ProcessIdentity.startTime(of: 999_999) == nil)
    }
}
