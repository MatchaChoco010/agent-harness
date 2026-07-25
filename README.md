# agent-harness

コーディングエージェント(Claude Code / Codex / opencode)向けの共有ハーネス。
プロジェクトに依存しない規約・skill・スクリプトをこのリポジトリで一元管理し、各プロジェクトはバージョンを固定(pin)して取り込む。

## 提供するもの

- **常時規約**(`harness/AGENTS.md`): どのプロジェクトでも変わらない standing なゲート(Git/PR 運用、markdown 規約、design doc ルールへのポインタなど)。
- **参照ドキュメント**(`harness/docs/`): ハーネス編集の作法、Git/Issue/PR の詳細、markdown の書き方、design doc のルールとテンプレート。
- **skills**(`harness/skills/`): SKILL.md 標準形式のワークフロー手順(design doc の執筆・レビュー、PR ワークフロー、日本語技術文書の規範など)。
- **スクリプト**(`harness/scripts/`): bot 名義の GitHub 操作ヘルパー、フックハンドラ、同期・初期化スクリプト。

## セットアップ

### 1. GitHub App(bot)

1. App が無ければ作る: https://github.com/settings/apps → **New GitHub App**。Webhook の Active を外し、Repository permissions を **Contents / Issues / Pull requests = Read and write** にする。
2. **Install App** で導入先リポジトリへインストールする(既存 App の場合は導入先リポジトリを追加する)。
3. 次の 3 つを控える: **App ID**(App 設定ページに表示)、**Installation ID**(インストール後の URL `settings/installations/<数字>` の数字)、**秘密鍵**(**Generate a private key** で取得した `.pem`。リポジトリ外に置く)。

詳細は [harness/scripts/gh/README.md](harness/scripts/gh/README.md)。

### 2. クローンと資格情報

このリポジトリを任意の場所に clone し、clone 直下に `.env`(追跡対象外)を置く。

```sh
BOT_GH_APP_ID=<App ID>
BOT_GH_INSTALLATION_ID=<Installation ID>
BOT_GH_APP_KEY=<秘密鍵 .pem の絶対パス>
```

### 3. プロジェクトの初期化

clone から init を実行し、対象リポジトリを指定する。

```sh
node harness/scripts/sync/harness-init.mjs <対象リポジトリのパス>
```

これが `.harness-version`(clone の origin と HEAD で pin)、`PROJECT.md` の雛形、資格情報(`~/.config/agent-harness/env`)、ベンダーコピー `harness/` と生成物(`AGENTS.md` / `CLAUDE.md` / skills ミラー / 各ツールのフック設定)を用意する。
疎通確認は対象リポジトリで `node harness/scripts/gh/app-token.mjs --check`。

あとは `PROJECT.md` にプロジェクト固有の常時規約を書いて `node harness/scripts/sync/harness-sync.mjs` を再実行し、CI に `--check` を置く(例: [.github/workflows/harness-check.yml](.github/workflows/harness-check.yml))。

## 運用

- **共有ハーネスの更新の取り込み**: `.harness-version` の revision を進めて sync を再実行し、差分を PR にする(pin を進めるまで挙動は変わらない)。手順は `harness-sync` skill。
- **共有ハーネス自体の変更**: このリポジトリへの Issue + PR で行い、マージ後に各プロジェクトが pin を進める。共有かプロジェクト固有かの判断を含めた手順は `harness-update` skill と [harness/docs/editing.md](harness/docs/editing.md)。
- プロジェクト固有の規約・skill・スクリプトは各プロジェクトの `PROJECT.md`・`.claude/skills/`(共有ミラー以外)・`scripts/` に置く。このリポジトリには特定プロジェクトの語彙・事情を持ち込まない。

## ライセンス

MIT OR Apache-2.0([LICENSE-MIT](LICENSE-MIT) / [LICENSE-APACHE](LICENSE-APACHE))。
