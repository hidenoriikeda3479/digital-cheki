# モック専用アイドル肖像

G-005の写真付きグリッド確認用。3枚とも架空の成人ポップパフォーマーを組み込みimagegenで個別生成したもの。実在人物の写真や業務ユーザーの画像ではない。外部画像URLから取得せず、アプリ内に同梱する。画像の人物と名称・プロフィールは本番情報として扱わない。

| モックID | アセット | 生成時の指定 |
|---|---|---|
| `idol-a` | `apps/mobile/assets/mock-idols/idol-a.png` | 約25歳の架空の日本人女性ポップパフォーマー。前髪のある肩までの暗髪、淡い青の衣装 |
| `idol-a2` | `apps/mobile/assets/mock-idols/idol-a2.png` | 約26歳の架空の日本人女性ポップパフォーマー。前髪のない波打つ赤茶の中髪、淡い紫の衣装 |
| `idol-b` | `apps/mobile/assets/mock-idols/idol-b.png` | 約24歳の架空の日本人女性ポップパフォーマー。短い暗髪のボブ、淡い桃色の衣装 |

共通プロンプト：`Use case: photorealistic-natural. Asset type: square portrait thumbnail for a Japanese mobile app's fictional idol selection mock data. Subject: one clearly fictional adult Japanese female pop performer` に上表の年齢・髪型・衣装を続け、`Scene: clean pale studio background. Composition: single person centered, head and shoulders, square crop, face fully visible at small thumbnail size. Natural realistic photography, soft even light. No text, watermark, logos, QR code, other people, or identifiable real celebrity likeness.` を指定した。各画像を別の組み込みimagegen呼出しで生成し、出力を検視して上記パスへコピーした。CLI/APIのフォールバックは使用していない。
