import ItemModel

struct LiveItemFetcher: ItemFetching {
    func fetch() async throws -> [Item] {
        []
    }
}

actor ItemCache {
    private var items: [Item] = []
}

extension String {
    func trimmedTitle() -> String { trimmingCharacters(in: .whitespaces) }
}
