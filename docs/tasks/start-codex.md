# 配置後にCodexへ送る初回指示

```text
今回は分割したエージェント指示と既存プロジェクトの照合だけを行ってください。
コード変更、依存追加、commit、push、AWS/EASの操作はまだ行わないでください。

1. ルートAGENTS.md、変更先までのAGENTS.mdとAGENTS.override.mdを確認する
2. docs/current-status.md、docs/decisions.md、docs/open-questions.mdを読む
3. モバイル・services・configに関係する階層別AGENTSと詳細ルールを読む
4. docs/requirements-coverage.mdのAUTH/FAN/GST/IDと要求原文を確認する
5. 現在のGit管理範囲、package/lock、Expo版、scripts、画面構成を読み取る
6. 記載された現在状態と実ファイルとの差を報告する
7. 本番用の構造でモックログインを作るための最小変更計画を示す

読んだ指示ファイル、対象要件ID、予定ファイル、確認方法、未決点を報告してください。
iPhone Expo Goで起動済みのプロジェクトは作り直さないでください。
「資料がある」と「機能が実装・試験済み」を区別してください。
```

認識確認の質問：
「アプリ本数、現在の実機、外部通信の可否、写真と通知の期限、再送方法、未承認の退会変更を要約してください」

期待：1アプリ/iPhone先行・Android未用意/業務通信なし/写真7日・通知30日/手動のみ/本番退会は要確認。
異なる場合はoverride、別階層AGENTS、古い会話・原文の適用範囲を確認する。
