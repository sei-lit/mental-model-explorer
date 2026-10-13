# mini-app

## モジュール構成

| モジュール | 持つもの | 対応 |
| --- | --- | --- |
| `core` | ログなどの横断的な基盤 | 同名 |
| `domain:model` | `XxxDomainModel` | 同名 |
| `domain:usecase` | UseCase interface と `*Params` | 同名 |

## 依存の向き

| モジュール | 依存先 |
| --- | --- |
| `domain:usecase` | `api domain:model` / `api core` |
| `data:repositoryimpl` | `domain:usecase` / `core` |
