# バイトから社長（仮の題）

地図の見た目の広い街（約 8km 四方）を、歩き・自転車・車で自由に動き回る、見下ろし型の 2D ゲームです。
はたらく、事業を始める、法を破る、どれも選べます。スマホの縦画面のブラウザで遊べます。

- 遊ぶ：https://109mei.github.io/baito-kara-shacho/ （公開の設定後）
- 仕様：[docs/SPEC.md](docs/SPEC.md)

絵と音は、すべてコードで作っています（画像・音声のファイルは使っていません）。
前の版（小さな立体の街）は、印（タグ）`diorama-v1` に残してあります。

## 動かし方

```
npm install
npm run dev      # 開発用に開く
npm test         # 街とルール本体のテスト
npm run build    # 公開用に組み立てる
npm run e2e      # 実際のブラウザでの動作テスト（先に npm run build）
```

## フォルダ

| 場所 | 中身 |
|---|---|
| src/core | 街を作る（city.ts）、ルール本体（sim.ts）。画面を知らない |
| src/data | 数値の表（balance.json）と、その検査（Zod） |
| src/store | ルール本体と画面の橋渡し（Zustand） |
| src/ui | 画面（React と CSS）、音の合成（sfx.ts） |
| src/world | 街の絵（PixiJS）、街ぜんたいの地図の絵 |
| src/save | 保存の窓口 |
| tests | Vitest |
| e2e | Playwright |
