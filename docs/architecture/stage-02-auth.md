# 段階02 認証契約と実装メモ

対象：P1-AUTH-001 / G-001、P1-FAN-003 / F-004、共通起動 F-001 と最小ホーム G-002 / F-007。後二者の撮影・アルバム機能は今回未実装。

## 共通契約

`services/contracts/auth.ts` の `AuthService` をMockと将来のHTTP実装の境界とする。`signIn({email,password})` は `AuthSession {principal:{id,role,displayName},credential,expiresAt}` を返す。画面の入口選択は表示のみで、認可は返却された `principal.role` に従う。`restore(credential)` は有効セッションを再検証し、`signOut(credential)` は失効させる。nullの成功値はない。期限はUTC ISO文字列、ID・credentialは不透明文字列。エラーは `Validation`、`Unauthenticated`、`Forbidden`、`Expired`、`Storage`、`Conflict`、`Cancelled` 等の共通コードを使う。入力の空欄とメール形式は認証機能で検証し、登録時のパスワード規則はログインへ適用しない。

起動時は組み立て処理がSecureStoreのactive credentialを読み、仮サーバーへ復元確認してからExpo Routerの画面を描画する。無効・期限切れ・停止・削除はcredentialを消して未ログインにする。保存障害は起動/ログイン失敗として明示する。ログインの多重実行は拒否し、離脱・ログアウト前に開始した応答は世代番号で破棄して仮セッションを失効させる。ログアウトは表示とactive credentialを外し、元利用者の写真等の領域は消さない。今段階に購読はない。

## Mock専用の仮値と保存範囲

テストアカウントはグループA/B、ファンA/B、停止済みグループ、削除済みファン。`group@example.test` / `fan@example.test` と `DemoPass123` は初期デモ用。B等のアドレスは `mock-auth.ts` の架空データであり、人数上限や本番認証仕様ではない。同一メール複数役割はOPEN-004のまま。再設定・登録・ゲストの完了画面は表示しない。

仮サーバーのSQLite `auth` レコードはアカウント状態、セッションID・所有者・期限・失効を保持する。パスワードはSQLite・SecureStoreに保存せず、開発bundle内のモック専用比較値にする。端末のactive credentialだけをSecureStoreへ保存する。セッション期限24時間は**モック試験用の仮値**で、OPEN-003の本番JWT期限を確定しない。時計・ID生成を注入して試験する。既存fixtureは変更せず、認証レコードを別キーで初回だけseedする。通常起動で上書きしない。明示的なモック初期化だけ対象環境の認証・検証データを消す。本番URL/HTTPリクエスト形、JWT検証・署名は未定義。

UI上の共通選択・ログイン・役割別ホームは `src/app/index.tsx` 内の論理画面で、G/F別の保護routeは生成しない。`explore.tsx` は既存の公開テンプレートで、利用者情報を読まない。ホームはセッションがある場合だけ描画し、復元中は`ServicesProvider`が画面全体を保留する。
