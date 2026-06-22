# Open Chat

OpenAI Responses APIへ質問を送り、回答・モデル名・トークン使用量をターミナルに表示するTypeScript製CLIです。

## 必要な環境

- Node.js 20以上
- npm
- OpenAI APIキー

## 実行

```bash
npm install
export OPENAI_API_KEY="..."
export OPENAI_MODEL="使用するモデル名"
npm run chat -- --question "日本の首都はどこですか？"
```

AIへの指示を変更する場合は、`--instruction`を追加します。

```bash
npm run chat -- --question "量子コンピューターとは？" --instruction "中学生向けに説明してください。"
```

APIキーは環境変数からのみ読み取り、画面表示やファイル保存は行いません。

OpenAI APIへのリクエストは30秒でタイムアウトします。利用制限、一時的なAPI障害、タイムアウト、通信障害では最大2回まで再試行し、認証・権限・入力の問題では再試行しません。

## 開発時の確認

```bash
npm run check
```

コードを自動整形する場合は`npm run format`、ESLintで自動修正する場合は`npm run lint:fix`を実行します。

`npm install`時にHuskyのpre-commitフックが設定されます。コミット時には、ステージ済みファイルの自動整形、TypeScriptの型チェック、ESLintの順に実行され、型またはLintにエラーがある場合はコミットを中止します。

TypeScriptとJavaScriptの文字列はシングルクォート、文末はセミコロンに統一します。importとexportはESLintで自動整列します。
