import AppKit
import Darwin
import Foundation
import Security
import SwiftUI

struct IndusUsageConsoleApp: App {
    @StateObject private var model = ConsoleModel()

    var body: some Scene {
        WindowGroup {
            ConsoleRootView(model: model)
                .preferredColorScheme(.light)
        }
        .windowStyle(.hiddenTitleBar)
        // The dashboard contains a scroll view and responsive grids. Let AppKit
        // manage the window frame instead of recomputing content-size constraints
        // on every animation tick.
        .windowResizability(.automatic)
    }
}

enum ConsoleSection: String, CaseIterable, Identifiable {
    case overview
    case accounts
    case sync
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "总览"
        case .accounts: return "账号矩阵"
        case .sync: return "同步中枢"
        case .settings: return "控制设置"
        }
    }

    var subtitle: String {
        switch self {
        case .overview: return "MISSION CONTROL"
        case .accounts: return "IDENTITY VAULT"
        case .sync: return "SIGNAL ROUTER"
        case .settings: return "SYSTEM CALIBRATION"
        }
    }

    var icon: String {
        switch self {
        case .overview: return "circle.hexagongrid.fill"
        case .accounts: return "person.2.crop.square.stack.fill"
        case .sync: return "waveform.path.ecg.rectangle.fill"
        case .settings: return "slider.horizontal.3"
        }
    }
}

struct AccountProfile: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var name: String = "新账号"
    var label: String = "账号"
    var baseURL: String = "https://www.foropencode.com"
    var userID: String = ""
    var enabled: Bool = true
    var colorIndex: Int = 0
}

struct AccountSecret: Codable, Equatable {
    var authorization: String = ""
    var cookie: String = ""
    var username: String = ""
    var password: String = ""
}

struct AccountDraft: Identifiable {
    var id: UUID { profile.id }
    var profile: AccountProfile
    var secret: AccountSecret

    static var new: AccountDraft {
        AccountDraft(profile: AccountProfile(), secret: AccountSecret())
    }
}

struct ConsoleSettings: Codable, Equatable {
    var projectPath: String = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Documents/Codex/2026-07-01/https-www-foropencode-com-usage-logs")
        .path
    var autoSync: Bool = false
    var intervalMinutes: Int = 5
    var proxy: String = ""
    var sshKeyPath: String = ""
}

private struct StoredConsoleState: Codable {
    var accounts: [AccountProfile]
    var settings: ConsoleSettings
}

struct SnapshotAccount: Decodable, Identifiable {
    var id: String
    var label: String
    var remainingPrimaryBalance: Double
    var usedPrimaryCost: Double
    var utilizationRate: Double

    private enum CodingKeys: String, CodingKey {
        case id
        case label
        case displayName
        case username
        case remainingPrimaryBalance
        case usedPrimaryCost
        case utilizationRate
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? "account-1"
        label = try container.decodeIfPresent(String.self, forKey: .label)
            ?? container.decodeIfPresent(String.self, forKey: .displayName)
            ?? container.decodeIfPresent(String.self, forKey: .username)
            ?? "账号"
        remainingPrimaryBalance = try container.decodeIfPresent(Double.self, forKey: .remainingPrimaryBalance) ?? 0
        usedPrimaryCost = try container.decodeIfPresent(Double.self, forKey: .usedPrimaryCost) ?? 0
        utilizationRate = try container.decodeIfPresent(Double.self, forKey: .utilizationRate) ?? 0
    }

    var balanceText: String {
        String(format: "¥%.4f", remainingPrimaryBalance)
    }
}

struct DashboardSnapshot: Decodable {
    var generatedAt: String?
    var accounts: [SnapshotAccount]
    var summary: SnapshotSummary?

    private enum CodingKeys: String, CodingKey {
        case generatedAt
        case accounts
        case account
        case summary
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        accounts = try container.decodeIfPresent([SnapshotAccount].self, forKey: .accounts) ?? []
        if accounts.isEmpty, let legacyAccount = try container.decodeIfPresent(SnapshotAccount.self, forKey: .account) {
            accounts = [legacyAccount]
        }
        summary = try container.decodeIfPresent(SnapshotSummary.self, forKey: .summary)
    }
}

