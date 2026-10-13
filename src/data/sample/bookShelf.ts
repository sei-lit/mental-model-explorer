import type { Claim, Flow, FlowStep, GraphEdge, GraphNode, Layer, NodeKind, ProjectGraph, RelationKind, TypeFlavor } from '../../core/model/graph'
import type { ProjectSource } from '../projectSource'

const inferred = (text: string, source = 'AI推定'): Claim => ({ text, provenance: 'inferred', source })
const observed = (text: string, source: string): Claim => ({ text, provenance: 'observed', source })

const FEATURE = 'Packages/Feature/Sources'
const DOMAIN = 'Packages/Domain/Sources'
const DATA = 'Packages/Data/Sources'

interface NodeOptions {
  aliases?: string[]
  flavor?: TypeFlavor
  layer?: Layer
  responsibility?: Claim
  role?: Claim
  constraints?: Claim[]
  code?: { path: string; startLine: number; text: string }
}

function node(id: string, kind: NodeKind, name: string, parentId: string | null, summary: string, options: NodeOptions = {}): GraphNode {
  const { code, ...rest } = options
  return { id, kind, name, parentId, summary, ...rest, ...(code ? { code: { language: 'swift', ...code } } : {}) }
}

function edge(id: string, source: string, target: string, relation: RelationKind, evidence: Claim, rationale?: Claim): GraphEdge {
  return { id, source, target, relation, evidence, ...(rationale ? { rationale } : {}) }
}

function flow(id: string, name: string, description: string, trigger: string, steps: FlowStep[]): Flow {
  return { id, name, description, trigger, steps }
}

