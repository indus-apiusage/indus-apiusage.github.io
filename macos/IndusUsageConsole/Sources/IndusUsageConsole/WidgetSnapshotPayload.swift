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
}

enum IndusWidgetDataStore {
    static let remoteURL = URL(string: "https://indus-apiusage.github.io/data/widget.json")!

    static var candidateURLs: [URL] {
        let applicationSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        return [
            applicationSupport
                .appendingPathComponent("IndusUsageConsole", isDirectory: true)
                .appendingPathComponent("widget.json"),
        ]
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
        var request = URLRequest(url: remoteURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

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
