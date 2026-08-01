import AppKit
import SwiftUI

private enum ConsolePalette {
    static let ink = Color(hex: 0x1B2437)
    static let muted = Color(hex: 0x65738A)
    static let soft = Color(hex: 0x8B99AD)
    static let line = Color(hex: 0xD7E0EC)
    static let canvas = Color(hex: 0xF3F6FB)
    static let cyan = Color(hex: 0x4BA9D8)
    static let blue = Color(hex: 0x6B83ED)
    static let pink = Color(hex: 0xE58AAF)
    static let mint = Color(hex: 0x4DAF8A)
}

struct ConsoleRootView: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        ZStack {
            LiquidBackdrop()
            HStack(spacing: 0) {
                SidebarView(model: model)
                Rectangle()
                    .fill(ConsolePalette.line.opacity(0.9))
                    .frame(width: 1)
                VStack(spacing: 0) {
                    TopBar(model: model)
                    ScrollViewReader { proxy in
                        ScrollView(.vertical, showsIndicators: false) {
                            Group {
                                switch model.section {
                                case .overview: OverviewView(model: model)
                                case .accounts: AccountsView(model: model)
                                case .sync: SyncCenterView(model: model)
                                case .settings: SettingsView(model: model)
                                }
                            }
                            .id("console-content-top")
                            .padding(.horizontal, 32)
                            .padding(.bottom, 36)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .onAppear {
                            DispatchQueue.main.async {
                                proxy.scrollTo("console-content-top", anchor: .top)
                            }
                        }
                        .onChange(of: model.section) { _ in
                            withAnimation(.easeOut(duration: 0.2)) {
                                proxy.scrollTo("console-content-top", anchor: .top)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .frame(minWidth: 1160, minHeight: 760)
        .sheet(item: $model.editingDraft) { draft in
            AccountEditorView(draft: draft) { updated in
                model.save(updated)
            }
        }
    }
}

struct SidebarView: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            BrandLockup()
                .padding(.horizontal, 22)
                .padding(.top, 26)
                .padding(.bottom, 32)

            Text("CONTROL DECK")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(2.4)
                .foregroundStyle(ConsolePalette.muted)
                .padding(.horizontal, 24)
                .padding(.bottom, 12)

            VStack(spacing: 7) {
                ForEach(ConsoleSection.allCases) { item in
                    SidebarButton(item: item, selected: model.section == item) {
                        withAnimation(.easeOut(duration: 0.2)) { model.section = item }
                    }
                }
            }
            .padding(.horizontal, 14)

            Spacer()

            SidebarSyncBadge(model: model)
                .padding(16)

            HStack(spacing: 8) {
                Circle()
                    .fill(Color(hex: 0x79E4B1))
                    .frame(width: 7, height: 7)
                    .shadow(color: Color(hex: 0x79E4B1).opacity(0.8), radius: 8)
                Text("LOCAL CONSOLE")
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .tracking(1.3)
                    .foregroundStyle(ConsolePalette.muted)
                Spacer()
                Text("v1.0")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(ConsolePalette.soft)
            }
            .padding(.horizontal, 23)
            .padding(.bottom, 22)
        }
        .frame(width: 244)
        .background(Color.white.opacity(0.72))
    }
}

struct BrandLockup: View {
    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: 0x81D9FF), Color(hex: 0x5F7BFF), Color(hex: 0xF58DB8)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Circle()
                    .stroke(Color.white.opacity(0.78), lineWidth: 1)
                    .frame(width: 21, height: 21)
                Capsule()
                    .fill(Color.white.opacity(0.9))
                    .frame(width: 2, height: 14)
                    .rotationEffect(.degrees(45))
            }
            .frame(width: 42, height: 42)
            .shadow(color: Color(hex: 0x73D4FF).opacity(0.35), radius: 18)

            VStack(alignment: .leading, spacing: 3) {
                Text("INDUS")
                    .font(.system(size: 17, weight: .black, design: .rounded))
                    .tracking(2.8)
                    .foregroundStyle(ConsolePalette.ink)
                Text("API USAGE CONSOLE")
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .tracking(1.2)
                    .foregroundStyle(ConsolePalette.muted)
            }
        }
    }
}

