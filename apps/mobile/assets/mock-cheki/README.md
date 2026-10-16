# 会員700001のチェキ素材

19枚すべて架空の成人アイドルと成人男性ファンの2ショット。組み込みimage_genで各撮影を個別生成し、既存の架空アイドル画像を人物参照にした。ユーザーの実写真・実会員情報ではない。

`cheki-01.jpg`〜`cheki-19.jpg`は撮影日順。日付・アイドル・受信状態は`src/services/mock/demo-cheki-manifest.ts`が管理する。

## サイズ・フレーム

生成した写真部分を、導入済みSkia/CanvasKitで白いフレームへ合成した。外枠54×86mm、写真部分46×62mmのinstax mini比率。1mmあたり16pxとした864×1376pxのJPEGで、写真部分は736×992px、左・上64px。下余白の配分は既存アプリの仮レイアウトに合わせた。実物の印刷品質・画面上の物理mm表示を保証するものではない。

再合成：`apps/mobile`で `node scripts/frame-demo-cheki.cjs <生成元PNG> <新しい出力JPEG>`。入力画像の構図を保ちながら写真窓へ中央配置する。19枚とも画像を目視し、2人・落書き・白枠を確認した。

## 生成プロンプト

各画像で以下の`INDEX`、`DATE`、`POSE`を差し替えた。参照はmanifestのidolIdに対応する`assets/mock-idols/<idolId>.png`。

```text
Use case: photorealistic-natural. Create ONE fictional Japanese idol meet-and-greet two-shot photograph for mobile app test data, session INDEX, date DATE. Use the supplied portrait solely as identity reference for the adult female idol (age 25); preserve her recognizable face, hairstyle and costume colors. Beside her is the same friendly adult Japanese male fan, age 28, round glasses, short black hair and a casual navy T-shirt; both fully clothed and non-romantic. Waist-up portrait of exactly two people, POSE, both faces clearly visible near the upper middle, small concert meet-and-greet backdrop, direct instant-camera flash and authentic casual snapshot texture. Add playful opaque marker doodles directly over the photograph around the edges: pink/blue hearts, little stars, sparkles, short handwritten 'Thank you!' and a small signature. Do not cover faces. Photo aspect ratio 46:62. This is the inner photo area only: NO white border, NO frame, NO photographed paper, NO extra people, no watermarks. A precise instax mini frame will be composed separately by the application.
```

POSEは順に`matching peace signs`、`making small finger hearts separately`、`waving happily at the camera`、`pointing to each other playfully`、`holding thumbs up`を繰り返した。INDEXは1〜19、DATEはmanifestの日付。
