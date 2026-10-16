# 外部依存の呼び出し口 — 階層別AGENTS

適用：`apps/mobile/src/services/`配下。上位のAGENTSを引き継ぎ、業務仕様を勝手に上書きしない。

## 作業前に読む
- [契約](../../../../.agents/rules/03-architecture-contracts.md)
- [モック](../../../../.agents/rules/04-mock-services.md)
- [転送状態](../../../../.agents/rules/07-transfers-retention.md)

## この範囲のルール
入力/戻り値/エラー/進捗/取消の意味を決めてからMockを実装する。
UIはインターフェースだけに依存し、選択・注入はここに集約する。api未実装は明示エラー、mockへ自動fallbackしない。
写真のバイト転送はJSON通信と分けてもよいが、コピー完了前に成功を返さない。
状態照会は再送と別。結果不明を成功/失敗に推測しない。
services/contractsとリポジトリ直下contracts(OpenAPI)を混同せず対応を文書化する。

関連原文・決定・未決事項はルートの参照先を確認する。実装範囲外のファイルへ変更が広がる場合は、その階層指示も読む。