struct SidebarButton: View {
    let item: ConsoleSection
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: item.icon)
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.system(size: 13, weight: selected ? .bold : .medium, design: .rounded))
                    Text(item.subtitle)
                        .font(.system(size: 8, weight: .medium, design: .monospaced))
                        .tracking(1.1)
                        .opacity(selected ? 0.52 : 0.24)
                }
                Spacer()
                if selected {
                    Circle()
                        .fill(Color(hex: 0x73D4FF))
                        .frame(width: 5, height: 5)
                        .shadow(color: Color(hex: 0x73D4FF), radius: 7)
                }
            }
            .foregroundStyle(selected ? ConsolePalette.ink : ConsolePalette.muted)
            .padding(.horizontal, 13)
            .padding(.vertical, 12)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [Color.white.opacity(0.86), ConsolePalette.blue.opacity(0.12)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .overlay {
                            RoundedRectangle(cornerRadius: 15, style: .continuous)
                                .stroke(ConsolePalette.cyan.opacity(0.26), lineWidth: 1)
                        }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct SidebarSyncBadge: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Text("SYNC ENGINE")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .tracking(1.5)
                    .foregroundStyle(ConsolePalette.muted)
                Spacer()
                Circle()
                    .fill(model.phase.color)
                    .frame(width: 7, height: 7)
                    .shadow(color: model.phase.color, radius: 7)
            }
            Text(model.phase.title)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(ConsolePalette.ink)
            Text(model.eventMessage)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(ConsolePalette.muted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.white.opacity(0.72))
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(ConsolePalette.line, lineWidth: 1)
                }
        }
    }
}

struct TopBar: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        HStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 3) {
                Text(model.section.subtitle)
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .tracking(2.1)
                    .foregroundStyle(ConsolePalette.cyan)
                Text(model.section.title)
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(ConsolePalette.ink)
            }
            Spacer()
            Text(Date.now.formatted(.dateTime.year().month(.twoDigits).day(.twoDigits)))
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(ConsolePalette.muted)
            Button {
                model.refreshRuntime()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ConsolePalette.ink.opacity(0.75))
                    .frame(width: 34, height: 34)
                    .background(Color.white.opacity(0.82), in: Circle())
            }
            .buttonStyle(.plain)
            .help("刷新状态")
            PhasePill(phase: model.phase)
        }
        .padding(.horizontal, 32)
        .padding(.top, 25)
        .padding(.bottom, 22)
    }
}

struct PhasePill: View {
    let phase: SyncPhase

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(phase.color)
                .frame(width: 6, height: 6)
            Text(phase.title.uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(1.2)
        }
        .foregroundStyle(phase.color)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(phase.color.opacity(0.1), in: Capsule())
        .overlay(Capsule().stroke(phase.color.opacity(0.24), lineWidth: 1))
    }
}

struct OverviewView: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HeroPanel(model: model)
            MetricsStrip(model: model)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .bottom, spacing: 18) {
                    AccountMatrixPanel(model: model)
                        .frame(minWidth: 430, maxWidth: .infinity, alignment: .leading)
                    SyncControlPanel(model: model)
                        .frame(width: 330, alignment: .leading)
                }
                VStack(spacing: 18) {
                    AccountMatrixPanel(model: model)
                    SyncControlPanel(model: model)
                }
            }
            EventLogPanel(model: model)
        }
    }
}

struct HeroPanel: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        GlassCard {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 20) {
                    HeroCopy(model: model)
                    Spacer(minLength: 10)
                    HeroOrbitalDisplay(phase: model.phase)
                        .frame(width: 260, height: 220)
                }
                VStack(alignment: .leading, spacing: 15) {
                    HeroCopy(model: model)
                    HeroOrbitalDisplay(phase: model.phase)
                        .frame(maxWidth: .infinity)
                        .frame(height: 180)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 300, alignment: .leading)
    }
}

struct HeroCopy: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        VStack(alignment: .leading, spacing: 17) {
            HStack(spacing: 10) {
                Text("LIVE TELEMETRY")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .tracking(2)
                    .foregroundStyle(Color(hex: 0x73D4FF))
                Capsule()
                    .fill(Color(hex: 0x73D4FF).opacity(0.4))
                    .frame(width: 35, height: 1)
            }
            Text("SYNC\nTHE SIGNAL.")
                .font(.system(size: 52, weight: .black, design: .rounded))
                .tracking(-1.8)
                .foregroundStyle(
                    LinearGradient(
                        colors: [ConsolePalette.ink, ConsolePalette.muted.opacity(0.72)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .lineSpacing(-5)
            Text("一个控制台，管理所有 ForOpenCode 账号的认证、同步与发布节奏。凭据进入 Keychain，数据沿现有流水线安全落地。")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(ConsolePalette.muted)
                .lineSpacing(5)
                .frame(maxWidth: 520, alignment: .leading)
            HStack(spacing: 9) {
                SignalChip(icon: "person.2.fill", value: "\(model.enabledAccounts.count)", label: "启用账号")
                SignalChip(icon: "timer", value: "\(model.settings.intervalMinutes)m", label: "周期")
                SignalChip(icon: "lock.shield.fill", value: "Keychain", label: "凭据")
            }
        }
        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
    }
}

struct HeroOrbitalDisplay: View {
    let phase: SyncPhase

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [phase.color.opacity(0.24), Color.clear],
                        center: .center,
                        startRadius: 5,
                        endRadius: 120
                    )
                )
                .blur(radius: 10)
            ForEach(0..<3, id: \.self) { index in
                RoundedRectangle(cornerRadius: 999)
                    .stroke(
                        LinearGradient(
                            colors: [ConsolePalette.ink.opacity(0.18), phase.color.opacity(0.65), ConsolePalette.ink.opacity(0.05)],
                            startPoint: .leading,
                            endPoint: .trailing
                        ),
                        lineWidth: index == 0 ? 1.2 : 0.7
                    )
                    .frame(width: 150 + CGFloat(index) * 33, height: 72 + CGFloat(index) * 26)
                    .rotationEffect(.degrees(Double(index) * 32))
            }
            Circle()
                .fill(
                    RadialGradient(
                        colors: [.white, phase.color, phase.color.opacity(0.05)],
                        center: .topLeading,
                        startRadius: 2,
                        endRadius: 65
                    )
                )
                .frame(width: 58, height: 58)
                .blur(radius: 0.2)
                .shadow(color: phase.color.opacity(0.8), radius: 25)
            Circle()
                .stroke(ConsolePalette.ink.opacity(0.35), lineWidth: 1)
                .frame(width: 17, height: 17)
            Text("01")
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .tracking(1)
                .foregroundStyle(ConsolePalette.muted)
                .offset(y: 48)
        }
    }
}

