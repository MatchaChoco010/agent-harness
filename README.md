# agent-harness

コーディングエージェント(Claude Code / Codex / opencode)向けの共有ハーネス。
プロジェクトに依存しない規約・skill・スクリプトをこのリポジトリで一元管理し、各プロジェクトはバージョンを固定(pin)して取り込む。

## 提供するもの

- **常時規約**(`harness/AGENTS.md`): どのプロジェクトでも変わらない standing なゲート(Git/PR 運用、markdown 規約、design doc ルールへのポインタなど)。
- **参照ドキュメント**(`harness/docs/`): ハーネス編集の作法、Git/Issue/PR の詳細、markdown の書き方、design doc のルールとテンプレート。
- **skills**(`harness/skills/`): SKILL.md 標準形式のワークフロー手順(design doc の執筆・レビュー、PR ワークフロー、日本語技術文書の規範など)。
- **スクリプト**(`harness/scripts/`): bot 名義の GitHub 操作ヘルパー、フックハンドラ、同期スクリプト本体。

## セットアップ(プロジェクトにこのハーネスを導入する)

導入は次の 3 段階で行う。
GitHub App の作成とリポジトリへのインストールは GitHub の Web UI でしか行えないため、この部分は自動化できない(設定後の疎通確認は自動化されている)。

### 1. GitHub App(bot)を用意し、対象リポジトリへのアクセス権を与える

bot 名義の GitHub 操作(`commit.mjs` / `gh.mjs` など)には GitHub App の installation token を使う。

1. App がまだ無ければ作る: https://github.com/settings/apps → **New GitHub App**。Webhook の Active を外し、Repository permissions を **Contents / Issues / Pull requests = Read and write** にして "Only on this account" で作成する。
2. **App ID** は作成後の App 設定ページに表示される数字を控える。
3. **秘密鍵**は App 設定ページの **Generate a private key** で `.pem` をダウンロードし、リポジトリ外(例: `C:\Users\<user>\.github\` や `~/.github/`)に置く。絶対にコミットしない。
4. **インストール**: App 設定ページ左メニューの **Install App** から、このハーネスを導入するリポジトリを選んでインストールする。既存の App を使い回す場合も、対象リポジトリをインストール対象に追加する。インストール後の URL `settings/installations/<数字>` の数字が **Installation ID** である(同一アカウントへのインストールなら、対象リポジトリを追加しても Installation ID は変わらない)。

鍵のローテーションなど詳細は [harness/scripts/gh/README.md](harness/scripts/gh/README.md) を参照。

### 2. 資格情報を環境変数で渡す

スクリプトは次の 3 つの環境変数を読む。

| 変数 | 値 |
|---|---|
| `BOT_GH_APP_ID` | App ID(数字) |
| `BOT_GH_INSTALLATION_ID` | Installation ID(数字) |
| `BOT_GH_APP_KEY` | 秘密鍵 `.pem` の絶対パス |

App ID / Installation ID は機密ではないので平文で置いてよい。
機密は秘密鍵ファイルだけである。
置き場所はツールごとに異なる。

**Claude Code** — プロジェクトの `.claude/settings.local.json`(未追跡・マシンローカル)の `env` に置く。設定を変えたら Claude Code を再起動する。

```json
{
  "env": {
    "BOT_GH_APP_ID": "<App ID>",
    "BOT_GH_INSTALLATION_ID": "<Installation ID>",
    "BOT_GH_APP_KEY": "<秘密鍵 .pem の絶対パス>"
  }
}
```

**Codex CLI** — `~/.codex/config.toml` の `[shell_environment_policy]` で渡す。Codex は既定で OS の環境変数をサブプロセスへ継承するが、バージョンによっては名前に `KEY` / `SECRET` / `TOKEN` を含む変数(`BOT_GH_APP_KEY` が該当)を既定フィルタで落とすため、`ignore_default_excludes = true` を明示するか `set` で明示注入する。

```toml
[shell_environment_policy]
ignore_default_excludes = true

[shell_environment_policy.set]
BOT_GH_APP_ID = "<App ID>"
BOT_GH_INSTALLATION_ID = "<Installation ID>"
BOT_GH_APP_KEY = "<秘密鍵 .pem の絶対パス>"
```

プロジェクト単位にしたい場合は trust 済みプロジェクトの `.codex/config.toml` にも書けるが、値はリポジトリに入れずユーザー側 config に置くのが安全である。

**opencode / その他のツール** — OS のユーザー環境変数として設定すれば、シェルの環境を継承するどのツールからも使える。

設定できたら疎通を確認する:

```sh
node harness/scripts/gh/app-token.mjs --check
```

### 3. ハーネスを展開する

1. プロジェクトのルートに pin ファイル `.harness-version` を置く:

   ```json
   {
     "repository": "https://github.com/MatchaChoco010/agent-harness",
     "revision": "<取り込む tag または commit sha>"
   }
   ```

2. プロジェクト固有の常時規約を `PROJECT.md` に書く(プロジェクト紹介、検証コマンド、固有のゲートなど)。
3. 同期を実行する。初回はまだ `harness/` が無いので、このリポジトリを任意の場所に clone し、**プロジェクトのルートで** sync スクリプトを実行する(2 回目以降はベンダーコピー内の同スクリプトを使う):

   ```sh
   node <agent-harness の clone>/harness/scripts/sync/harness-sync.mjs   # 初回
   node harness/scripts/sync/harness-sync.mjs                            # 以後
   ```

   これで `harness/`(ベンダーコピー)、`AGENTS.md`(`harness/AGENTS.md` + `PROJECT.md` の結合)、`CLAUDE.md`(`@AGENTS.md`)、skills のミラー(`.claude/skills/` と `.agents/skills/`)が生成される。
4. Claude Code のフック・permissions を使う場合は、本リポジトリの `.claude/settings.json` を例にプロジェクトの `.claude/settings.json` を用意する(フックのハンドラは `harness/scripts/hooks/` を指す)。
5. CI に生成物の検証を置く(本リポジトリの `.github/workflows/harness-check.yml` が例):

   ```sh
   node harness/scripts/sync/harness-sync.mjs --check
   ```

## 運用

- **共有ハーネスの更新の取り込み**: このリポジトリの新しい revision に `.harness-version` を進め、sync を再実行して差分を PR にする(明示的な取り込み。pin を進めるまで挙動は変わらない)。手順は `harness-sync` skill。
- **共有ハーネス自体の変更**: このリポジトリへの Issue + PR で行い、マージ後に各プロジェクトが pin を進める。共有かプロジェクト固有かの判断を含めた手順は `harness-update` skill と [harness/docs/editing.md](harness/docs/editing.md)。
- プロジェクト固有の規約・skill・スクリプトは各プロジェクトの `PROJECT.md`・`.claude/skills/`(共有ミラー以外)・`scripts/` に置き、このリポジトリには特定プロジェクトの語彙・事情を持ち込まない。

## ライセンス

MIT OR Apache-2.0([LICENSE-MIT](LICENSE-MIT) / [LICENSE-APACHE](LICENSE-APACHE))。