const nodes: GraphNode[] = [
  node('project', 'project', 'BookShelf', null, '読書リストを管理する SwiftUI アプリ。', {
    responsibility: inferred('読みたい本・読んだ本を一覧し、お気に入りや詳細を扱う。', '設計者のメモ'),
  }),

  // packages
  node('pkg.feature', 'package', 'Feature', 'project', '画面と画面状態を持つ Presentation 層。', {
    layer: 'presentation',
    responsibility: inferred('SwiftUI の View と ViewModel を置き、UseCase を呼んで状態を画面に渡す。', '設計者のメモ'),
    role: inferred('ユーザー操作の入口'),
    constraints: [observed('Feature は Data を import しない', 'Packages/Feature/Package.swift')],
  }),
  node('pkg.domain', 'package', 'Domain', 'project', 'アプリの業務ルールと抽象を持つ Domain 層。', {
    layer: 'domain',
    responsibility: inferred('Entity・UseCase・Repository の抽象を定義し、外部技術に依存しない。', '設計者のメモ'),
    role: inferred('抽象化の境界'),
    constraints: [observed('Domain は Data を import しない', 'Packages/Domain/Package.swift')],
  }),
  node('pkg.data', 'package', 'Data', 'project', 'API とキャッシュを扱う Data 層。', {
    layer: 'data',
    responsibility: inferred('Repository の実装と、通信・永続化のアダプタを持つ。', '設計者のメモ'),
    role: inferred('I/O アダプタ'),
    constraints: [observed('Data は Domain の抽象に依存する', 'Packages/Data/Package.swift')],
  }),

  // modules
  node('mod.BookListFeature', 'module', 'BookListFeature', 'pkg.feature', '本の一覧画面。', {
    responsibility: inferred('一覧の表示、読み込み、お気に入り切り替えの操作を受ける。'),
  }),
  node('mod.BookDetailFeature', 'module', 'BookDetailFeature', 'pkg.feature', '本の詳細画面。', {
    responsibility: inferred('1 冊の本の詳細表示を担う。'),
  }),
  node('mod.Entity', 'module', 'Entity', 'pkg.domain', 'ドメインのデータ型。', {
    responsibility: inferred('Book などの値型を定義する。ロジックは最小限に保つ。'),
    constraints: [observed('Entity は他のモジュールに依存しない', 'Packages/Domain/Package.swift')],
  }),
  node('mod.UseCase', 'module', 'UseCase', 'pkg.domain', 'ユーザーの 1 操作に対応する処理。', {
    responsibility: inferred('1 操作 1 クラスで Repository を呼び出す。', '設計者のメモ'),
  }),
  node('mod.RepositoryInterface', 'module', 'RepositoryInterface', 'pkg.domain', 'Repository のプロトコル置き場。', {
    responsibility: inferred('Domain が Data を知らずに済むよう、データ取得の抽象だけを公開する。'),
    role: inferred('抽象化の境界'),
  }),
  node('mod.Repository', 'module', 'Repository', 'pkg.data', 'Repository 実装。', {
    responsibility: inferred('API とキャッシュを組み合わせ、Domain が望む形のデータを返す。'),
  }),
  node('mod.Gateway', 'module', 'Gateway', 'pkg.data', 'API・キャッシュへの接続口と DTO。', {
    responsibility: inferred('通信と永続化の詳細を閉じ込め、DTO を外に出す。'),
    role: inferred('I/O アダプタ'),
  }),

  // BookListFeature
  node('type.BookListView', 'type', 'BookListView', 'mod.BookListFeature', '一覧画面の SwiftUI View。', {
    flavor: 'struct', aliases: ['View', '一覧画面'],
    responsibility: inferred('ViewModel の状態を描画し、操作を ViewModel に渡す。'),
  }),
  node('prop.BookListView.viewModel', 'property', 'viewModel', 'type.BookListView', '画面が観測する ViewModel。', {
    code: { path: `${FEATURE}/BookListFeature/BookListView.swift`, startLine: 4, text: `@StateObject private var viewModel: BookListViewModel` },
  }),
  node('method.BookListView.body', 'method', 'body', 'type.BookListView', '状態に応じて一覧を描画し、表示時に読み込みを開始する。', {
    code: {
      path: `${FEATURE}/BookListFeature/BookListView.swift`, startLine: 8,
      text: `var body: some View {
    List(viewModel.books) { book in
        BookRowView(book: book) {
            Task { await viewModel.toggleFavorite(id: book.id) }
        }
    }
    .overlay { if case .loading = viewModel.state { ProgressView() } }
    .task { await viewModel.load() }
}`,
    },
  }),
  node('type.BookListViewModel', 'type', 'BookListViewModel', 'mod.BookListFeature', '一覧画面の状態を管理する ViewModel。', {
    flavor: 'class', aliases: ['ViewModel', '一覧ViewModel'],
    responsibility: inferred('UseCase を呼び、結果を State に変換して View に公開する。', '設計者のメモ'),
    role: inferred('画面ロジックの置き場'),
    constraints: [inferred('Gateway や Repository 実装を直接参照しない')],
  }),
  node('prop.BookListViewModel.state', 'property', 'state', 'type.BookListViewModel', '画面状態 (idle / loading / loaded / failed)。', {
    code: {
      path: `${FEATURE}/BookListFeature/BookListViewModel.swift`, startLine: 5,
      text: `enum State {
    case idle
    case loading
    case loaded([Book])
    case failed(String)
}

@Published private(set) var state: State = .idle`,
    },
  }),
  node('prop.BookListViewModel.fetchBooksUseCase', 'property', 'fetchBooksUseCase', 'type.BookListViewModel', '本の取得 UseCase。', {
    code: { path: `${FEATURE}/BookListFeature/BookListViewModel.swift`, startLine: 15, text: `private let fetchBooksUseCase: FetchBooksUseCase` },
  }),
  node('prop.BookListViewModel.toggleFavoriteUseCase', 'property', 'toggleFavoriteUseCase', 'type.BookListViewModel', 'お気に入り切り替え UseCase。', {
    code: { path: `${FEATURE}/BookListFeature/BookListViewModel.swift`, startLine: 16, text: `private let toggleFavoriteUseCase: ToggleFavoriteUseCase` },
  }),
  node('method.BookListViewModel.load', 'method', 'load', 'type.BookListViewModel', '一覧を取得して state を更新する。', {
    code: {
      path: `${FEATURE}/BookListFeature/BookListViewModel.swift`, startLine: 24,
      text: `func load() async {
    state = .loading
    do {
        let books = try await fetchBooksUseCase.execute()
        state = .loaded(books)
    } catch {
        state = .failed(error.localizedDescription)
    }
}`,
    },
  }),
  node('method.BookListViewModel.toggleFavorite', 'method', 'toggleFavorite(id:)', 'type.BookListViewModel', 'お気に入りを切り替え、一覧の該当行を更新する。', {
    code: {
      path: `${FEATURE}/BookListFeature/BookListViewModel.swift`, startLine: 36,
      text: `func toggleFavorite(id: Book.ID) async {
    guard case .loaded(var books) = state,
          let index = books.firstIndex(where: { $0.id == id }) else { return }
    do {
        books[index] = try await toggleFavoriteUseCase.execute(book: books[index])
        state = .loaded(books)
    } catch {
        state = .failed(error.localizedDescription)
    }
}`,
    },
  }),
  node('type.BookRowView', 'type', 'BookRowView', 'mod.BookListFeature', '一覧の 1 行を描画する View。', {
    flavor: 'struct', aliases: ['行View', 'Row'],
    responsibility: inferred('Book を受け取って表示するだけで、状態を持たない。'),
  }),
  node('prop.BookRowView.book', 'property', 'book', 'type.BookRowView', '表示する本。', {
    code: { path: `${FEATURE}/BookListFeature/BookRowView.swift`, startLine: 3, text: `let book: Book\nlet onTapFavorite: () -> Void` },
  }),

  // BookDetailFeature
  node('type.BookDetailView', 'type', 'BookDetailView', 'mod.BookDetailFeature', '詳細画面の SwiftUI View。', {
    flavor: 'struct', aliases: ['詳細画面', '詳細View'],
    responsibility: inferred('詳細 ViewModel の状態を描画する。'),
  }),
  node('method.BookDetailView.body', 'method', 'body', 'type.BookDetailView', '詳細を描画し、表示時に読み込みを開始する。', {
    code: {
      path: `${FEATURE}/BookDetailFeature/BookDetailView.swift`, startLine: 7,
      text: `var body: some View {
    Group {
        if case .loaded(let book) = viewModel.state {
            Text(book.title).font(.title)
        } else {
            ProgressView()
        }
    }
    .task { await viewModel.load() }
}`,
    },
  }),
  node('type.BookDetailViewModel', 'type', 'BookDetailViewModel', 'mod.BookDetailFeature', '詳細画面の状態を管理する ViewModel。', {
    flavor: 'class', aliases: ['詳細ViewModel'],
    responsibility: inferred('1 冊分の取得結果を State に変換する。'),
    constraints: [inferred('Feature は Data を import しない', '設計者のメモ')],
  }),
  node('prop.BookDetailViewModel.state', 'property', 'state', 'type.BookDetailViewModel', '詳細の画面状態。', {
    code: { path: `${FEATURE}/BookDetailFeature/BookDetailViewModel.swift`, startLine: 5, text: `@Published private(set) var state: BookListViewModel.State = .idle` },
  }),
  node('prop.BookDetailViewModel.cacheGateway', 'property', 'cacheGateway', 'type.BookDetailViewModel', 'キャッシュ Gateway を直接保持している。', {
    code: { path: `${FEATURE}/BookDetailFeature/BookDetailViewModel.swift`, startLine: 8, text: `private let cacheGateway: BookCacheGateway // TODO: UseCase 経由に戻す` },
  }),
  node('method.BookDetailViewModel.load', 'method', 'load', 'type.BookDetailViewModel', '先にキャッシュを見て、無ければ UseCase で取得する。', {
    code: {
      path: `${FEATURE}/BookDetailFeature/BookDetailViewModel.swift`, startLine: 18,
      text: `func load() async {
    if let cached = cacheGateway.load().first(where: { $0.id == bookID }) {
        state = .loaded([cached.toEntity()])
        return
    }
    do {
        state = .loaded([try await fetchBookDetailUseCase.execute(id: bookID)])
    } catch {
        state = .failed(error.localizedDescription)
    }
}`,
    },
  }),

  // Entity
  node('type.Book', 'type', 'Book', 'mod.Entity', '本を表す Entity。', {
    flavor: 'struct', aliases: ['書籍', 'Entity'],
    responsibility: inferred('タイトル・著者・読書状態・お気に入りを持つ値型。'),
  }),
  node('prop.Book.status', 'property', 'status', 'type.Book', '読書状態。', {
    code: {
      path: `${DOMAIN}/Entity/Book.swift`, startLine: 1,
      text: `public struct Book: Identifiable, Equatable {
    public let id: String
    public let title: String
    public let author: Author
    public var status: ReadingStatus
    public var isFavorite: Bool
}`,
    },
  }),
  node('prop.Book.isFavorite', 'property', 'isFavorite', 'type.Book', 'お気に入りかどうか。', {
    code: { path: `${DOMAIN}/Entity/Book.swift`, startLine: 6, text: `public var isFavorite: Bool` },
  }),
  node('type.Author', 'type', 'Author', 'mod.Entity', '著者を表す Entity。', {
    flavor: 'struct', aliases: ['著者'],
    responsibility: inferred('著者名を持つ値型。'),
  }),
  node('type.ReadingStatus', 'type', 'ReadingStatus', 'mod.Entity', '読書状態の列挙。', {
    flavor: 'enum', aliases: ['読書状態'],
    responsibility: inferred('未読・読書中・読了を表す。'),
    code: {
      path: `${DOMAIN}/Entity/ReadingStatus.swift`, startLine: 1,
      text: `public enum ReadingStatus: String {
    case unread
    case reading
    case finished
}`,
    },
  }),

  // UseCase
  node('type.FetchBooksUseCase', 'type', 'FetchBooksUseCase', 'mod.UseCase', '本の一覧を取得する UseCase。', {
    flavor: 'class', aliases: ['UseCase', '一覧取得UseCase'],
    responsibility: inferred('一覧取得の窓口。Repository の抽象だけを知る。', '設計者のメモ'),
    role: inferred('ViewModel と Repository の仲介'),
    constraints: [observed('Repository は protocol 経由でのみ参照する', 'FetchBooksUseCase.swift:4')],
  }),
  node('prop.FetchBooksUseCase.repository', 'property', 'repository', 'type.FetchBooksUseCase', 'Repository の抽象。', {
    code: { path: `${DOMAIN}/UseCase/FetchBooksUseCase.swift`, startLine: 4, text: `private let repository: BookRepository` },
  }),
  node('method.FetchBooksUseCase.execute', 'method', 'execute', 'type.FetchBooksUseCase', 'Repository から一覧を取得して返す。', {
    code: {
      path: `${DOMAIN}/UseCase/FetchBooksUseCase.swift`, startLine: 10,
      text: `public func execute() async throws -> [Book] {
    try await repository.fetchBooks()
}`,
    },
  }),
  node('type.ToggleFavoriteUseCase', 'type', 'ToggleFavoriteUseCase', 'mod.UseCase', 'お気に入りを切り替える UseCase。', {
    flavor: 'class', aliases: ['お気に入りUseCase'],
    responsibility: inferred('お気に入りの反転を Repository に依頼する。'),
  }),
  node('prop.ToggleFavoriteUseCase.repository', 'property', 'repository', 'type.ToggleFavoriteUseCase', 'Repository の抽象。', {
    code: { path: `${DOMAIN}/UseCase/ToggleFavoriteUseCase.swift`, startLine: 4, text: `private let repository: BookRepository` },
  }),
  node('method.ToggleFavoriteUseCase.execute', 'method', 'execute(book:)', 'type.ToggleFavoriteUseCase', 'お気に入りを反転した本を返す。', {
    code: {
      path: `${DOMAIN}/UseCase/ToggleFavoriteUseCase.swift`, startLine: 10,
      text: `public func execute(book: Book) async throws -> Book {
    try await repository.toggleFavorite(id: book.id, to: !book.isFavorite)
}`,
    },
  }),
  node('type.FetchBookDetailUseCase', 'type', 'FetchBookDetailUseCase', 'mod.UseCase', '本の詳細を取得する UseCase。', {
    flavor: 'class', aliases: ['詳細取得UseCase'],
    responsibility: inferred('1 冊の取得を Repository に依頼する。'),
  }),
  node('method.FetchBookDetailUseCase.execute', 'method', 'execute(id:)', 'type.FetchBookDetailUseCase', 'id で 1 冊を取得する。', {
    code: {
      path: `${DOMAIN}/UseCase/FetchBookDetailUseCase.swift`, startLine: 10,
      text: `public func execute(id: Book.ID) async throws -> Book {
    try await repository.fetchBook(id: id)
}`,
    },
  }),

  // RepositoryInterface
  node('type.BookRepository', 'type', 'BookRepository', 'mod.RepositoryInterface', '本のデータ取得の抽象 (protocol)。', {
    flavor: 'protocol', aliases: ['Repository', 'リポジトリ', 'Repository Interface'],
    responsibility: inferred('Domain が必要とするデータ操作だけを宣言し、取得元を隠す。', '設計者のメモ'),
    role: inferred('抽象化の境界'),
    constraints: [observed('Entity 以外の型を引数・戻り値に使わない', 'BookRepository.swift')],
  }),
  node('method.BookRepository.fetchBooks', 'method', 'fetchBooks', 'type.BookRepository', '一覧取得の宣言。', {
    code: { path: `${DOMAIN}/RepositoryInterface/BookRepository.swift`, startLine: 2, text: `func fetchBooks() async throws -> [Book]` },
  }),
  node('method.BookRepository.toggleFavorite', 'method', 'toggleFavorite(id:to:)', 'type.BookRepository', 'お気に入り更新の宣言。', {
    code: { path: `${DOMAIN}/RepositoryInterface/BookRepository.swift`, startLine: 3, text: `func toggleFavorite(id: Book.ID, to isFavorite: Bool) async throws -> Book` },
  }),
  node('method.BookRepository.fetchBook', 'method', 'fetchBook(id:)', 'type.BookRepository', '1 冊取得の宣言。', {
    code: { path: `${DOMAIN}/RepositoryInterface/BookRepository.swift`, startLine: 4, text: `func fetchBook(id: Book.ID) async throws -> Book` },
  }),

  // Repository
  node('type.BookRepositoryImpl', 'type', 'BookRepositoryImpl', 'mod.Repository', 'BookRepository の実装。', {
    flavor: 'class', aliases: ['Repository実装', 'RepositoryImpl'],
    responsibility: inferred('API を優先し、失敗時はキャッシュに切り替えて Book を返す。', '設計者のメモ'),
    role: inferred('取得元の切り替え役'),
    constraints: [inferred('DTO を Domain に漏らさず、Book に変換して返す')],
  }),
  node('prop.BookRepositoryImpl.api', 'property', 'api', 'type.BookRepositoryImpl', 'API Gateway。', {
    code: {
      path: `${DATA}/Repository/BookRepositoryImpl.swift`, startLine: 4,
      text: `private let api: BookAPIGateway
private let cache: BookCacheGateway

init(api: BookAPIGateway, cache: BookCacheGateway) {
    self.api = api
    self.cache = cache
}`,
    },
  }),
  node('prop.BookRepositoryImpl.cache', 'property', 'cache', 'type.BookRepositoryImpl', 'キャッシュ Gateway。', {
    code: { path: `${DATA}/Repository/BookRepositoryImpl.swift`, startLine: 5, text: `private let cache: BookCacheGateway` },
  }),
  node('method.BookRepositoryImpl.fetchBooks', 'method', 'fetchBooks', 'type.BookRepositoryImpl', 'API から取得し、失敗したらキャッシュを返す。', {
    code: {
      path: `${DATA}/Repository/BookRepositoryImpl.swift`, startLine: 14,
      text: `func fetchBooks() async throws -> [Book] {
    do {
        let dtos = try await api.getBooks()
        cache.save(dtos)
        return dtos.map { $0.toEntity() }
    } catch {
        let cached = cache.load()
        if cached.isEmpty { throw error }
        return cached.map { $0.toEntity() }
    }
}`,
    },
  }),
  node('method.BookRepositoryImpl.toggleFavorite', 'method', 'toggleFavorite(id:to:)', 'type.BookRepositoryImpl', 'サーバーに反映し、キャッシュも更新する。', {
    code: {
      path: `${DATA}/Repository/BookRepositoryImpl.swift`, startLine: 28,
      text: `func toggleFavorite(id: Book.ID, to isFavorite: Bool) async throws -> Book {
    let dto = try await api.putFavorite(id: id, isFavorite: isFavorite)
    var cached = cache.load().filter { $0.id != id }
    cached.append(dto)
    cache.save(cached)
    return dto.toEntity()
}`,
    },
  }),
  node('method.BookRepositoryImpl.fetchBook', 'method', 'fetchBook(id:)', 'type.BookRepositoryImpl', 'キャッシュに無ければ API の一覧から探す。', {
    code: {
      path: `${DATA}/Repository/BookRepositoryImpl.swift`, startLine: 38,
      text: `func fetchBook(id: Book.ID) async throws -> Book {
    if let dto = cache.load().first(where: { $0.id == id }) {
        return dto.toEntity()
    }
    let dtos = try await api.getBooks()
    guard let dto = dtos.first(where: { $0.id == id }) else { throw BookError.notFound }
    return dto.toEntity()
}`,
    },
  }),

  // Gateway
  node('type.BookAPIGateway', 'type', 'BookAPIGateway', 'mod.Gateway', '書籍 API への通信口。', {
    flavor: 'class', aliases: ['Gateway', 'ゲートウェイ', 'APIGateway'],
    responsibility: inferred('URLSession で API を呼び、レスポンスを BookDTO にデコードする。', '設計者のメモ'),
    role: inferred('I/O アダプタ'),
    constraints: [observed('Domain の型を import しない', 'Packages/Data/Package.swift')],
  }),
  node('method.BookAPIGateway.getBooks', 'method', 'getBooks', 'type.BookAPIGateway', '一覧 API を呼んで BookDTO を返す。', {
    code: {
      path: `${DATA}/Gateway/BookAPIGateway.swift`, startLine: 10,
      text: `func getBooks() async throws -> [BookDTO] {
    let url = baseURL.appendingPathComponent("books")
    let (data, response) = try await session.data(from: url)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        throw APIError.invalidResponse
    }
    return try JSONDecoder().decode([BookDTO].self, from: data)
}`,
    },
  }),
  node('method.BookAPIGateway.putFavorite', 'method', 'putFavorite(id:isFavorite:)', 'type.BookAPIGateway', 'お気に入り状態を PUT する。', {
    code: {
      path: `${DATA}/Gateway/BookAPIGateway.swift`, startLine: 24,
      text: `func putFavorite(id: String, isFavorite: Bool) async throws -> BookDTO {
    var request = URLRequest(url: baseURL.appendingPathComponent("books/\\(id)/favorite"))
    request.httpMethod = "PUT"
    request.httpBody = try JSONEncoder().encode(["is_favorite": isFavorite])
    let (data, _) = try await session.data(for: request)
    return try JSONDecoder().decode(BookDTO.self, from: data)
}`,
    },
  }),
  node('type.BookCacheGateway', 'type', 'BookCacheGateway', 'mod.Gateway', 'ローカルキャッシュへの読み書き口。', {
    flavor: 'class', aliases: ['キャッシュ', 'CacheGateway'],
    responsibility: inferred('BookDTO の配列を UserDefaults に保存・復元する。'),
    role: inferred('I/O アダプタ'),
  }),
  node('method.BookCacheGateway.load', 'method', 'load', 'type.BookCacheGateway', '保存済みの BookDTO を読み出す。', {
    code: {
      path: `${DATA}/Gateway/BookCacheGateway.swift`, startLine: 8,
      text: `func load() -> [BookDTO] {
    guard let data = defaults.data(forKey: key) else { return [] }
    return (try? JSONDecoder().decode([BookDTO].self, from: data)) ?? []
}`,
    },
  }),
  node('method.BookCacheGateway.save', 'method', 'save', 'type.BookCacheGateway', 'BookDTO の配列を保存する。', {
    code: {
      path: `${DATA}/Gateway/BookCacheGateway.swift`, startLine: 14,
      text: `func save(_ dtos: [BookDTO]) {
    guard let data = try? JSONEncoder().encode(dtos) else { return }
    defaults.set(data, forKey: key)
}`,
    },
  }),
  node('type.BookDTO', 'type', 'BookDTO', 'mod.Gateway', 'API・キャッシュ共通の転送用データ型。', {
    flavor: 'struct', aliases: ['DTO'],
    responsibility: inferred('JSON の形をそのまま表し、Entity への変換口を持つ。'),
    constraints: [inferred('Gateway の外には DTO のまま出さない')],
  }),
  node('method.BookDTO.toEntity', 'method', 'toEntity', 'type.BookDTO', 'DTO を Book に変換する。', {
    code: {
      path: `${DATA}/Gateway/BookDTO.swift`, startLine: 9,
      text: `func toEntity() -> Book {
    Book(
        id: id,
        title: title,
        author: Author(name: authorName),
        status: ReadingStatus(rawValue: status) ?? .unread,
        isFavorite: isFavorite
    )
}`,
    },
  }),
]

