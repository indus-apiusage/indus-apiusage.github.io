import AppKit
import Darwin
import Foundation
import Security
import SwiftUI
import WidgetKit

final class IndusUsageConsoleAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private weak var mainWindow: NSWindow?
    private var allowWindowClose = false

    func attach(to window: NSWindow) {
        if mainWindow !== window {
            mainWindow = window
            window.identifier = NSUserInterfaceItemIdentifier("main")
            window.delegate = self
        }
    }

    func showMainWindow() {
        guard let window = mainWindow ?? NSApp.windows.first(where: {
            $0.title == "Indus Usage Console"
        }) else {
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        NSApp.unhide(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func applicationShouldHandleReopen(
        _ sender: NSApplication,
        hasVisibleWindows flag: Bool
    ) -> Bool {
        showMainWindow()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Command-Q and the menu bar's Quit action must still be able to exit.
        allowWindowClose = true
        return .terminateNow
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard !allowWindowClose else { return true }

        // Treat the red close button as "hide to background". Keeping the
        // window alive preserves the SwiftUI model and the sync subprocess.
        sender.orderOut(nil)
        NSApp.hide(nil)
        return false
    }
}

private struct MainWindowLifecycleBridge: NSViewRepresentable {
    let appDelegate: IndusUsageConsoleAppDelegate

    func makeNSView(context: Context) -> NSView {
        NSView(frame: .zero)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        let appDelegate = appDelegate
        if let window = nsView.window {
            appDelegate.attach(to: window)
        } else {
            DispatchQueue.main.async {
                guard let window = nsView.window else { return }
                appDelegate.attach(to: window)
            }
        }
    }
}

struct IndusUsageConsoleApp: App {
    @StateObject private var model = ConsoleModel()
    @NSApplicationDelegateAdaptor(IndusUsageConsoleAppDelegate.self)
    private var appDelegate

    var body: some Scene {
        // The widget deep link should reuse this one console window instead of
        // opening a new WindowGroup instance on every click.
        Window("Indus Usage Console", id: "main") {
            ConsoleRootView(model: model)
                .preferredColorScheme(.light)
                .background(MainWindowLifecycleBridge(appDelegate: appDelegate))
                .onOpenURL { _ in
                    model.section = .overview
                    appDelegate.showMainWindow()
                }
        }
        .windowStyle(.hiddenTitleBar)
        // The dashboard contains a scroll view and responsive grids. Let AppKit
        // manage the window frame instead of recomputing content-size constraints
        // on every animation tick.
        .windowResizability(.automatic)

        MenuBarExtra("Indus Usage Console", systemImage: "chart.bar.xaxis") {
            Button("显示控制台") {
                appDelegate.showMainWindow()
            }
            Divider()
            Button("退出 Indus Usage Console") {
                NSApp.terminate(nil)
            }
        }
        .menuBarExtraStyle(.menu)

    }
}

enum ConsoleSection: String, CaseIterable, Identifiable {
    case overview
    case accounts
    case keys
    case sync
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "总览"
        case .accounts: return "账号矩阵"
        case .keys: return "API 密钥"
        case .sync: return "同步中枢"
        case .settings: return "控制设置"
        }
    }

    var subtitle: String {
        switch self {
        case .overview: return "MISSION CONTROL"
        case .accounts: return "IDENTITY VAULT"
        case .keys: return "KEY VAULT"
        case .sync: return "SIGNAL ROUTER"
        case .settings: return "SYSTEM CALIBRATION"
        }
    }

    var icon: String {
        switch self {
        case .overview: return "circle.hexagongrid.fill"
        case .accounts: return "person.2.crop.square.stack.fill"
        case .keys: return "key.fill"
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

struct StoredAPIKey: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var remoteID: Int?
    var name: String = "未命名密钥"
    var value: String = ""
    var quotaLimit: Double?
    var unlimitedQuota: Bool = false
    var usedQuota: Double?
    var expiredTime: Int = -1
    var modelLimitsEnabled: Bool = false
    var modelLimits: String = ""
    var allowIPs: String = ""
    var group: String = ""
    var crossGroupRetry: Bool = false

    private enum CodingKeys: String, CodingKey {
        case id
        case remoteID
        case name
        case value
        case quotaLimit
        case unlimitedQuota
        case usedQuota
        case expiredTime
        case modelLimitsEnabled
        case modelLimits
        case allowIPs
        case group
        case crossGroupRetry
    }

    init(
        id: UUID = UUID(),
        remoteID: Int? = nil,
        name: String = "未命名密钥",
        value: String = "",
        quotaLimit: Double? = nil,
        unlimitedQuota: Bool = false,
        usedQuota: Double? = nil,
        expiredTime: Int = -1,
        modelLimitsEnabled: Bool = false,
        modelLimits: String = "",
        allowIPs: String = "",
        group: String = "",
        crossGroupRetry: Bool = false
    ) {
        self.id = id
        self.remoteID = remoteID
        self.name = name
        self.value = value
        self.quotaLimit = quotaLimit
        self.unlimitedQuota = unlimitedQuota
        self.usedQuota = usedQuota
        self.expiredTime = expiredTime
        self.modelLimitsEnabled = modelLimitsEnabled
        self.modelLimits = modelLimits
        self.allowIPs = allowIPs
        self.group = group
        self.crossGroupRetry = crossGroupRetry
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        remoteID = try container.decodeIfPresent(Int.self, forKey: .remoteID)
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? "未命名密钥"
        value = try container.decodeIfPresent(String.self, forKey: .value) ?? ""
        quotaLimit = try container.decodeIfPresent(Double.self, forKey: .quotaLimit)
        unlimitedQuota = try container.decodeIfPresent(Bool.self, forKey: .unlimitedQuota) ?? false
        usedQuota = try container.decodeIfPresent(Double.self, forKey: .usedQuota)
        expiredTime = try container.decodeIfPresent(Int.self, forKey: .expiredTime) ?? -1
        modelLimitsEnabled = try container.decodeIfPresent(Bool.self, forKey: .modelLimitsEnabled) ?? false
        modelLimits = try container.decodeIfPresent(String.self, forKey: .modelLimits) ?? ""
        allowIPs = try container.decodeIfPresent(String.self, forKey: .allowIPs) ?? ""
        group = try container.decodeIfPresent(String.self, forKey: .group) ?? ""
        crossGroupRetry = try container.decodeIfPresent(Bool.self, forKey: .crossGroupRetry) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeIfPresent(remoteID, forKey: .remoteID)
        try container.encode(name, forKey: .name)
        try container.encode(value, forKey: .value)
        try container.encodeIfPresent(quotaLimit, forKey: .quotaLimit)
        try container.encode(unlimitedQuota, forKey: .unlimitedQuota)
        try container.encodeIfPresent(usedQuota, forKey: .usedQuota)
        try container.encode(expiredTime, forKey: .expiredTime)
        try container.encode(modelLimitsEnabled, forKey: .modelLimitsEnabled)
        try container.encode(modelLimits, forKey: .modelLimits)
        try container.encode(allowIPs, forKey: .allowIPs)
        try container.encode(group, forKey: .group)
        try container.encode(crossGroupRetry, forKey: .crossGroupRetry)
    }
}

struct AccountSecret: Codable, Equatable {
    var authorization: String = ""
    var cookie: String = ""
    var username: String = ""
    var password: String = ""
    var apiKeys: [StoredAPIKey] = []

    private enum CodingKeys: String, CodingKey {
        case authorization
        case cookie
        case username
        case password
        case apiKeys
    }

    init(
        authorization: String = "",
        cookie: String = "",
        username: String = "",
        password: String = "",
        apiKeys: [StoredAPIKey] = []
    ) {
        self.authorization = authorization
        self.cookie = cookie
        self.username = username
        self.password = password
        self.apiKeys = apiKeys
    }

    // Keep existing Keychain records readable after adding the API key vault.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        authorization = try container.decodeIfPresent(String.self, forKey: .authorization) ?? ""
        cookie = try container.decodeIfPresent(String.self, forKey: .cookie) ?? ""
        username = try container.decodeIfPresent(String.self, forKey: .username) ?? ""
        password = try container.decodeIfPresent(String.self, forKey: .password) ?? ""
        apiKeys = try container.decodeIfPresent([StoredAPIKey].self, forKey: .apiKeys) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(authorization, forKey: .authorization)
        try container.encode(cookie, forKey: .cookie)
        try container.encode(username, forKey: .username)
        try container.encode(password, forKey: .password)
        try container.encode(apiKeys, forKey: .apiKeys)
    }
}

struct AccountDraft: Identifiable {
    var id: UUID { profile.id }
    var profile: AccountProfile
    var secret: AccountSecret

    static var new: AccountDraft {
        AccountDraft(profile: AccountProfile(), secret: AccountSecret())
    }
}

struct WalletSessionCredentials {
    let cookie: String
    let authorization: String
    let userID: String
}

struct APIKeyRecord: Identifiable {
    let accountID: UUID
    let accountLabel: String
    let accountUserID: String
    let accountColorIndex: Int
    let baseURL: String
    let key: StoredAPIKey

    var id: String { "\(accountID.uuidString)-\(key.id.uuidString)" }
    var displayName: String {
        if key.name.caseInsensitiveCompare("zdy") == .orderedSame { return "曾德宇" }
        return key.name.isEmpty ? "未命名密钥" : key.name
    }
    var accountSourceText: String {
        let label = accountLabel.isEmpty ? "未命名账号" : accountLabel
        let userID = accountUserID.trimmingCharacters(in: .whitespacesAndNewlines)
        return userID.isEmpty ? label : "\(label) · UID \(userID)"
    }
    var statusText: String {
        if key.value.isEmpty { return "未设置值" }
        return "已安全保存 · \(quotaText)"
    }
    var quotaText: String {
        if key.unlimitedQuota { return "无限额度" }
        let remaining = key.quotaLimit.map { String(format: "剩余 ¥%.2f", $0) } ?? "未设置限额"
        if let usedQuota = key.usedQuota {
            return "\(remaining) · 已用 ¥\(String(format: "%.2f", usedQuota))"
        }
        return remaining
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

private struct APIKeySyncResponse: Decodable {
    var success: Bool
    var accountID: String
    var quotaPerUnit: Double
    var quotaDisplayType: String
    var keys: [StoredAPIKey]
}

private struct APIKeyUpdateInput: Encodable {
    var remoteID: Int
    var name: String
    var quotaLimit: Double?
    var unlimitedQuota: Bool
    var expiredTime: Int
    var modelLimitsEnabled: Bool
    var modelLimits: String
    var allowIPs: String
    var group: String
    var crossGroupRetry: Bool
}

private struct APIKeyUpdateResponse: Decodable {
    var success: Bool
    var accountID: String?
    var remoteID: Int?
    var quotaLimit: Double?
    var unlimitedQuota: Bool?
}

private enum APIKeyCommandError: LocalizedError {
    case invalidResponse
    case missingNode
    case processFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "网站返回了无法识别的 API Key 响应"
        case .missingNode: return "找不到 Node.js 运行时"
        case .processFailed(let detail):
            return detail.isEmpty ? "API Key 管理命令执行失败" : "API Key 管理命令执行失败：\(detail)"
        }
    }
}

private struct LogRefreshResult {
    let modificationDate: Date
    let lines: [String]
}

private struct SnapshotRefreshResult {
    let modificationDate: Date
    let snapshot: DashboardSnapshot
}

struct SnapshotAccount: Decodable, Identifiable {
    var id: String
    var label: String
    var requestCount: Int
    var remainingPrimaryBalance: Double
    var usedPrimaryCost: Double
    var utilizationRate: Double
    var gptPlusRatio: Double?
    var gptPlusKey: String?

    private enum CodingKeys: String, CodingKey {
        case id
        case label
        case displayName
        case username
        case requestCount
        case remainingPrimaryBalance
        case usedPrimaryCost
        case utilizationRate
        case gptPlus
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? "account-1"
        label = try container.decodeIfPresent(String.self, forKey: .label)
            ?? container.decodeIfPresent(String.self, forKey: .displayName)
            ?? container.decodeIfPresent(String.self, forKey: .username)
            ?? "账号"
        requestCount = try container.decodeIfPresent(Int.self, forKey: .requestCount) ?? 0
        remainingPrimaryBalance = try container.decodeIfPresent(Double.self, forKey: .remainingPrimaryBalance) ?? 0
        usedPrimaryCost = try container.decodeIfPresent(Double.self, forKey: .usedPrimaryCost) ?? 0
        utilizationRate = try container.decodeIfPresent(Double.self, forKey: .utilizationRate) ?? 0
        let multiplier = try container.decodeIfPresent(SnapshotMultiplier.self, forKey: .gptPlus)
        gptPlusRatio = multiplier?.ratio
        gptPlusKey = multiplier?.key
    }

    var balanceText: String {
        String(format: "¥%.4f", remainingPrimaryBalance)
    }

    var usageText: String {
        String(format: "¥%.4f", usedPrimaryCost)
    }

    var multiplierText: String {
        guard let gptPlusRatio else { return "—" }
        return String(format: "×%.2f", gptPlusRatio)
    }
}

struct SnapshotMultiplier: Decodable {
    var key: String
    var ratio: Double

    private enum CodingKeys: String, CodingKey {
        case key
        case ratio
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        key = try container.decodeIfPresent(String.self, forKey: .key) ?? "gpt_plus"
        ratio = try container.decodeIfPresent(Double.self, forKey: .ratio) ?? 0
    }
}

struct SnapshotPerson: Decodable, Identifiable {
    var id: String
    var displayName: String
    var requests: Int
    var primaryCost: Double
    var days: [SnapshotDay]

    private struct Totals: Decodable {
        var requests: Int
        var primaryCost: Double
    }

    private enum CodingKeys: String, CodingKey {
        case personId
        case displayName
        case totals
        case days
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .personId) ?? "person"
        displayName = try container.decodeIfPresent(String.self, forKey: .displayName) ?? id
        let totals = try container.decodeIfPresent(Totals.self, forKey: .totals)
        requests = totals?.requests ?? 0
        primaryCost = totals?.primaryCost ?? 0
        days = try container.decodeIfPresent([SnapshotDay].self, forKey: .days) ?? []
    }

    var usageText: String {
        String(format: "¥%.4f", primaryCost)
    }

    var requestText: String {
        String(format: "%d 次请求", requests)
    }
}

