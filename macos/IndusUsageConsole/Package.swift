// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "IndusUsageConsole",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "IndusUsageConsole", targets: ["IndusUsageConsole"])
    ],
    targets: [
        .executableTarget(
            name: "IndusUsageConsole",
            path: "Sources"
        )
    ]
)