const edges: GraphEdge[] = [
  // presentation
  edge('e.listView.observes.listVM', 'type.BookListView', 'type.BookListViewModel', 'observes', observed('@StateObject で ViewModel を保持', 'BookListView.swift:4')),
  edge('e.listView.creates.row', 'type.BookListView', 'type.BookRowView', 'creates', observed('List の各要素で BookRowView を生成', 'BookListView.swift:10')),
  edge('e.detailView.observes.detailVM', 'type.BookDetailView', 'type.BookDetailViewModel', 'observes', observed('@StateObject で ViewModel を保持', 'BookDetailView.swift:4')),
  edge('e.row.dep.book', 'type.BookRowView', 'type.Book', 'depends_on', observed('let book: Book', 'BookRowView.swift:3')),
  edge('e.listVM.dep.fetch', 'type.BookListViewModel', 'type.FetchBooksUseCase', 'depends_on', observed('init(fetchBooksUseCase:) で注入', 'BookListViewModel.swift:18'),
    inferred('ViewModel が Repository を知らずに済むよう、取得の手順を UseCase に分離している。', '設計者のメモ')),
  edge('e.listVM.dep.toggle', 'type.BookListViewModel', 'type.ToggleFavoriteUseCase', 'depends_on', observed('init(toggleFavoriteUseCase:) で注入', 'BookListViewModel.swift:19'),
    inferred('お気に入りの更新規則を画面から切り離し、他画面でも使えるようにしている。')),
  edge('e.detailVM.dep.fetchDetail', 'type.BookDetailViewModel', 'type.FetchBookDetailUseCase', 'depends_on', observed('init(fetchBookDetailUseCase:) で注入', 'BookDetailViewModel.swift:12')),
  edge('e.detailVM.dep.cache', 'type.BookDetailViewModel', 'type.BookCacheGateway', 'depends_on', observed('private let cacheGateway: BookCacheGateway', 'BookDetailViewModel.swift:8'),
    inferred('一時的なショートカット。一覧で取得済みの本を即表示したくて、UseCase を経由せずキャッシュを直接読んでいる。Feature から Data への依存になり、層の向きに反する。')),
  // domain
  edge('e.fetch.dep.repo', 'type.FetchBooksUseCase', 'type.BookRepository', 'depends_on', observed('private let repository: BookRepository', 'FetchBooksUseCase.swift:4'),
    inferred('UseCase が具体的な取得元に縛られないよう、プロトコルに依存する (依存性逆転)。')),
  edge('e.toggle.dep.repo', 'type.ToggleFavoriteUseCase', 'type.BookRepository', 'depends_on', observed('private let repository: BookRepository', 'ToggleFavoriteUseCase.swift:4'),
    inferred('テストで Repository をモックに差し替えられるようにするため。')),
  edge('e.fetchDetail.dep.repo', 'type.FetchBookDetailUseCase', 'type.BookRepository', 'depends_on', observed('private let repository: BookRepository', 'FetchBookDetailUseCase.swift:4')),
  edge('e.book.dep.author', 'type.Book', 'type.Author', 'depends_on', observed('public let author: Author', 'Book.swift:4')),
  edge('e.book.dep.status', 'type.Book', 'type.ReadingStatus', 'depends_on', observed('public var status: ReadingStatus', 'Book.swift:5')),
  edge('e.repo.passes.book', 'type.BookRepository', 'type.Book', 'passes_data', observed('全メソッドが Book を返す', 'BookRepository.swift:2')),
  // data
  edge('e.impl.implements.repo', 'type.BookRepositoryImpl', 'type.BookRepository', 'implements', observed('final class BookRepositoryImpl: BookRepository', 'BookRepositoryImpl.swift:1')),
  edge('e.impl.dep.api', 'type.BookRepositoryImpl', 'type.BookAPIGateway', 'depends_on', observed('init(api:cache:) で注入', 'BookRepositoryImpl.swift:12'),
    inferred('最新のデータはサーバーが正なので、まず API を呼ぶ。通信の詳細は Gateway に任せて Repository は取得方針に集中する。', '設計者のメモ')),
  edge('e.impl.dep.cache', 'type.BookRepositoryImpl', 'type.BookCacheGateway', 'depends_on', observed('init(api:cache:) で注入', 'BookRepositoryImpl.swift:12'),
    inferred('オフラインや通信失敗時にも一覧を見せるためのフォールバックとして使う。')),
  edge('e.api.passes.dto', 'type.BookAPIGateway', 'type.BookDTO', 'passes_data', observed('getBooks が [BookDTO] を返す', 'BookAPIGateway.swift:10')),
  edge('e.cache.passes.dto', 'type.BookCacheGateway', 'type.BookDTO', 'passes_data', observed('load / save が [BookDTO] を扱う', 'BookCacheGateway.swift:8')),
  edge('e.dto.passes.book', 'type.BookDTO', 'type.Book', 'passes_data', observed('toEntity() が Book を返す', 'BookDTO.swift:9')),
  // method-level calls: loadList
  edge('c.listBody.load', 'method.BookListView.body', 'method.BookListViewModel.load', 'calls', observed('.task { await viewModel.load() }', 'BookListView.swift:15')),
  edge('c.load.fetchExecute', 'method.BookListViewModel.load', 'method.FetchBooksUseCase.execute', 'calls', observed('try await fetchBooksUseCase.execute()', 'BookListViewModel.swift:27')),
  edge('c.fetchExecute.repoFetch', 'method.FetchBooksUseCase.execute', 'method.BookRepository.fetchBooks', 'calls', observed('try await repository.fetchBooks()', 'FetchBooksUseCase.swift:11')),
  edge('c.repoFetch.implFetch', 'method.BookRepository.fetchBooks', 'method.BookRepositoryImpl.fetchBooks', 'calls', observed('動的ディスパッチ (protocol witness)', 'BookRepository.swift:2')),
  edge('c.implFetch.getBooks', 'method.BookRepositoryImpl.fetchBooks', 'method.BookAPIGateway.getBooks', 'calls', observed('let dtos = try await api.getBooks()', 'BookRepositoryImpl.swift:16')),
  edge('c.implFetch.save', 'method.BookRepositoryImpl.fetchBooks', 'method.BookCacheGateway.save', 'calls', observed('cache.save(dtos)', 'BookRepositoryImpl.swift:17')),
  edge('c.implFetch.cacheLoad', 'method.BookRepositoryImpl.fetchBooks', 'method.BookCacheGateway.load', 'calls', observed('catch 節で cache.load()', 'BookRepositoryImpl.swift:20')),
  edge('c.implFetch.toEntity', 'method.BookRepositoryImpl.fetchBooks', 'method.BookDTO.toEntity', 'calls', observed('dtos.map { $0.toEntity() }', 'BookRepositoryImpl.swift:18')),
  edge('p.getBooks.dto', 'method.BookAPIGateway.getBooks', 'type.BookDTO', 'passes_data', observed('JSONDecoder().decode([BookDTO].self, from: data)', 'BookAPIGateway.swift:16')),
  edge('p.implFetch.book', 'method.BookRepositoryImpl.fetchBooks', 'type.Book', 'passes_data', observed('戻り値 [Book]', 'BookRepositoryImpl.swift:14')),
  // toggleFavorite
  edge('c.listBody.toggle', 'method.BookListView.body', 'method.BookListViewModel.toggleFavorite', 'calls', observed('Task { await viewModel.toggleFavorite(id:) }', 'BookListView.swift:11')),
  edge('c.toggle.toggleExecute', 'method.BookListViewModel.toggleFavorite', 'method.ToggleFavoriteUseCase.execute', 'calls', observed('try await toggleFavoriteUseCase.execute(book:)', 'BookListViewModel.swift:40')),
  edge('c.toggleExecute.repoToggle', 'method.ToggleFavoriteUseCase.execute', 'method.BookRepository.toggleFavorite', 'calls', observed('repository.toggleFavorite(id:to:)', 'ToggleFavoriteUseCase.swift:11')),
  edge('c.repoToggle.implToggle', 'method.BookRepository.toggleFavorite', 'method.BookRepositoryImpl.toggleFavorite', 'calls', observed('動的ディスパッチ (protocol witness)', 'BookRepository.swift:3')),
  edge('c.implToggle.put', 'method.BookRepositoryImpl.toggleFavorite', 'method.BookAPIGateway.putFavorite', 'calls', observed('api.putFavorite(id:isFavorite:)', 'BookRepositoryImpl.swift:29')),
  edge('c.implToggle.save', 'method.BookRepositoryImpl.toggleFavorite', 'method.BookCacheGateway.save', 'calls', observed('cache.save(cached)', 'BookRepositoryImpl.swift:32')),
  edge('c.implToggle.toEntity', 'method.BookRepositoryImpl.toggleFavorite', 'method.BookDTO.toEntity', 'calls', observed('return dto.toEntity()', 'BookRepositoryImpl.swift:33')),
  // showDetail
  edge('c.detailBody.load', 'method.BookDetailView.body', 'method.BookDetailViewModel.load', 'calls', observed('.task { await viewModel.load() }', 'BookDetailView.swift:15')),
  edge('c.detailLoad.cache', 'method.BookDetailViewModel.load', 'method.BookCacheGateway.load', 'calls', observed('cacheGateway.load()', 'BookDetailViewModel.swift:19')),
  edge('c.detailLoad.execute', 'method.BookDetailViewModel.load', 'method.FetchBookDetailUseCase.execute', 'calls', observed('fetchBookDetailUseCase.execute(id:)', 'BookDetailViewModel.swift:24')),
  edge('c.detailExecute.repoFetchBook', 'method.FetchBookDetailUseCase.execute', 'method.BookRepository.fetchBook', 'calls', observed('repository.fetchBook(id:)', 'FetchBookDetailUseCase.swift:11')),
  edge('c.repoFetchBook.impl', 'method.BookRepository.fetchBook', 'method.BookRepositoryImpl.fetchBook', 'calls', observed('動的ディスパッチ (protocol witness)', 'BookRepository.swift:4')),
  edge('c.implFetchBook.cache', 'method.BookRepositoryImpl.fetchBook', 'method.BookCacheGateway.load', 'calls', observed('cache.load().first(where:)', 'BookRepositoryImpl.swift:39')),
  edge('c.implFetchBook.api', 'method.BookRepositoryImpl.fetchBook', 'method.BookAPIGateway.getBooks', 'calls', observed('キャッシュに無いとき api.getBooks()', 'BookRepositoryImpl.swift:42')),
]

