# 環境設定 — 階層別AGENTS

適用：`apps/mobile/src/config/`配下。上位のAGENTSを引き継ぎ、業務仕様を勝手に上書きしない。

## 作業前に読む
- [環境](../../../../.agents/rules/02-mobile-environment.md)
- [モード](../../../../.agents/rules/04-mock-services.md)
- [秘密情報](../../../../.agents/rules/12-git-security.md)

## この範囲のルール
設定は境界で解析し、未設定/不正値を本番でmockにしない。production+mockは禁止。
EXPO_PUBLICは秘密ではない。鍵・実token・DB秘密情報を含めない。
SDK/OS下限・写真3MB・JWT15分などを会話の提案例から本番値として固定しない。
既存同等設定があれば命名だけで二重化しない。config plugin変更はExpo Goへの反映範囲を説明する。

関連原文・決定・未決事項はルートの参照先を確認する。実装範囲外のファイルへ変更が広がる場合は、その階層指示も読む。
