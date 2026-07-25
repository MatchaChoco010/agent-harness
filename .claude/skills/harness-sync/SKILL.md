---
name: harness-sync
description: プロジェクトに取り込んだ共有ハーネス(agent-harness)を同期する手順。pin(.harness-version)を進めて新しい版を取り込む、sync スクリプトを実行して生成物を再生成する、CI の --check の乖離を直す、といった作業のときに使用する。「ハーネスを更新して」「harness-sync を回して」「--check が落ちた」などの依頼で参照する。
---

プロジェクト側で共有ハーネス(agent-harness リポジトリ)を同期する手順。
共有ハーネスの**中身を変えたい**ときはこのスキルではなく `harness-update` を使う(このスキルは取り込み専用)。

## 仕組み(前提)

プロジェクトは共有ハーネスの `harness/` ディレクトリを、pin した rev のベンダーコピーとして取り込む。
pin はリポジトリルートの `.harness-version`(JSON)で表す。

```json
{ "repository": "https://github.com/<owner>/agent-harness", "revision": "<tag または commit SHA>" }
```

共有ハーネスのリポジトリ自身では `{ "repository": "self" }` とし、`harness/` をソースとして扱う(ベンダー展開をスキップし、生成物だけを再生成・検証する)。

## 同期の実行

リポジトリルートで sync スクリプトを実行する。

```sh
node harness/scripts/sync/harness-sync.mjs
```

これが次を行う。

1. pin した rev を取得し、`harness/` をベンダーコピーとして展開する。
2. `AGENTS.md` を生成する(`harness/AGENTS.md`(共有規約)+ `PROJECT.md`(プロジェクト固有規約)の結合)。
3. `CLAUDE.md` を生成する(`@AGENTS.md` の import 1 行)。
4. `harness/skills/` 配下の共有 skill を `.claude/skills/` にミラーする。
5. `.claude/skills/` 全体を `.agents/skills/` にミラーする(Codex 用)。
6. フック設定を各ツールに用意する(`.claude/settings.json` / `.codex/hooks.json` へ sync 管理エントリをマージ、`.opencode/plugins/agent-harness.js` を生成。プロジェクト独自のフック・permissions は保持される)。

リポジトリルート以外から実行するときは `--target <dir>` で対象リポジトリを明示する(ルートの探索はしない)。
プロジェクトへの初期導入は agent-harness の clone から `node harness/scripts/sync/harness-init.mjs <対象リポジトリのパス>` で行う(pin・PROJECT.md 雛形・資格情報の導入・初回 sync までを一括で行う。→ agent-harness リポジトリの README)。

## CI での検証

生成物と pin の一致は CI で `--check` により検証される。

```sh
node harness/scripts/sync/harness-sync.mjs --check
```

乖離があれば一覧を出して exit 1 になる。
`--check` が落ちたら、手で生成物を直そうとせず、sync を実行し直して差分をコミットする。

## pin を進める(共有ハーネスの新しい版を取り込む)

共有ハーネス側の変更がマージされたら、各プロジェクトで明示的に取り込む。

1. `develop` から feature ブランチを切る。
2. `.harness-version` の `revision` を新しい tag / SHA に上げる。
3. `node harness/scripts/sync/harness-sync.mjs` を実行し、`harness/`・`AGENTS.md`・skills ミラーの差分を生成する。
4. 差分を確認し(意図しない規約変更が混ざっていないか)、feature ブランチにコミットして PR を作る(→ `pr-workflow`)。
5. ユーザーのレビュー・マージを経て取り込みが確定する。

## 禁止事項

- **`harness/` 配下を直接編集しない。** ベンダーコピーなので、直接編集しても次の sync で消える上、`--check` で乖離として検出される。共有側を変えたいときは `harness-update` の手順で agent-harness リポジトリへ PR を出す。
- `AGENTS.md` / `CLAUDE.md` / `.claude/skills/` の共有ミラー / `.agents/skills/` / `.opencode/plugins/agent-harness.js` も生成物なので直接編集しない。プロジェクト固有の規約は `PROJECT.md` に、プロジェクト固有の skill は `.claude/skills/`(共有ミラー以外の名前)に置く。
- `.claude/settings.json` / `.codex/hooks.json` の sync 管理エントリ(command に `harness/scripts/hooks/` を含むもの)は sync が上書きする。プロジェクト独自のフック・permissions の追記は自由(保持される)。