const flows: Flow[] = [
  flow('flow.loadList', '一覧の読み込み', '一覧画面の表示から、API 取得・キャッシュ保存・Entity 変換までの流れ。', 'BookListView.onAppear (.task)', [
    { edgeId: 'c.listBody.load', note: '画面表示時に ViewModel の load を呼ぶ。' },
    { edgeId: 'c.load.fetchExecute', note: 'state を loading にして UseCase を呼ぶ。', data: '[Book]' },
    { edgeId: 'c.fetchExecute.repoFetch', note: 'UseCase は protocol の fetchBooks を呼ぶだけ。', data: '[Book]' },
    { edgeId: 'c.repoFetch.implFetch', note: 'プロトコル経由で BookRepositoryImpl に到達する。' },
    { edgeId: 'c.implFetch.getBooks', note: 'まず API から取得する。', data: '[BookDTO]' },
    { edgeId: 'c.implFetch.save', note: '取得結果をキャッシュに保存する。', data: '[BookDTO]' },
    { edgeId: 'c.implFetch.toEntity', note: 'DTO を Entity に変換して返す。', data: '[Book]' },
  ]),
  flow('flow.toggleFavorite', 'お気に入りの切り替え', '行のボタン押下から、サーバー更新とキャッシュ更新までの流れ。', 'BookRowView のお気に入りボタン押下', [
    { edgeId: 'c.listBody.toggle', note: 'タップ時に ViewModel へ本の id を渡す。', data: 'Book.ID' },
    { edgeId: 'c.toggle.toggleExecute', note: '現在の本を UseCase に渡す。', data: 'Book' },
    { edgeId: 'c.toggleExecute.repoToggle', note: '反転後の値を指定して Repository を呼ぶ。', data: 'isFavorite: Bool' },
    { edgeId: 'c.repoToggle.implToggle', note: 'プロトコル経由で実装に到達する。' },
    { edgeId: 'c.implToggle.put', note: 'サーバーに PUT して更新後の DTO を受け取る。', data: 'BookDTO' },
    { edgeId: 'c.implToggle.save', note: 'キャッシュ上の該当本を差し替えて保存する。', data: '[BookDTO]' },
    { edgeId: 'c.implToggle.toEntity', note: 'Entity に変換して ViewModel に返す。', data: 'Book' },
  ]),
  flow('flow.showDetail', '詳細の表示', '詳細画面の表示から、キャッシュ参照と UseCase 経由の取得までの流れ。', 'BookDetailView.onAppear (.task)', [
    { edgeId: 'c.detailBody.load', note: '画面表示時に ViewModel の load を呼ぶ。' },
    { edgeId: 'c.detailLoad.cache', note: 'ViewModel がキャッシュを直接読む (層をまたぐ依存)。', data: '[BookDTO]' },
    { edgeId: 'c.detailLoad.execute', note: 'キャッシュに無ければ UseCase を呼ぶ。', data: 'Book' },
    { edgeId: 'c.detailExecute.repoFetchBook', note: 'protocol の fetchBook を呼ぶ。', data: 'Book' },
    { edgeId: 'c.repoFetchBook.impl', note: 'プロトコル経由で実装に到達する。' },
    { edgeId: 'c.implFetchBook.cache', note: 'Repository 側でもまずキャッシュを探す。', data: '[BookDTO]' },
    { edgeId: 'c.implFetchBook.api', note: '無ければ API の一覧から探す。', data: '[BookDTO]' },
  ]),
]

export const bookShelfGraph: ProjectGraph = { rootId: 'project', nodes, edges, flows }

export const bookShelfSource: ProjectSource = {
  id: 'sample-bookshelf',
  label: 'BookShelf (サンプル iOS アプリ)',
  load: async () => bookShelfGraph,
}
