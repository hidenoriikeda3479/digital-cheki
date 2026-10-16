# 段階13 モック統合確認・公開前チェックリスト

2026-09-25 時点。原文は [requirements.md](../requirements.md)、画面定義は [screen-map.md](../screen-map.md)、受入項目は [acceptance-cases.md](acceptance-cases.md)。**コードあり／Jest合格／iPhone Expo Go合格／本番連携済みは別の状態**である。以下の「自動」は記載の Jest が検証した範囲だけを指し、52件の正式受入または実機合格を意味しない。iPhone操作結果は受領していない。

2026-09-26のDEC-029変更：受付一覧を独立表示し、受付単位の送信結果を写真一覧に示す。`apps/mobile`で型チェック・Lint・44スイート/170件のJestが成功。旧写真別送信試験も残るが現行アプリ配線の証跡には数えない。受付単位の部分失敗/再送/応答喪失は`mock-upload-service.integration.test.ts`内の新しいbatch試験と`full-journey.integration.test.ts`で確認。iPhone実機と本番APIは未確認。

## 実行結果と再現条件

- `apps/mobile` から `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:ci` を実行する。今回追加した `src/services/mock/full-journey.integration.test.ts` はデスクトップ上の SQLite、実ファイル、Skia と状態保持モックを使い、グループ→会員番号→2アイドル→3枚→写真別編集→JPEG生成→送信→ファン受信→検索・お気に入り・通知→再起動→別ファン隔離を通す。カメラ撮影・QR読取とiPhone上の描画は別途実機で行う。
- 異常系の既存証跡は `src/services/mock/mock-upload-service.integration.test.ts`（部分失敗、手動3回、応答喪失、7日、通知条件）、`src/services/mock/mock-download-service.integration.test.ts`（失敗→手動再受信、期限、別ファン、通知30日）、`src/services/local-capture.integration.test.ts`（中断、容量、所有者）、`src/services/local-editing.integration.test.ts`（保存世代）、`src/services/mock/mock-support-account.test.ts`（退会）、`src/features/identification/qr-scanner.test.tsx` と `src/features/capture/capture-camera.test.tsx`（権限拒否）である。実際のOS強制終了・低容量・カメラ拒否はiPhone確認待ち。
- Jest の `src/testing/network-guard.ts` は fetch / XMLHttpRequest / WebSocket を遮断する。ソース走査で業務 `fetch`、業務外部画像URL、通知SDK呼出しは見つからなかった。画像画面の URI はローカル写真参照で、`src/app/explore.tsx` の外部リンクはExpoサンプルのドキュメントリンクである。ネイティブ画像ローダー・OS通信・Metroを含む完全なパケット監査は行っていない。
- `EXPO_PUBLIC_APP_ENV=production`、`EXPO_PUBLIC_DATA_SOURCE=api` でローカル iOS Hermes `.hbc` と検査用の `--no-bytecode` JS を生成した。`node scripts/check-release-bundle.cjs stage130-release` は既知 fixture / debug マーカー不在を確認した。一方、公開JSには `mockPasswordInbox` などモック専用の **プロパティ名** が残る。これは JS文字列の限定検査であり、Hermes成果物自体の全内容、署名済み配布物、アセット、モック専用型/UIの完全排除は保証しない。production＋mock は設定で拒否、api は `NotImplemented`。公開アプリとして起動・利用はできない。

## P1 52件の追跡

以下のコード・試験パスはすべて `apps/mobile/src/` 相対。`実機待ち` は全49アプリ要件に共通。`本番待ち` は業務API/配信/運用が必要な部分を示す。表で「自動」とした行も正式な `AT-P1-*` は未実施のまま。

