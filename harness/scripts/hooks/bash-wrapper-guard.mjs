#!/usr/bin/env node
// bash-wrapper-guard.mjs — PreToolUse フック(matcher: Bash)。
//
// 素の `gh` / `git commit` / `git merge --continue` を Bash ツールで直接叩こうと
// したら、理由つきで block し、bot 名義になるラッパー(harness/scripts/gh/gh.mjs /
// commit.mjs / merge-commit.mjs)へ誘導する。permissions.deny(`Bash(gh:*)` /
// `Bash(git commit:*)` / `Bash(git merge --continue:*)`)がハードゲート、本フックが
// 「なぜ・代わりに何を使うか」の案内を担う。該当しないコマンドは素通り(exit 0)。
//
// 検出はコマンド「位置」に限る(行頭・`;`/`&&`/`||`/`|`/`(` の直後、env 代入の後)。
// これにより `node harness/scripts/gh/gh.mjs`(引数中の gh)や `node harness/scripts/gh/commit.mjs`、
// `git status` / `git commit-tree` は誤検知しない。
//
// また、bot ラッパーで Issue/PR/コメント/コミットの本文を書く操作(gh.mjs issue/pr、
// pr-reply.mjs、commit.mjs、merge-commit.mjs)を検知したら、日本語の言葉選び・表現の規範
// (harness/docs/japanese.md)を読むよう非ブロックのリマインダーを注入する。
// PR の作成だけは、本文に加えて差分に入った日本語(コードコメント・ドキュメント)の
// 見直しを促す。
//
// OS 非依存の純 Node stdlib。起動は
// `node "${CLAUDE_PROJECT_DIR}/scripts/hooks/bash-wrapper-guard.mjs"`。

// コマンド位置のプレフィクス: 行頭 / 区切り(; & | && || |) / 開き括弧 の後、
// 続く env 代入(VAR=val)を読み飛ばす。
const POS = String.raw`(?:^|[;&|(]|&&|\|\|)\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+)*`
// 素の gh: コマンド位置の `gh` の直後が空白か行末(gh.mjs / github は除外)。
const GH_RE = new RegExp(POS + String.raw`gh(?=\s|$)`, 'm')
// 素の git commit: コマンド位置の git、グローバルオプション(`--no-pager` や値を
// 取る `-c user.x=y` / `-C <path>` 等)を挟んでサブコマンド commit(直後が空白/
// 行末。commit-tree は除外)。オプションは「`-` で始まるトークン + 任意でその値」を
// 繰り返しで読み飛ばす。
const GIT_COMMIT_RE = new RegExp(
  POS + String.raw`git\s+(?:-\S+(?:\s+[^-\s]\S*)?\s+)*commit(?=\s|$)`,
  'm',
)
// git merge --continue: コマンド位置の git、グローバルオプションを挟んで merge、
// その引数のどこかに `--continue`(コンフリクト解消の確定をローカルコミットで
// 行おうとするケース)。`git merge origin/develop` などマージの開始は許可する。
const GIT_MERGE_CONTINUE_RE = new RegExp(
  POS + String.raw`git\s+(?:-\S+(?:\s+[^-\s]\S*)?\s+)*merge\s+(?:\S+\s+)*--continue(?=\s|$)`,
  'm',
)
// bot ラッパーで日本語の本文を書く操作(Issue/PR の作成・コメント・返信、コミットメッセージ)。
const JAPANESE_POST_RE = /gh\.mjs\s+(?:issue|pr)\b|gh[\\/](?:pr-reply|commit|merge-commit)\.mjs/
const PR_CREATE_RE = /gh\.mjs\s+pr\s+create\b/

const WRITING_REMINDER =
  'これから書く Issue/PR/コメント/コミットメッセージの日本語は harness/docs/japanese.md(言葉選び・表現の規範)に従う。' +
  'このセッションで未読なら、先に Read してから本文を書くこと。'
const PR_REMINDER =
  'PR を出す前に、差分に入る日本語を見直すこと。対象は変更したコードのコメント・ドキュメント・design doc と、PR 本文である。' +
  '規範は harness/docs/japanese.md(言葉選び・表現)・code-comments.md(コメントに何を書くか)・markdown.md で、' +
  'このセッションで未読なら先に Read する。手順は pr-workflow skill「PR を出す前に日本語を見直す」。'

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { input += c })
process.stdin.on('end', () => {
  let d = {}
  try { d = JSON.parse(input || '{}') } catch { d = {} }

  const command = (d.tool_input && d.tool_input.command) || ''
  if (!command) process.exit(0)

  const hitsGh = GH_RE.test(command)
  const hitsGitCommit = GIT_COMMIT_RE.test(command)
  const hitsMergeContinue = GIT_MERGE_CONTINUE_RE.test(command)
  if (!hitsGh && !hitsGitCommit && !hitsMergeContinue) {
    if (JAPANESE_POST_RE.test(command)) {
      const body = PR_CREATE_RE.test(command) ? PR_REMINDER : WRITING_REMINDER
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: `<japanese-writing-reminder>${body}</japanese-writing-reminder>`,
        },
      }) + '\n')
    }
    process.exit(0)
  }

  const reasons = []
  if (hitsGh) {
    reasons.push(
      '素の `gh` は使わない(ユーザー個人アカウント名義になる)。GitHub 操作は bot 名義になる ' +
        '`node harness/scripts/gh/gh.mjs <gh の引数...>` を通す。',
    )
  }
  if (hitsGitCommit) {
    reasons.push(
      '素の `git commit` は使わない(コミットの author がユーザー個人名義になる)。' +
        '`git add` で対象を選んでから `node harness/scripts/gh/commit.mjs "メッセージ"` を使う(bot 名義 + Verified)。' +
        'マージ中のコンフリクト解消の確定は `node harness/scripts/gh/merge-commit.mjs "メッセージ"`。' +
        '複数行メッセージは stdin: `printf \'subject\\n\\n本文\' | node harness/scripts/gh/commit.mjs -`。',
    )
  }
  if (hitsMergeContinue) {
    reasons.push(
      '`git merge --continue` は使わない(マージコミットの author がユーザー個人名義になる)。' +
        'コンフリクトを解消して `git add` してから `node harness/scripts/gh/merge-commit.mjs "メッセージ"` を使う' +
        '(bot 名義 + Verified の 2 親マージコミット)。',
    )
  }
  reasons.push('詳細: harness/docs/git-and-pr.md /(コマンド手順は)pr-workflow skill。')

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reasons.join('\n'),
    },
  }) + '\n')
})