struct SnapshotDay: Decodable, Identifiable {
    var id: String { date }
    var date: String
    var requests: Int
    var primaryCost: Double

    private enum CodingKeys: String, CodingKey {
        case date
        case requests
        case primaryCost
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        date = try container.decodeIfPresent(String.self, forKey: .date) ?? ""
        requests = try container.decodeIfPresent(Int.self, forKey: .requests) ?? 0
        primaryCost = try container.decodeIfPresent(Double.self, forKey: .primaryCost) ?? 0
    }

    var usageText: String {
        String(format: "¥%.4f", primaryCost)
    }

    var requestText: String {
        String(format: "%d", requests)
    }

    var shortDateText: String {
        let parts = date.split(separator: "-")
        guard parts.count == 3,
              let month = Int(parts[1]),
              let day = Int(parts[2]) else { return date }
        return "\(month)月\(day)日"
    }
}

struct DashboardSnapshot: Decodable {
    var generatedAt: String?
    var accounts: [SnapshotAccount]
    var people: [SnapshotPerson]
    var days: [SnapshotDay]
    var summary: SnapshotSummary?

    private enum CodingKeys: String, CodingKey {
        case generatedAt
        case accounts
        case account
        case people
        case days
        case summary
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        accounts = try container.decodeIfPresent([SnapshotAccount].self, forKey: .accounts) ?? []
        people = try container.decodeIfPresent([SnapshotPerson].self, forKey: .people) ?? []
        days = try container.decodeIfPresent([SnapshotDay].self, forKey: .days) ?? []
        if accounts.isEmpty, let legacyAccount = try container.decodeIfPresent(SnapshotAccount.self, forKey: .account) {
            accounts = [legacyAccount]
        }
        summary = try container.decodeIfPresent(SnapshotSummary.self, forKey: .summary)
    }

    private var latestDataDate: String? {
        summary?.latestDate ?? days.map(\.date).max()
    }

    var latestDay: SnapshotDay? {
        guard let latestDataDate else { return days.max { $0.date < $1.date } }
        return days.first(where: { $0.date == latestDataDate })
            ?? days.max { $0.date < $1.date }
    }

    var latestMonthDays: [SnapshotDay] {
        guard let latestDataDate else { return [] }
        let monthPrefix = String(latestDataDate.prefix(7))
        return days.filter { $0.date.hasPrefix(monthPrefix) }
    }