struct SnapshotSummary: Decodable {
    var totalRequests: Int
    var totalPrimaryCost: Double
}

enum SyncPhase: Equatable {
    case idle
    case running
    case success
    case failed

    var title: String {
        switch self {
        case .idle: return "待命"
        case .running: return "同步中"
        case .success: return "已同步"
        case .failed: return "需要检查"
        }
    }

    var color: Color {
        switch self {
        case .idle: return .white.opacity(0.45)
        case .running: return Color(hex: 0x73D4FF)
        case .success: return Color(hex: 0x79E4B1)
        case .failed: return Color(hex: 0xFF8FA9)
        }
    }
}

final class KeychainVault {
    private let service = "com.indus-apiusage.console.credentials"

    func save(_ secret: AccountSecret, for id: UUID) throws {
        let data = try JSONEncoder().encode(secret)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id.uuidString,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw VaultError(status) }
    }

    func read(for id: UUID) -> AccountSecret? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id.uuidString,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(AccountSecret.self, from: data)
    }

    func delete(for id: UUID) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: id.uuidString
        ]
        SecItemDelete(query as CFDictionary)
    }

    private struct VaultError: LocalizedError {
        let status: OSStatus
        var errorDescription: String? { "Keychain error: \(status)" }
        init(_ status: OSStatus) { self.status = status }
    }
}

@MainActor
final class ConsoleModel: ObservableObject {
    @Published var section: ConsoleSection = .overview
    @Published private(set) var accounts: [AccountProfile] = []
    @Published var settings = ConsoleSettings()
    @Published var phase: SyncPhase = .idle
    @Published var eventMessage = "等待第一次校准"
    @Published var logLines: [String] = []
    @Published var snapshot: DashboardSnapshot?
    @Published var editingDraft: AccountDraft?
    @Published var showProjectPicker = false

    private let vault = KeychainVault()
    private var secrets: [UUID: AccountSecret] = [:]
    private var loopProcess: Process?
    private var onceProcess: Process?
    private var ownsLoop = false
    private var autoStartScheduled = false
    private var pollTimer: Timer?
    private var lastLogModificationDate: Date?
    private var lastSnapshotModificationDate: Date?

    var enabledAccounts: [AccountProfile] { accounts.filter(\.enabled) }
    var isLoopRunning: Bool { loopProcess?.isRunning == true || existingLoopPID != nil }
    var existingLoopPID: Int32? {
        let url = projectURL.appendingPathComponent("work/sync-loop.pid")
        guard let raw = try? String(contentsOf: url, encoding: .utf8),
              let value = Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              kill(value, 0) == 0 else { return nil }
        return value
    }
    var projectURL: URL { URL(fileURLWithPath: settings.projectPath) }
    var credentialsReady: Bool {
        !enabledAccounts.isEmpty && enabledAccounts.allSatisfy { hasCredentials(for: $0.id) }
    }