struct SignalChip: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color(hex: 0x73D4FF))
            Text(value)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(ConsolePalette.ink)
            Text(label)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(ConsolePalette.muted)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.72), in: Capsule())
        .overlay(Capsule().stroke(ConsolePalette.line, lineWidth: 1))
    }
}

struct MetricsStrip: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        // Keep all four summary tiles on the same grid tracks. An adaptive grid
        // can create extra narrow tracks when a card asks for an infinite width.
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(minimum: 0), spacing: 12), count: 4),
            spacing: 12
        ) {
            MetricTile(icon: "person.2.crop.square.stack.fill", eyebrow: "IDENTITIES", value: "\(model.accounts.count)", caption: "已配置账号")
            MetricTile(icon: "checkmark.seal.fill", eyebrow: "READY", value: "\(model.enabledAccounts.filter { model.hasCredentials(for: $0.id) }.count)", caption: "凭据就绪")
            MetricTile(icon: "chart.line.uptrend.xyaxis", eyebrow: "REQUESTS", value: model.snapshot.map { compactNumber($0.summary?.totalRequests ?? 0) } ?? "—", caption: "已记录请求")
            MetricTile(icon: "creditcard.fill", eyebrow: "BALANCE", value: model.snapshot.map { String(format: "¥%.2f", $0.accounts.reduce(0) { $0 + $1.remainingPrimaryBalance }) } ?? "—", caption: "可用余额")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct MetricTile: View {
    let icon: String
    let eyebrow: String
    let value: String
    let caption: String

    var body: some View {
        GlassCard(padding: 16) {
            HStack(alignment: .top) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color(hex: 0x73D4FF))
                    .frame(width: 28, height: 28)
                    .background(Color(hex: 0x73D4FF).opacity(0.11), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                Spacer()
                Text(eyebrow)
                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                    .tracking(1.4)
                    .foregroundStyle(ConsolePalette.muted)
            }
            Text(value)
                .font(.system(size: 25, weight: .bold, design: .rounded))
                .foregroundStyle(ConsolePalette.ink)
                .padding(.top, 13)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Text(caption)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(ConsolePalette.muted)
        }
        .frame(maxWidth: .infinity, minHeight: 112, alignment: .leading)
    }
}

struct AccountMatrixPanel: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        GlassCard(minHeight: 450) {
            PanelHeader(eyebrow: "ACCOUNT MATRIX", title: "账号轨道", detail: "选择哪些身份进入本轮同步") {
                Button {
                    model.openNewAccount()
                } label: {
                    Label("添加账号", systemImage: "plus")
                }
                .buttonStyle(GlassButtonStyle(tint: Color(hex: 0x73D4FF)))
            }
            if model.accounts.isEmpty {
                EmptyAccountState { model.openNewAccount() }
                    .frame(maxWidth: .infinity, minHeight: 270, alignment: .center)
            } else {
                VStack(spacing: 10) {
                    ForEach(Array(model.accounts.enumerated()), id: \.element.id) { index, profile in
                        AccountRow(model: model, profile: profile, index: index)
                    }
                }
                .padding(.top, 16)
            }
        }
    }
}

struct AccountRow: View {
    @ObservedObject var model: ConsoleModel
    let profile: AccountProfile
    let index: Int

    private var accent: Color {
        [Color(hex: 0x73D4FF), Color(hex: 0xF28CB6), Color(hex: 0xA997FF), Color(hex: 0x79E4B1)][profile.colorIndex % 4]
    }

