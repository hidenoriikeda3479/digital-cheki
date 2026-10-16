# 段階13 API接続への引き継ぎ

2026-09-25。これはモック段階の境界と未実装箇所の記録であり、確定済みの全HTTP API仕様書ではない。本番URL、認証寿命、S3転送方式、通知配信方式は決めていない。要件別の証跡は [モック統合チェックリスト](testing/mock-release-checklist.md)。

2026-09-26追記：DEC-029により現行のグループ送信境界は`contracts/batch-upload.ts` / `services/mock/mock-batch-upload.ts` / `features/upload/batch-upload-controller.ts`。本番APIには受付単位の送信開始、結果照会、手動再送、集合固定と冪等性が必要。ファイルを複数に分けて転送する場合もグループへの結果は受付単位とし、サーバーの写真ID別受領記録は各写真の7日期限・受取認可・重複防止に残す。旧`contracts/upload.ts`等の写真別UI契約は現行アプリに配線されていない。本番での原子性・部分成功・失敗3回の単位はOPEN-029。

2026-09-26追記：G-013の`contracts/photo-management.ts`は受付単位の送信状態を`ManagedIntake`へ1件だけ返す。`retryUpload`は明示操作による受付送信を`BatchUploadService`へ渡し、結果不明は同ID照会のみを先行する。参加アイドルと撮影日の検索は端末内の受付/写真記録に対して行い、本番検索APIが完成したことを意味しない。

## 現在の組み立て

- `apps/mobile/src/services/compose.ts` と `select-business-service.ts` が `EXPO_PUBLIC_APP_ENV` / `EXPO_PUBLIC_DATA_SOURCE` を検証して注入先を決める。`production+mock` は拒否。`api` ファクトリーは未実装で `NotImplemented`、通信失敗によるモックへの切替はない。公開用の実APIがない現状ではアプリは業務利用できない。
- UIは `apps/mobile/src/services/contracts/app-services.ts` の controller/service を受け、モックのSQLite・FileSystem・fetchを画面から直接操作しない。グループ写真・ファン写真は端末所有者別、仮サーバーは独立した名前空間。端末保存 `local-capture.ts`、`local-editing.ts`、`local-finished-image.ts`、`local-photo-management.ts` は本番でも使う方向だが、現在 `source: 'mock'` を組み立て時に与えているため、実API接続時には名前空間・移行方針を設計してから変更する。既存モックファイルを本番データとして流用しない。
- 外部通信のモック実装は `services/mock/` 以下。`mock-upload-server.ts` はアプリ内仮サーバーであり、独立ジョブ・複数端末共有・S3/SES/Pushを再現しない。`storage/mock-photo-transfer.ts` と `mock-photo-receive.ts` は端末内ファイルコピー。サービスの境界にモック専用 `MockUploadControls` / `MockDownloadControls` / 受信箱が含まれるため、実API組み立て時に開発専用UIや型を公開機能に混入させない。

## 実APIの差し替え箇所

| 領域 | 現在の呼び出し口・実装 | 後続で必要な契約・検証 |
|---|---|---|
| 認証・役割 | `contracts/auth.ts`, `services/mock/mock-auth.ts`, `features/auth/auth-controller.ts` | ログイン/復元/ログアウト、principal と役割、停止/削除拒否、更新・失効、保存失敗。JWT署名検証/寿命/複数端末方針はOPEN-003/004。SecureStoreにパスワードを置かない |
| 登録・メール認証・ゲスト | `contracts/enrollment.ts`, `services/mock/mock-enrollment.ts`, `storage/guest-access-store.ts` | 登録申請/再送/最新6桁照合、10分境界、本人確認メール配送、ゲストID/QR/番号と衝突・期限・復旧。OPEN-005/020 |
| 変更・再設定 | `contracts/password.ts`, `services/mock/mock-auth.ts` | 対象アカウントに結びつく使い捨て参照、期限、旧認証拒否、失効・監査、メール配送。OPEN-003/015 |
| ファン解決・受付 | `contracts/identification.ts`, `services/mock/mock-identification.ts` | QR/番号は権限ではなく存在確認と非表示受取参照へ分離。グループ所有・承認済みアイドルをサーバー側でも検査。受付IDの冪等性・再照会 |
| 撮影・編集 | `contracts/capture.ts`, `contracts/editing.ts`, `services/local-*` | 端末内継続保存を維持。元写真・編集JSONは送信対象にしない。ログアウト/中断とアカウント別保存を確認 |
| 完成画像 | `contracts/finished-image.ts`, `services/local-finished-image.ts` | 写真ID、編集 revision、画質、実寸、byteSize、生成物参照を固定。画像仕様はOPEN-002、確定後の変更はOPEN-016/022 |
| アップロード | 現行：`contracts/batch-upload.ts`, `services/mock/mock-batch-upload.ts`, `mock-upload-server.ts`, `storage/mock-photo-transfer.ts` | 受付単位の送信・結果照会・手動再送・冪等性。仮サーバーの写真ID別受領記録で7日期限と重複防止。ファイル転送方式/原子性/部分成功/3回計数はOPEN-017/019/029。本番API・独立削除ジョブは未実装 |
| ダウンロード・アルバム | `contracts/download.ts`, `services/mock/mock-download-service.ts`, `storage/mock-photo-receive.ts` | 認証された受取人の一覧/状態/受信、写真ID直接指定時の認可、期限後拒否、端末別の受信事実、手動retry。OPEN-018/021。アルバムのローカルお気に入りの同期は未承認 |
| 通知 | `contracts/download.ts` の撮影ID通知と `mock-upload-server.ts` | 全写真が受取可能な時に撮影単位1件、30日保持、対象受取人・撮影ID、既読/遷移。リモート通知、トークン登録/失効、権限、配信失敗と重複防止は未実装 |
| 問い合わせ・退会 | `contracts/support.ts`, `services/mock/mock-support.ts`, `contracts/auth.ts` | 問い合わせ受付ID/失敗、運営への配送・保存・監査。退会即時アクセス停止と保持/削除/匿名化、既存資格情報の失効。OPEN-001/005 |

HTTPを定義する際は上記の対象機能だけ OpenAPI に追加し、入力・出力・認可主体・失敗コード・状態照会・再試行/冪等性・期限境界を各機能で確認する。画面に本番URLやS3パスを埋め込まない。業務通信のテストは `src/testing/network-guard.ts` の JS transport ガードに加えて実API契約試験、サーバー認可試験、端末通信観測が必要である。

## 公開前のゲート

1. 本番サーバー、DB移行とバックアップ/監査、写真保管と期限削除ジョブ、TLS、署名付き転送、SES等の配信、通知トークン管理を設計・実装・検証する。`P1-OPR-001/002/003` は担当者が本番相当環境で別途手動検証する。
2. iPhone Expo Goで [段階13チェックリスト](testing/mock-release-checklist.md) の通し・異常系を記録する。Android、専用ビルド、署名、権限文言、ストア審査も公開前に対象環境で確認する。Expo Go合格を配布ビルド合格と扱わない。
3. `docs/open-questions.md` の画像、JWT、退会・再登録、送信集合、期限途中、失敗計数、複数端末を権限者と決定し、決定台帳・契約・試験を同時更新する。公開バンドルのサンプルExplore画面、開発fixture/debugと `mockPasswordInbox` 等のモック専用プロパティ名、「仮サーバー」表記の除外も再検査する。
