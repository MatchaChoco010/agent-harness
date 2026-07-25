# agent-harness

コーディングエージェント(Claude Code / Codex / opencode)向けの共有ハーネス。
プロジェクトに依存しない規約・skill・スクリプトをこのリポジトリで一元管理し、各プロジェクトはバージョンを固定(pin)して取り込む。

## 提供するもの

- **CLI**(`agent-harness`): プロジェクトへの導入(`init`)と更新(`update`)を行うコマンド。
- **常時規約**(`harness/AGENTS.md`): どのプロジェクトでも変わらない standing なゲート(Git/PR 運用、markdown 規約、design doc ルールへのポインタなど)。
- **参照ドキュメント**(`harness/docs/`): ハーネス編集の作法、Git/Issue/PR の詳細、markdown の書き方、design doc のルールとテンプレート。
- **skills**(`harness/skills/`): SKILL.md 標準形式のワークフロー手順(design doc の執筆・レビュー、PR ワークフロー、日本語技術文書の規範など)。
- **スクリプト**(`harness/scripts/`): bot 名義の GitHub 操作ヘルパー、フックハンドラ、同期スクリプト本体。

## セットアップ

### 1. GitHub App(bot)

1. App が無ければ作る: https://github.com/settings/apps → **New GitHub App**。Webhook の Active を外し、Repository permissions を **Contents / Issues / Pull requests = Read and write** にする。
2. **Install App** で導入先リポジトリへインストールする(既存 App の場合は導入先リポジトリを追加する)。
3. 次の 3 つを控える: **App ID**(App 設定ページに表示)、**Installation ID**(インストール後の URL `settings/installations/<数字>` の数字)、**秘密鍵**(**Generate a private key** で取得した `.pem`。リポジトリ外に置く)。

### 2. CLI のインストール

```sh
cargo install --git https://github.com/MatchaChoco010/agent-harness
```

### 3. プロジェクトの初期化

対象リポジトリのルートで実行する。

```sh
agent-harness init
```

これが共有ハーネスを取得し、`.harness-version`(pin)・`PROJECT.md` の雛形・ベンダーコピー `harness/`・生成物(`AGENTS.md` / `CLAUDE.md` / skills ミラー / 各ツールのフック設定)を配置する。
手順 1 の資格情報(App ID / Installation ID / 秘密鍵のパス)が未設定なら対話で入力を求め、`~/.config/agent-harness/env` に保存する(環境変数とリポジトリ直下の `.env` が優先される)。
疎通確認は `node harness/scripts/gh/app-token.mjs --check`。

初期化後は、`PROJECT.md` にプロジェクト固有の常時規約を書いて `node harness/scripts/sync/harness-sync.mjs` で `AGENTS.md` を再生成し、CI に `node harness/scripts/sync/harness-sync.mjs --check` を置く(例: [.github/workflows/harness-check.yml](.github/workflows/harness-check.yml))。

## 運用

- **更新の取り込み**: 対象リポジトリで `agent-harness update`(最新)または `agent-harness update <rev>` を実行し、差分を PR にする。手順は `harness-sync` skill。
- **共有ハーネス自体の変更**: このリポジトリへの Issue + PR で行い、マージ後に各プロジェクトが pin を進めて取り込む。手順は `harness-update` skill。
- **プロジェクト固有の規約**: 各プロジェクトの `PROJECT.md` に書く。
- **プロジェクト固有の skill**: `.claude/skills/` に共有ミラー以外の名前で置く。
- **プロジェクト固有のスクリプト**: `scripts/` に置く。

## ライセンス

MIT OR Apache-2.0([LICENSE-MIT](LICENSE-MIT) / [LICENSE-APACHE](LICENSE-APACHE))。