| FR | 実装ファイル | 自動試験の証跡・限界 |
|---|---|---|
| P1-AUTH-001 | `features/auth/auth-screen.tsx`, `services/mock/mock-auth.ts` | `features/auth/auth-screen.test.tsx`, `services/mock/mock-auth.test.ts`; 本番認証待ち |
| P1-AUTH-002 | `features/auth/password-screen.tsx`, `services/mock/mock-auth.ts` | `services/mock/mock-password.test.ts`; 実メール待ち、G-002採番はOPEN-015 |
| P1-FAN-001 | `features/auth/enrollment-screen.tsx`, `services/mock/mock-enrollment.ts` | `services/mock/mock-enrollment.test.ts`; 本番登録API待ち |
| P1-FAN-002 | `features/auth/enrollment-screen.tsx`, `services/mock/mock-enrollment.ts` | `services/mock/mock-enrollment.test.ts`; 実メール待ち |
| P1-FAN-003 | `features/auth/auth-screen.tsx`, `services/mock/mock-auth.ts` | `features/auth/auth-screen.test.tsx`, `services/mock/mock-auth.test.ts`; 本番認証待ち |
| P1-FAN-004 | `features/auth/validation.ts`, `features/auth/password-screen.tsx` | `services/mock/mock-password.test.ts`, `services/mock/mock-enrollment.test.ts`; 本番認証待ち |
| P1-GST-001 | `features/auth/enrollment-screen.tsx`, `services/mock/mock-enrollment.ts` | `services/mock/mock-enrollment.test.ts`; 異端末復旧はOPEN-020 |
| P1-GST-002 | `features/identification/qr-code.tsx`, `services/mock/mock-identification.ts` | `services/mock/mock-enrollment.test.ts`, `services/mock/mock-identification.test.ts`; iPhone表示待ち |
| P1-GST-003 | `services/mock/mock-enrollment.ts`, `storage/namespace.ts` | `services/mock/mock-enrollment.test.ts`; 他端末は未確認 |
| P1-ID-001 | `features/identification/qr-scanner.tsx`, `services/mock/mock-identification.ts` | `features/identification/qr-scanner.test.tsx`, `services/mock/mock-identification.test.ts`; 実カメラ待ち |
| P1-ID-002 | `features/identification/identification-screen.tsx`, `services/mock/mock-identification.ts` | `features/identification/identification-screen.test.tsx`, `services/mock/mock-identification.test.ts`; 実機表示待ち |
| P1-ID-003 | `services/mock/mock-identification.ts`, `features/identification/identification-controller.ts` | `services/mock/mock-identification.test.ts`, `services/mock/mock-enrollment.test.ts`; 実QR待ち |
| P1-SHT-001 | `features/identification/identification-controller.ts`, `services/mock/mock-identification.ts` | `features/identification/identification-controller.test.ts`; 通し試験も複数選択 |
| P1-SHT-002 | `features/capture/capture-camera.tsx`, `services/local-capture.ts` | `services/local-capture.integration.test.ts`, `services/mock/full-journey.integration.test.ts`; 実撮影待ち |
| P1-SHT-003 | `features/capture/capture-controller.ts`, `services/local-capture.ts` | `services/local-capture.integration.test.ts`; 実機削除待ち |
| P1-SHT-004 | `features/capture/capture-controller.ts`, `services/local-capture.ts` | `services/local-capture.integration.test.ts`, 通し試験; 実撮影待ち |
| P1-FRM-001 | `features/editing/editing-screen.tsx`, `services/local-editing.ts` | `services/local-editing.integration.test.ts`; 実機表示待ち |
| P1-FRM-002 | `features/editing/editing-screen.tsx`, `services/local-editing.ts` | `features/editing/editing-screen.test.tsx`, `services/local-editing.integration.test.ts`; 実機操作待ち |
| P1-FRM-003 | `services/local-editing.ts`, `features/editing/editing-controller.ts` | `services/local-editing.integration.test.ts`; 実機操作待ち |
| P1-DRW-001 | `features/editing/editing-screen.tsx`, `services/local-editing.ts` | `features/editing/editing-screen.test.tsx`, `services/local-editing.integration.test.ts`; タッチ描画待ち |
| P1-DRW-002 | `features/editing/editing-controller.ts`, `services/local-editing.ts` | `features/editing/editing-controller.test.ts`, 通し試験; 本人操作の実機証跡待ち |
| P1-IMG-001 | `features/finished-image/skia-renderer.ts`, `services/local-finished-image.ts` | `features/finished-image/skia-renderer.integration.test.ts`, 通し試験; 実写真待ち |
| P1-IMG-002 | `features/editing/editing-config.ts`, `services/local-finished-image.ts` | `services/local-finished-image.integration.test.ts`; 出力値は仮、実機測定待ち |
| P1-IMG-003 | `features/finished-image/skia-renderer.ts`, `features/editing/editing-config.ts` | JPEG寸法の自動確認のみ。Android表示、形式・圧縮の確定は未検証・OPEN-002 |
| P1-UPL-001 | `services/mock/mock-batch-upload.ts`, `storage/mock-photo-transfer.ts` | 受付一括操作の通し試験; 実サーバー待ち |
| P1-UPL-002 | `features/upload/batch-upload-controller.ts`, `services/mock/mock-batch-upload.ts` | 現行は受付単位。写真別原文との差はDEC-029/OPEN-029、実機待ち |
| P1-UPL-003 | `features/capture/capture-screen.tsx`, `services/mock/mock-batch-upload.ts` | 受付単位の手動再送・既受領ID重複防止の結合試験。実機待ち |
| P1-UPL-004 | `services/mock/mock-batch-upload.ts` | 受付失敗数のみ保存。現行UIに3回要対応表示は未実装、OPEN-029 |
| P1-UPL-005 | `services/mock/mock-batch-upload.ts`, `services/mock/mock-upload-server.ts` | 受付完了後の再送拒否、部分成功後の既受領ID照会。実API冪等性待ち |
| P1-UPL-006 | `services/mock/mock-upload-server.ts` | 同上で操作時の期限処理。アプリ終了中の独立削除ジョブは未実装・本番待ち |
| P1-UPL-007 | `services/mock/mock-batch-upload.ts`, `services/mock/mock-upload-server.ts` | 写真IDの受領記録を残し受付再送を拒否。実サーバー待ち |
| P1-UPL-008 | `features/photo-management/photo-management-screen.tsx`, `services/local-photo-management.ts` | `services/local-capture.integration.test.ts`; 実機容量・削除待ち |
| P1-REC-001 | `services/local-capture.ts`, `services/local-editing.ts`, `services/mock/mock-batch-upload.ts` | DEC-037/043で送信前の途中保存・未完了表示を現行対象から変更。送信確定後の転送状態だけ照会/手動再送。画面/サービス試験、実機中断待ち |
| P1-REC-002 | `features/capture/capture-controller.ts`, `services/local-photo-management.ts` | DEC-043で送信前中断は再開せず、新規受付へ。再起動後の旧受付非表示と確定後失敗の再送を試験。iPhone未確認 |
| P1-DWN-001 | `services/mock/mock-download-service.ts`, `storage/mock-photo-receive.ts` | `services/mock/mock-download-service.integration.test.ts`, 通し試験; 実API待ち |
| P1-DWN-002 | `features/download/download-controller.ts`, `services/mock/mock-download-service.ts` | `services/mock/mock-download-service.integration.test.ts`; 異端末はOPEN-021 |
| P1-DWN-003 | `features/download/download-screen.tsx`, `services/mock/mock-download-service.ts` | 同上で失敗後手動再受信; 実回線待ち |
| P1-DWN-004 | `storage/mock-photo-receive.ts`, `services/mock/mock-download-service.ts` | 同上で実ファイル・SQLite確認; 実端末待ち |
| P1-DWN-005 | `services/mock/mock-download-service.ts`, `services/mock/mock-upload-server.ts` | 同上で期限後拒否; 期限中転送はOPEN-018 |
| P1-NTF-001 | `services/mock/mock-upload-server.ts`, `services/mock/mock-upload-service.ts` | `services/mock/mock-upload-service.integration.test.ts`; リモート配信未実装 |
| P1-NTF-002 | `services/mock/mock-download-service.ts` | 内部文面は結合試験済み。DEC-046で表示画面を削除し、現UIの表示は未実装。最終文言待ち |
| P1-NTF-003 | `services/mock/mock-download-service.ts` | 30日保持は結合試験済み。DEC-046で通知一覧・遷移を削除し、現UIの一覧・遷移は未実装 |
| P1-ALB-001 | `features/download/download-screen.tsx`, `services/mock/mock-download-service.ts` | 通し試験、`services/mock/mock-download-service.integration.test.ts`; 実端末待ち |
| P1-ALB-002 | `features/download/album-filter.ts`, `features/download/download-screen.tsx` | `features/download/album-filter.test.ts`, 通し試験; 実機操作待ち |
| P1-ALB-003 | `services/mock/mock-download-service.ts`, `features/download/download-screen.tsx` | `services/mock/mock-download-service.integration.test.ts`, 通し試験; 実機待ち |
| P1-ALB-004 | `features/download/album-filter.ts`, `services/mock/mock-download-service.ts` | `services/mock/mock-download-service.integration.test.ts`; 実機待ち |
| P1-ACC-001 | `features/auth/account-settings-screen.tsx`, `services/mock/mock-auth.ts` | `services/mock/mock-support-account.test.ts`; 本番削除方針はOPEN-001/005 |
| P1-ACC-002 | `services/mock/mock-auth.ts` | モック論理削除と履歴保持のみ。実サーバー分析・削除管理は未実装、本番待ち |
| P1-SUP-001 | `features/support/support-screen.tsx`, `services/mock/mock-support.ts` | `features/support/support-screen.test.tsx`, `services/mock/mock-support-account.test.ts`; 実受付待ち |
| P1-OPR-001 | アプリ実装対象外。`services/mock/fixtures.ts` は試験データ | **未実施**。本番DB直接登録/変更・履歴を運用環境で確認する |
| P1-OPR-002 | アプリ実装対象外。モックseedは作業者履歴ではない | **未実施**。本番DBの作業者・日時・変更内容を確認する |
| P1-OPR-003 | アプリ実装対象外。モック受信箱は人力メールではない | **未実施**。運用担当者による実メール送付・到達を確認する |