    var body: some View {
        HStack(spacing: 13) {
            ZStack {
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(accent.opacity(0.14))
                Text(String(profile.label.prefix(1)).uppercased())
                    .font(.system(size: 15, weight: .black, design: .rounded))
                    .foregroundStyle(accent)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(profile.label.isEmpty ? profile.name : profile.label)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(ConsolePalette.ink)
                    if profile.enabled {
                        Text("LIVE")
                            .font(.system(size: 7, weight: .bold, design: .monospaced))
                            .tracking(1)
                            .foregroundStyle(Color(hex: 0x79E4B1))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(Color(hex: 0x79E4B1).opacity(0.1), in: Capsule())
                    }
                }
                Text(profile.userID.isEmpty ? "未设置 new-api-user" : "USER \(profile.userID) · \(shortHost(profile.baseURL))")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(ConsolePalette.muted)
                if let balance = model.balance(for: index) {
                    Text("余额 \(balance.balanceText) · 使用率 \(String(format: "%.1f%%", balance.utilizationRate * 100))")
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundStyle(accent.opacity(0.8))
                }
            }
            Spacer()
            Circle()
                .fill(model.hasCredentials(for: profile.id) ? Color(hex: 0x79E4B1) : Color(hex: 0xFF8FA9))
                .frame(width: 7, height: 7)
                .shadow(color: model.hasCredentials(for: profile.id) ? Color(hex: 0x79E4B1) : Color(hex: 0xFF8FA9), radius: 7)
            Toggle("", isOn: Binding(
                get: { profile.enabled },
                set: { model.setEnabled($0, for: profile.id) }
            ))
            .labelsHidden()
            .toggleStyle(.switch)
            .scaleEffect(0.78)
            Button { model.edit(profile) } label: {
                Image(systemName: "slider.horizontal.2.square")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ConsolePalette.muted)
            }
            .buttonStyle(.plain)
            .help("编辑账号")
        }
        .padding(12)
        .background(Color.white.opacity(profile.enabled ? 0.78 : 0.52), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 17, style: .continuous).stroke(ConsolePalette.line, lineWidth: 1))
    }
}

struct EmptyAccountState: View {
    let action: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.badge.plus")
                .font(.system(size: 27, weight: .light))
                .foregroundStyle(Color(hex: 0x73D4FF))
            Text("还没有接入身份")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(ConsolePalette.ink)
            Text("添加第一个账号，把认证交给 Keychain 管理。")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(ConsolePalette.muted)
            Button("添加第一个账号", action: action)
                .buttonStyle(GlassButtonStyle(tint: Color(hex: 0x73D4FF)))
                .padding(.top, 3)
        }
        .frame(maxWidth: .infinity)
    }
}

struct SyncControlPanel: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        GlassCard(minHeight: 450) {
            PanelHeader(eyebrow: "SYNC CORE", title: "同步引擎", detail: "App 控制本地循环")
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(model.settings.autoSync ? "自动同步已开启" : "自动同步已关闭")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(ConsolePalette.ink)
                        Text("每 \(model.settings.intervalMinutes) 分钟刷新一次")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(ConsolePalette.muted)
                    }
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { model.settings.autoSync },
                        set: { model.setAutoSync($0) }
                    ))
                    .labelsHidden()
                    .toggleStyle(.switch)
                }
                SyncOrb(phase: model.phase)
                    .frame(maxWidth: .infinity)
                    .frame(height: 112)
                HStack(spacing: 9) {
                    Button {
                        model.runOnce()
                    } label: {
                        Label("立即同步", systemImage: "bolt.fill")
                    }
                    .buttonStyle(GlassButtonStyle(tint: Color(hex: 0xF28CB6), filled: true))
                    Button {
                        model.section = .sync
                    } label: {
                        Image(systemName: "terminal.fill")
                    }
                    .buttonStyle(GlassButtonStyle(tint: ConsolePalette.muted))
                    .help("查看日志")
                }
            }
            .padding(.top, 17)
        }
    }
}

struct SyncOrb: View {
    let phase: SyncPhase

    var body: some View {
        ZStack {
            Circle()
                .fill(phase.color.opacity(0.12))
                .blur(radius: 20)
            ForEach(0..<2, id: \.self) { index in
                Circle()
                    .stroke(phase.color.opacity(0.18 - Double(index) * 0.05), lineWidth: 1)
                    .frame(width: 54 + CGFloat(index) * 27, height: 54 + CGFloat(index) * 27)
            }
            Image(systemName: phase == .running ? "arrow.triangle.2.circlepath" : "waveform.path")
                .font(.system(size: 23, weight: .light))
                .foregroundStyle(phase.color)
                .shadow(color: phase.color, radius: 13)
        }
    }
}

