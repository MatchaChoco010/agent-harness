# 共有ハーネスの常時規約

特定の作業のときだけ必要な規約は `harness/docs/` 配下の参照ドキュメントに置く。
その一覧と「いつ読むか」は [harness/docs/README.md](harness/docs/README.md)。

## Design Docs

設計判断は **docs/design/ の番号付き design doc** に意思決定の記録として残す。
design doc を作成・変更・レビューするときは [harness/docs/design/README.md](harness/docs/design/README.md)(ルール)と [harness/docs/design/template.md](harness/docs/design/template.md)(テンプレート)に従う。
執筆は `design-doc-write` skill、レビューは `design-doc-review` skill、レビューを収束まで自動で回すときは `design-doc` skill を使う。

## Markdown と日本語の書き方

markdown を書く・編集するときは [harness/docs/markdown.md](harness/docs/markdown.md) に従う(見た目のための文中改行の禁止・一文一行を含む)。
日本語を書くときは、書く場所(ドキュメント・PR/Issue・コメント・コミットメッセージ)を問わず [harness/docs/japanese.md](harness/docs/japanese.md)(言葉選び・表現)に従う。
まとまった技術文書の段落構成は `japanese-tech-writing` skill に従う。

## コードコメント

ソースコードにコメントを書く・編集するときは [harness/docs/code-comments.md](harness/docs/code-comments.md)(コメントに何を書くか)に従う。

## Git・Issue・PR(常時のゲート)

作業は **Issue + `feature/hoge` ブランチ + PR** でトラックする。
**ゲーティング PR のマージはユーザーが行う。エージェントは `develop` / `main` に勝手にマージしない**(唯一の例外であるレビュー前 Design Doc の develop 集約 landing を含め、[harness/docs/git-and-pr.md](harness/docs/git-and-pr.md) が正)。
ブランチ運用・Issue/PR の切り方・コミットメッセージ・レビュー対応は同ドキュメントに従い、GitHub 操作のコマンドは `pr-workflow` skill を使う。

## エージェント向けスクリプト

再利用スクリプトを書く・置くときは [harness/docs/scripts.md](harness/docs/scripts.md) に従う。
動作確認用の使い捨てスクリプトはリポジトリに残さない。

## skills とハーネスの編集

手順化された作業は skill(SKILL.md 標準形式)で行う。
ユーザーに是正されたとき・一般化できる指摘を受けたとき・非自明な失敗を調査して解決したときは、そのターンのうちに `learnings` skill の基準で記録する。
ハーネス(常時規約のソース / skill / `harness/docs/` / design doc のルール / スクリプト)を編集するとき、および記録した知見を恒久ルールや skill へ昇格するときは [harness/docs/editing.md](harness/docs/editing.md) に従う。
消費側プロジェクトの `harness/` は sync が管理する生成物なので直接編集しない。
