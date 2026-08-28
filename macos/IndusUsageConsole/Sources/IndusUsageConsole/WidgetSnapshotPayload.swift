import Foundation

struct WidgetAccountPayload: Codable {
    let label: String
    let balance: Double
    let usage: Double
    let requests: Int
    let utilization: Double
    let gptPlusRatio: Double?
}

struct WidgetSnapshotPayload: Codable {
    let generatedAt: String?
    let latestDate: String?
    let todayUsage: Double
    let todayRequests: Int
    let monthUsage: Double
    let monthRequests: Int
    let totalBalance: Double
    let gptPlusRatio: Double?
    let accountCount: Int
    let syncState: String
    let accounts: [WidgetAccountPayload]

    static let placeholder = WidgetSnapshotPayload(
        generatedAt: nil,
        latestDate: nil,
        todayUsage: 0,
        todayRequests: 0,
        monthUsage: 0,
        monthRequests: 0,
        totalBalance: 0,
        gptPlusRatio: nil,
        accountCount: 0,
        syncState: "等待同步",
        accounts: []
    )

    static func newest(
        local: WidgetSnapshotPayload?,
        remote: WidgetSnapshotPayload?
    ) -> WidgetSnapshotPayload? {
        switch (local, remote) {
        case let (local?, remote?):
            guard let localDate = freshnessDate(local) else { return remote }
            guard let remoteDate = freshnessDate(remote) else { return local }
            return localDate >= remoteDate ? local : remote
        case let (local?, nil):
            return local
        case let (nil, remote?):
            return remote
        case (nil, nil):
            return nil
        }
    }

    private static func freshnessDate(_ payload: WidgetSnapshotPayload) -> Date? {
        if let generatedAt = payload.generatedAt {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: generatedAt) {
                return date
            }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: generatedAt) {
                return date
            }
        }

        guard let latestDate = payload.latestDate else { return nil }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: latestDate)
    }
}

enum IndusWidgetDataStore {
    private static let widgetBundleIdentifier = "com.indus-apiusage.console.widget"
    static let remoteURL = URL(string: "https://indus-apiusage.github.io/data/widget.json")!

    static var candidateURLs: [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        let globalURL = home
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("IndusUsageConsole", isDirectory: true)
            .appendingPathComponent("widget.json")
        let widgetContainerURL = home
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Containers", isDirectory: true)
            .appendingPathComponent(widgetBundleIdentifier, isDirectory: true)
            .appendingPathComponent("Data", isDirectory: true)
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("IndusUsageConsole", isDirectory: true)
            .appendingPathComponent("widget.json")
        let bundledURL = Bundle.main.url(forResource: "widget", withExtension: "json")

        let urls = [
            applicationSupport
                .appendingPathComponent("IndusUsageConsole", isDirectory: true)
                .appendingPathComponent("widget.json"),
            widgetContainerURL,
            globalURL,
            bundledURL,
        ].compactMap { $0 }

        return urls.reduce(into: [URL]()) { result, url in
            if !result.contains(url) {
                result.append(url)
            }
        }
    }

    static func load() -> WidgetSnapshotPayload? {
        for url in candidateURLs {
            guard let data = try? Data(contentsOf: url),
                  let payload = try? JSONDecoder().decode(WidgetSnapshotPayload.self, from: data) else {
                continue
            }
            return payload
        }
        return nil
    }

    static func loadRemote(completion: @escaping (WidgetSnapshotPayload?) -> Void) {
        var components = URLComponents(url: remoteURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(
                name: "refresh",
                value: String(Int(Date().timeIntervalSince1970 * 1000))
            )
        ]
        var request = URLRequest(url: components.url!)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")

        URLSession.shared.dataTask(with: request) { data, response, _ in
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode),
                  let data,
                  let payload = try? JSONDecoder().decode(WidgetSnapshotPayload.self, from: data) else {
                completion(nil)
                return
            }
            completion(payload)
        }.resume()
    }
}