## フェーズ1の29論理画面ID

画面は Expo Router の1アプリ内で共通コンポーネント/状態で表示する。以下のコード先は `apps/mobile/src/features/` 相対。各画面の原文遷移は [screen-map.md](../screen-map.md) を参照。全29画面の **iPhone実機操作は未確認**。自動の画面テストは対象の `*.test.tsx`、結合導線は `services/mock/full-journey.integration.test.ts` を参照する。後者はネイティブ画面をタップした証跡ではない。

| ID | 実装入口 | 検証方法・残り |
|---|---|---|
| G-001 | `auth/auth-screen.tsx`, `auth/password-screen.tsx` | 画面Jest、実機待ち。再設定の正式IDはOPEN-015 |
| G-002 | `auth/auth-screen.tsx`, `capture/capture-screen.tsx` | DEC-043で未完了入口を外し、送信前中断後は新規受付から開始。画面Jest、iPhone確認待ち |
| G-003 | `identification/qr-scanner.tsx` | QR権限Jest、実機読取待ち |
| G-004 | `identification/identification-screen.tsx` | 画面Jest、実機表示待ち |
| G-005 | `identification/identification-screen.tsx` | 画面Jest/通し試験、実機選択待ち |
| G-006 | `capture/capture-camera.tsx` | 権限Jest、実撮影待ち |
| G-007 | `capture/capture-screen.tsx` | 画面Jest、実機削除待ち |
| G-008 | `editing/editing-screen.tsx` | 画面Jest、実機確認待ち |
| G-009 | `editing/editing-screen.tsx` | 画面Jest/通し試験、実機描画待ち |
| G-010 | `finished-image/finished-image-screen.tsx` | 画面Jest/通し試験、実画像確認待ち |
| G-011 | `capture/capture-screen.tsx`, `upload/batch-upload-controller.ts` | DEC-029により写真一覧へ統合、独立画面なし。受付共通×/✓の画面試験、実機待ち |
| G-012 | `capture/capture-screen.tsx`, `services/mock/mock-batch-upload.ts` | DEC-029により写真一覧へ統合。受付単位の手動再送・結果照会試験、実機待ち |
| G-013 | `photo-management/photo-management-screen.tsx` | local-capture結合Jest、実機削除待ち |
| G-014 | `support/support-screen.tsx` | 画面Jest、実機受付待ち |
| F-001 | `auth/auth-screen.tsx` | 画面Jest、実機起動待ち |
| F-002 | `auth/enrollment-screen.tsx` | 登録Jest、実機待ち |
| F-003 | `auth/enrollment-screen.tsx` | 10分コードJest、実機待ち |
| F-004 | `auth/auth-screen.tsx`, `auth/password-screen.tsx` | 画面Jest、実機待ち |
| F-005 | `auth/enrollment-screen.tsx` | 登録Jest、実機待ち |
| F-006 | `identification/identification-screen.tsx`, `identification/qr-code.tsx` | 識別Jest、実機QR待ち |
| F-007 | `auth/auth-screen.tsx`, `download/download-screen.tsx` | 画面Jest/通し試験、実機待ち |
| F-008 | `download/download-screen.tsx` | 画面Jest/受信結合Jest、実機待ち |
| F-009 | `download/download-screen.tsx` | 画面Jest/通し試験、実機待ち |
| F-010 | `download/download-screen.tsx` | 画面Jest/受信結合Jest、実機待ち |
| F-011 | `download/download-screen.tsx`, `download/album-filter.ts` | 検索Jest、実機待ち |
| F-012 | `download/download-screen.tsx` | お気に入りJest、実機待ち |
| F-013 | 画面なし（DEC-046） | 通知レコードは内部保持。現UIの一覧・遷移は未実装 |
| F-014 | `auth/account-settings-screen.tsx`, `auth/password-screen.tsx` | 画面Jest、実機待ち |
| F-015 | `support/support-screen.tsx` | 画面Jest、実機待ち |