struct EventLogPanel: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        GlassCard {
            PanelHeader(eyebrow: "EVENT STREAM", title: "运行轨迹", detail: "最近 90 条同步事件") {
                Button {
                    model.section = .sync
                } label: {
                    Text("打开完整日志")
                }
                .buttonStyle(GlassButtonStyle(tint: ConsolePalette.muted))
            }
            LogView(lines: model.logLines, compact: true)
                .padding(.top, 15)
        }
    }
}

struct AccountsView: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            GlassCard {
                PanelHeader(eyebrow: "IDENTITY VAULT", title: "账号矩阵", detail: "账号凭据保存在 macOS Keychain，工作区只保留非敏感元数据") {
                    Button {
                        model.openNewAccount()
                    } label: {
                        Label("添加账号", systemImage: "plus")
                    }
                    .buttonStyle(GlassButtonStyle(tint: Color(hex: 0x73D4FF)))
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 290), spacing: 13)], spacing: 13) {
                    ForEach(Array(model.accounts.enumerated()), id: \.element.id) { index, profile in
                        AccountDetailCard(model: model, profile: profile, index: index)
                    }
                }
                .padding(.top, 17)
            }
            GlassCard {
                Text("安全说明")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(ConsolePalette.ink)
                Text("App 不会把 Bearer Token、Cookie 或密码写入 Git。同步时仅在本机 work 目录生成权限为 600 的临时环境文件，并由现有 Node 同步脚本读取。")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(ConsolePalette.muted)
                    .lineSpacing(5)
                    .padding(.top, 8)
            }
        }
    }
}

struct AccountDetailCard: View {
    @ObservedObject var model: ConsoleModel
    let profile: AccountProfile
    let index: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Circle()
                    .fill(Color(hex: profile.colorIndex % 2 == 0 ? 0x73D4FF : 0xF28CB6).opacity(0.8))
                    .frame(width: 10, height: 10)
                Text(profile.label.isEmpty ? profile.name : profile.label)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(ConsolePalette.ink)
                Spacer()
                Button { model.edit(profile) } label: {
                    Image(systemName: "ellipsis")
                        .foregroundStyle(ConsolePalette.muted)
                }
                .buttonStyle(.plain)
            }
            HStack(alignment: .lastTextBaseline) {
                Text(model.balance(for: index)?.balanceText ?? "—")
                    .font(.system(size: 31, weight: .bold, design: .rounded))
                    .foregroundStyle(ConsolePalette.ink)
                    .minimumScaleFactor(0.7)
                Text("余额")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(ConsolePalette.muted)
            }
            Divider().overlay(ConsolePalette.line)
            HStack {
                MetadataValue(title: "USER ID", value: profile.userID.isEmpty ? "—" : profile.userID)
                Spacer()
                MetadataValue(title: "AUTH", value: model.hasCredentials(for: profile.id) ? "KEYCHAIN" : "MISSING")
            }
            Toggle("参与自动同步", isOn: Binding(
                get: { profile.enabled },
                set: { model.setEnabled($0, for: profile.id) }
            ))
            .toggleStyle(.switch)
            .font(.system(size: 11, weight: .medium, design: .rounded))
            .foregroundStyle(ConsolePalette.muted)
        }
        .padding(17)
        .background(Color.white.opacity(0.74), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(ConsolePalette.line, lineWidth: 1))
    }
}

struct MetadataValue: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .tracking(1.2)
                .foregroundStyle(ConsolePalette.soft)
            Text(value)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ConsolePalette.ink.opacity(0.78))
        }
    }
}

struct SyncCenterView: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 18) {
                    SyncStatusCard(model: model)
                        .frame(minWidth: 500, maxWidth: .infinity, alignment: .leading)
                    RuntimePanel(model: model)
                        .frame(width: 300, alignment: .leading)
                }
                VStack(spacing: 18) {
                    SyncStatusCard(model: model)
                    RuntimePanel(model: model)
                }
            }
            GlassCard {
                PanelHeader(eyebrow: "RAW EVENT STREAM", title: "同步日志", detail: "自动滚动到最新事件")
                LogView(lines: model.logLines)
                    .padding(.top, 15)
            }
        }
    }
}

struct SyncStatusCard: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        GlassCard {
            PanelHeader(eyebrow: "CONTROL LOOP", title: "同步中枢", detail: "通过 App 调度现有五分钟循环")
            HStack(spacing: 18) {
                SyncOrb(phase: model.phase)
                    .frame(width: 120, height: 120)
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.phase.title)
                        .font(.system(size: 29, weight: .bold, design: .rounded))
                        .foregroundStyle(model.phase.color)
                        .minimumScaleFactor(0.7)
                    Text(model.eventMessage)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(ConsolePalette.muted)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        Button("立即同步") { model.runOnce() }
                            .buttonStyle(GlassButtonStyle(tint: Color(hex: 0xF28CB6), filled: true))
                        Button(model.settings.autoSync ? "暂停" : "启动") {
                            model.setAutoSync(!model.settings.autoSync)
                        }
                        .buttonStyle(GlassButtonStyle(tint: Color(hex: 0x73D4FF)))
                    }
                    .padding(.top, 5)
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            }
            .padding(.top, 18)
        }
    }
}

