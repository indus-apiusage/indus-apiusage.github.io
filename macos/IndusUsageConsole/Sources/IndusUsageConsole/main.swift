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

struct APIKeyRecord: Identifiable {
    let accountID: UUID
    let accountLabel: String
    let baseURL: String
    let key: StoredAPIKey

    var id: String { "\(accountID.uuidString)-\(key.id.uuidString)" }
    var displayName: String {
        if key.name.caseInsensitiveCompare("zdy") == .orderedSame { return "曾德宇" }
        return key.name.isEmpty ? "未命名密钥" : key.name
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
    case processFailed

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "网站返回了无法识别的 API Key 响应"
        case .missingNode: return "找不到 Node.js 运行时"
        case .processFailed: return "API Key 管理命令执行失败"
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

    private struct Totals: Decodable {
        var requests: Int
        var primaryCost: Double
    }

    private enum CodingKeys: String, CodingKey {
        case personId
        case displayName
        case totals
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .personId) ?? "person"
        displayName = try container.decodeIfPresent(String.self, forKey: .displayName) ?? id
        let totals = try container.decodeIfPresent(Totals.self, forKey: .totals)
        requests = totals?.requests ?? 0
        primaryCost = totals?.primaryCost ?? 0
    }

    var usageText: String {
        String(format: "¥%.4f", primaryCost)
    }

    var requestText: String {
        String(format: "%d 次请求", requests)
    }
}

struct DashboardSnapshot: Decodable {
    var generatedAt: String?
    var accounts: [SnapshotAccount]
    var people: [SnapshotPerson]
    var summary: SnapshotSummary?

    private enum CodingKeys: String, CodingKey {
        case generatedAt
        case accounts
        case account
        case people
        case summary
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        accounts = try container.decodeIfPresent([SnapshotAccount].self, forKey: .accounts) ?? []
        people = try container.decodeIfPresent([SnapshotPerson].self, forKey: .people) ?? []
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
        case .running: return Color(hex: 0x467FA7)
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
    @Published private(set) var apiKeySyncingIDs: Set<UUID> = []

    private let vault = KeychainVault()
    private var secrets: [UUID: AccountSecret] = [:]
    private var loopProcess: Process?
    private var onceProcess: Process?
    private var ownsLoop = false
    private var autoStartScheduled = false
    private var stopRequested = false
    private var secretsLoaded = false
    private var pollTimer: Timer?
    private var lastLogModificationDate: Date?
    private var lastSnapshotModificationDate: Date?
    private var runtimeRefreshInFlight = false
    private var initialAPIKeySyncScheduled = false

    var enabledAccounts: [AccountProfile] { accounts.filter(\.enabled) }
    var isLoopRunning: Bool { loopProcess?.isRunning == true || existingLoopPID != nil }
    var apiKeyRecords: [APIKeyRecord] {
        accounts.flatMap { profile in
            (secrets[profile.id]?.apiKeys ?? []).map { key in
                APIKeyRecord(
                    accountID: profile.id,
                    accountLabel: profile.label.isEmpty ? profile.name : profile.label,
                    baseURL: profile.baseURL,
                    key: key
                )
            }
        }
    }
    var existingLoopPID: Int32? {
        let url = projectURL.appendingPathComponent("work/sync-loop.pid")
        guard let raw = try? String(contentsOf: url, encoding: .utf8),
              let value = Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              kill(value, 0) == 0 else { return nil }
        return value
    }
    var projectURL: URL { URL(fileURLWithPath: settings.projectPath) }
    var credentialsReady: Bool {
        secretsLoaded && !enabledAccounts.isEmpty && enabledAccounts.allSatisfy { hasCredentials(for: $0.id) }
    }

    init() {
        loadState()
        // Runtime state does not need a frame-rate poll. Five seconds keeps the
        // console responsive while avoiding repeated disk reads and view updates.
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refreshRuntime() }
        }
        refreshRuntime()
        // Let the first window frame render before Keychain can show an access
        // prompt. Reading credentials is moved off the main actor as well.
        DispatchQueue.main.async { [weak self] in self?.loadSecretsInBackground() }
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