## iPhone Expo Go 手動受入

実行フォルダー `C:\work\digital-cheki\apps\mobile`。既存Metroを維持し、止まっている場合のみ PowerShell で `npx.cmd expo start --go`。架空のテスト情報のみ使用する。実機結果を要件ID・日時・OS/Expo Go版・操作・期待/実結果・写真枚数・再起動方法とともに記録する。

1. `group@example.test` / `DemoPass123` でログイン。F-006の会員QRを別画面で表示するか番号 `700001` で会員Aを特定し、ファン名/メールが番号画面に出ないことを確認する。2アイドルを選び3枚を実撮影する。各写真に異なる描画をして再起動し、編集と3枚が保持されることを確認する。
2. 写真別に画質を選び完成JPEGの見た目・寸法・容量・処理時間を記録する。送信確定後、仮送信を進める。1枚失敗、手動再送、3回要対応、応答喪失の照会をモック専用制御で確認する。再起動だけでは勝手に送信しないことを確認する。
3. グループをログアウトし `fan@example.test` でログイン。受取一覧から3枚を明示受信し、再起動後のアルバム・検索・お気に入り・通知先が同じ撮影だけであることを確認する。fan Bでは会員A写真を表示できないことを確認する。
4. 別の受付でゲストを発行し、ゲスト写真が新規会員へ移らないことを確認する。モック時計で写真7日と通知30日を別に確認する。カメラ/QR権限拒否、容量警告、送信途中の強制終了、退会後の再ログイン拒否も記録する。破壊的なモック初期化は必要な確認を終えてから明示確認で行う。

