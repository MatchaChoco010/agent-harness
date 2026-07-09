# agent-harness

コーディングエージェント(Claude Code / Codex / opencode)向けの共有ハーネス。
プロジェクトに依存しない規約・skill・スクリプトをこのリポジトリで一元管理し、各プロジェクトはバージョンを固定(pin)して取り込む。

## 提供するもの

- **常時規約**(`harness/AGENTS.md`): どのプロジェクトでも変わらない standing なゲート(Git/PR 運用、markdown 規約、design doc ルールへのポインタなど)。
- **参照ドキュメント**(`harness/docs/`): ハーネス編集の作法、Git/Issue/PR の詳細、markdown の書き方、design doc のルールとテンプレート。
- **skills**(`harness/skills/`): SKILL.md 標準形式のワークフロー手順(design doc の執筆・レビュー、PR ワークフロー、日本語技術文書の規範など)。
- **スクリプト**(`harness/scripts/`): bot 名義の GitHub 操作ヘルパー、フックハンドラ、同期スクリプト本体。

## 使い方(プロジェクト側)

1. プロジェクトのルートに `.harness-version`(このリポジトリの URL と tag/sha)を置く。
2. `node harness/scripts/sync/harness-sync.mjs` を実行すると、pin した rev の `harness/` がベンダーコピーとして展開され、`AGENTS.md`(`harness/AGENTS.md` + `PROJECT.md` の結合)、`CLAUDE.md`(`@AGENTS.md`)、skills のミラー(`.claude/skills/` と `.agents/skills/`)が生成される。
3. 生成物と pin の一致は CI の `harness-sync --check` で検証する。
4. 共有ハーネスの更新は、このリポジトリへの PR → マージ後に各プロジェクトで pin を進めて再 sync、という明示的な取り込みで行う。

プロジェクト固有の規約は各プロジェクトの `PROJECT.md` と `.claude/skills/`(共有ミラー以外)に置き、このリポジトリには特定プロジェクトの語彙・事情を持ち込まない。

## ライセンス

MIT OR Apache-2.0([LICENSE-MIT](LICENSE-MIT) / [LICENSE-APACHE](LICENSE-APACHE))。