    init() {
        loadState()
        // Runtime state does not need a frame-rate poll. Five seconds keeps the
        // console responsive while avoiding repeated disk reads and view updates.
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshRuntime() }
        }
        refreshRuntime()
        if settings.autoSync {
            DispatchQueue.main.async { [weak self] in self?.startSync() }
        }
    }

    deinit {
        pollTimer?.invalidate()
    }

    func hasCredentials(for id: UUID) -> Bool {
        guard let secret = secrets[id] else { return false }
        return !secret.authorization.isEmpty || !secret.cookie.isEmpty ||
            (!secret.username.isEmpty && !secret.password.isEmpty)
    }

    func balance(for index: Int) -> SnapshotAccount? {
        snapshot?.accounts[safe: index]
    }

    func openNewAccount() { editingDraft = .new }

    func edit(_ profile: AccountProfile) {
        editingDraft = AccountDraft(profile: profile, secret: secrets[profile.id] ?? AccountSecret())
    }

    func save(_ draft: AccountDraft) {
        do {
            try vault.save(draft.secret, for: draft.profile.id)
            secrets[draft.profile.id] = draft.secret
            if let index = accounts.firstIndex(where: { $0.id == draft.profile.id }) {
                accounts[index] = draft.profile
            } else {
                accounts.append(draft.profile)
            }
            persistState()
            editingDraft = nil
            eventMessage = "已将 \(draft.profile.label) 接入凭据舱"
        } catch {
            eventMessage = "Keychain 保存失败：\(error.localizedDescription)"
        }
    }

    func remove(_ profile: AccountProfile) {
        if let index = accounts.firstIndex(of: profile) { accounts.remove(at: index) }
        secrets.removeValue(forKey: profile.id)
        vault.delete(for: profile.id)
        persistState()
        eventMessage = "已移除 \(profile.label)"
    }

    func setEnabled(_ enabled: Bool, for id: UUID) {
        guard let index = accounts.firstIndex(where: { $0.id == id }) else { return }
        accounts[index].enabled = enabled
        persistState()
        eventMessage = enabled ? "已启用该账号同步" : "已暂停该账号同步"
    }

    func setAutoSync(_ enabled: Bool) {
        settings.autoSync = enabled
        persistState()
        if enabled { startSync() } else { stopSync() }
    }

    func startSync() {
        guard loopProcess?.isRunning != true else { return }
        guard credentialsReady else {
            phase = .failed
            eventMessage = "请先为所有启用账号补充凭据"
            settings.autoSync = false
            persistState()
            return
        }
        if let pid = existingLoopPID, !takeOverExternalLoop(pid) {
            phase = .failed
            eventMessage = "检测到无法确认来源的同步进程，请先在终端停止它"
            return
        }
        guard existingLoopPID == nil else {
            phase = .failed
            eventMessage = "旧同步进程尚未退出，请稍后重试"
            return
        }
        do {
            let envURL = try writeRuntimeEnvironment()
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/bash")
            process.arguments = [projectURL.appendingPathComponent("scripts/run-local-sync-loop.sh").path]
            process.currentDirectoryURL = projectURL
            process.environment = processEnvironment(using: envURL)
            process.terminationHandler = { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.loopProcess = nil
                    self.ownsLoop = false
                    self.refreshRuntime()
                }
            }
            try process.run()
            loopProcess = process
            ownsLoop = true
            phase = .running
            eventMessage = "自动同步已启动，每 \(settings.intervalMinutes) 分钟检查一次"
        } catch {
            removeRuntimeEnvironment()
            phase = .failed
            eventMessage = "同步启动失败：\(error.localizedDescription)"
        }
    }

    func stopSync() {
        if ownsLoop, let process = loopProcess, process.isRunning {
            process.terminate()
            loopProcess = nil
            ownsLoop = false
            phase = .idle
            eventMessage = "自动同步已暂停"
            removeRuntimeEnvironment()
            return
        }

        if let pid = existingLoopPID, takeOverExternalLoop(pid) {
            phase = .idle
            eventMessage = "已停止旧的终端同步进程"
            return
        }

        eventMessage = "当前没有可停止的同步进程"
        refreshRuntime()
    }

    func runOnce() {
        guard onceProcess?.isRunning != true else { return }
        guard !isLoopRunning else {
            eventMessage = "自动同步正在运行，请等待当前周期结束"
            return
        }
        guard credentialsReady else {
            phase = .failed
            eventMessage = "请先为所有启用账号补充凭据"
            return
        }
        do {
            let envURL = try writeRuntimeEnvironment()
            let process = Process()
            let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/npm")
            if !FileManager.default.isExecutableFile(atPath: process.executableURL?.path ?? "") {
                process.executableURL = URL(fileURLWithPath: "/usr/local/bin/npm")
            }
            process.arguments = ["run", "sync:publish"]
            process.currentDirectoryURL = projectURL
            process.environment = processEnvironment(using: envURL)
            process.standardOutput = pipe
            process.standardError = pipe
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
                Task { @MainActor in self?.appendLog(text) }
            }
            process.terminationHandler = { [weak self] _ in
                pipe.fileHandleForReading.readabilityHandler = nil
                Task { @MainActor in
                    guard let self else { return }
                    self.onceProcess = nil
                    self.removeRuntimeEnvironment()
                    self.refreshRuntime()
                    self.eventMessage = "单次同步任务已结束"
                }
            }
            try process.run()
            onceProcess = process
            phase = .running
            eventMessage = "正在执行一次同步并推送"
        } catch {
            removeRuntimeEnvironment()
            phase = .failed
            eventMessage = "单次同步启动失败：\(error.localizedDescription)"
        }
    }

    func chooseProject() {
        let panel = NSOpenPanel()
        panel.title = "选择 Indus API Usage 项目目录"
        panel.message = "选择包含 scripts/run-local-sync-loop.sh 的项目目录"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in
                self?.settings.projectPath = url.path
                self?.persistState()
                self?.eventMessage = "项目路径已更新"
            }
        }
    }

    func chooseSSHKey() {
        let panel = NSOpenPanel()
        panel.title = "选择 Git SSH 私钥"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            Task { @MainActor in
                self?.settings.sshKeyPath = url.path
                self?.persistState()
            }
        }
    }

    func refreshRuntime() {
        refreshLog()
        loadSnapshot()
        if loopProcess?.isRunning != true, let _ = existingLoopPID {
            if phase != .running { phase = .running }
            if ownsLoop { ownsLoop = false }
        } else if loopProcess?.isRunning != true, onceProcess?.isRunning != true, phase == .running {
            phase = .idle
        }

        if settings.autoSync,
           loopProcess?.isRunning != true,
           onceProcess?.isRunning != true,
           existingLoopPID == nil,
           credentialsReady,
           phase != .failed,
           !autoStartScheduled {
            autoStartScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.autoStartScheduled = false
                self.startSync()
            }
        }
    }

    private func loadState() {
        let url = stateURL
        if let data = try? Data(contentsOf: url),
           let stored = try? JSONDecoder().decode(StoredConsoleState.self, from: data) {
            accounts = stored.accounts
            settings = stored.settings
        }
        for account in accounts { secrets[account.id] = vault.read(for: account.id) }
        if settings.proxy.isEmpty { settings.proxy = localEnvValue("FOROPENCODE_PROXY") }
        if settings.sshKeyPath.isEmpty { settings.sshKeyPath = localEnvValue("SYNC_GIT_SSH_KEY_PATH") }
    }

    func persistState() {
        let stored = StoredConsoleState(accounts: accounts, settings: settings)
        guard let data = try? JSONEncoder().encode(stored) else { return }
        try? FileManager.default.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: stateURL, options: .atomic)
    }

    private var stateURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("IndusUsageConsole/state.json")
    }

    private func writeRuntimeEnvironment() throws -> URL {
        let workURL = projectURL.appendingPathComponent("work")
        try FileManager.default.createDirectory(at: workURL, withIntermediateDirectories: true)
        let envURL = workURL.appendingPathComponent("app-sync.env")
        let runtimeAccounts = enabledAccounts.enumerated().map { index, profile in
            let secret = secrets[profile.id] ?? AccountSecret()
            return RuntimeAccount(
                id: "account-\(index + 1)",
                label: profile.label.isEmpty ? profile.name : profile.label,
                baseUrl: profile.baseURL,
                scope: "self",
                auth: RuntimeAuth(
                    cookie: secret.cookie,
                    authorization: secret.authorization,
                    userId: profile.userID,
                    username: secret.username,
                    password: secret.password
                )
            )
        }
        let json = try String(decoding: JSONEncoder().encode(runtimeAccounts), as: UTF8.self)
        var lines = ["export FOROPENCODE_ACCOUNTS_JSON=\(shellQuote(json))"]
        if !settings.proxy.isEmpty { lines.append("export FOROPENCODE_PROXY=\(shellQuote(settings.proxy))") }
        if !settings.sshKeyPath.isEmpty { lines.append("export SYNC_GIT_SSH_KEY_PATH=\(shellQuote(settings.sshKeyPath))") }
        lines.append("export SYNC_INTERVAL_SECONDS=\(max(60, settings.intervalMinutes * 60))")
        try lines.joined(separator: "\n").appending("\n").write(to: envURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: envURL.path)
        return envURL
    }

    private func processEnvironment(using envURL: URL) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["SYNC_ENV_FILE"] = envURL.path
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        return environment
    }

    private func removeRuntimeEnvironment() {
        try? FileManager.default.removeItem(at: projectURL.appendingPathComponent("work/app-sync.env"))
    }

    private func takeOverExternalLoop(_ pid: Int32) -> Bool {
        guard isExpectedLoopProcess(pid) else { return false }

        eventMessage = "正在接管旧的终端同步进程"
        _ = kill(pid, SIGTERM)

        for _ in 0..<25 {
            if kill(pid, 0) != 0 { return true }
            usleep(100_000)
        }

        if kill(pid, 0) == 0 {
            _ = kill(pid, SIGKILL)
            usleep(100_000)
        }

        return existingLoopPID == nil
    }

    private func isExpectedLoopProcess(_ pid: Int32) -> Bool {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-p", String(pid), "-o", "command="]
        process.standardOutput = pipe

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return false
        }

        let command = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        return command.contains("run-local-sync-loop.sh")
    }

    private func refreshLog() {
        let logURL = projectURL.appendingPathComponent("work/sync-loop.log")
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: logURL.path),
              let modificationDate = attributes[.modificationDate] as? Date else { return }
        guard modificationDate != lastLogModificationDate else { return }
        guard let text = try? String(contentsOf: logURL, encoding: .utf8) else { return }
        let updatedLines = text.split(separator: "\n", omittingEmptySubsequences: false)
            .suffix(90)
            .map(String.init)
        lastLogModificationDate = modificationDate
        if updatedLines != logLines { logLines = updatedLines }
    }

    private func loadSnapshot() {
        let url = projectURL.appendingPathComponent("docs/data/latest.json")
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let modificationDate = attributes[.modificationDate] as? Date else { return }
        guard modificationDate != lastSnapshotModificationDate else { return }
        guard let data = try? Data(contentsOf: url),
              let value = try? JSONDecoder().decode(DashboardSnapshot.self, from: data) else { return }
        lastSnapshotModificationDate = modificationDate
        snapshot = value
    }

    private func appendLog(_ text: String) {
        logLines.append(contentsOf: text.split(separator: "\n").map(String.init))
        logLines = Array(logLines.suffix(90))
    }

    private func localEnvValue(_ key: String) -> String {
        let url = projectURL.appendingPathComponent("work/sync.env")
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        for line in contents.split(separator: "\n") {
            let prefix = "export \(key)="
            guard line.hasPrefix(prefix) else { continue }
            var value = String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
            if value.hasPrefix("'") && value.hasSuffix("'") { value = String(value.dropFirst().dropLast()) }
            if value.hasPrefix("\"") && value.hasSuffix("\"") { value = String(value.dropFirst().dropLast()) }
            return value
        }
        return ""
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

private struct RuntimeAccount: Encodable {
    var id: String
    var label: String
    var baseUrl: String
    var scope: String
    var auth: RuntimeAuth
}

private struct RuntimeAuth: Encodable {
    var cookie: String
    var authorization: String
    var userId: String
    var username: String
    var password: String
}

IndusUsageConsoleApp.main()

private extension Array {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

extension Color {
    init(hex: UInt, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: opacity
        )
    }
}
