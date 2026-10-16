# 端末保存と復旧 — 階層別AGENTS

適用：`apps/mobile/src/storage/`配下。上位のAGENTSを引き継ぎ、業務仕様を勝手に上書きしない。

## 作業前に読む
- [保存復旧](../../../../.agents/rules/08-storage-recovery.md)
- [アカウント境界](../../../../.agents/rules/05-auth-roles.md)
- [送受信状態](../../../../.agents/rules/07-transfers-retention.md)

## この範囲のルール
SQLite・FileSystem・SecureStoreの直接操作をこの境界へ集約する。
ファイルとDBは同時コミットと仮定しない。一時状態/確定/復旧を記録する。
user/group/guestとmock/api環境で保存領域を分け、遅い書込でアカウントを横断しない。
未送信保護、不採用削除、手動ローカル削除、退会、テスト初期化を別処理にする。
DB migrationは非破壊を基本とし、型変更でユーザーの写真をdropしない。

関連原文・決定・未決事項はルートの参照先を確認する。実装範囲外のファイルへ変更が広がる場合は、その階層指示も読む。