struct RuntimePanel: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        GlassCard {
            PanelHeader(eyebrow: "RUNTIME", title: "运行参数", detail: "当前进程")
            VStack(alignment: .leading, spacing: 14) {
                RuntimeLine(title: "周期", value: "每 \(model.settings.intervalMinutes) 分钟")
                RuntimeLine(title: "启用账号", value: "\(model.enabledAccounts.count) 个")
                RuntimeLine(title: "项目", value: shortPath(model.settings.projectPath))
                RuntimeLine(title: "PID", value: model.existingLoopPID.map(String.init) ?? "未运行")
            }
            .padding(.top, 18)
        }
    }
}

struct RuntimeLine: View {
    let title: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(ConsolePalette.muted)
            Spacer()
            Text(value)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(ConsolePalette.ink.opacity(0.78))
                .lineLimit(2)
                .multilineTextAlignment(.trailing)
                .minimumScaleFactor(0.7)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct SettingsView: View {
    @ObservedObject var model: ConsoleModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            GlassCard {
                PanelHeader(eyebrow: "SYSTEM CALIBRATION", title: "控制设置", detail: "同步脚本、网络和 Git 参数")
                VStack(alignment: .leading, spacing: 16) {
                    SettingRow(title: "项目目录", detail: "包含 scripts/run-local-sync-loop.sh 的仓库") {
                        HStack {
                            Text(model.settings.projectPath)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(ConsolePalette.muted)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer()
                            Button("选择") { model.chooseProject() }
                                .buttonStyle(GlassButtonStyle(tint: Color(hex: 0x73D4FF)))
                        }
                    }
                    SettingRow(title: "自动同步", detail: "开启后 App 会启动现有五分钟循环") {
                        Toggle("", isOn: Binding(
                            get: { model.settings.autoSync },
                            set: { model.setAutoSync($0) }
                        ))
                        .labelsHidden()
                        .toggleStyle(.switch)
                    }
                    SettingRow(title: "同步间隔", detail: "当前脚本固定为 5 分钟；此项用于界面显示与后续扩展") {
                        Stepper("\(model.settings.intervalMinutes) 分钟", value: Binding(
                            get: { model.settings.intervalMinutes },
                            set: { model.settings.intervalMinutes = $0; model.persistState() }
                        ), in: 1...60)
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                    }
                    SettingRow(title: "网络代理", detail: "例如 http://127.0.0.1:7897，留空使用系统环境") {
                        TextField("可选代理地址", text: Binding(
                            get: { model.settings.proxy },
                            set: { model.settings.proxy = $0; model.persistState() }
                        ))
                        .textFieldStyle(.plain)
                        .padding(10)
                        .background(Color.white.opacity(0.78), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .frame(maxWidth: 330)
                    }
                    SettingRow(title: "Git SSH 私钥", detail: "用于自动 push；不会写入凭据 JSON") {
                        HStack {
                            Text(model.settings.sshKeyPath.isEmpty ? "未指定" : shortPath(model.settings.sshKeyPath))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(ConsolePalette.muted)
                                .lineLimit(1)
                            Spacer()
                            Button("选择") { model.chooseSSHKey() }
                                .buttonStyle(GlassButtonStyle(tint: Color(hex: 0x73D4FF)))
                        }
                    }
                }
                .padding(.top, 19)
            }
            GlassCard {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "lock.shield.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(Color(hex: 0x79E4B1))
                    VStack(alignment: .leading, spacing: 6) {
                        Text("凭据保护")
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(ConsolePalette.ink)
                        Text("Bearer Token、Cookie、用户名和密码只保存到 macOS Keychain。生成运行环境时使用 600 权限，停止同步后会删除临时文件。")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(ConsolePalette.muted)
                            .lineSpacing(5)
                    }
                }
            }
        }
    }
}

struct SettingRow<Content: View>: View {
    let title: String
    let detail: String
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .center, spacing: 20) {
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(ConsolePalette.ink)
                Text(detail)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(ConsolePalette.muted)
            }
            Spacer()
            content
        }
        .padding(.vertical, 5)
    }
}

