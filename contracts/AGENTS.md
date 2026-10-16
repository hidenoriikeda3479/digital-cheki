# API仕様（将来HTTPとの接点） — 階層別AGENTS

適用：`contracts/`配下。上位のAGENTSを引き継ぎ、業務仕様を勝手に上書きしない。

## 作業前に読む
- [契約](../.agents/rules/03-architecture-contracts.md)
- [状態と期限](../.agents/rules/07-transfers-retention.md)
- [将来のAPI](../.agents/rules/11-backend-aws.md)

## この範囲のルール
ここはAPI仕様書用。現在まだopenapi.yamlがない場合、存在/稼働済みとして扱わない。
依頼対象の機能から入力/出力/エラー/認証/冪等性を記載する。GET/POST等のHTTP形式は合意・実装に合わせる。
Mockの都合で個人情報フィールドや成功応答を増やさない。TypeScript型だけでなくruntimeの検証も合わせる。
契約変更ではアプリとモック・テストの対応を更新し、将来C#にも同じ制約を適用する。

関連原文・決定・未決事項はルートの参照先を確認する。実装範囲外のファイルへ変更が広がる場合は、その階層指示も読む。
