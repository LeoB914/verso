import SwiftUI

struct GitPanel: View {
    let workspace: Workspace
    @State private var status: GitStatus?
    @State private var commits: [GitCommit] = []
    @State private var branches: [String] = []
    @State private var message = ""
    @State private var busy: String?
    @State private var error: String?
    @State private var isRepo = false
    @State private var shownCommit: GitCommit?

    private var root: URL { workspace.root }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelHeader(title: "Git") {
                if isRepo {
                    Button { run("Pulling…") { try await GitService.run(root, ["pull", "--ff-only"], timeout: 120) } } label: {
                        Image(systemName: "arrow.down.circle")
                    }.help("Pull")
                    Button { push() } label: { Image(systemName: "arrow.up.circle") }.help("Push")
                }
                Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }.help("Refresh")
            }
            Divider()
            if GitService.gitPath == nil {
                Text("Git is not installed. Install the Xcode command line tools (xcode-select --install).")
                    .font(.callout).foregroundStyle(.secondary).padding()
            } else if !isRepo {
                VStack(alignment: .leading, spacing: 8) {
                    Text("This project is not a Git repository.").font(.callout).foregroundStyle(.secondary)
                    Button("Initialize Repository") {
                        run("Initializing…") { try await GitService.initRepo(root) }
                    }
                }
                .padding()
            } else {
                content
            }
            Spacer(minLength: 0)
        }
        .task { await refresh() }
        .sheet(item: $shownCommit) { commit in CommitSheet(root: root, commit: commit) }
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Menu {
                    ForEach(branches, id: \.self) { branch in
                        Button(branch) { run("Switching…") { try await GitService.run(root, ["switch", branch]) } }
                            .disabled(branch == status?.branch)
                    }
                    Divider()
                    Button("New Branch…") {
                        if let name = Prompt.text(title: "New Branch", message: "Name of the new branch:", confirm: "Create") {
                            run("Creating branch…") { try await GitService.run(root, ["switch", "-c", name]) }
                        }
                    }
                } label: {
                    Label(status?.branch ?? "–", systemImage: "arrow.triangle.branch")
                }
                .fixedSize()
                if let status, status.ahead > 0 || status.behind > 0 {
                    Text("↑\(status.ahead) ↓\(status.behind)").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer()
                if let busy {
                    ProgressView().controlSize(.small)
                    Text(busy).font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            if let error {
                Text(error).font(.system(size: 11)).foregroundStyle(.red).textSelection(.enabled).lineLimit(6)
            }
            TextField("Commit message", text: $message, axis: .vertical)
                .lineLimit(2...5)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("Commit") { commit(all: false) }
                    .disabled(message.trimmingCharacters(in: .whitespaces).isEmpty || !(status?.files.contains(where: \.isStaged) ?? false))
                Button("Commit All") { commit(all: true) }
                    .disabled(message.trimmingCharacters(in: .whitespaces).isEmpty || (status?.files.isEmpty ?? true))
                    .help("Stage all changes and commit")
            }
            .controlSize(.small)
        }
        .padding(10)
        Divider()
        List {
            let staged = status?.files.filter(\.isStaged) ?? []
            let unstaged = status?.files.filter(\.isUnstaged) ?? []
            Section("Staged (\(staged.count))") {
                ForEach(staged) { file in fileRow(file, staged: true) }
            }
            Section {
                ForEach(unstaged) { file in fileRow(file, staged: false) }
            } header: {
                HStack {
                    Text("Changes (\(unstaged.count))")
                    Spacer()
                    if !unstaged.isEmpty {
                        Button("Stage All") { run(nil) { try await GitService.run(root, ["add", "-A"]) } }
                            .buttonStyle(.borderless).font(.system(size: 10))
                    }
                }
            }
            Section("History") {
                ForEach(commits) { commit in
                    Button { shownCommit = commit } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(commit.subject).font(.system(size: 12)).lineLimit(1)
                            Text("\(commit.shortHash) · \(commit.author) · \(commit.date.formatted(.relative(presentation: .named)))")
                                .font(.system(size: 10)).foregroundStyle(.secondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
    }

    private func fileRow(_ file: GitFileStatus, staged: Bool) -> some View {
        HStack(spacing: 6) {
            Text(staged ? String(file.indexStatus) : file.displayStatus)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(color(for: staged ? String(file.indexStatus) : file.displayStatus))
                .frame(width: 12)
            Text(file.path).font(.system(size: 12)).lineLimit(1).truncationMode(.middle)
            Spacer()
            Button {
                run(nil) {
                    if staged { try await GitService.run(root, ["restore", "--staged", "--", file.path]) }
                    else { try await GitService.run(root, ["add", "--", file.path]) }
                }
            } label: { Image(systemName: staged ? "minus" : "plus") }
            .buttonStyle(.borderless)
            .help(staged ? "Unstage" : "Stage")
        }
        .contentShape(Rectangle())
        .onTapGesture { if FileManager.default.fileExists(atPath: root.appendingPathComponent(file.path).path) { workspace.openFile(file.path) } }
        .contextMenu {
            if !staged && file.indexStatus != "?" {
                Button("Discard Changes…", role: .destructive) {
                    guard Prompt.confirm("Discard changes to \(file.path)?", message: "This cannot be undone with Git, but Verso's version history keeps a snapshot.",
                                         confirm: "Discard", destructive: true) else { return }
                    workspace.takeSnapshot(reason: "Before discarding changes")
                    run(nil) {
                        try await GitService.run(root, ["restore", "--", file.path])
                        workspace.reloadOpenDocuments([file.path])
                    }
                }
            }
        }
    }

    private func color(for status: String) -> Color {
        switch status {
        case "M": .orange
        case "A", "U", "?": .green
        case "D": .red
        default: .secondary
        }
    }

    private func refresh() async {
        isRepo = GitService.isRepo(root)
        guard isRepo, GitService.gitPath != nil else { return }
        do {
            status = try await GitService.status(root)
            commits = (try? await GitService.log(root, limit: 30)) ?? []
            branches = (try? await GitService.branches(root)) ?? []
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func run(_ label: String?, _ action: @escaping () async throws -> Void) {
        busy = label
        error = nil
        Task {
            workspace.saveAll()
            do { try await action() } catch { self.error = error.localizedDescription }
            busy = nil
            await refresh()
        }
    }

    private func commit(all: Bool) {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        run("Committing…") {
            if all { try await GitService.run(root, ["add", "-A"]) }
            try await GitService.run(root, ["commit", "-m", text])
            message = ""
        }
    }

    private func push() {
        run("Pushing…") {
            do {
                try await GitService.run(root, ["push"], timeout: 120)
            } catch {
                // First push of a branch: set the upstream.
                if error.localizedDescription.contains("no upstream"), let branch = status?.branch {
                    try await GitService.run(root, ["push", "-u", "origin", branch], timeout: 120)
                } else {
                    throw error
                }
            }
        }
    }
}

private struct CommitSheet: View {
    let root: URL
    let commit: GitCommit
    @Environment(\.dismiss) private var dismiss
    @State private var text = "Loading…"

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(commit.subject).font(.headline)
            Text("\(commit.hash) · \(commit.author) · \(commit.date.formatted())").font(.caption).foregroundStyle(.secondary)
            DiffTextView(text: text)
            HStack {
                Spacer()
                Button("Close") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
        .frame(width: 760, height: 560)
        .task {
            text = (try? await GitService.show(root, commit: commit.hash)) ?? "Could not load the commit."
        }
    }
}

/// Monospaced unified-diff display with +/- coloring.
struct DiffTextView: View {
    let text: String

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(text.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                    Text(line.isEmpty ? " " : line)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(line.hasPrefix("+") && !line.hasPrefix("+++") ? Color.green
                                         : line.hasPrefix("-") && !line.hasPrefix("---") ? Color.red
                                         : line.hasPrefix("@@") ? Color.blue : Color.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(8)
            .textSelection(.enabled)
        }
        .background(Color(nsColor: .textBackgroundColor))
        .border(Color.primary.opacity(0.1))
    }
}
