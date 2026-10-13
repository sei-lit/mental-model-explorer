import ItemModel
import OtherModel
import UsapoShared

/// 一覧の状態を持つ。
@MainActor
final class ItemListViewModel: ObservableObject {
    private let fetcher: any ItemFetching
    private(set) var clash: Clash?
    private let shared: SharedThing? = nil

    init(fetcher: any ItemFetching) {
        self.fetcher = fetcher
    }

    func didTapRetry() {
        reload()
    }

    private func reload() {
        Task {
            _ = try? await self.fetcher.fetch()
        }
    }

    static func make(fetcher: ItemFetching) -> ItemListViewModel {
        let model = ItemListViewModel(fetcher: fetcher)
        return model
    }
}
