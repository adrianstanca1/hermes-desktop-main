// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "HermesDesktop",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "HermesDesktop",
            targets: ["HermesDesktop"]
        )
    ],
    dependencies: [
        .package(path: "Vendor/SwiftTerm"),
        // Pin swift-testing to 6.2.x: 6.3.x pulled in swift-syntax prebuilts that failed to link (_TestingInterop) on some toolchains.
        .package(url: "https://github.com/swiftlang/swift-testing.git", revision: "5ee435b15ad40ec1f644b5eb9d247f263ccd2170")
    ],
    targets: [
        .executableTarget(
            name: "HermesDesktop",
            dependencies: [
                .product(name: "SwiftTerm", package: "SwiftTerm")
            ],
            path: "Sources/HermesDesktop"
        ),
        .testTarget(
            name: "HermesDesktopTests",
            dependencies: [
                "HermesDesktop",
                .product(name: "Testing", package: "swift-testing")
            ],
            path: "Tests/HermesDesktopTests"
        )
    ]
)
