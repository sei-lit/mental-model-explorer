# Mental Model Explorer

A prototype interface for building a shared understanding of a software project between a human and an AI.
You explore the project as a graph — across abstraction levels and perspectives — and ask questions about
whatever you are looking at. The UI turns what you are looking at into structured context for the AI, and
the AI answers by pointing back into the same graph (highlights, what-if removal, traces).

人間とAIが、ソフトウェアプロジェクトについての理解（メンタルモデル）を同じ構造の上で一緒に組み立てるための
インターフェースのプロトタイプです。次の問いを、実際に操作して確かめるために作りました。

> 人間は、自分が見ているものをAIに説明し直すことなく、その対象について問いを立て、AIと一緒に理解を深められるか？

| 関係を選んで「なぜこの依存関係が必要なの？」 | 「Repositoryを削除するとどうなる？」の What-if |
| --- | --- |
| ![エッジを選んで質問すると、回答の文と対応する要素が図の上で強調される](docs/images/ask-about-edge.jpg) | ![削除されるもの・切れる関係・影響を受ける要素を図の上に表示する](docs/images/what-if-removal.jpg) |

## 使い方

ターミナルから起動します。AI の回答には、ログイン済みの [Claude Code](https://claude.com/claude-code) CLI
（`claude`）をヘッドレスモードで使います。課金は Claude のサブスクリプションに対して行われ、API キーは不要です。

```bash
git clone https://github.com/sei-lit/mental-model-explorer.git
cd mental-model-explorer
npm install
npm start            # ビルドして http://127.0.0.1:5178 を開く
```

| オプション | 内容 |
| --- | --- |
| `--project <path>` | 開くリポジトリのルート（既定は同梱のサンプル） |
| `--pr <n>` | その番号の PR の変更を重ねて開く（`gh` で取得。`--project` と一緒に使う） |
| `--diff <ref>` | `ref` からの変更（未コミット分を含む）を重ねて開く |
| `--model <name>` | `claude` に渡すモデル（既定 `sonnet`。深く考えさせたいときは `opus`） |
| `--mock` | `claude` を使わず、グラフのデータから組み立てるモック応答で動かす |
| `--port <n>` | ポート（既定 5178） |
| `--claude <path>` | `claude` コマンドのパス |
| `--no-open` | ブラウザを開かない |

`npm start -- --mock` のように `--` の後ろに渡します。`claude` が見つからない場合は自動でモック応答になります。
開発時は `npm run dev`（Vite。`MME_MOCK=1` でモック）、テストは `npm test`。

## 自分のプロジェクトを開く

リポジトリのルートを指定すると、Gradle の Kotlin Multiplatform ビルドと Swift Package を検出して 1 つのグラフにします
（両方あれば両方。例: KMP と iOS アプリが同居するリポジトリ）。

```bash
npm start -- --project /path/to/repo      # 開発時は MME_PROJECT=/path/to/repo npm run dev
```

**Kotlin（ルートの `settings.gradle.kts`）**

- `include(":a:b")` のモジュール（`:tools:` 配下は除外）を、最初のセグメントごとのグループにまとめる
- `build.gradle.kts` の `dependencies {}` にある `projects.x.y` / `project(":x:y")` をモジュール間の依存にする（framework の `export` は依存にしない）
- `src/{commonMain,androidMain,iosMain,jvmMain,main}/kotlin` から、型（class / interface / object / enum）とメンバー（companion object を含む）、トップレベル関数
- ルートの `CLAUDE.md` に「モジュール構成」「依存の向き」の表があれば、責務と依存してよい範囲（**推測**として表示）

**Swift（3 階層以内の `Package.swift` で `Sources/` に Swift を持つもの）**

- ターゲットと依存（標準の `.target(...)` と `let x = Target.target(name:, dependencies:, targetGroup:)` 形式）、TargetGroup ごとのグループ
- 型（struct / class / enum / protocol / actor）とメンバー。同じターゲット内の extension は元の型に統合し、外部の型への extension は別ノード
- `docs/architecture/module-kinds.md` 等があれば、モジュール種別から一意に決まる層（L0〜L6）と責務（**推測**）。曖昧な種別には層を付けない
- Kotlin の framework（例: `UsapoShared`）を import するファイルでは、KMP 側で一意な型名に一致した参照を境界辺（推定）としてつなぐ

**共通**

- 型の参照・継承は import と同一モジュール内で一意に決まる名前だけをつなぐ
- 呼び出し（`receiver.method(`）は引数・プロパティの宣言型から解決し、interface / protocol は実装へのディスパッチも推定する。
  画面のイベント・ライフサイクル（`onXxx` / `didTapXxx` / `load` / `body` / `viewDidLoad` 等）を入口に「流れ」を作る。
  これらは静的解析による**推定**で、破線で表示する（DI・クロージャ・フレームワーク経由の呼び出しは含まない）

完全な構文解析はしていません（正規表現と簡易スキャナ）。2 万ノード規模（KMP 17 モジュール + iOS 323 ターゲット）で動作を確認しています。

## PR を読む

```bash
gh pr checkout 123                                   # 解析するコードを PR の先頭にそろえる
npm start -- --project /path/to/repo --pr 123        # または --diff origin/main
```

- 差分の各行を、それを含む最小の宣言（メソッド・プロパティ・型）に対応づけます。差分はローカルの `git diff`（作業ツリーと merge-base の間）で取り、`gh` は PR のタイトル・本文・base を取るだけに使います。
- 開くと「変更周辺だけ」の表示から始まります。変更を含む要素と、それと直接つながる要素だけを描き、変更を含む要素には「変更 n」の印が付きます。範囲内に変更が無ければ何も隠しません。
- 何も選んでいないとき、右側にこの範囲で変更された宣言の一覧が出て、そこから辿れます。
- 質問のコンテキストに PR のタイトル・本文の抜粋と、今の範囲で変更された宣言が入ります。「この PR は何を変えた？影響しうるのはどこ？」のように聞けます。
- HEAD が PR の先頭と違うときや、未コミットの変更を含むときは ⚠ で知らせます。削除された宣言は、ファイルの一覧にだけ残ります。

## できること

### Explore — 構造を探索する

- **Semantic Zoom**: ノードをダブルクリックすると、その内部に入ります（Project → Package → Module →
  Type → Method → Code）。入った先では、子要素どうしの依存がその粒度に持ち上げて表示され、外側の要素は
  「枝分かれした階層」の粒度で薄く表示されます。キャンバスのズームでもカードの情報量が変わります。
- **3 つの視点**: Structure（包含・依存）/ Responsibility（責務・役割・制約。観測か推測かを区別）/
  Flow（処理の流れを番号付きで。今いる範囲を通る流れを自動で選ぶ）。視点を切り替えても、選択と抽象度はそのまま残ります。
- **関係が多い画面**: 描く関係が 40 本を超えると、選んだ・ポイントした要素の関係（と AI の回答が指す関係）だけを描き、各カードには関係の相手の数を出します。
- **関係を選ぶ**: エッジも選択でき、集約されたエッジは内訳（根拠・理由）を確認できます。層の向きに反する依存は ⚠ で示します。
- **探索の経路**: 戻る・進むと、パンくずで現在地を保ちます。

### Understand — AI と理解を組み立てる

- 何かを選んで質問欄に書くだけで、選択対象（ノード / 複数ノード / エッジ / コードの行範囲 / 画面全体）が
  質問の対象になります。「AI に渡す内容」を開くと、実際に送るコンテキストと、予算内に収めるために省いた件数を確認できます。
- 回答は文章と図が対応しています。文にカーソルを合わせると該当要素が強調され、参照チップを押すとその要素へ移動して探索を続けられます。
- 「削除するとどうなる？」には、影響範囲を UI 側で計算した Before / After を表示します（構造上の推定）。処理の流れは trace として番号付きで辿ります。
- 回答カードは質問したときの視点を覚えていて、「この時の画面に戻る」で戻れます。

## 設計

```
src/core/model          グラフ（包含は parentId、依存・呼び出しは葉同士のエッジ、主張は観測/推測を区別）
src/core/exploration    探索状態（scope = 抽象度、perspective、selection、履歴、trail）とビュー射影
src/core/understanding  質問コンテキストの構築、回答スキーマと検証、削除シミュレーション、モック応答
src/data                ProjectSource とサンプル（iOS の本棚アプリ）。将来のリポジトリ解析はここに足す
src/ui                  React + React Flow
server                  API（/api/project, /api/config, /api/ask）と claude CLI の呼び出し、起動用 CLI
```

### 「人間が注目しているもの」を AI にどう渡すか

UI の状態をそのまま送るのではなく、質問対象（subject）を中心に、次のものを予算内で抽出します。

| 軸 | 内容 |
| --- | --- |
| `target` / `subject` | 何について問うているか。エッジなら両端・根拠・理由、集約エッジなら relation 別の内訳と代表例（種類ごとに 1 例を先に選ぶ） |
| `lens` | 抽象度（どのノードの内部をどの粒度で見ているか）と視点、Flow なら手順 |
| `visible` | いま画面にある要素。多すぎるときは subject に接するものを優先 |
| `nearby` | 画面外だが subject と直接つながる要素（AI が名前を挙げられるように） |
| `trail` | そこに至るまでの探索を数文に圧縮（連続した選択は最後のものだけ） |
| `previous` | 直前の回答（追い質問のため） |
| `omitted` | 省いた件数。UI にも表示する |

### AI の回答を UI に反映するときの安全性

- 回答は構造化データ（`answerSchema`）で受け取り、モデルが返すのはノード / エッジの ID と宣言的な
  visual（`whatIfRemove` / `trace`）だけです。影響範囲の計算と描画は UI が行い、モデルの出力を実行しません。
- サーバーで ID の実在を検証し、存在しない参照は除外して画面に件数を表示します。visual は一部でも不正なら丸ごと捨てます。
- `claude` はツールを無効化し、空の一時ディレクトリで起動します（CLAUDE.md などに影響されないように）。
  サーバーは 127.0.0.1 にだけ bind し、ほかのサイトや DNS rebinding からの API 呼び出し（サブスクリプションを
  勝手に消費される）を防ぐため、Host / Origin が自分自身のリクエストだけを受け付けます。

## スコープ外

理解度の評価、メンタルモデルの永続化、ソースコードの編集、GitHub リポジトリの自動解析、複数人での同時編集、認証。

## License

MIT
