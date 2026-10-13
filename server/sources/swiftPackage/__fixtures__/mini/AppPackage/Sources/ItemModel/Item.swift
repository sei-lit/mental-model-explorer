import Const

/// 一覧に並ぶ商品。ここは要約に入らない。
public struct Item: Sendable {
    public let id: String
    public let version = Const.version
}

public protocol ItemFetching: Sendable {
    func fetch() async throws -> [Item]
}

public struct Clash {}
