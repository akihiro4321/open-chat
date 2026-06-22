# Open Chat

OpenAI Responses APIへ質問を送り、回答を生成された部分から表示するTypeScript製チャットアプリです。CLIとローカルWeb画面から利用できます。

## 必要な環境

- Node.js 20.9以上
- npm
- OpenAI APIキー

## 実行

```bash
npm install
export OPENAI_API_KEY="..."
export OPENAI_MODEL="使用するモデル名"
npm run chat -- --question "日本の首都はどこですか？"
```

Web版は開発サーバーを起動し、ブラウザで `http://localhost:3000` を開きます。

```bash
npm run db:migrate
npm run dev
```

ブラウザはOpen ChatのAPIルートだけを呼び出し、APIキーはサーバー側の環境変数として扱います。回答は改行区切りJSONのストリームで受け取り、生成された部分から画面へ表示します。「停止」を押すとブラウザからOpenAI APIまで中断を伝播します。

スレッドとメッセージは `prisma/open-chat.db` に保存されます。画面の左側でスレッドの作成、切り替え、削除ができ、再読み込み後も会話が残ります。モデルには直近40件かつ約80,000文字以内の履歴を渡します。最初の回答が完了すると、OpenAIでスレッド名を自動生成します。

DBの中身はDBeaverでSQLite接続を作成し、`prisma/open-chat.db` を指定すると確認できます。Prismaのデータ閲覧画面を使う場合は次を実行します。

```bash
npm run db:studio
```

AIへの指示を変更する場合は、`--instruction`を追加します。

```bash
npm run chat -- --question "量子コンピューターとは？" --instruction "中学生向けに説明してください。"
```

同じ質問を分類・要約・要点からなる構造化データとして取得する場合は、`--structured`を追加します。OpenAI SDKとZodで形式を検証し、検証に成功した回答だけを表示します。

```bash
npm run chat -- --question "味噌汁の作り方を教えてください" --structured
```

構造化回答では、通常回答と異なり生成途中のJSONは表示しません。回答拒否、出力途中、形式不正はそれぞれエラーとして扱います。

APIキーは環境変数からのみ読み取り、画面表示やファイル保存は行いません。

回答は生成された部分から順に表示されます。生成中に `Ctrl+C` を押すとOpenAI APIへのリクエストを中断し、表示済みの内容を部分回答として残します。

OpenAI APIへのリクエストは30秒でタイムアウトします。利用制限、一時的なAPI障害、タイムアウト、通信障害では、回答の表示開始前に限り最大2回まで再試行します。回答の表示開始後は、内容の重複を防ぐため再試行しません。

## 開発時の確認

```bash
npm run check
```

コードを自動整形する場合は`npm run format`、ESLintで自動修正する場合は`npm run lint:fix`を実行します。

`npm install`時にHuskyのpre-commitフックが設定されます。コミット時には、ステージ済みファイルの自動整形、TypeScriptの型チェック、ESLintの順に実行され、型またはLintにエラーがある場合はコミットを中止します。

TypeScriptとJavaScriptの文字列はシングルクォート、文末はセミコロンに統一します。importとexportはESLintで自動整列します。