    func edit(accountID: UUID) {
        guard let profile = accounts.first(where: { $0.id == accountID }) else {
            eventMessage = "找不到对应账号"
            return
        }
        edit(profile)
    }

    func save(_ draft: AccountDraft) {
        let previousAPIKeys = secrets[draft.profile.id]?.apiKeys ?? []
        var sanitizedSecret = draft.secret
        sanitizedSecret.apiKeys = draft.secret.apiKeys.compactMap { key in
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
            editingDraft = nil
            if remoteChanges.isEmpty {
                eventMessage = "已将 \(draft.profile.label) 接入凭据舱，保存 API Key \(sanitizedSecret.apiKeys.count) 个"
            } else {
                eventMessage = "本机已保存，正在把 \(remoteChanges.count) 个 API Key 的限额同步到网站"
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
        persistState()
        eventMessage = "已移除 \(profile.label)"
    }

    func setEnabled(_ enabled: Bool, for id: UUID) {
        guard let index = accounts.firstIndex(where: { $0.id == id }) else { return }
        accounts[index].enabled = enabled
        persistState()
        eventMessage = enabled ? "已启用该账号同步" : "已暂停该账号同步"
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
            if announce { eventMessage = "请先为该账号补充凭据，才能从网站读取 API Key" }
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
                let oldRemoteKeys = Dictionary(
                    uniqueKeysWithValues: updatedSecret.apiKeys.compactMap { key in
                        key.remoteID.map { ($0, key) }
                    }
                )
                let importedKeys = response.keys.map { imported -> StoredAPIKey in
                    guard imported.value.isEmpty, let remoteID = imported.remoteID,
                          let oldKey = oldRemoteKeys[remoteID] else { return imported }
                    var restored = imported
                    restored.value = oldKey.value
                    return restored
                }
                let localOnlyKeys = updatedSecret.apiKeys.filter { $0.remoteID == nil }
                updatedSecret.apiKeys = importedKeys + localOnlyKeys
                try self.vault.save(updatedSecret, for: accountID)
                self.secrets[accountID] = updatedSecret
                self.eventMessage = "已从网站同步 \(importedKeys.count) 个 API Key，远端限额已载入"
            } catch {
                if announce {
                    self.eventMessage = "网站 API Key 同步失败：请检查登录凭据、用户 ID 和网络设置"
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
            eventMessage = "网站限额同步失败：App 中的本机值已保留，请检查凭据后重试"
        }
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

    func openTopUp(for profile: AccountProfile) {
        guard let url = websiteURL(for: profile, path: "/wallet/") else {
            eventMessage = "账号地址无效，无法打开充值页面"
            return
        }
        NSWorkspace.shared.open(url)
        eventMessage = "已打开 \(profile.label) 的充值页面"
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

        guard isLoopRunning else {
            eventMessage = "同步间隔已设为每 \(value) 分钟"
            return
        }

        guard loopProcess?.isRunning == true else {
            eventMessage = "同步间隔已更新；请用 App 启动循环后生效"
            return
        }

        do {
            _ = try writeRuntimeEnvironment()
            eventMessage = "同步间隔已更新为每 \(value) 分钟，将在下一周期生效"
        } catch {
            eventMessage = "同步间隔已保存，但运行配置写入失败：\(error.localizedDescription)"
        }
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
                    self.loopProcess = nil
                    self.ownsLoop = false
                    self.removeRuntimeEnvironment()
                    if !self.stopRequested && process.terminationStatus != 0 {
                        self.phase = .failed
                        self.eventMessage = "自动同步进程已退出（状态 \(process.terminationStatus)），请查看日志"
                    } else if self.stopRequested {
                        self.phase = .idle
                    }
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
            stopRequested = true
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
        refreshProcessState()
        guard !runtimeRefreshInFlight else { return }

        runtimeRefreshInFlight = true
        let rootURL = projectURL
        let previousLogDate = lastLogModificationDate
        let previousSnapshotDate = lastSnapshotModificationDate
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let logResult = Self.readLog(
                at: rootURL.appendingPathComponent("work/sync-loop.log"),
                previousDate: previousLogDate
            )
            let snapshotResult = Self.readSnapshot(
                at: rootURL.appendingPathComponent("docs/data/latest.json"),
                previousDate: previousSnapshotDate
            )

            DispatchQueue.main.async {
                guard let self else { return }
                self.runtimeRefreshInFlight = false
                if let logResult {
                    self.lastLogModificationDate = logResult.modificationDate
                    if logResult.lines != self.logLines { self.logLines = logResult.lines }
                }
                if let snapshotResult {
                    self.lastSnapshotModificationDate = snapshotResult.modificationDate
                    self.snapshot = snapshotResult.snapshot
                }
                self.refreshProcessState()
            }
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
                for (id, secret) in loaded { self.secrets[id] = secret }
                self.secretsLoaded = true
                self.refreshRuntime()
                self.scheduleInitialAPIKeySync()
                if self.settings.autoSync { self.startSync() }
            }
        }
    }

    private func scheduleInitialAPIKeySync() {
        guard !initialAPIKeySyncScheduled else { return }
        initialAPIKeySyncScheduled = true
        let accountIDs = accounts.compactMap { profile -> UUID? in
            guard hasCredentials(for: profile.id), secrets[profile.id]?.apiKeys.isEmpty != false else { return nil }
            return profile.id
        }
        for accountID in accountIDs {
            syncRemoteAPIKeys(for: accountID, announce: false)
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

    private func writeRuntimeEnvironment() throws -> URL {
        let workURL = projectURL.appendingPathComponent("work")
        try FileManager.default.createDirectory(at: workURL, withIntermediateDirectories: true)
        let envURL = workURL.appendingPathComponent("app-sync.env")
        let runtimeAccounts = makeRuntimeAccounts(includeDisabled: false)
        let json = try String(decoding: JSONEncoder().encode(runtimeAccounts), as: UTF8.self)
        var lines = ["export FOROPENCODE_ACCOUNTS_JSON=\(shellQuote(json))"]
        if !settings.proxy.isEmpty { lines.append("export FOROPENCODE_PROXY=\(shellQuote(settings.proxy))") }
        if !settings.sshKeyPath.isEmpty { lines.append("export SYNC_GIT_SSH_KEY_PATH=\(shellQuote(settings.sshKeyPath))") }
        lines.append("export SYNC_INTERVAL_SECONDS=\(max(60, settings.intervalMinutes * 60))")
        try lines.joined(separator: "\n").appending("\n").write(to: envURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: envURL.path)
        return envURL
    }

    private func makeRuntimeAccounts(includeDisabled: Bool) -> [RuntimeAccount] {
        let profiles = includeDisabled ? accounts : enabledAccounts
        return profiles.enumerated().map { index, profile in
            let secret = secrets[profile.id] ?? AccountSecret()
            return RuntimeAccount(
                id: "account-\(index + 1)",
                label: profile.label.isEmpty ? profile.name : profile.label,
                baseUrl: profile.baseURL,
                scope: "self",
                auth: RuntimeAuth(
                    cookie: secret.cookie,
                    // A password login must not be shadowed by an old Bearer token
                    // that may still be present in the Keychain record.
                    authorization: secret.username.isEmpty || secret.password.isEmpty
                        ? secret.authorization
                        : "",
                    userId: profile.userID,
                    username: secret.username,
                    password: secret.password
                )
            )
        }
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
            throw APIKeyCommandError.processFailed
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
                    // Keep command errors out of the event log; the CLI already redacts secrets.
                    _ = error
                    continuation.resume(throwing: APIKeyCommandError.processFailed)
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

    nonisolated private static func readLog(at url: URL, previousDate: Date?) -> LogRefreshResult? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let modificationDate = attributes[.modificationDate] as? Date,
              modificationDate != previousDate,
              let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
            .suffix(90)
            .map(String.init)
        return LogRefreshResult(modificationDate: modificationDate, lines: lines)
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
