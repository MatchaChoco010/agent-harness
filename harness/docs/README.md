# harness/docs — ハーネス参照ドキュメントの索引

ここは **ハーネス**(エージェント向けの恒久的な規約・指示・道具立て)のうち、常時規約(AGENTS.md)に常駐させるほど常時必要ではないが、特定の作業のときに**必ず読む**べき規約を置く場所である。
常時規約は常時必要な standing ゲートだけを持ち、ここへポインタを張る。

## 一覧と「いつ読むか」

| ドキュメント | 何の規約か | **読むべきタイミング(必須)** |
|---|---|---|
| [editing.md](editing.md) | ハーネス編集の作法・共有/プロジェクト固有の判断・多ツール対応・ベンダー領域の編集禁止・常時規約の整理の規律・読まれる仕組みの作り方 | 常時規約(AGENTS.md のソース)/ skill / `harness/docs/` / design doc のルール / スクリプトを**編集・新設するとき(必須)** |
| [markdown.md](markdown.md) | Markdown 執筆の作法(見た目のための行中改行を入れない、全 markdown 共通) | **markdown を書く・編集するとき(design doc・harness・README・SKILL.md など全 markdown)** |
| [japanese.md](japanese.md) | 日本語の言葉選びと表現の規範 | **日本語の文章を書くとき(design doc・PR/Issue の本文とコメント・コミットメッセージ・コードコメント)** |
| [git-and-pr.md](git-and-pr.md) | ブランチ運用・コミット・Issue/PR・Design Doc のブランチ運用とレビュー PR・実装分割・レビュー対応・同期 | Git の分岐・コミット・Issue/PR 作業をするとき。`gh` の具体コマンドは `pr-workflow` skill |
| [scripts.md](scripts.md) | 再利用スクリプトは二層(`harness/scripts/` / プロジェクトの `scripts/`)に Node で・一時検証スクリプトは残さない | スクリプトを書く/置き場所を決めるとき |
| [design/README.md](design/README.md) | design doc のルール(書く対象・高度・自己完結・status・レビュープロセス) | design doc を書く・レビューするとき(必須) |
| [design/template.md](design/template.md) | design doc のテンプレート | design doc を新規に書き始めるとき |

## 読むのを保証する仕組み

ポインタは受動的なので、読まれることを**仕組みで担保する**:

- **ハーネス編集**: ハーネスのファイルを編集しようとしたら editing.md と本索引を読むよう促す。フック機構のあるツールでは PreToolUse 相当のフック(ハンドラは `harness/scripts/hooks/`、登録は各プロジェクト・各ツールの設定ファイル)で注入する。
- **素の `gh` / `git commit` の禁止**: これらをシェルツールで直接叩いたら、permission 設定とフックが block し、bot 名義になる `harness/scripts/gh/gh.mjs` / `commit.mjs` を使うよう案内する(→ [git-and-pr.md](git-and-pr.md))。
- **日本語の本文の投稿**: bot ラッパーで Issue/PR/コメント/コミットの本文を書く操作(`gh.mjs` の issue/pr 系・`pr-reply.mjs`・`commit.mjs`)をフックが検知し、[japanese.md](japanese.md) を読むよう促す。design doc・原稿の執筆では skill(design-doc 系・`japanese-tech-writing`)が参照を指示する。
- **作業トリガーの規約**: 作業内容で発火する規約(Issue/PR、design doc など)は、その作業を description でトリガーする skill(`pr-workflow`、`design-doc` 系)から参照させる。
- **常時必要なゲート**: 事実上どの作業でも関わるゲートだけ常時規約(AGENTS.md)に置く。

新しい規約を足すときに、この「読まれる仕組み」まで用意するのが必須である(→ [editing.md](editing.md))。
