# ホーム上の写真受取モーダル

根拠：C70 / DEC-070。対象：P1-DWN-001〜005、P1-REC-001/002、F-007/F-008。要求原文は変更しない。

## 呼出し口と保存状態

DownloadController.startReceive(intakeId?)は利用者の明示操作からのみ呼ぶ。省略時は当該利用者の全未受信受付、指定時はその受付だけを扱う。既存DownloadService.list/downloadを使い、画面はモック・SQL・コピーを直接呼ばない。受信中もphaseはclosedのままでホームを残す。receiveBatchへ初期対象のintakeId/photoId集合と分母を固定し、新着は次回へ回す。

サービスがファイル・記録を確認したreceived + localUriのみsavedへ進める。転送100%は成功条件にしない。最終照会で応答喪失とコピー確定後の記録復旧を照合する。retryReceiveは先に状態照会し、未保存かつ受信可能な同IDだけを再処理する。期限切れ・受信済み削除・別利用者は拒否する。アカウント変更で操作世代を更新し、旧結果を新画面へ反映しない。migration・seed・保存形式は追加していない。再起動時は既存の台帳とファイルをlistで照合し、再転送は手動のみ。

## UI移設と素材

ReceiveInbox/ReceiveInboxButtonとreceive-list phase、独立受信タブを廃止。F-008の論理IDは対応表に維持する。受付単位の全対象・日付・期限・失敗状態・手動受取はホームの矢印から表示するモーダルに移した。3サムネイルは表示枚数であり、受取枚数の上限ではない。更新アイコンは照会のみ。通知画面は以前のDEC-046で未接続であり、今回復活させない。内部通知・撮影IDは保持する。

ZIPのheart-soft.png / heart-outline.png / sparkle-small.png / sparkle-soft.pngをapps/mobile/assets/images/receiveへ変更せず配置。SVGは同梱せず、見本の人物や枠は切り抜かない。写真は既存の認可済みプレビューまたは保存確認済みの端末参照を使用する。

## 実機調整用の初期値

- 黒35%の背景、白パネル幅88%・最大360、角丸24、内側余白22、進捗バー7。
- スタック最大3枚。containで変形・切抜きを避け、白縁3・下余白9で太い二重枠を抑える。
- 表示200ms、1枚400ms・移動12、待機揺れ±2。標準Animatedのnative driverを使用し、保存処理に待機を追加しない。高速受取は最新数枚で表現する。
- 完了1000ms後に閉じ、ホームを維持。読み上げ時は手動で閉じる。動きを減らす設定は静止表示。背景移行・モーダル解除でループと購読を停止する。
- 30秒の応答待ちで「応答待ちを終了する」を表示。転送取消・自動タイムアウトではない。世代を更新して次の写真を開始せず、結果不明として照合と手動再試行へ戻す。既に開始した1枚は完了する可能性がある。OPEN-032に本番取消方式を残す。

## 自動試験と未確認

receive-modal.test.tsx：0/1/3/10枚、保存確認前の100%抑止、分母固定、部分／全失敗・期限切れ、手動再試行、応答喪失照合、待機解除、受付範囲、背景停止／復帰／購読解除、読み上げ時の手動終了。

auth-screen.test.tsx：ホームを同じまま保つ受取、10枚の対象確認、アルバム更新と3タブ。既存mock-download-service/create-mock-services/full-journey結合試験：実ファイル・SQLite再オープン・利用者分離・途中復旧。Jest通信ガードを維持する。

自動試験はiPhoneの実描画・Safe Area・文字拡大・処理速度を証明しない。Android、実API、確実な転送取消と別端末受信判定は未確認。

## iPhone Expo Go手順

1. PCと同じWi-Fiで既存Metroを開き、グループで会員を指定して3枚撮影・編集・仮送信する。
2. ファンへ切り替え、ホームの矢印で受付・全対象・期限を確認する。未受信写真がアルバムへ混ざらないことを確認する。
3. 「写真を受け取る」を押す。ホームが背面に残り、中央パネルにスタックと保存枚数が出る。背景とタブは押せず、保存完了前に100%にならないことを確認する。
4. 成功後は同じホームの件数・最近のアルバムが更新され、別画面へ自動遷移しない。終了・再起動して画像が残ることを確認する。
5. fail-midwayの部分失敗は既存のサービス制御口と自動試験で確認済み。実機の失敗注入UIは今回追加しておらず、iPhoneでの失敗試験は別途準備が必要。期限は既存モック時計で検証する。
6. VoiceOver・動きを減らす設定・文字拡大・背景移行／復帰を確認する。実機結果を記録してから合格扱いにする。

## 今回の変更ファイルと実行証跡

表示：apps/mobile/src/features/auth/{auth-screen.tsx,fan-home-screen.tsx,fan-tab-bar.tsx}、apps/mobile/src/features/download/{download-controller.ts,download-screen.tsx,receive-modal.tsx}。旧receive-inbox.tsx / receive-inbox-button.tsxを削除。追加素材はassets/images/receiveのPNG4点。

試験：auth-screen.test.tsx、download-screen.test.tsx、receive-modal.test.tsx、services/mock/create-mock-services.integration.test.ts、services/mock/full-journey.integration.test.ts。モックの業務実装は変更せず、旧画面経由の試験を新しい明示受取へ接続した。

資料：decisions.md、decision-evidence.md、current-status.md、implementation-progress.md、open-questions.md、requirements-coverage.md、screen-map.md、testing/acceptance-cases.md、architecture/stage-08-download.md、このメモ。requirements.mdと原文アーカイブは変更していない。

2026-10-14、C:\\work\\digital-cheki\\apps\\mobileでnpm.cmd run typecheck / npm.cmd run lint / npm.cmd run test:ciが成功（49スイート・216件）。C:\\work\\digital-chekiでnode .agents/tools/check-instructions.mjsとgit diff --checkが成功。Metroの/statusはpackager-status:running。iPhone実機・Android・実APIの合格証跡ではない。
