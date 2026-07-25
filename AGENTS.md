<!-- このファイルは生成物である。直接編集しない。ソース: harness/AGENTS.md(共有)+ PROJECT.md(プロジェクト固有)。再生成: node harness/scripts/sync/harness-sync.mjs -->

# 共有ハーネスの常時規約

この文書は共有ハーネスの常時規約であり、プロジェクト固有の規約はこの後(PROJECT.md 由来)に続く。

特定の作業のときだけ必要な規約は `harness/docs/` 配下の参照ドキュメントに置き、ここからは短いポインタで参照する。
その一覧と「いつ読むか」は [harness/docs/README.md](harness/docs/README.md)。

## Design Docs(必読ルール)

設計判断は **docs/design/ の番号付き design doc** に意思決定の記録として残す。
ルールとテンプレートは [harness/docs/design/README.md](harness/docs/design/README.md) と [harness/docs/design/template.md](harness/docs/design/template.md) を参照。
要点:

- 1 ファイル = 1 意思決定。`NNNN_title.md` の連番(意思決定の時系列順)。
- 代替案と Pros/Cons、なぜその案を選んだかを必ず書く。
- 昔の doc は消さない。設計変更は新番号の doc で記録し、旧 doc を参照する。
- status: `draft`(書きかけ)/ `ready for review`(レビュー待ち)/ `reviewing`(レビュー PR でレビュー中)/ `approved`(ユーザー承認)/ `ai-approved`(委任判断で実装)/ `rejected`。
- レビュー前の doc(`draft` / `ready for review`)も **develop に集約**する(feature → develop を `--no-ff` で PR なし landing。ユーザーがブランチ切替なしに読めるように)。レビューは develop から `reviewing` に変えるだけの **レビュー PR** で行い、PR コメント(差分外の行にも可)でレビューし、承認後にユーザーがマージする(README「レビュープロセス」)。

design doc の執筆・レビューは専用 skill で行う。
`design-doc-write` skill で draft を書き、`design-doc-review` skill でルール遵拠と設計妥当性を敵対的にレビューする。
両者を束ねて敵対的レビューを収束まで自動で回すワークフローは `design-doc` skill で起動する(詳細は各 skill 参照)。

## Markdown の書き方(全 markdown 共通)

Markdown は **文の途中で見た目(行の折り返し)のためだけに改行を入れない**。
長い文を見た目で割らず、折り返しはエディタのソフトラップに任せる(文中の見た目改行は word wrap のあるエディタで中途半端な改行となり読みにくくする)。
改行は意味の区切り(段落・文末・リスト項目など)で行い、日本語の散文は **一文ごとに改行する「一文一行」を標準**とする(→ `japanese-tech-writing` skill)。
詳細・例外と例は [harness/docs/markdown.md](harness/docs/markdown.md)。

## Git・Issue・PR(常時のゲート)

作業は **Issue + `feature/hoge` ブランチ + PR** でトラックする。
`main`(動作保証)← `develop`(開発)← `feature/hoge`(機能単位)。
`feature` は `--no-ff` で `develop` に戻す。

- **誰が何をマージするか(重要)**: 実装コード・ハーネス変更・Design Doc レビュー PR の **ゲーティング PR はユーザーがマージする。エージェントは `develop` / `main` に勝手にマージしない。** 唯一の例外はレビュー前 Design Doc(`draft` / `ready for review`)の develop 集約 landing で、これだけは `feature → develop` を `--no-ff` でエージェントがマージしてよい(PR を作らない)。`main` へのマージは常にユーザーの確認を経る。
- **PR はレビューの単位**: 関係ない差分を 1 PR に混ぜない。とくにハーネスとプロダクトコード / Design Doc 本文を混ぜない。一方、論理単位を曲げてまで小さく割らない。
- **ハーネスの変更も Issue + PR**: skill・スクリプト・参照ドキュメント・design doc のルール・常時規約の更新も、`develop` に直接コミットせず Issue + feature ブランチ + ゲーティング PR で行う(中身の書き方は [harness/docs/editing.md](harness/docs/editing.md))。
- **コミットメッセージ**: 1 行目は何をやったかの簡潔なサマリー(英語の命令形、72 文字程度まで)、空行をはさんで本文。

ブランチ運用・コミットのシェル渡し・Issue/PR・Design Doc のブランチ運用とレビュー PR・実装分割・レビュー対応・同期の詳細手順は [harness/docs/git-and-pr.md](harness/docs/git-and-pr.md)、`gh` の具体的コマンドとヘルパーは `pr-workflow` skill を参照する。

## エージェント向けスクリプト

再利用スクリプト(skill のフック・ヘルパーを含む)は **Node.js** で書き、共有は `harness/scripts/`、プロジェクト固有はプロジェクトの `scripts/` に置く。
動作確認用の使い捨てスクリプトはリポジトリに残さない。
判断基準と詳細は [harness/docs/scripts.md](harness/docs/scripts.md)。

## skills と学びの記録

手順化された作業は skill(SKILL.md 標準形式)で行う。
共有 skill は `harness/` からミラーされ、プロジェクト固有 skill はプロジェクト側に置く。
skill の編集は [harness/docs/editing.md](harness/docs/editing.md) に従う。

作業で得た学び・知見を恒久ルールや skill へ昇格するときは、昇格先が共有ハーネスかプロジェクト固有かを [harness/docs/editing.md](harness/docs/editing.md)「共有ハーネスかプロジェクト固有かの判断」に従って決める(学びの記録の仕組み自体はプロジェクトごとに定めてよく、この共有ハーネスは提供しない)。

## ハーネスの編集

ハーネス(常時規約のソース / skill / `harness/docs/` / design doc のルール / スクリプト)を編集するときは [harness/docs/editing.md](harness/docs/editing.md) に従う(編集の作法・共有/固有の判断・多ツール対応・ベンダー領域の編集禁止を含む)。
消費側プロジェクトの `harness/` は sync が管理する生成物なので直接編集しない。

# agent-harness のプロジェクト固有規約

このリポジトリは、プロジェクト非依存の共有ハーネスの源泉である。

- **特定プロジェクトの名前・語彙・事情を持ち込まない。** コード・ドキュメント・skill・Issue・PR・コミット履歴のすべてで、内容は特定のプロジェクトに依存しない一般的な形で書く。利用側プロジェクトの要望を取り込むときも、一般化した問題として記述する。
- このリポジトリでは `harness/` が編集対象のソースである(`.harness-version` は `self`)。編集は [harness/docs/editing.md](harness/docs/editing.md) に従い、Issue + feature ブランチ + ゲーティング PR で行う(マージはユーザー)。
- `AGENTS.md`・`CLAUDE.md`・`.claude/skills/` の共有ミラー・`.agents/skills/` は生成物である。ソース(`harness/AGENTS.md`・`PROJECT.md`・`harness/skills/`)を編集し、`node harness/scripts/sync/harness-sync.mjs` で再生成する。
- 検証コマンド: `node harness/scripts/sync/harness-sync.mjs --check` と、`harness/scripts/**/*.mjs` の `node --check`。
