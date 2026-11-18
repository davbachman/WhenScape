// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "WhenScape",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "WhenScape", targets: ["WhenScape"])],
    targets: [
        .target(name: "WhenScapeCore"),
        .executableTarget(name: "WhenScape", dependencies: ["WhenScapeCore"], resources: [.copy("Resources/Web")]),
        .testTarget(name: "WhenScapeCoreTests", dependencies: ["WhenScapeCore"])
    ]
)
