# 参照資料と照合範囲

## 添付・原文・前版
| コード | 資料 | 確認範囲 | 用途 |
|---|---|---|---|
| R1 | デジタルチェキアプリ-要求定義(1).txt（v4.1、原文内更新日2026-07-29） | 全720行・UTF-8原本 | docs/requirements.mdへ内容変更せず配置 |
| R2 | デジタルチェキアプリ-要求定義.txt（原文内更新日2026-07-20） | 全648行 | source-archiveへ原文保存。旧仕様の検出・不足の参考 |
| A1 | 前回のAGENTS.md | 19,428バイトの全文 | 主要ルールを継承・分割。旧版はZIPのreview/previous-AGENTS.txt |
| A2 | cheki_agent_setup.zip内docs/decisions.md | 10,434バイトの全文 | DEC-001〜016を継承、根拠/分類を追加 |
| C | 今回表示されている同プロジェクトの会話と画像 | 見えている発言・受領画像 | docs/decision-evidence.mdに必要な発言を抜粋 |
| P | 同プロジェクト関連の他チャット検索 | 取得できた関連会話の抜粋/要約 | 下記に限定。独立した新規決定の全文は未取得 |

R1 SHA-256：`27e7bdf73772431be8ca24eea645bd1c71143f926cb34d4a47f11ab9e09b50e5`

R2 SHA-256：`067a4dc5ce12a114b4e46bc2bd6e6506707529786ffc0d82381fb734c75b3a2e`

A1 SHA-256：`d03a93a14ccd812fdc5ca096767b8c2794bd9ddbd9758310eb6c990f32969038`

要求定義Excelの再変換や再編集は今回行っていない。プロジェクト上のR1テキストと配布済み原文を基準にした。

## 他チャットを調べた結果と限界
「チェキアプリ」「デジタルチェキ」「アプリ要件の深掘り」および技術/運用のキーワードで関連会話を2回検索した。
関連抜粋には、RN+Expo+TS採用（2026-08-05のユーザー発言として取得）、API/DB/S3構成（2026-08-07）、Android未用意でiPhone先行（2026-09-24）が含まれた。
ただし、本会話と重複する可能性があり、別チャットすべてのタイトル・全文を取得したわけではない。今回の確定値は、可能なものは現在の会話Cと原文R1で再確認した。
再検索でも、独立した他チャットの追加コーディング規約の全文は見つからなかった。

検索に混じったMM Code Academyや会社Webサイトの仕様は除外した。Next.js/Tailwind/静的出力/basePath/QR素材/ブランド色、コメント文体の制約を、このアプリの了承事項と認定しない。
FilesのProject検索ではR1の該当箇所を確認した。別名資料の重複・全文未取得の候補を確認済み原文として追加していない。

## 解析していないもの
ユーザーPCの作業フォルダー、GitHubの実リポジトリ、package/lockの実物、未取得の別チャット、添付されていない設計書。
それらを検証したとは主張せず、Codexで適用するときの初回調査対象にする。

## 外部公式資料（業務決定とは別）
技術的な誤記防止のため今回参照した一次資料。取得日：2026-09-25。実装時には導入済み版に合わせて再確認する。
| コード | 確認内容 | URL |
|---|---|---|
| E01 | AGENTSの階層読込、override、cwd、標準32KiB | https://developers.openai.com/codex/agent-configuration/agents-md |
| E02 | Expo GoとDevelopment Build | https://docs.expo.dev/develop/development-builds/introduction/ |
| E03 | SQLite永続化・パラメータ・schema | https://docs.expo.dev/versions/latest/sdk/sqlite/ |
| E04 | Cameraキャッシュ・権限・プレビュー | https://docs.expo.dev/versions/latest/sdk/camera/ |
| E05 | FileSystem API | https://docs.expo.dev/versions/latest/sdk/filesystem/ |
| E06 | SecureStoreの用途と端末差 | https://docs.expo.dev/versions/latest/sdk/securestore/ |
| E07 | Skia Canvas・画像取得 | https://shopify.github.io/react-native-skia/docs/canvas/overview/ |
| E08 | S3非同期削除・Versioning | https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html |
| E08b | S3 Lifecycle日時/日数計算 | https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html |
| E09 | S3署名URLの期限・再利用・DL継続 | https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html |
| E10 | App Storeアカウント削除要件 | https://developer.apple.com/support/offering-account-deletion-in-your-app/ |
| E11 | Expo Notifications | https://docs.expo.dev/versions/latest/sdk/notifications/ |
| E12 | EXPO_PUBLICの公開性 | https://docs.expo.dev/guides/environment-variables/ |

Google Play削除案内は今回の取得時にレート制限で本文確認できず、今回確認済み根拠には採用していない。公開前にGoogle側も確認する課題を残す。
外部資料の制約は、業務仕様を黙って修正する根拠として使わない。

初期会話に明示された継続事項と、旧原文だけに残る情報は[legacy-carryover.md](legacy-carryover.md)へ分離した。