## 公開前の未完了・不具合候補

1. **本番APIの実装がない。** `dataSource=api` は意図的に `NotImplemented`。認証、登録/再設定、受付・識別、アップロード/状態照会/期限ジョブ、ダウンロード、通知、問い合わせ、退会の実サーバーと契約試験が必要。[引き継ぎ](../mock-api-handoff.md)参照。
2. **iPhone Expo Goの結果未受領。** カメラ、QR、Skiaタッチ/画質/容量、強制終了、SecureStore、ファイル閲覧を実機で確認する。Android、専用開発/配布ビルド、署名、ストア審査、OS写真アプリ連携は未確認または対象外であり、必要範囲を公開計画で決める。
3. **公開バンドルに初期Expoサンプルの `Explore` タブと外部ドキュメントリンクが残る。** また `mockPasswordInbox` 等のモック専用名や画面中の「仮サーバー」表記が残る。業務API通信ではないが製品公開前に正式画面・文言・型へ整理し、画面遷移とアセットを再検査する。今回の棚卸しでは既存の初期画面を変更していない。
4. **本番手動運用の3件は未実施。** DB登録・変更履歴・人力メール通知はモックseedで代用できない。公開環境と担当者を用意して別枠で検証する。
5. **未決を保持する。** OPEN-001/002/003/004/005/015/016/017/018/019/020/021/022/024 ほか [open-questions.md](../open-questions.md) を確認。退会時保持、JPEG値、JWT、削除済みメール、送信集合、期限途中、失敗計数、端末間受信を本番合意済みにしない。
