import Foundation
import SwiftUI
import WidgetKit

struct IndusUsageWidgetEntry: TimelineEntry {
    let date: Date
    let payload: WidgetSnapshotPayload
}

struct IndusUsageWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> IndusUsageWidgetEntry {
        IndusUsageWidgetEntry(date: Date(), payload: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (IndusUsageWidgetEntry) -> Void) {
        let localPayload = IndusWidgetDataStore.load()
        if let localPayload {
            completion(IndusUsageWidgetEntry(date: Date(), payload: localPayload))
            return
        }

        IndusWidgetDataStore.loadRemote { payload in
            let entry = IndusUsageWidgetEntry(
                date: Date(),
                payload: WidgetSnapshotPayload.newest(
                    local: localPayload,
                    remote: payload
                ) ?? .placeholder
            )
            DispatchQueue.main.async {
                completion(entry)
            }
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<IndusUsageWidgetEntry>) -> Void) {
        let localPayload = IndusWidgetDataStore.load()
        if let localPayload {
            let now = Date()
            let refreshDate = Calendar.current.date(byAdding: .minute, value: 5, to: now)
                ?? now.addingTimeInterval(300)
            completion(Timeline(
                entries: [IndusUsageWidgetEntry(date: now, payload: localPayload)],
                policy: .after(refreshDate)
            ))
            return
        }

        IndusWidgetDataStore.loadRemote { payload in
            let now = Date()
            let entry = IndusUsageWidgetEntry(
                date: now,
                payload: WidgetSnapshotPayload.newest(
                    local: localPayload,
                    remote: payload
                ) ?? .placeholder
            )
            let refreshDate = Calendar.current.date(byAdding: .minute, value: 5, to: now)
                ?? now.addingTimeInterval(300)
            DispatchQueue.main.async {
                completion(Timeline(entries: [entry], policy: .after(refreshDate)))
            }
        }
    }
}

struct IndusUsageWidget: Widget {
    private let kind = "IndusUsageWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: IndusUsageWidgetProvider()) { entry in
            IndusUsageWidgetView(entry: entry)
        }
        .configurationDisplayName("Indus API 用量")
        .description("查看今日、本月累计、余额与账号状态")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

@main
struct IndusUsageWidgetBundle: WidgetBundle {
    var body: some Widget {
        IndusUsageWidget()
    }
}

private enum WidgetPalette {
    static let ink = Color(red: 0.10, green: 0.14, blue: 0.22)
    static let muted = Color(red: 0.39, green: 0.45, blue: 0.54)
    static let blue = Color(red: 0.27, green: 0.49, blue: 0.66)
    static let pink = Color(red: 0.82, green: 0.42, blue: 0.62)
    static let mint = Color(red: 0.24, green: 0.62, blue: 0.52)
    static let paper = Color(red: 0.95, green: 0.97, blue: 0.99)
}

private enum WidgetLayout {
    static let smallInset: CGFloat = 16
    static let mediumInset: CGFloat = 20
    static let largeInset: CGFloat = 26
}

private struct IndusUsageWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: IndusUsageWidgetEntry

    private var content: some View {
        Group {
            switch family {
            case .systemSmall:
                SmallWidgetView(payload: entry.payload)
            case .systemLarge:
                LargeWidgetView(payload: entry.payload)
            default:
                MediumWidgetView(payload: entry.payload)
            }
        }
        .widgetURL(URL(string: "indususage://overview"))
    }

    @ViewBuilder
    var body: some View {
        if #available(macOS 14.0, *) {
            content.containerBackground(for: .widget) {
                WidgetBackground()
            }
        } else {
            content.background(WidgetBackground())
        }
    }
}

private struct WidgetBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [WidgetPalette.paper, Color.white, Color(red: 0.93, green: 0.95, blue: 0.99)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(WidgetPalette.blue.opacity(0.12))
                .frame(width: 150, height: 150)
                .blur(radius: 25)
                .offset(x: 80, y: -70)
            Circle()
                .fill(WidgetPalette.pink.opacity(0.10))
                .frame(width: 130, height: 130)
                .blur(radius: 24)
                .offset(x: -75, y: 75)
        }
    }
}

private struct SmallWidgetView: View {
    let payload: WidgetSnapshotPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            WidgetHeader(status: payload.syncState)

            Text("本月累计")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(WidgetPalette.muted)
            Text(money(payload.monthUsage, digits: 2))
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundStyle(WidgetPalette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.65)

            HStack(spacing: 8) {
                MiniMetric(label: "今日", value: money(payload.todayUsage, digits: 2), tint: WidgetPalette.pink)
                MiniMetric(label: "余额", value: money(payload.totalBalance, digits: 2), tint: WidgetPalette.blue)
            }
            Spacer(minLength: 0)
            Text("更新 \(shortDate(payload.latestDate))")
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .foregroundStyle(WidgetPalette.muted)
                .lineLimit(1)
        }
        .padding(WidgetLayout.smallInset)
    }
}