struct AccountEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: AccountDraft
    let onSave: (AccountDraft) -> Void

    init(draft: AccountDraft, onSave: @escaping (AccountDraft) -> Void) {
        _draft = State(initialValue: draft)
        self.onSave = onSave
    }

    var body: some View {
        ZStack {
            ConsolePalette.canvas.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(draft.profile.name == "新账号" ? "接入新身份" : "编辑身份")
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundStyle(ConsolePalette.ink)
                        Text("CREDENTIAL INTAKE")
                            .font(.system(size: 9, weight: .bold, design: .monospaced))
                            .tracking(2)
                            .foregroundStyle(Color(hex: 0x73D4FF))
                    }
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .foregroundStyle(ConsolePalette.muted)
                            .frame(width: 30, height: 30)
                            .background(Color.white.opacity(0.84), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 24)

                ScrollView {
                    VStack(alignment: .leading, spacing: 17) {
                        EditorField(title: "显示名称", hint: "例如：主账号 / Junhao") {
                            TextField("账号名称", text: $draft.profile.label)
                                .editorTextField()
                        }
                        HStack(spacing: 14) {
                            EditorField(title: "USER ID", hint: "请求头 new-api-user") {
                                TextField("例如 1479", text: $draft.profile.userID)
                                    .editorTextField()
                            }
                            EditorField(title: "BASE URL", hint: "通常无需修改") {
                                TextField("https://www.foropencode.com", text: $draft.profile.baseURL)
                                    .editorTextField()
                            }
                        }
                        EditorField(title: "AUTHORIZATION", hint: "可粘贴完整 Bearer 或只粘贴 Token") {
                            SecureField("Bearer Token", text: $draft.secret.authorization)
                                .editorTextField()
                        }
                        EditorField(title: "COOKIE", hint: "从浏览器请求头复制 cookie 全字段") {
                            ZStack(alignment: .topLeading) {
                                TextEditor(text: $draft.secret.cookie)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(ConsolePalette.ink.opacity(0.78))
                                    .scrollContentBackground(.hidden)
                                    .padding(8)
                                if draft.secret.cookie.isEmpty {
                                    Text("session=...; ph_phc_...")
                                        .font(.system(size: 11, design: .monospaced))
                                        .foregroundStyle(ConsolePalette.soft)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 13)
                                        .allowsHitTesting(false)
                                }
                            }
                            .frame(height: 92)
                            .background(Color.white.opacity(0.78), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(ConsolePalette.line, lineWidth: 1))
                        }
                        HStack(spacing: 14) {
                            EditorField(title: "USERNAME", hint: "可选：让脚本登录") {
                                TextField("可选", text: $draft.secret.username)
                                    .editorTextField()
                            }
                            EditorField(title: "PASSWORD", hint: "可选，保存到 Keychain") {
                                SecureField("可选", text: $draft.secret.password)
                                    .editorTextField()
                            }
                        }
                        HStack {
                            Toggle("默认参与自动同步", isOn: $draft.profile.enabled)
                                .toggleStyle(.switch)
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(ConsolePalette.muted)
                            Spacer()
                            Text("凭据只会进入 macOS Keychain")
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(Color(hex: 0x79E4B1).opacity(0.72))
                        }
                    }
                }
                .scrollIndicators(.hidden)

                HStack {
                    Spacer()
                    Button("取消") { dismiss() }
                        .buttonStyle(GlassButtonStyle(tint: ConsolePalette.muted))
                    Button("保存并接入") {
                        onSave(draft)
                        dismiss()
                    }
                    .buttonStyle(GlassButtonStyle(tint: Color(hex: 0x73D4FF), filled: true))
                    .disabled(draft.profile.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.top, 22)
            }
            .padding(28)
        }
        .frame(width: 670, height: 620)
    }
}

struct EditorField<Content: View>: View {
    let title: String
    let hint: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .tracking(1.4)
                    .foregroundStyle(ConsolePalette.muted)
                Spacer()
                Text(hint)
                    .font(.system(size: 9, weight: .medium, design: .rounded))
                    .foregroundStyle(ConsolePalette.soft)
                    .lineLimit(1)
            }
            content
        }
        .frame(maxWidth: .infinity)
    }
}

struct LogView: View {
    let lines: [String]
    var compact = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 3) {
                    if lines.isEmpty {
                        Text("等待同步事件……")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(ConsolePalette.muted)
                            .padding(.vertical, 20)
                    } else {
                        ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                            Text(line)
                                .font(.system(size: compact ? 9 : 10, weight: .regular, design: .monospaced))
                                .foregroundStyle(logColor(for: line))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    Color.clear.frame(height: 1).id("tail")
                }
                .padding(14)
            }
            .frame(maxWidth: .infinity, minHeight: compact ? 116 : 310, maxHeight: compact ? 150 : 400)
            .background(Color.white.opacity(0.78), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(ConsolePalette.line, lineWidth: 1))
            .onChange(of: lines.count) { _ in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("tail", anchor: .bottom) }
            }
        }
    }

    private func logColor(for line: String) -> Color {
        if line.localizedCaseInsensitiveContains("failed") || line.localizedCaseInsensitiveContains("unauthorized") {
            return Color(hex: 0xFF8FA9).opacity(0.9)
        }
        if line.localizedCaseInsensitiveContains("finished") || line.localizedCaseInsensitiveContains("success") {
            return Color(hex: 0x79E4B1).opacity(0.9)
        }
        if line.contains("Starting") || line.contains("Fetched") {
            return Color(hex: 0x73D4FF).opacity(0.9)
        }
        return ConsolePalette.muted
    }
}

