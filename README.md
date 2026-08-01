# agent-harness

コーディングエージェント(Claude Code / Codex / opencode)向けの共有ハーネス。
プロジェクトに依存しない規約・skill・スクリプトをこのリポジトリで一元管理し、各プロジェクトはバージョンを固定(pin)して取り込む。

## 提供するもの

- **CLI**(`agent-harness`): プロジェクトへの導入(`init`)・更新(`update`)・再生成(`sync`)・検証(`check`)を行うコマンド。
- **常時規約**(`harness/AGENTS.md`): どのプロジェクトでも変わらない standing なゲート(Git/PR 運用、markdown 規約、design doc ルールへのポインタなど)。
- **参照ドキュメント**(`harness/docs/`): ハーネス編集の作法、Git/Issue/PR の詳細、日本語の言葉選びと表現・markdown の書き方・コードコメントの規約、design doc のルールとテンプレート。
- **skills**(`harness/skills/`): SKILL.md 標準形式のワークフロー手順(design doc の執筆・レビュー、PR ワークフロー、日本語技術文書の規範など)。
- **スクリプト**(`harness/scripts/`): bot 名義の GitHub 操作ヘルパー、フックハンドラ。

## セットアップ

### 1. GitHub App(bot)

1. App が無ければ作る: https://github.com/settings/apps → **New GitHub App**。Webhook の Active を外し、Repository permissions を **Contents / Issues / Pull requests = Read and write** にする。
2. **Install App** で導入先リポジトリへインストールする(既存 App の場合は導入先リポジトリを追加する)。
3. 次の 3 つを控える: **App ID**(App 設定ページに表示)、**Installation ID**(インストール後の URL `settings/installations/<数字>` の数字)、**秘密鍵**(**Generate a private key** で取得した `.pem`。リポジトリ外に置く)。

### 2. CLI のインストール

```sh
cargo install --git https://github.com/MatchaChoco010/agent-harness --branch main
```

### 3. プロジェクトの初期化

対象リポジトリのルートで実行する。

```sh
agent-harness init
```

これが共有ハーネスを取得し、`.harness-version`(pin)・`PROJECT.md` の雛形・ベンダーコピー `harness/`・生成物(`AGENTS.md` / `CLAUDE.md` / skills ミラー / 各ツールのフック設定)を配置する。
`.gitignore` には、ハーネス由来の無視項目(bot の資格情報を置く `.env` と `harness/scripts/node_modules/`)を入れたブロックを追記する。
ブロックはマーカーで囲まれ、`sync` はその範囲だけを更新するので、プロジェクト固有の記述はブロックの外にそのまま書いてよい。
手順 1 の資格情報(App ID / Installation ID / 秘密鍵のパス)が未設定なら対話で入力を求め、`~/.config/agent-harness/env` に保存する(環境変数とリポジトリ直下の `.env` が優先される)。
疎通確認は `node harness/scripts/gh/app-token.mjs --check`。

初期化後は、`PROJECT.md` にプロジェクト固有の常時規約を書いて `agent-harness sync` で `AGENTS.md` を再生成する。
CI には `agent-harness check` を置く(CLI は pin の revision で `cargo install --git https://github.com/MatchaChoco010/agent-harness --rev <revision>` として入れる)。
リポジトリの default branch は GitHub の Settings で `develop` にしておく(PR 本文の `Closes #N` による Issue の自動クローズは、default branch へのマージでのみ行われる)。

## 開発の流れ

作業は **Issue + `feature/hoge` ブランチ + PR** でトラックする。
PR をマージするかどうかはユーザーが決める。GitHub 上で自分でマージしてもよいし、エージェントに指示して代行させてもよい。
日本語の規範(言葉選び・markdown の書き方・技術文書の段落構成)も含むので、design doc・Issue/PR の本文・コミットメッセージの本文は日本語で書かれる。

### 新機能を作る

1. エージェントに機能の作成を依頼する。設計判断を記録に残したいときは、あわせて design doc の執筆も依頼する。
2. design doc を依頼した場合、エージェントが `docs/design/NNNN_*.md` に書き上げて `develop` に載せる。この段階ではまだレビュー前で、ブランチを切り替えずに読める。
3. 読んでレビューする段になったら「design doc のレビューを開始して」と伝える。エージェントがレビュー PR を作る。差分はステータスの 1 行だけだが、GitHub の Files changed から doc の全文にコメントできる。
4. PR にコメントを書いたら「レビューコメントに対応して」と伝える。エージェントが doc 本文を直し、各コメントに返信する。
5. 内容に納得したら PR で承認する。エージェントがステータスを `approved` に変えるので、PR をマージする。設計として成り立たないと結論したときは `rejected` にして記録として残す。
6. 承認後、エージェントに実装を依頼する。

### 実装をレビューする

- 大きな機能は、全体像を書いた親 Issue と、実装単位ごとの Sub-issue に分割される。PR は Sub-issue 1 つにつき 1 つ。
- バグ修正など分割の要らない作業は、Issue 1 つと PR 1 つ。
- PR はレビューの単位なので、関係ない変更は混ざらない。
- design doc と同じく、PR にコメントを書いて「レビューコメントに対応して」と伝えれば、修正とコメントへの返信が返ってくる。修正が不要と判断された場合も、なぜ不要かが返信される。
- レビューが通ったら PR をマージする。`develop` から `main` へのマージも、指示すればエージェントが行う。

## ハーネスを更新する

- 共有ハーネス(規約・skill・スクリプト)を変えたいときは、エージェントに依頼する。このリポジトリへの Issue + PR になり、マージはユーザーが行う(`harness-update` skill)。
- マージしたら、利用側の各プロジェクトで `agent-harness update`(最新)または `agent-harness update <rev>` を実行し、差分を PR にして取り込む(自動では反映されない)。
- 変更が共有ハーネスとプロジェクト固有のどちらに属するかもエージェントが判断する。プロジェクト固有と判断されたものは、常時必要なら `PROJECT.md`、特定の作業のときだけ必要ならプロジェクトの `docs/harness/` に置かれる。
- エージェントは作業中の学びをローカルに記録していて、溜まってきたら恒久ルール化・skill 化を提案してくる。
- プロジェクト固有の skill は `.claude/skills/` に共有ミラー以外の名前で、スクリプトは `scripts/` に置く。

## ライセンス

MIT OR Apache-2.0([LICENSE-MIT](LICENSE-MIT) / [LICENSE-APACHE](LICENSE-APACHE))。
