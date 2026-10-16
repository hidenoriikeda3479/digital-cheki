# 段階03 PC表示用テストQR

`member-a.svg` は会員A、`guest-1.svg` は既存seedゲスト1のQR。架空のモックデータのみ。生成元は `src/services/mock/identification-fixtures.json` で、アプリ内のQR表示と同じ `qrcode-generator` によるエンコードを使用する。再生成はアプリフォルダーで `node scripts/generate-stage03-qr.cjs`。

PCで `member-a.svg` または `guest-1.svg` をブラウザーに開き、iPhone側でグループAにログインして「新しい撮影受付」から読み取る。PCとiPhoneが同じ画面である必要はない。QRには認証権限がなく、グループログイン後の識別にだけ使う。カメラを許可できない場合は番号入力を使う。会員Aのモック番号は `700001`、seedゲストの6桁一時番号は `000123`（先頭0を含む）。

この素材を読めても、iPhoneのネイティブカメラ動作は実機での確認結果として別に記録する。外部QR作成サービスへの送信は不要。
