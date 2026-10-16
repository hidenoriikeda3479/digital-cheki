# 将来のAWS設定 — 階層別AGENTS

適用：`infra/`配下。上位のAGENTSを引き継ぎ、業務仕様を勝手に上書きしない。

## 作業前に読む
- [AWS](../.agents/rules/11-backend-aws.md)
- [外部操作](../.agents/rules/12-git-security.md)

## この範囲のルール
AWS採用済みだが、今のモック作成で課金リソースを作らない。
RDS PostgreSQL/S3/SESの方針は維持。EC2/ECS/Fargate・AZ・size・backup・IaCツールは未確定。
開発/本番を分離し、本番の画像削除・schema操作・署名資格情報変更は別承認を取る。
S3 Lifecycleが厳密な7日アクセス失効を単独で実現すると説明しない。バージョンや既発行URLも確認する。

関連原文・決定・未決事項はルートの参照先を確認する。実装範囲外のファイルへ変更が広がる場合は、その階層指示も読む。
