# 12 — Git・秘密情報・承認

根拠：DEC-016/019、現在の実装依頼範囲。安全手順は本版の実装ルール。

## 最初に確認
```powershell
Get-Location
git status --short
git rev-parse --show-toplevel
git -C "apps/mobile" rev-parse --show-toplevel
```
実パスと存在を確認して実行。内側が独立リポジトリなら報告し、.git削除で勝手に統合しない。
エージェントから見えるリポジトリとユーザーPCが同じとは仮定しない。GitHub連携済みだけでpush/作成権限があるとは断定しない。

## 作業範囲
現在の依頼に関係する差分だけ。既存の未コミット変更、生成済みExpo指示、package/lock、ユーザー編集を保持する。
無断のreset --hard、clean -fd、force push、rebaseによる共有履歴変更、全ファイル整形、create-expo-appで再作成は禁止。
コードや画像をバックアップするときは原本を壊さず、復元手順と移動先を示す。ユーザーが許可しただけで自動全データ削除を行わない。

## 外部操作の承認
commit/push/PR/リポジトリ作成/ブランチ保護変更は明示的な依頼・承認がある場合だけ。
AWSリソース、EASビルド、ストア提出、メール送信、有料操作、実ユーザーデータ変更は実装とは別に承認を得る。
npm install等も作業の必要性と権限を確認。通信制限を迂回したり、execute-policyを安易に緩めたりしない。

## Gitへ入れないもの
.env.local/本番.env、秘密鍵、証明書の秘密部分、AWSキー、DB認証情報、実token、実ユーザー写真、実行時DB、node_modules、個人バックアップ。
架空のfixtureは本物の個人情報と分け、mock/test配下だけに置く。公開bundleへ残さない。
.env.exampleには非機密の設定名と例。EXPO_PUBLIC値はクライアントから見える（E12）。
appの設定ファイルに書けば秘密になるとは考えない。JWT署名鍵やAWS長期キーはアプリへ持たせない。

## 改善案と確定運用を区別
1リポジトリ、feature→PR→main、Actionsで型/Lint/testという提案はあるが、会社ownerやCI/レビュー人数は未確認。
1人開発で承認者2人を必須にするなど、実現不能な保護を無断で設定しない。
GitHub ActionsからAWSへ接続する認証方式も後続。いまはCIのために本番secretを投入しない。
