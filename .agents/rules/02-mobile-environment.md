# 02 — Windows・Expo・実機

根拠：DEC-002/013〜017、C09〜C11。技術確認：E02/E03/E04/E05/E06。

## 現在の制約
Windowsのみ。iPhone実機Expo Goを先に使う。Androidは実機未用意。MacとApple有料登録を前提にしない。
現在の成功状態は初期画面と文字変更。src/app/index.tsxと既存テンプレートの構成を尊重する。
実SDKはpackage/lock/configから確認する。画像にSDK57表示があることと、依存パッチ番号まで確認済みであることを区別する。

## 確認するファイル
package.json、package-lock.json、app.json/app.config.*、tsconfig、Metro/Babel設定、Expo生成済みAGENTS、.gitignore。
バージョン不一致の対策として無断でSDK54へ戻したり、create-expo-appで作り直したりしない。
問題調査で依存関係の更新が必要なら、理由・互換性・変更範囲・戻し方を示して承認を得る。

## Windowsでの案内
- 実際の作業パスを確認。案内例はC:\work\digital-cheki、アプリはapps\mobile
- npm.cmd/npx.cmdを使い、PowerShellのプロンプト文字やMarkdownのリンクをコマンドへ入れない
- ANDROID_HOMEにエスケープ用のバックスラッシュを入れない。画像と貼付テキストが違うときは入力ミスと断定しない
- 環境変数のUser/Machine/現在プロセスを区別。既存Pathを壊さない
- 既存Metroを無断で停止しない。複数起動による古いQR/portを確認
- 実エージェントがLinuxの場合はnpm/npx、実在パスを使用し、ユーザーへはWindows用に説明

## 起動・診断コマンド
`apps/mobile`でまず次を確認する。
```powershell
npm.cmd run
npm.cmd ls expo --depth=0
npx.cmd expo start --go
```
起動は実行許可と既存プロセスを確認してから。依存変更/不一致調査時は`npx.cmd expo-doctor`。
`npm run typecheck/lint/test:ci`は存在確認して実行し、不在を成功としない。

## 依存導入
採用SDKとの互換性を確認し、端末系は`npx.cmd expo install <package>`で必要なものだけ導入する。
FileSystemの旧APIと新APIを混ぜない。現在のインストール版の型定義と公式資料を照合する。
iPhone Expo Goで使えないモジュールやconfig pluginだけの機能を選ぶ場合、未登録のApple環境での制約を先に説明する。
SQLCipher等のネイティブ設定を追加すればExpo Goでも動く、と断定しない。

## 機能実装と検証を分ける
カメラ・Skia・SQLite等は採用版のExpo Go対応を調べたうえで先行実装する。権限文言やbundle ID固有動作は専用ビルドで再確認する。
Windows上でローカルiOSビルド/iOSシミュレーターを動かせる前提のコマンドを案内しない。
Apple有料登録後はEASによるiPhone実機向けDevelopment Buildを候補とし、課金・署名・端末登録は承認を取る。
Androidの実機・開発ビルド・公開ビルドは後続の検証欄に残す。
最低OSとビルドSDK/target SDKは別。勝手にAndroid16以上などへユーザー範囲を制限しない。
