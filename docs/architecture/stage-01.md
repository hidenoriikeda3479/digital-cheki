# 段階01の構成・契約

対象は共通基盤のみ。要求原文・画面番号を変更しない。関連画面G-001/G-002/G-006/G-007/G-009/G-011/F-004/F-007/F-009の機能は未実装。

## 組み立てと値

`src/app/_layout.tsx` → `services/provider.tsx` → `services/compose.ts` が起動時に一度初期化する。UIは `FoundationCheckService` に依存し、SQL・保存SDK・Mock実装・fetchを直接呼ばない。

`EXPO_PUBLIC_APP_ENV` は development/staging/production、`EXPO_PUBLIC_DATA_SOURCE` は mock/apiを既存名として継続。両方必須、production+mockはconfig評価時/実行時に拒否、api未実装はNotImplemented。APIが失敗してもモックへ移らない。値は公開可能な設定のみ。

`EntityId` は意味を解釈しない文字列。ID生成は注入し、端末実装はExpo CryptoのrandomUUID。`Clock` を注入し、境界時刻はUTC ISO文字列に正規化する。業務期限・JWT寿命・容量上限は設定していない。`AppError.code` でエラーを分類し、未知例外/ネイティブcause/認証情報をUIやconsoleへ出さない。

## 保存配置と移行

- SQLiteは既存 `digital-cheki-state.db` / `app_state` を再利用。`PRAGMA user_version=1`。版0は既存行を維持してtransaction内で表作成と版更新。未来版は明示エラー。毎回DROPしない。
- キーとファイルの相対配置は `digital-cheki/<environment>/<mock|api>/<group|fan|mock-server>/id-<owner-idのUTF-16 hex>/...`。roleとownerを含め、同じID文字列でも別領域になる。
- FileSystemの基準は `Paths.document`。名前は単一ファイル名のみ許可し、URI/絶対パス/親ディレクトリ移動を受け付けない。DBにはファイル名と状態だけを記録し、写真バイト列を入れない。
- モック初期データは仮サーバーの `fixtures` キーにpayloadのschemaVersionとseedVersionを別々に保存。既存seedVersionを更新だけで偽装せず、起動時再投入をしない。
- SecureStoreは同じ名前空間のgroup/fanの小さなtoken用。password/画像は対象外。生体認証オプションは有効化していない。今回の確認画面ではtokenを書き込まない。

## 確認専用ポート

`services/contracts/foundation-check.ts` に次を定義。これはローカル保存診断の契約であり、HTTP URLや業務認証APIの仕様ではない。OpenAPIはこの段階では作らない。

| 処理 | 入出力・完了条件 |
|---|---|
| `read(targetId)` | 指定されたテスト対象の最新レコード、ファイル内容、seed集計を返す。未保存はrecord/fileContents=null。未知対象はValidation |
| `save(targetId)` | 注入ID/Clockで記録を作る。pendingをDBへ保存→一時ファイル書込/読込照合→最終ファイルへ確定→DBのlatestを確定→pending削除の後だけ成功 |
| `reset('RESET_MOCK_DATA')` | UI確認後に呼ぶ。指定開発環境のmock DBキー/ファイルと既知テスト利用者tokenのみ除去して再seed。本番/api・他環境・他フォルダーは対象外 |

全操作は同じサービスインスタンス内で直列化。利用者の名前空間は操作開始時に固定する。UIは対象変更時に旧表示を消し、旧対象の遅い結果を適用しない。一般ユーザー認証を実装した意味ではない。

pendingが残った場合、最終ファイルが正しい内容なら同じID/時刻でDBを確定。未確定なら該当の一時ファイルとpendingだけを取り除き、前の正常latestを保持する。異なる内容や欠損したlatestはStorageとして報告する。検証ファイルの過去版は明示resetまで残す。

resetは開始マーカーをDBへ先に記録する。中断時は次回初期化で同じmock領域の処理を再開し、成功後にマーカーを除く。任意のパスを再帰削除するAPIは確認画面へ渡さない。

## 検証・配布の境界

`__DEV__` の静的分岐からだけMock組み立てと確認画面を参照する。iOSのproduction/api JS bundleを実際に生成し、fixture/確認画面固有の識別文字列がないことを `scripts/check-release-bundle.cjs` で確認。API実装・署名・配布試験の合格ではない。

SQLite/FileSystem/SecureStore/CryptoはSDK57の互換版をExpo installで導入。[SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)、[FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/)、[SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)の公式資料と導入型を確認した。FileSystem/SecureStoreの固定v57 URLは取得できず、latestが57.0.7/57.0.4を示すことを照合した。FileSystemは新APIのみ。SecureStore config pluginは専用ビルド用設定であり、Expo Goへ設定を反映したとはしない。

実行結果とiPhone手順は [実装進捗](../implementation-progress.md)。