    var latestMonthUsage: Double {
        latestMonthDays.reduce(0) { $0 + $1.primaryCost }
    }

    var latestMonthRequests: Int {
        latestMonthDays.reduce(0) { $0 + $1.requests }
    }

    var latestMonthLabel: String {
        guard let latestDataDate else { return "本月" }
        let parts = latestDataDate.split(separator: "-")
        guard parts.count >= 2, let month = Int(parts[1]) else { return "本月" }
        return "\(month)月"
    }
}

struct SnapshotSummary: Decodable {
    var totalRequests: Int
    var totalPrimaryCost: Double
    var latestDate: String?
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
        case .running: return Color(hex: 0x467FA7)
        case .success: return Color(hex: 0x79E4B1)
        case .failed: return Color(hex: 0xFF8FA9)
        }
    }
}

// The loop reads its environment again between cycles, whereas one-off work
// needs a disposable snapshot. Keeping them separate prevents a short task
// from deleting credentials still needed by a running loop.
private enum RuntimeEnvironmentPurpose {
    case loop
    case once
    case reconnect

    var fileName: String {
        switch self {
        case .loop:
            return "app-sync-loop.env"
        case .once:
            return "app-sync-once-\(UUID().uuidString).env"
        case .reconnect:
            return "app-sync-reconnect-\(UUID().uuidString).env"
        }
    }
}

private struct PendingPasswordReconnect {
    let profile: AccountProfile
    let runtimeAccountID: String
    let accountID: UUID
    var resumeAutoSync: Bool
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
    @Published var topUpProfile: AccountProfile?
    @Published var showProjectPicker = false
    @Published private(set) var apiKeySyncingIDs: Set<UUID> = []

    private let vault = KeychainVault()
    private var secrets: [UUID: AccountSecret] = [:]
    private var loopProcess: Process?
    private var onceProcess: Process?
    private var loopRuntimeEnvironmentURL: URL?
    private var pendingPasswordReconnect: PendingPasswordReconnect?
    private var ownsLoop = false
    private var autoStartScheduled = false
    private var stopRequested = false
    private var secretsLoaded = false
    private var pollTimer: Timer?
    private var lastLogModificationDate: Date?
    private var lastSnapshotModificationDate: Date?
    private var logRefreshInFlight = false
    private var snapshotRefreshInFlight = false
    private var externalLoopPID: Int32?
    private var externalLoopProbeInFlight = false

    var enabledAccounts: [AccountProfile] { accounts.filter(\.enabled) }
    var isLoopRunning: Bool { loopProcess?.isRunning == true || existingLoopPID != nil }
    var apiKeyRecords: [APIKeyRecord] {
        accounts.flatMap { profile in
            (secrets[profile.id]?.apiKeys ?? []).map { key in
                APIKeyRecord(
                    accountID: profile.id,
                    accountLabel: profile.label.isEmpty ? profile.name : profile.label,
                    accountUserID: profile.userID,
                    accountColorIndex: profile.colorIndex,
                    baseURL: profile.baseURL,
                    key: key
                )
            }
        }
    }
    var existingLoopPID: Int32? { externalLoopPID }
    var projectURL: URL { URL(fileURLWithPath: settings.projectPath) }
    var credentialsReady: Bool {
        secretsLoaded && !enabledAccounts.isEmpty && enabledAccounts.allSatisfy { hasCredentials(for: $0.id) }
    }
    var backgroundSyncReady: Bool {
        credentialsReady && enabledAccounts.allSatisfy { hasBackgroundRecoveryPath(for: $0) }
    }

