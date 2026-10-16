# デジタルチェキ — 作業指示

作業前に実在するパス、Gitルート、差分を確認し、今回のユーザー依頼を優先する。
業務判断は [決定台帳](docs/decisions.md)、[現状](docs/current-status.md)、[未決事項](docs/open-questions.md)、対象の [要求定義](docs/requirements.md) と照合する。資料と実装・実機確認を混同しない。

対象階層の `AGENTS.md` と、必要な `.agents/rules/` を明示的に読む。同階層の `AGENTS.override.md` があれば優先関係を確認する。入口とルール一覧は [.agents/README.md](.agents/README.md) を参照する。

既存の Expo プロジェクト、ユーザー差分、SDK を保持する。業務通信だけを状態保持モックにし、本番用の境界と実装を作る。Windows と iPhone Expo Go を先行し、Android 実機未確認を区別する。秘密情報や実ユーザーデータを Git に入れない。
