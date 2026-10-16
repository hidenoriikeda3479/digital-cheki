# 将来のASP.NET Core API — 階層別AGENTS

適用：`apps/api/`配下。上位のAGENTSを引き継ぎ、業務仕様を勝手に上書きしない。

## 作業前に読む
- [APIとAWS](../../.agents/rules/11-backend-aws.md)
- [契約](../../.agents/rules/03-architecture-contracts.md)
- [認可](../../.agents/rules/05-auth-roles.md)

## この範囲のルール
このディレクトリに指示ファイルがあるだけでAPIプロジェクト作成を許可されたと解釈しない。
C# ASP.NET Core Web API / PostgreSQL方針。具体的.NET/EF/Npgsql版は実環境確認後に選定する。
Mockと一致する契約・所有者検証・期限・重複防止を実装。実JWT署名鍵やRDS秘密情報をモバイルへ持たせない。
DB/S3/通知の分散処理をまとめて成功と仮定しない。失効・結果不明・重複イベントを試験する。

関連原文・決定・未決事項はルートの参照先を確認する。実装範囲外のファイルへ変更が広がる場合は、その階層指示も読む。
