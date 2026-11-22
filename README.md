# バイトから社長（仮の題）

アルバイトをしながら、好きな商売を選んで小さく始め、独立するまでを遊ぶ経営ゲームの、最初の試作です。
スマホの縦画面のブラウザで遊べます。

- 遊ぶ：https://109mei.github.io/baito-kara-shacho/
- 仕様：[docs/SPEC.md](docs/SPEC.md)

## 動かし方

```
npm install
npm run dev      # 開発用に開く
npm test         # ルール本体のテストとシミュレーション
npm run build    # 公開用に組み立てる
npm run e2e      # 実際のブラウザでの動作テスト（先に npm run build）
```

## フォルダ

| 場所 | 中身 |
|---|---|
| src/core | ルール本体（状態・命令・1日進める・ボット）。画面を知らない |
| src/data | 数値の表（balance.json）と、その検査（Zod） |
| src/store | ルール本体と画面の橋渡し（Zustand） |
| src/ui | 画面（React と CSS） |
| src/world | 街の絵（PixiJS） |
| src/save | 保存の窓口 |
| tests | Vitest |
| e2e | Playwright |