struct PanelHeader<Accessory: View>: View {
    let eyebrow: String
    let title: String
    let detail: String
    @ViewBuilder let accessory: Accessory

    init(eyebrow: String, title: String, detail: String, @ViewBuilder accessory: () -> Accessory = { EmptyView() }) {
        self.eyebrow = eyebrow
        self.title = title
        self.detail = detail
        self.accessory = accessory()
    }

    var body: some View {
        HStack(alignment: .top, spacing: 15) {
            VStack(alignment: .leading, spacing: 5) {
                Text(eyebrow)
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .tracking(1.8)
                    .foregroundStyle(Color(hex: 0x73D4FF).opacity(0.78))
                Text(title)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(ConsolePalette.ink)
                Text(detail)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(ConsolePalette.muted)
            }
            Spacer()
            accessory
        }
    }
}

struct GlassCard<Content: View>: View {
    let padding: CGFloat
    let minHeight: CGFloat
    @ViewBuilder let content: Content

    init(padding: CGFloat = 21, minHeight: CGFloat = 0, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.minHeight = minHeight
        self.content = content()
    }

    var body: some View {
        // Group builder children before applying the card modifiers. Without
        // this wrapper, grid parents can treat the tuple's children as
        // separate layout items and split a card into unrelated fragments.
        VStack(alignment: .leading, spacing: 0) {
            content
        }
            .padding(padding)
            .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .topLeading)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 25, style: .continuous))
            .background(Color.white.opacity(0.76), in: RoundedRectangle(cornerRadius: 25, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 25, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [Color.white.opacity(0.95), ConsolePalette.line, ConsolePalette.cyan.opacity(0.2)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            }
            .shadow(color: Color(hex: 0x6B7C99).opacity(0.18), radius: 24, y: 13)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct GlassButtonStyle: ButtonStyle {
    let tint: Color
    var filled = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .foregroundStyle(filled ? Color.white : tint)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(filled ? tint : tint.opacity(0.1), in: Capsule())
            .overlay(Capsule().stroke(tint.opacity(filled ? 0 : 0.22), lineWidth: 1))
            .opacity(configuration.isPressed ? 0.68 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

struct LiquidBackdrop: View {
    var body: some View {
        ZStack {
            ConsolePalette.canvas
            Circle()
                .fill(ConsolePalette.cyan.opacity(0.18))
                .frame(width: 520, height: 520)
                .blur(radius: 90)
                .offset(x: -300, y: -260)
            Circle()
                .fill(ConsolePalette.pink.opacity(0.16))
                .frame(width: 460, height: 460)
                .blur(radius: 100)
                .offset(x: 310, y: 250)
            Circle()
                .fill(ConsolePalette.blue.opacity(0.12))
                .frame(width: 380, height: 380)
                .blur(radius: 110)
                .offset(x: 180, y: -40)
            Canvas { context, size in
                var grid = Path()
                let step: CGFloat = 72
                stride(from: 0, through: size.width, by: step).forEach { x in
                    grid.move(to: CGPoint(x: x, y: 0))
                    grid.addLine(to: CGPoint(x: x, y: size.height))
                }
                stride(from: 0, through: size.height, by: step).forEach { y in
                    grid.move(to: CGPoint(x: 0, y: y))
                    grid.addLine(to: CGPoint(x: size.width, y: y))
                }
                context.stroke(grid, with: .color(ConsolePalette.ink.opacity(0.05)), lineWidth: 1)
            }
        }
        .ignoresSafeArea()
    }
}

private extension View {
    func editorTextField() -> some View {
        self
            .textFieldStyle(.plain)
            .font(.system(size: 11, weight: .medium, design: .monospaced))
            .foregroundStyle(ConsolePalette.ink.opacity(0.78))
            .padding(10)
            .background(Color.white.opacity(0.8), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(ConsolePalette.line, lineWidth: 1))
    }
}

private func compactNumber(_ value: Int) -> String {
    if value >= 1_000_000 { return String(format: "%.1fM", Double(value) / 1_000_000) }
    if value >= 1_000 { return String(format: "%.1fk", Double(value) / 1_000) }
    return "\(value)"
}

private func shortHost(_ value: String) -> String {
    URL(string: value)?.host ?? value.replacingOccurrences(of: "https://", with: "")
}

private func shortPath(_ value: String) -> String {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return value.hasPrefix(home) ? "~" + value.dropFirst(home.count) : value
}
