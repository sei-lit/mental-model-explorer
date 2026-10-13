// swift-tools-version: 6.0

import PackageDescription

enum TargetGroup {
    case feature
    case screenRequest
    case core
    case serviceAndManager
    case model
}

// Libraries
let stubKit = Target.Dependency.product(name: "StubKit", package: "StubKit")

// KMP の framework
let usapoSharedXCFramework = Target.binaryTarget(
    name: "UsapoShared",
    path: "XCFrameworks/UsapoShared.xcframework"
)
let usapoShared = Target.Dependency.target(name: usapoSharedXCFramework.name)

// MARK: - Targets

let const = Target.target(
    name: "Const",
    path: "Sources/Const",
    dependencies: [],
    targetGroup: .core,
    swiftLanguageMode: .v6
)

let itemModel = Target.target(
    name: "ItemModel",
    dependencies: [
        const
    ],
    dependencyLibraries: [stubKit],
    targetGroup: .model,
    swiftLanguageMode: .v6
)

let otherModel = Target.target(name: "OtherModel", path: "Sources/OtherModel", targetGroup: .model, swiftLanguageMode: .v6)

let itemRepository = Target.target(
    name: "ItemRepository",
    dependencies: [
        itemModel,
        // otherModel,
    ],
    targetGroup: .serviceAndManager,
    swiftLanguageMode: .v6
)

let itemScreenRequests = Target.target(
    name: "ItemScreenRequests",
    targetGroup: .screenRequest,
    swiftLanguageMode: .v6
)

let itemFeature = Target.target(
    name: "ItemFeature",
    dependencies: [
        itemModel,
        otherModel,
        itemScreenRequests
    ],
    dependencyLibraries: [
        usapoShared
    ],
    targetGroup: .feature,
    swiftLanguageMode: .v6
)

let itemFeatureTests = Target.testTarget(
    name: "ItemFeatureTests",
    dependencies: [itemFeature],
    targetGroup: .feature,
    swiftLanguageMode: .v6
)

let package = Package.package(
    name: "MiniPackage",
    platforms: [.iOS(.v18)],
    targets: [const, itemModel, otherModel, itemRepository, itemScreenRequests, itemFeature],
    binaryTargets: [usapoSharedXCFramework],
    testTargets: [itemFeatureTests]
)
