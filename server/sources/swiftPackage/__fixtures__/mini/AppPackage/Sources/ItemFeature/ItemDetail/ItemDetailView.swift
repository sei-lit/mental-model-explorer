import ItemModel
import SwiftUI

struct ItemDetailView: View {
    @State private var viewModel: ItemListViewModel
    let item: Item
    let other: SharedThing? = nil

    var body: some View {
        Button("再読み込み") { viewModel.didTapRetry() }
            .card()
    }
}

extension View {
    func card() -> some View { self }
}

extension Item {
    var badge: String { "new" }
}