private struct MediumWidgetView: View {
    let payload: WidgetSnapshotPayload

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                WidgetHeader(status: payload.syncState)
                Text("本月累计")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(WidgetPalette.muted)
                Text(money(payload.monthUsage, digits: 2))
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(WidgetPalette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                Text("\(payload.monthRequests) 次请求 · \(shortDate(payload.latestDate))")
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .foregroundStyle(WidgetPalette.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Rectangle()
                .fill(WidgetPalette.ink.opacity(0.10))
                .frame(width: 1)

            VStack(alignment: .leading, spacing: 9) {
                CompactValue(label: "今日用量", value: money(payload.todayUsage, digits: 2), tint: WidgetPalette.pink)
                CompactValue(label: "总余额", value: money(payload.totalBalance, digits: 2), tint: WidgetPalette.blue)
                CompactValue(label: "gpt_plus", value: ratio(payload.gptPlusRatio), tint: WidgetPalette.mint)
                Text("\(payload.accountCount) 个账号")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(WidgetPalette.muted)
            }
            .frame(width: 112, alignment: .leading)
        }
        .padding(WidgetLayout.mediumInset)
    }
}

private struct LargeWidgetView: View {
    let payload: WidgetSnapshotPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                WidgetHeader(status: payload.syncState, prominent: true)
                Spacer()
                Text(shortDate(payload.latestDate))
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(WidgetPalette.muted)
            }

            HStack(spacing: 11) {
                LargeMetric(label: "本月累计", value: money(payload.monthUsage, digits: 2), detail: "\(payload.monthRequests) 次请求", tint: WidgetPalette.blue)
                LargeMetric(label: "今日用量", value: money(payload.todayUsage, digits: 2), detail: "\(payload.todayRequests) 次请求", tint: WidgetPalette.pink)
                LargeMetric(label: "总余额", value: money(payload.totalBalance, digits: 2), detail: ratio(payload.gptPlusRatio) + " gpt_plus", tint: WidgetPalette.mint)
            }

            Text("账号轨道")
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .tracking(1.5)
                .foregroundStyle(WidgetPalette.muted)

            if payload.accounts.isEmpty {
                Spacer()
                Text("等待 App 完成第一次同步")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(WidgetPalette.muted)
                Spacer()
            } else {
                ForEach(Array(payload.accounts.prefix(3).enumerated()), id: \.offset) { index, account in
                    AccountWidgetRow(account: account, tint: index.isMultiple(of: 2) ? WidgetPalette.blue : WidgetPalette.pink)
                }
                Spacer(minLength: 0)
            }

            Text("Indus Usage Console · 数据由本机同步结果提供")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(WidgetPalette.muted.opacity(0.85))
        }
        // WidgetKit margins are disabled above so the large desktop widget owns
        // one consistent visual inset on all four edges.
        .padding(WidgetLayout.largeInset)
    }
}

private struct WidgetHeader: View {
    let status: String
    var prominent = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: prominent ? 16 : 11, weight: .bold))
                .foregroundStyle(WidgetPalette.blue)
            Text("INDUS API")
                .font(.system(size: prominent ? 14 : 9, weight: .bold, design: .monospaced))
                .tracking(prominent ? 1.4 : 1.1)
                .foregroundStyle(WidgetPalette.ink)
            Spacer(minLength: 0)
            Circle()
                .fill(status == "同步中" ? WidgetPalette.pink : WidgetPalette.mint)
                .frame(width: prominent ? 8 : 6, height: prominent ? 8 : 6)
        }
    }
}

private struct MiniMetric: View {
    let label: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .foregroundStyle(tint)
            Text(value)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(WidgetPalette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CompactValue: View {
    let label: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .foregroundStyle(tint)
            Text(value)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(WidgetPalette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
        }
    }
}

private struct LargeMetric: View {
    let label: String
    let value: String
    let detail: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(tint)
            Text(value)
                .font(.system(size: 25, weight: .bold, design: .rounded))
                .foregroundStyle(WidgetPalette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.54)
            Text(detail)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(WidgetPalette.muted)
                .lineLimit(1)
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.68), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(tint.opacity(0.18), lineWidth: 1))
    }
}

private struct AccountWidgetRow: View {
    let account: WidgetAccountPayload
    let tint: Color

    var body: some View {
        HStack(spacing: 9) {
            Circle()
                .fill(tint)
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 3) {
                Text(account.label)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(WidgetPalette.ink)
                    .lineLimit(1)
                Text("\(money(account.usage, digits: 2)) 已用 · \(percent(account.utilization))")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(WidgetPalette.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(money(account.balance, digits: 2))
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(WidgetPalette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text("余额")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(WidgetPalette.muted)
            }
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 14)
        .background(Color.white.opacity(0.62), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
    }
}

private func money(_ value: Double, digits: Int) -> String {
    String(format: "¥%.*f", digits, value)
}

private func ratio(_ value: Double?) -> String {
    guard let value else { return "—" }
    return String(format: "×%.2f", value)
}

private func percent(_ value: Double) -> String {
    String(format: "%.1f%%", value * 100)
}

private func shortDate(_ value: String?) -> String {
    guard let value else { return "等待数据" }
    let parts = value.split(separator: "-")
    guard parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]) else { return value }
    return "\(month)月\(day)日"
}
