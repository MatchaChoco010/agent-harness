# agent-harness のプロジェクト固有規約

このリポジトリは、プロジェクト非依存の共有ハーネスの源泉である。

- **特定プロジェクトの名前・語彙・事情を持ち込まない。** コード・ドキュメント・skill・Issue・PR・コミット履歴のすべてで、内容は特定のプロジェクトに依存しない一般的な形で書く。利用側プロジェクトの要望を取り込むときも、一般化した問題として記述する。
- このリポジトリでは `harness/` が編集対象のソースである(pin ファイル `.harness-version` は持たない)。編集は [harness/docs/editing.md](harness/docs/editing.md) に従い、Issue + feature ブランチ + ゲーティング PR で行う(マージはユーザー)。
- `AGENTS.md`・`CLAUDE.md`・`.claude/skills/` の共有ミラー・`.agents/skills/`・フック設定・`.gitignore` の管理ブロックは生成物である。ソース(`harness/AGENTS.md`・`PROJECT.md`・`harness/skills/`、フック設定と `.gitignore` ブロックは CLI の `src/`)を編集し、`cargo run -- sync --source .` で再生成する。
- 検証コマンド: `cargo run -- check --source .` と、`harness/scripts/**/*.mjs` の `node --check`。
