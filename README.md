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
export OPENAI_ALLOWED_MODELS="使用するモデル名,選択肢に加えるモデル名"
# 任意: 一時障害時に一度だけ切り替えるモデル
export OPENAI_FALLBACK_MODEL="代替モデル名"
npm run chat -- --question "日本の首都はどこですか？"
```

Web版は開発サーバーを起動し、ブラウザで `http://localhost:3000` を開きます。

```bash
npm run db:migrate
npm run dev
```

ブラウザはOpen ChatのAPIルートだけを呼び出し、APIキーはサーバー側の環境変数として扱います。回答は改行区切りJSONのストリームで受け取り、生成された部分から画面へ表示します。「停止」を押すとブラウザからOpenAI APIまで中断を伝播します。

スレッドとメッセージは `prisma/open-chat.db` に保存されます。画面の左側でスレッドの作成、切り替え、削除ができ、再読み込み後も会話が残ります。モデルには直近40件かつ約80,000文字以内の履歴を渡します。最初の回答が完了すると、OpenAIでスレッド名を自動生成します。

`OPENAI_ALLOWED_MODELS`にカンマ区切りで指定したモデルは、画面上でスレッドごとに選択できます。選択内容はスレッドへ保存され、API側でも許可一覧を検証します。`OPENAI_FALLBACK_MODEL`を指定すると、回答表示前の一時障害に限り、通常の再試行後に代替モデルへ一度だけ切り替えます。選択モデルと実際に使用されたモデルは実行記録へ保存されます。

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

## RAG文書取込

第7章では、ローカルのMarkdownまたはテキストファイルを取り込み、チャンク化、OpenAI Embeddings APIでの埋め込み生成、LanceDBへのベクトル保存、SQLiteへのメタデータ保存を行います。取込後のチャット回答では、質問を埋め込み化してLanceDBから関連チャンクを検索し、取得した文脈を不信頼な参考資料としてOpenAIへ渡します。

取込対象の文書本文は、埋め込み生成のためOpenAI APIへ送信されます。API利用料が発生します。外部送信できない文書は取り込まないでください。

```bash
export OPENAI_API_KEY="..."
export OPENAI_MODEL="..."
export OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
npm run db:migrate
npm run rag:ingest -- --path "docs/requirement"
```

任意でチャンク戦略、チャンクサイズ、オーバーラップを指定できます。`fixed` は文字数で固定分割し、`markdown` はMarkdown見出しを優先して分割します。

```bash
npm run rag:ingest -- --path "docs/requirement" --chunk-strategy markdown --chunk-size 1200 --chunk-overlap 200
```

RAGのメタデータは `prisma/open-chat.db` に、ベクトル索引は既定で `data/lancedb/` に保存されます。取込が最後まで成功した場合だけ、SQLite上の有効索引が新しい取込へ切り替わります。取込履歴にはチャンク戦略、サイズ、オーバーラップも保存されます。

チャット画面は常に現在有効なRAG索引を使います。有効な索引がない場合は、先に `npm run rag:ingest -- --path "取込対象パス"` を実行するようエラーを返します。検索件数は `RAG_TOP_K` で変更できます。

検索方式は `RAG_RETRIEVAL_MODE` で切り替えられます。`vector` はベクトル検索のみ、`keyword` はキーワード検索のみ、`hybrid` は両方の結果をRRFで順位統合します。

```bash
export RAG_RETRIEVAL_MODE=hybrid
```

検索結果だけを確認したい場合は、チャット回答を生成せずにRAG検索を実行できます。検索方式や件数はコマンド引数で一時的に上書きできます。

```bash
npm run rag:search -- --question "Open ChatのRAG構成は？"
npm run rag:search -- --question "Open ChatのRAG構成は？" --retrieval-mode keyword --top-k 8
```

RAG検索の評価は、質問と期待するチャンクIDまたは文書IDを持つJSONで実行します。`docs/rag-evaluation-sample.json` をコピーし、`rag:search` の結果に出るIDへ置き換えて使います。

```bash
npm run rag:evaluate -- --dataset "docs/rag-evaluation-sample.json"
npm run rag:evaluate -- --dataset "docs/rag-evaluation-sample.json" --retrieval-mode all --top-k 8
```

評価では `Recall@k`、`MRR`、`nDCG` を出力します。`--retrieval-mode all` を指定すると、`vector`、`keyword`、`hybrid` を同じ評価データで比較できます。

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