    init() {
        loadState()
        // Runtime state is deliberately low-frequency. The sync loop writes files
        // asynchronously, so a 15-second probe is enough without waking SwiftUI
        // during every idle interaction.
        pollTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshRuntime() }
        }
        DispatchQueue.main.async { [weak self] in self?.refreshRuntime() }
        // Let the first window frame render before Keychain can show an access
        // prompt. Reading credentials is moved off the main actor as well.
        DispatchQueue.main.async { [weak self] in self?.loadSecretsInBackground() }
    }

    deinit {
        pollTimer?.invalidate()
    }

    func hasCredentials(for id: UUID) -> Bool {
        guard let secret = secrets[id] else { return false }
        return hasSessionCredentials(secret) || hasPasswordCredentials(secret)
    }

    func canReconnectPasswordSession(for id: UUID) -> Bool {
        guard let secret = secrets[id] else { return false }
        return hasPasswordCredentials(secret)
    }

    func balance(for index: Int) -> SnapshotAccount? {
        snapshot?.accounts[safe: index]
    }

    func openNewAccount() { editingDraft = .new }

    func edit(_ profile: AccountProfile) {
        editingDraft = AccountDraft(profile: profile, secret: secrets[profile.id] ?? AccountSecret())
    }

    func edit(accountID: UUID) {
        guard let profile = accounts.first(where: { $0.id == accountID }) else {
            eventMessage = "找不到对应账号"
            return
        }
        edit(profile)
    }

    // Remote records come first so their metadata wins over a locally added copy.
    private func deduplicateAPIKeys(_ keys: [StoredAPIKey]) -> [StoredAPIKey] {
        let prioritizedKeys = keys.filter { $0.remoteID != nil } + keys.filter { $0.remoteID == nil }
        var seenRemoteIDs = Set<Int>()
        var seenValues = Set<String>()
        var uniqueKeys: [StoredAPIKey] = []

        for key in prioritizedKeys {
            if let remoteID = key.remoteID, seenRemoteIDs.contains(remoteID) {
                continue
            }

            let value = key.value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty, seenValues.contains(value) {
                continue
            }

            if let remoteID = key.remoteID { seenRemoteIDs.insert(remoteID) }
            if !value.isEmpty { seenValues.insert(value) }
            uniqueKeys.append(key)
        }

        return uniqueKeys
    }

    func save(_ draft: AccountDraft) {
        let previousAPIKeys = secrets[draft.profile.id]?.apiKeys ?? []
        var sanitizedSecret = draft.secret
        let sanitizedAPIKeys: [StoredAPIKey] = draft.secret.apiKeys.compactMap { key in
            let value = key.value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { return nil }
            let name = key.name.trimmingCharacters(in: .whitespacesAndNewlines)
            let quotaLimit = key.quotaLimit.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
            var normalized = key
            normalized.name = name.isEmpty ? "未命名密钥" : name
            normalized.value = value
            normalized.quotaLimit = quotaLimit
            return normalized
        }
        sanitizedSecret.apiKeys = deduplicateAPIKeys(sanitizedAPIKeys)

        let remoteChanges = sanitizedSecret.apiKeys.filter { key in
            guard let remoteID = key.remoteID else { return false }
            let previous = previousAPIKeys.first(where: { $0.remoteID == remoteID })
            return previous == nil || previous?.name != key.name ||
                previous?.quotaLimit != key.quotaLimit ||
                previous?.unlimitedQuota != key.unlimitedQuota ||
                previous?.expiredTime != key.expiredTime ||
                previous?.modelLimitsEnabled != key.modelLimitsEnabled ||
                previous?.modelLimits != key.modelLimits ||
                previous?.allowIPs != key.allowIPs ||
                previous?.group != key.group ||
                previous?.crossGroupRetry != key.crossGroupRetry
        }

        do {
            try vault.save(sanitizedSecret, for: draft.profile.id)
            secrets[draft.profile.id] = sanitizedSecret
            if let index = accounts.firstIndex(where: { $0.id == draft.profile.id }) {
                accounts[index] = draft.profile
            } else {
                accounts.append(draft.profile)
            }
            persistState()
            let runtimeConfigRefreshed: Bool
            if ownsLoop, loopProcess?.isRunning == true {
                do {
                    _ = try writeLoopRuntimeEnvironment()
                    runtimeConfigRefreshed = true
                } catch {
                    runtimeConfigRefreshed = false
                }
            } else {
                runtimeConfigRefreshed = true
            }
            editingDraft = nil
            if remoteChanges.isEmpty {
                eventMessage = runtimeConfigRefreshed
                    ? "已将 \(draft.profile.label) 接入凭据舱，保存 API Key \(sanitizedSecret.apiKeys.count) 个"
                    : "本机凭据已保存，但自动同步配置刷新失败，请重启自动同步"
            } else {
                eventMessage = runtimeConfigRefreshed
                    ? "本机已保存，正在把 \(remoteChanges.count) 个 API Key 的限额同步到网站"
                    : "本机已保存，但自动同步配置刷新失败，请重启自动同步"
                Task { [weak self] in
                    await self?.updateRemoteAPIKeys(
                        remoteChanges,
                        accountID: draft.profile.id,
                        accountLabel: draft.profile.label
                    )
                }
            }
        } catch {
            eventMessage = "Keychain 保存失败：\(error.localizedDescription)"
        }
    }

    func remove(_ profile: AccountProfile) {
        if let index = accounts.firstIndex(of: profile) { accounts.remove(at: index) }
        secrets.removeValue(forKey: profile.id)
        vault.delete(for: profile.id)
        if enabledAccounts.isEmpty {
            settings.autoSync = false
        }
        persistState()
        if enabledAccounts.isEmpty, isLoopRunning || activeExpectedLoopPID() != nil {
            eventMessage = "已移除 \(profile.label)，没有可同步账号，正在停止同步"
            stopSync()
            return
        }
        refreshManagedLoopEnvironmentAfterAccountChange()
        eventMessage = "已移除 \(profile.label)"
    }

    func setEnabled(_ enabled: Bool, for id: UUID) {
        guard let index = accounts.firstIndex(where: { $0.id == id }) else { return }
        accounts[index].enabled = enabled
        let hasEnabledAccounts = !enabledAccounts.isEmpty
        if !hasEnabledAccounts {
            settings.autoSync = false
        }
        persistState()

        guard hasEnabledAccounts else {
            eventMessage = "所有账号同步已暂停，正在停止同步循环"
            if isLoopRunning || activeExpectedLoopPID() != nil {
                stopSync()
            } else {
                phase = .idle
            }
            return
        }

        let refreshed = refreshManagedLoopEnvironmentAfterAccountChange()
        eventMessage = enabled
            ? (refreshed ? "已启用该账号同步，下一周期将包含该账号" : "已启用该账号同步")
            : (refreshed ? "已暂停该账号同步，下一周期将跳过该账号" : "已暂停该账号同步")

        if enabled, settings.autoSync, !isLoopRunning {
            startSync()
        }
    }

    func reconnectPasswordSession(for accountID: UUID) {
        guard let profile = accounts.first(where: { $0.id == accountID }) else {
            eventMessage = "找不到对应账号"
            return
        }
        guard canReconnectPasswordSession(for: accountID) else {
            eventMessage = "请先为该账号保存账号密码后再重新连接"
            return
        }
        guard pendingPasswordReconnect == nil else {
            eventMessage = "已有账号正在重新连接，请等待当前任务结束"
            return
        }
        guard onceProcess?.isRunning != true else {
            eventMessage = "当前单次任务尚未结束，正在等待后再重新连接"
            return
        }

        do {
            let runtimeAccountID = try runtimeAccountIdentifier(for: profile)
            pendingPasswordReconnect = PendingPasswordReconnect(
                profile: profile,
                runtimeAccountID: runtimeAccountID,
                accountID: accountID,
                resumeAutoSync: settings.autoSync
            )
            // Prevent the scheduler from starting another process while the
            // old loop is being drained and the selected account reconnects.
            settings.autoSync = false
            persistState()

            if isLoopRunning || activeExpectedLoopPID() != nil {
                eventMessage = "正在安全暂停同步，并为 \(profile.label) 重新建立会话"
                pauseLoopForPendingPasswordReconnect()
            } else {
                beginPendingPasswordReconnect()
            }
        } catch {
            pendingPasswordReconnect = nil
            eventMessage = "重新连接准备失败：\(error.localizedDescription)"
        }
    }

    func apiKeyCount(for id: UUID) -> Int {
        secrets[id]?.apiKeys.count ?? 0
    }

    func isAPIKeySyncing(for id: UUID) -> Bool {
        apiKeySyncingIDs.contains(id)
    }

    func syncRemoteAPIKeys(for accountID: UUID, announce: Bool = true) {
        guard !apiKeySyncingIDs.contains(accountID) else {
            if announce { eventMessage = "这个账号的 API Key 正在同步，请稍候" }
            return
        }
        guard let profile = accounts.first(where: { $0.id == accountID }) else {
            if announce { eventMessage = "找不到对应账号" }
            return
        }
        guard secretsLoaded, hasCredentials(for: accountID) else {
            if announce { eventMessage = "请先为该账号补充 Cookie/Bearer Token 或账号密码" }
            return
        }
        guard hasReusableSession(for: profile) else {
            if announce { eventMessage = "请先在账号矩阵中点击 \(profile.label) 的“重新连接”，再同步 API Key" }
            return
        }

        apiKeySyncingIDs.insert(accountID)
        if announce { eventMessage = "正在从 \(profile.label) 的网站读取 API Key" }
        Task { [weak self] in
            guard let self else { return }
            defer { self.apiKeySyncingIDs.remove(accountID) }

            do {
                let runtimeID = try self.runtimeAccountIdentifier(for: profile)
                let data = try await self.runAPIKeyCommand(
                    ["list", "--account-id", runtimeID]
                )
                let response = try JSONDecoder().decode(APIKeySyncResponse.self, from: data)
                guard response.success else { throw APIKeyCommandError.invalidResponse }

                var updatedSecret = self.secrets[accountID] ?? AccountSecret()
                let existingKeys = self.deduplicateAPIKeys(updatedSecret.apiKeys)
                var oldRemoteKeys: [Int: StoredAPIKey] = [:]
                for key in existingKeys {
                    guard let remoteID = key.remoteID, oldRemoteKeys[remoteID] == nil else { continue }
                    oldRemoteKeys[remoteID] = key
                }
                let importedKeys = response.keys.map { imported -> StoredAPIKey in
                    guard imported.value.isEmpty, let remoteID = imported.remoteID,
                          let oldKey = oldRemoteKeys[remoteID] else { return imported }
                    var restored = imported
                    restored.value = oldKey.value
                    return restored
                }
                let localOnlyKeys = existingKeys.filter { $0.remoteID == nil }
                updatedSecret.apiKeys = self.deduplicateAPIKeys(importedKeys + localOnlyKeys)
                try self.vault.save(updatedSecret, for: accountID)
                self.secrets[accountID] = updatedSecret
                self.eventMessage = "已从网站同步 \(importedKeys.count) 个 API Key，远端限额已载入"
            } catch {
                if announce {
                    self.eventMessage = self.apiKeySyncFailureMessage(
                        error,
                        fallback: "网站 API Key 同步失败：请检查登录凭据、用户 ID 和网络设置"
                    )
                }
            }
        }
    }

    func syncAPIKeyQuota(_ record: APIKeyRecord) {
        guard let profile = accounts.first(where: { $0.id == record.accountID }),
              let key = secrets[record.accountID]?.apiKeys.first(where: { $0.id == record.key.id }),
              key.remoteID != nil else {
            eventMessage = "这条 API Key 没有远端 ID，无法同步限额；请先从网站同步"
            return
        }
        guard !apiKeySyncingIDs.contains(record.accountID) else {
            eventMessage = "这个账号正在同步 API Key，请稍候"
            return
        }

        apiKeySyncingIDs.insert(record.accountID)
        eventMessage = "正在把 \(record.displayName) 的限额同步到网站"
        Task { [weak self] in
            guard let self else { return }
            defer { self.apiKeySyncingIDs.remove(record.accountID) }
            await self.updateRemoteAPIKeys([key], accountID: record.accountID, accountLabel: profile.label)
        }
    }

    private func updateRemoteAPIKeys(
        _ keys: [StoredAPIKey],
        accountID: UUID,
        accountLabel: String
    ) async {
        do {
            let profile = try accountProfile(for: accountID)
            let runtimeID = try runtimeAccountIdentifier(for: profile)
            var updatedCount = 0

            for key in keys {
                guard let remoteID = key.remoteID else { continue }
                let input = APIKeyUpdateInput(
                    remoteID: remoteID,
                    name: key.name,
                    quotaLimit: key.quotaLimit,
                    unlimitedQuota: key.unlimitedQuota,
                    expiredTime: key.expiredTime,
                    modelLimitsEnabled: key.modelLimitsEnabled,
                    modelLimits: key.modelLimits,
                    allowIPs: key.allowIPs,
                    group: key.group,
                    crossGroupRetry: key.crossGroupRetry
                )
                let inputData = try JSONEncoder().encode(input)
                let output = try await runAPIKeyCommand(
                    ["update", "--account-id", runtimeID],
                    input: inputData
                )
                let response = try JSONDecoder().decode(APIKeyUpdateResponse.self, from: output)
                guard response.success else { throw APIKeyCommandError.invalidResponse }
                updatedCount += 1
            }

            eventMessage = updatedCount > 0
                ? "已将 \(updatedCount) 个 API Key 的限额同步到 \(accountLabel) 网站"
                : "没有需要同步的远端 API Key"
        } catch {
            eventMessage = apiKeySyncFailureMessage(
                error,
                fallback: "网站限额同步失败：App 中的本机值已保留，请检查凭据后重试"
            )
        }
    }

    private func apiKeySyncFailureMessage(_ error: Error, fallback: String) -> String {
        let detail = error.localizedDescription
        if detail.contains("AUTH_SESSION_LIMIT") {
            return "网站拒绝了新的密码登录（会话数量已达上限）。App 已进入登录冷却，请在网页登录会话中退出其他会话后再重试"
        }
        if detail.contains("Unauthorized") || detail.contains("401") {
            return "网站会话已失效，App 会在下一次同步重新登录；如再次达到会话上限，请先退出其他网页登录会话"
        }
        return fallback
    }

    func copyAPIKey(_ record: APIKeyRecord) {
        guard let key = secrets[record.accountID]?.apiKeys.first(where: { $0.id == record.key.id }),
              !key.value.isEmpty else {
            eventMessage = "这个 API Key 还没有保存完整值"
            return
        }

        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        guard pasteboard.setString(key.value, forType: .string) else {
            eventMessage = "复制 API Key 失败"
            return
        }
        eventMessage = "已复制 \(record.displayName) 到剪贴板"
    }

    func openTopUp(for accountID: UUID) {
        guard let profile = accounts.first(where: { $0.id == accountID }) else {
            eventMessage = "找不到对应账号"
            return
        }
        openTopUp(for: profile)
    }

    func topUpCredentials(for profile: AccountProfile) -> WalletSessionCredentials {
        let secret = secrets[profile.id] ?? AccountSecret()
        return WalletSessionCredentials(
            cookie: secret.cookie,
            authorization: secret.authorization,
            userID: profile.userID
        )
    }

    func persistWalletCookies(_ cookies: [HTTPCookie], for accountID: UUID, baseURL: String) {
        guard let profile = accounts.first(where: { $0.id == accountID }),
              let host = walletHost(from: baseURL) else { return }

        var selected: [String: HTTPCookie] = [:]
        for cookie in cookies {
            guard cookieMatchesHost(cookie, host: host),
                  !cookie.name.contains(";"),
                  !cookie.value.contains(";"),
                  !cookie.value.isEmpty else { continue }
            if let expiresDate = cookie.expiresDate, expiresDate <= Date() { continue }

            if let existing = selected[cookie.name],
               cookieDomainSpecificity(existing, host: host) >= cookieDomainSpecificity(cookie, host: host) {
                continue
            }
            selected[cookie.name] = cookie
        }

        guard selected.keys.contains(where: { $0.caseInsensitiveCompare("session") == .orderedSame }) else {
            return
        }

        let header = selected.values
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            .map { "\($0.name)=\($0.value)" }
            .joined(separator: "; ")
        guard !header.isEmpty else { return }

        var secret = secrets[accountID] ?? AccountSecret()
        guard secret.cookie != header else { return }
        secret.cookie = header

        do {
            try vault.save(secret, for: accountID)
            secrets[accountID] = secret
            let label = profile.label.isEmpty ? profile.name : profile.label
            eventMessage = "已保存 \(label) 的钱包登录状态，下次打开无需重新登录"
        } catch {
            eventMessage = "钱包登录状态保存失败：\(error.localizedDescription)"
        }
    }

    private func walletHost(from baseURL: String) -> String? {
        var value = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { value = "https://www.foropencode.com" }
        if !value.contains("://") { value = "https://\(value)" }
        return URL(string: value)?.host?.lowercased()
    }

    private func cookieMatchesHost(_ cookie: HTTPCookie, host: String) -> Bool {
        let domain = cookie.domain
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return domain == host || host.hasSuffix(".\(domain)") || domain.hasSuffix(".\(host)")
    }

    private func cookieDomainSpecificity(_ cookie: HTTPCookie, host: String) -> Int {
        let domain = cookie.domain
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return domain == host ? 2 : 1
    }

    func openTopUp(for profile: AccountProfile) {
        guard websiteURL(for: profile, path: "/wallet/") != nil else {
            eventMessage = "账号地址无效，无法打开充值页面"
            return
        }
        topUpProfile = profile
        eventMessage = "已在 App 内打开 \(profile.label) 的官方钱包，活动和金额实时读取"
    }

    func topUpURL(for profile: AccountProfile) -> URL? {
        websiteURL(for: profile, path: "/wallet/")
    }

    func openTopUpInBrowser(for profile: AccountProfile) {
        guard let url = websiteURL(for: profile, path: "/wallet/") else {
            eventMessage = "账号地址无效，无法打开充值页面"
            return
        }
        NSWorkspace.shared.open(url)
        eventMessage = "已在浏览器打开 \(profile.label) 的充值页面"
    }

    func openKeyManager(for accountID: UUID) {
        guard let profile = accounts.first(where: { $0.id == accountID }) else {
            eventMessage = "找不到对应账号"
            return
        }
        guard let url = websiteURL(for: profile, path: "/keys/") else {
            eventMessage = "账号地址无效，无法打开密钥管理"
            return
        }
        NSWorkspace.shared.open(url)
        eventMessage = "已打开 \(profile.label) 的网页密钥管理"
    }

    private func websiteURL(for profile: AccountProfile, path: String) -> URL? {
        var base = profile.baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if base.isEmpty { base = "https://www.foropencode.com" }
        while base.hasSuffix("/") { base.removeLast() }
        return URL(string: base + path)
    }

    func setAutoSync(_ enabled: Bool) {
        if var pending = pendingPasswordReconnect {
            // Keep the reconnect isolated from scheduling. The user's new
            // preference is applied after this one account has finished.
            pending.resumeAutoSync = enabled
            pendingPasswordReconnect = pending
            settings.autoSync = false
            persistState()
            eventMessage = enabled
                ? "将在账号重新连接成功后恢复自动同步"
                : "账号重新连接完成后将保持自动同步关闭"
            return
        }

        settings.autoSync = enabled
        persistState()
        if enabled {
            guard secretsLoaded else {
                eventMessage = "正在读取 Keychain，凭据就绪后会自动启动同步"
                return
            }
            startSync()
        } else {
            stopSync()
        }
    }

    func setIntervalMinutes(_ minutes: Int) {
        let value = min(max(minutes, 1), 1440)
        guard settings.intervalMinutes != value else { return }
        settings.intervalMinutes = value
        persistState()

        guard ownsLoop, loopProcess?.isRunning == true else {
            eventMessage = "同步间隔已设为每 \(value) 分钟"
            return
        }

        do {
            _ = try writeLoopRuntimeEnvironment()
            eventMessage = "同步间隔已更新为每 \(value) 分钟，将在下一周期生效"
        } catch {
            eventMessage = "同步间隔已保存，但运行配置写入失败：\(error.localizedDescription)"
        }
    }

    func startSync() {
        guard loopProcess?.isRunning != true else { return }
        guard pendingPasswordReconnect == nil else {
            eventMessage = "正在完成账号重新连接，随后会按设置恢复自动同步"
            return
        }
        guard onceProcess?.isRunning != true else {
            eventMessage = "单次任务仍在运行，完成后再启动自动同步"
            return
        }
        guard !externalLoopProbeInFlight else {
            eventMessage = "正在检查已有同步进程，请稍候再启动"
            return
        }
        guard credentialsReady else {
            phase = .failed
            eventMessage = "请先为所有启用账号补充 Cookie/Bearer Token 或账号密码"
            settings.autoSync = false
            persistState()
            return
        }
        guard backgroundSyncReady else {
            phase = .idle
            eventMessage = "请先在账号矩阵中为每个账号点击“重新连接”，建立一次可续期的密码会话"
            return
        }
        if let pid = activeExpectedLoopPID() {
            guard takeOverExternalLoop(pid) else {
                phase = .failed
                eventMessage = "检测到无法确认来源的同步进程，请先在终端停止它"
                return
            }
            externalLoopPID = nil
        }
        guard activeExpectedLoopPID() == nil else {
            phase = .failed
            eventMessage = "旧同步进程尚未退出，请稍后重试"
            return
        }

        var environmentURL: URL?
        do {
            let envURL = try writeRuntimeEnvironment(purpose: .loop)
            environmentURL = envURL
            loopRuntimeEnvironmentURL = envURL
            let process = Process()
            let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: "/bin/bash")
            process.arguments = [projectURL.appendingPathComponent("scripts/run-local-sync-loop.sh").path]
            process.currentDirectoryURL = projectURL
            process.environment = processEnvironment(using: envURL)
            process.standardOutput = pipe
            process.standardError = pipe
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
                Task { @MainActor in self?.appendLog(text) }
            }
            stopRequested = false
            process.terminationHandler = { [weak self] process in
                pipe.fileHandleForReading.readabilityHandler = nil
                Task { @MainActor in
                    guard let self else { return }
                    let wasStopRequested = self.stopRequested
                    self.loopProcess = nil
                    self.ownsLoop = false
                    if self.loopRuntimeEnvironmentURL == envURL {
                        self.loopRuntimeEnvironmentURL = nil
                    }
                    self.removeRuntimeEnvironment(at: envURL)

                    if let pending = self.pendingPasswordReconnect {
                        self.stopRequested = false
                        self.beginPendingPasswordReconnect(pending)
                    } else if !wasStopRequested && process.terminationStatus != 0 {
                        self.phase = .failed
                        self.eventMessage = "自动同步进程已退出（状态 \(process.terminationStatus)），请查看日志"
                    } else if wasStopRequested {
                        self.phase = .idle
                        self.eventMessage = "自动同步已暂停"
                    } else {
                        self.phase = .idle
                    }
                    self.stopRequested = false
                    self.refreshRuntime()
                }
            }
            try process.run()
            loopProcess = process
            ownsLoop = true
            phase = .running
            eventMessage = "自动同步已启动，每 \(settings.intervalMinutes) 分钟检查一次"
        } catch {
            removeRuntimeEnvironment(at: environmentURL)
            if loopRuntimeEnvironmentURL == environmentURL {
                loopRuntimeEnvironmentURL = nil
            }
            phase = .failed
            eventMessage = "同步启动失败：\(error.localizedDescription)"
        }
    }

    func stopSync() {
        if ownsLoop, let process = loopProcess, process.isRunning {
            stopRequested = true
            process.terminate()
            phase = .running
            eventMessage = "正在安全暂停自动同步"
            return
        }

        if let pid = activeExpectedLoopPID() {
            if takeOverExternalLoop(pid) {
                externalLoopPID = nil
                phase = .idle
                eventMessage = "已停止旧的终端同步进程"
                return
            }

            phase = .failed
            eventMessage = "无法确认或停止已有同步进程"
            return
        }

        if existingLoopPID != nil {
            // The PID file can outlive its process or be reused by macOS. It
            // is never safe to block the UI on an unrelated process.
            externalLoopPID = nil
        }
        eventMessage = "当前没有可停止的同步进程"
        refreshRuntime()
    }

    func runOnce(allowPasswordLoginFor: Set<UUID> = []) {
        guard onceProcess?.isRunning != true else { return }
        guard pendingPasswordReconnect == nil else {
            eventMessage = "账号重新连接中，请等待它结束后再执行单次同步"
            return
        }
        guard !isLoopRunning, activeExpectedLoopPID() == nil else {
            eventMessage = "自动同步正在运行，请等待当前周期结束"
            return
        }
        guard credentialsReady else {
            phase = .failed
            eventMessage = "请先为所有启用账号补充 Cookie/Bearer Token 或账号密码"
            return
        }
        guard !allowPasswordLoginFor.isEmpty || backgroundSyncReady else {
            phase = .idle
            eventMessage = "请先在账号矩阵中点击“重新连接”，建立一次可续期的密码会话"
            return
        }

        var environmentURL: URL?
        do {
            let envURL = try writeRuntimeEnvironment(
                purpose: .once,
                allowPasswordLoginFor: allowPasswordLoginFor
            )
            environmentURL = envURL
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
                    self.removeRuntimeEnvironment(at: envURL)
                    self.refreshRuntime()
                    self.eventMessage = "单次同步任务已结束"
                }
            }
            try process.run()
            onceProcess = process
            phase = .running
            eventMessage = "正在执行一次同步并推送"
        } catch {
            removeRuntimeEnvironment(at: environmentURL)
            phase = .failed
            eventMessage = "单次同步启动失败：\(error.localizedDescription)"
        }
    }

    private func pauseLoopForPendingPasswordReconnect() {
        guard pendingPasswordReconnect != nil else { return }

        if ownsLoop, let process = loopProcess, process.isRunning {
            stopRequested = true
            process.terminate()
            phase = .running
            eventMessage = "正在等待当前同步循环完全停止"
            return
        }

        if externalLoopProbeInFlight {
            eventMessage = "正在确认同步进程状态，随后会继续重新连接"
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                self?.pauseLoopForPendingPasswordReconnect()
            }
            return
        }

        if let pid = activeExpectedLoopPID() {
            guard takeOverExternalLoop(pid) else {
                pendingPasswordReconnect = nil
                phase = .failed
                eventMessage = "无法停止已有同步进程；为避免并发登录，已取消重新连接"
                return
            }
            externalLoopPID = nil
        }

        beginPendingPasswordReconnect()
    }

    private func beginPendingPasswordReconnect(_ request: PendingPasswordReconnect? = nil) {
        guard let reconnect = request ?? pendingPasswordReconnect else { return }
        guard onceProcess?.isRunning != true else {
            eventMessage = "正在等待当前单次任务结束后重新连接"
            return
        }

        do {
            eventMessage = "正在为 \(reconnect.profile.label) 建立一次可续期的密码会话"
            try runPasswordReconnect(reconnect)
        } catch {
            pendingPasswordReconnect = nil
            phase = .failed
            eventMessage = "重新连接启动失败：\(error.localizedDescription)"
        }
    }

    private func runPasswordReconnect(_ reconnect: PendingPasswordReconnect) throws {
        let envURL = try writeRuntimeEnvironment(
            purpose: .reconnect,
            allowPasswordLoginFor: Set([reconnect.accountID]),
            accountIDs: Set([reconnect.accountID])
        )
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [
            projectURL.appendingPathComponent("scripts/connect-account.sh").path,
            "--account-id",
            reconnect.runtimeAccountID,
        ]
        process.currentDirectoryURL = projectURL
        process.environment = processEnvironment(using: envURL)
        process.standardOutput = pipe
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in self?.appendLog(text) }
        }
        process.terminationHandler = { [weak self] process in
            pipe.fileHandleForReading.readabilityHandler = nil
            Task { @MainActor in
                guard let self else { return }
                self.onceProcess = nil
                self.removeRuntimeEnvironment(at: envURL)
                let resumeAutoSync = self.pendingPasswordReconnect?.resumeAutoSync
                    ?? reconnect.resumeAutoSync
                self.pendingPasswordReconnect = nil
                self.refreshRuntime()
                if process.terminationStatus == 0 {
                    self.phase = .success
                    self.eventMessage = "\(reconnect.profile.label) 已建立可续期的密码会话"
                    if resumeAutoSync, !self.enabledAccounts.isEmpty {
                        self.settings.autoSync = true
                        self.persistState()
                        self.eventMessage = "\(reconnect.profile.label) 已重新连接，正在恢复自动同步"
                        DispatchQueue.main.async { [weak self] in self?.startSync() }
                    }
                } else {
                    self.phase = .failed
                    self.settings.autoSync = false
                    self.persistState()
                    self.eventMessage = "\(reconnect.profile.label) 重新连接失败（状态 \(process.terminationStatus)），自动同步保持关闭，请查看运行日志"
                }
            }
        }
        do {
            try process.run()
        } catch {
            removeRuntimeEnvironment(at: envURL)
            throw error
        }
        onceProcess = process
        phase = .running
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
        refreshExternalLoopPID()
        refreshProcessState()
        let rootURL = projectURL

        if !snapshotRefreshInFlight {
            snapshotRefreshInFlight = true
            let previousSnapshotDate = lastSnapshotModificationDate
            DispatchQueue.global(qos: .utility).async { [weak self] in
                let snapshotResult = Self.readSnapshot(
                    at: rootURL.appendingPathComponent("docs/data/latest.json"),
                    previousDate: previousSnapshotDate
                )
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.snapshotRefreshInFlight = false
                    if let snapshotResult {
                        self.lastSnapshotModificationDate = snapshotResult.modificationDate
                        self.snapshot = snapshotResult.snapshot
                        self.publishWidgetSnapshot(snapshotResult.snapshot)
                    }
                    self.refreshProcessState()
                }
            }
        }

        if !logRefreshInFlight {
            logRefreshInFlight = true
            let previousLogDate = lastLogModificationDate
            DispatchQueue.global(qos: .utility).async { [weak self] in
                let logResult = Self.readLog(
                    at: rootURL.appendingPathComponent("work/sync-loop.log"),
                    previousDate: previousLogDate
                )
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.logRefreshInFlight = false
                    if let logResult {
                        self.lastLogModificationDate = logResult.modificationDate
                        if logResult.lines != self.logLines { self.logLines = logResult.lines }
                    }
                    self.refreshProcessState()
                }
            }
        }
    }

    private func refreshExternalLoopPID() {
        guard !externalLoopProbeInFlight else { return }
        externalLoopProbeInFlight = true
        let pidURL = projectURL.appendingPathComponent("work/sync-loop.pid")
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let pid = Self.readPIDFile(at: pidURL)
            let activePID = pid.flatMap { Self.isExpectedLoopProcess($0) ? $0 : nil }
            if pid != nil, activePID == nil {
                // The loop owns this PID file. Removing only a stale entry
                // prevents a recycled macOS PID from blocking reconnects.
                try? FileManager.default.removeItem(at: pidURL)
            }
            DispatchQueue.main.async {
                guard let self else { return }
                self.externalLoopPID = activePID
                self.externalLoopProbeInFlight = false
                self.refreshProcessState()
            }
        }
    }

    private func publishWidgetSnapshot(_ snapshot: DashboardSnapshot) {
        let accounts = snapshot.accounts.map { account in
            WidgetAccountPayload(
                label: account.label,
                balance: account.remainingPrimaryBalance,
                usage: account.usedPrimaryCost,
                requests: account.requestCount,
                utilization: account.utilizationRate,
                gptPlusRatio: account.gptPlusRatio
            )
        }
        let payload = WidgetSnapshotPayload(
            generatedAt: snapshot.generatedAt,
            latestDate: snapshot.latestDay?.date,
            todayUsage: snapshot.latestDay?.primaryCost ?? 0,
            todayRequests: snapshot.latestDay?.requests ?? 0,
            monthUsage: snapshot.latestMonthUsage,
            monthRequests: snapshot.latestMonthRequests,
            totalBalance: snapshot.accounts.reduce(0) { $0 + $1.remainingPrimaryBalance },
            gptPlusRatio: snapshot.accounts.compactMap(\.gptPlusRatio).first,
            accountCount: snapshot.accounts.count,
            syncState: phase.title,
            accounts: accounts
        )

        guard let data = try? JSONEncoder().encode(payload) else { return }
        var wroteSnapshot = false
        for url in IndusWidgetDataStore.candidateURLs {
            do {
                try FileManager.default.createDirectory(
                    at: url.deletingLastPathComponent(),
                    withIntermediateDirectories: true
                )
                try data.write(to: url, options: .atomic)
                wroteSnapshot = true
            } catch {
                continue
            }
        }
        if wroteSnapshot {
            WidgetCenter.shared.reloadTimelines(ofKind: "IndusUsageWidget")
        }
    }

    private func refreshProcessState() {
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
           pendingPasswordReconnect == nil,
           backgroundSyncReady,
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

    nonisolated private static func readPIDFile(at url: URL) -> Int32? {
        let descriptor = open(url.path, O_RDONLY | O_NONBLOCK)
        guard descriptor >= 0 else { return nil }
        defer { close(descriptor) }

        var buffer = [UInt8](repeating: 0, count: 32)
        let count = buffer.withUnsafeMutableBytes { pointer -> Int in
            guard let baseAddress = pointer.baseAddress else { return 0 }
            return Darwin.read(descriptor, baseAddress, pointer.count)
        }
        guard count > 0 else { return nil }
        let raw = String(decoding: buffer.prefix(count), as: UTF8.self)
        return Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func activeExpectedLoopPID() -> Int32? {
        if let knownPID = existingLoopPID, Self.isExpectedLoopProcess(knownPID) {
            return knownPID
        }

        let pidURL = projectURL.appendingPathComponent("work/sync-loop.pid")
        guard let pid = Self.readPIDFile(at: pidURL), Self.isExpectedLoopProcess(pid) else {
            externalLoopPID = nil
            return nil
        }

        externalLoopPID = pid
        return pid
    }

    private func loadState() {
        let url = stateURL
        if let data = try? Data(contentsOf: url),
           let stored = try? JSONDecoder().decode(StoredConsoleState.self, from: data) {
            accounts = stored.accounts
            settings = stored.settings
        }
        if settings.proxy.isEmpty { settings.proxy = localEnvValue("FOROPENCODE_PROXY") }
        if settings.sshKeyPath.isEmpty { settings.sshKeyPath = localEnvValue("SYNC_GIT_SSH_KEY_PATH") }
    }

    private func loadSecretsInBackground() {
        let accountIDs = accounts.map(\.id)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let vault = KeychainVault()
            var loaded: [UUID: AccountSecret] = [:]
            for id in accountIDs {
                if let secret = vault.read(for: id) { loaded[id] = secret }
            }
            DispatchQueue.main.async {
                guard let self else { return }
                for (id, secret) in loaded {
                    var normalizedSecret = secret
                    normalizedSecret.apiKeys = self.deduplicateAPIKeys(secret.apiKeys)
                    if normalizedSecret != secret {
                        try? self.vault.save(normalizedSecret, for: id)
                    }
                    self.secrets[id] = normalizedSecret
                }
                self.secretsLoaded = true
                self.refreshRuntime()
                if self.settings.autoSync { self.startSync() }
            }
        }
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

    private func writeRuntimeEnvironment(
        purpose: RuntimeEnvironmentPurpose,
        allowPasswordLoginFor: Set<UUID> = [],
        accountIDs: Set<UUID>? = nil
    ) throws -> URL {
        let workURL = projectURL.appendingPathComponent("work")
        try FileManager.default.createDirectory(at: workURL, withIntermediateDirectories: true)
        let envURL = workURL.appendingPathComponent(purpose.fileName)
        let runtimeAccounts = makeRuntimeAccounts(
            includeDisabled: accountIDs != nil,
            accountIDs: accountIDs,
            allowPasswordLoginFor: allowPasswordLoginFor
        )
        let json = try String(decoding: JSONEncoder().encode(runtimeAccounts), as: UTF8.self)
        var lines = ["export FOROPENCODE_ACCOUNTS_JSON=\(shellQuote(json))"]
        if !settings.proxy.isEmpty { lines.append("export FOROPENCODE_PROXY=\(shellQuote(settings.proxy))") }
        if !settings.sshKeyPath.isEmpty { lines.append("export SYNC_GIT_SSH_KEY_PATH=\(shellQuote(settings.sshKeyPath))") }
        lines.append("export SYNC_INTERVAL_SECONDS=\(max(60, settings.intervalMinutes * 60))")
        try lines.joined(separator: "\n").appending("\n").write(to: envURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: envURL.path)
        return envURL
    }

    private func writeLoopRuntimeEnvironment() throws -> URL {
        let envURL = try writeRuntimeEnvironment(purpose: .loop)
        loopRuntimeEnvironmentURL = envURL
        return envURL
    }

    @discardableResult
    private func refreshManagedLoopEnvironmentAfterAccountChange() -> Bool {
        guard ownsLoop, loopProcess?.isRunning == true else { return false }
        do {
            _ = try writeLoopRuntimeEnvironment()
            return true
        } catch {
            return false
        }
    }

    private func makeRuntimeAccounts(
        includeDisabled: Bool,
        accountIDs: Set<UUID>? = nil,
        allowPasswordLoginFor: Set<UUID> = []
    ) -> [RuntimeAccount] {
        let allProfiles = includeDisabled ? accounts : enabledAccounts
        let profiles = accountIDs.map { selectedIDs in
            allProfiles.filter { selectedIDs.contains($0.id) }
        } ?? allProfiles
        return profiles.map { profile in
            let secret = secrets[profile.id] ?? AccountSecret()
            let stableIndex = accounts.firstIndex(where: { $0.id == profile.id }) ?? 0
            let usesPasswordAuthentication = hasPasswordCredentials(secret)
            return RuntimeAccount(
                id: "account-\(stableIndex + 1)",
                label: profile.label.isEmpty ? profile.name : profile.label,
                baseUrl: profile.baseURL,
                scope: "self",
                auth: RuntimeAuth(
                    // Keep browser credentials out of the child process when
                    // the account is configured for password authentication.
                    cookie: usesPasswordAuthentication ? "" : secret.cookie,
                    authorization: usesPasswordAuthentication ? "" : secret.authorization,
                    userId: profile.userID,
                    // A password session is created only by the reconnect
                    // action. Background work may only reuse or refresh it.
                    username: secret.username,
                    password: secret.password,
                    preferPasswordLogin: usesPasswordAuthentication,
                    allowPasswordLogin: usesPasswordAuthentication && allowPasswordLoginFor.contains(profile.id),
                    // A background retry is only permitted after the server
                    // explicitly rejects a known refresh session. Node keeps
                    // the cross-process lock and recovery cooldown.
                    allowPasswordRecovery: usesPasswordAuthentication
                )
            )
        }
    }

    private func hasSessionCredentials(_ secret: AccountSecret) -> Bool {
        !secret.cookie.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !secret.authorization.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func hasPasswordCredentials(_ secret: AccountSecret) -> Bool {
        !secret.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !secret.password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func cachedPasswordSessionEntry(for profile: AccountProfile) -> [String: Any]? {
        guard let runtimeAccountID = try? runtimeAccountIdentifier(for: profile) else { return nil }
        let cacheURL = projectURL.appendingPathComponent("work/auth-session-cache.json")
        guard let data = try? Data(contentsOf: cacheURL),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let accounts = payload["accounts"] as? [String: Any],
              let entry = accounts[runtimeAccountID] as? [String: Any] else {
            return nil
        }
        return entry
    }

    private func hasReusableSession(for profile: AccountProfile) -> Bool {
        guard let secret = secrets[profile.id] else { return false }
        if !hasPasswordCredentials(secret) {
            return hasSessionCredentials(secret)
        }

        guard let entry = cachedPasswordSessionEntry(for: profile) else { return false }

        let hasRefreshCookie = (entry["cookie"] as? String)?
            .contains("new_api_refresh=") == true
        let hasAccessToken = !(entry["authorization"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
        let requiresManualReconnect = entry["requiresManualReconnect"] as? Bool ?? false
        return hasRefreshCookie && hasAccessToken && !requiresManualReconnect
    }

    private func hasBackgroundRecoveryPath(for profile: AccountProfile) -> Bool {
        guard let secret = secrets[profile.id] else { return false }
        if !hasPasswordCredentials(secret) {
            return hasSessionCredentials(secret)
        }
        if hasReusableSession(for: profile) {
            return true
        }

        // A cooldown is not a manual-reconnect state. Node will retry this
        // account with bounded backoff, so restarting the App must not block
        // its managed loop before that scheduled recovery can happen.
        let reason = cachedPasswordSessionEntry(for: profile)?["reconnectReason"] as? String
        return reason == "AUTH_AUTO_RECOVERY_COOLDOWN"
    }

    private func processEnvironment(using envURL: URL) -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["SYNC_ENV_FILE"] = envURL.path
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        return environment
    }

    private func accountProfile(for id: UUID) throws -> AccountProfile {
        guard let profile = accounts.first(where: { $0.id == id }) else {
            throw APIKeyCommandError.invalidResponse
        }
        return profile
    }

    private func runtimeAccountIdentifier(for profile: AccountProfile) throws -> String {
        guard let index = accounts.firstIndex(where: { $0.id == profile.id }) else {
            throw APIKeyCommandError.invalidResponse
        }
        return "account-\(index + 1)"
    }

    private func apiKeyProcessEnvironment() throws -> [String: String] {
        let json = try String(
            decoding: JSONEncoder().encode(makeRuntimeAccounts(includeDisabled: true)),
            as: UTF8.self
        )
        var environment = ProcessInfo.processInfo.environment
        environment["FOROPENCODE_ACCOUNTS_JSON"] = json
        if settings.proxy.isEmpty {
            environment.removeValue(forKey: "FOROPENCODE_PROXY")
        } else {
            environment["FOROPENCODE_PROXY"] = settings.proxy
        }
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        return environment
    }

    private func nodeExecutableURL() -> URL? {
        let candidates = [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ]
        return candidates
            .map(URL.init(fileURLWithPath:))
            .first(where: { FileManager.default.isExecutableFile(atPath: $0.path) })
    }

    private func runAPIKeyCommand(_ arguments: [String], input: Data? = nil) async throws -> Data {
        guard let nodeURL = nodeExecutableURL() else { throw APIKeyCommandError.missingNode }
        let scriptURL = projectURL.appendingPathComponent("scripts/manage-api-keys.mjs")
        guard FileManager.default.isReadableFile(atPath: scriptURL.path) else {
            throw APIKeyCommandError.processFailed("找不到 API Key 管理脚本")
        }

        let process = Process()
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        let inputPipe = input == nil ? nil : Pipe()
        process.executableURL = nodeURL
        process.arguments = [scriptURL.path] + arguments
        process.currentDirectoryURL = projectURL
        process.environment = try apiKeyProcessEnvironment()
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        if let inputPipe { process.standardInput = inputPipe }

        return try await withCheckedThrowingContinuation { continuation in
            process.terminationHandler = { process in
                let output = outputPipe.fileHandleForReading.readDataToEndOfFile()
                let error = errorPipe.fileHandleForReading.readDataToEndOfFile()
                if process.terminationStatus == 0 {
                    continuation.resume(returning: output)
                } else {
                    // The CLI redacts secrets; retain safe server error codes for actionable UI messages.
                    let detail = String(data: error, encoding: .utf8)?
                        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    continuation.resume(throwing: APIKeyCommandError.processFailed(detail))
                }
            }

            do {
                try process.run()
                if let input, let inputPipe {
                    inputPipe.fileHandleForWriting.write(input)
                    inputPipe.fileHandleForWriting.closeFile()
                }
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    private func removeRuntimeEnvironment(at url: URL?) {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private func takeOverExternalLoop(_ pid: Int32) -> Bool {
        guard Self.isExpectedLoopProcess(pid) else { return false }

        eventMessage = "正在接管旧的终端同步进程"
        _ = kill(pid, SIGTERM)

        for _ in 0..<25 {
            if kill(pid, 0) != 0 {
                externalLoopPID = nil
                return true
            }
            usleep(100_000)
        }

        if kill(pid, 0) == 0 {
            _ = kill(pid, SIGKILL)
            usleep(100_000)
        }

        externalLoopPID = kill(pid, 0) == 0 ? pid : nil
        return externalLoopPID == nil
    }

    nonisolated private static func isExpectedLoopProcess(_ pid: Int32) -> Bool {
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

    nonisolated private static func readLog(at url: URL, previousDate: Date?) -> LogRefreshResult? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let modificationDate = attributes[.modificationDate] as? Date,
              modificationDate != previousDate,
              let text = readLogTail(at: url) else { return nil }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            .suffix(90)
            .map(String.init)
        return LogRefreshResult(modificationDate: modificationDate, lines: lines)
    }

    nonisolated private static func readLogTail(at url: URL, maxBytes: UInt64 = 96 * 1024) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        let fileSize = handle.seekToEndOfFile()
        let offset = fileSize > maxBytes ? fileSize - maxBytes : 0
        handle.seek(toFileOffset: offset)
        let data = handle.readDataToEndOfFile()
        handle.closeFile()
        return String(data: data, encoding: .utf8)
    }

    nonisolated private static func readSnapshot(at url: URL, previousDate: Date?) -> SnapshotRefreshResult? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let modificationDate = attributes[.modificationDate] as? Date,
              modificationDate != previousDate,
              let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(DashboardSnapshot.self, from: data) else { return nil }
        return SnapshotRefreshResult(modificationDate: modificationDate, snapshot: snapshot)
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
    var preferPasswordLogin: Bool
    var allowPasswordLogin: Bool
    var allowPasswordRecovery: Bool
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
