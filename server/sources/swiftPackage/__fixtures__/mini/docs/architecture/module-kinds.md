# モジュール種別カタログ

## カタログ

| 種別 | 命名 | レイヤー | TargetGroup | いつ作るか |
| --- | --- | --- | --- | --- |
| Feature | `<Domain>Feature` | L5 | .feature | 画面ドメイン新設時に ScreenRequests とペアで機械的に作成 |
| 遷移契約 | `<Domain>ScreenRequests`（複数形） | L2 | .screenRequest | 同上（Feature とペア）。中身は ID・値型のみ |
| ドメインモデル（語彙） | `<Domain>Model` | L2 | .model | 型・語彙が 2 モジュール以上で共有されたとき |
| **共有語彙** | `<Concept>Model`（サフィックスは Model を維持） | L1 | .model | 凍結可能な値語彙が無関係な 2 ドメイン以上から参照されたとき |
| イベント定義 | `<Domain>EventModel` | L2 | .model | イベントを持つドメインに作成 |
| Repository 実装 | `<Domain>Repository` | L4 | .serviceAndManager（暫定） | live 実装を Model から分離するとき |
| ドメインサービス | `<Domain>Service`（**Manager は新規禁止**。SDK アダプタ側の `<SDK 名>Service` は新規禁止） | L4 | .serviceAndManager | 外部作用が複数消費者を持つとき |
| 計測・SDK アダプタ（外縁） | `<SDK 名>Tracker`（計測）。**`<SDK 名>Service` は新規禁止** | L3（外縁） | .serviceAndManager | ベンダー SDK 1 つにつき 1 アダプタ |
| ドメイン UI 部品 | `<Domain>View` | L4 | .view | Feature 内の部品に 2 人目の消費者が現れたとき |
| 名前付き共有概念 UI | `<Concept>View` | 参照する語彙の最外層 | .view | 横断利用されるとき |
| 合成ルート | `App`（唯一） | L6 | .core | 作成済み |

## 命名規則

| 種別 | 命名 | レイヤー | TargetGroup | いつ作るか |
| --- | --- | --- | --- | --- |
| 無関係 | `<X>Bogus` | L0 | .core | カタログ外の表は読まない |
