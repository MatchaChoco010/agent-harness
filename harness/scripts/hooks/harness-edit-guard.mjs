#!/usr/bin/env node
// harness-edit-guard.mjs — PreToolUse フック(matcher: Edit|Write|MultiEdit)。
//
// ハーネス関連ファイルの編集を検知して次を行う。
//
// 1. **生成物**(AGENTS.md / CLAUDE.md / .agents/skills/** / 共有ミラーの .claude/skills/<名>)への
//    編集は deny する。ソース(harness/AGENTS.md、PROJECT.md、harness/skills/)を編集して
//    `node harness/scripts/sync/harness-sync.mjs` で再生成する。
// 2. **ベンダー領域**(`harness/` 配下)への編集は、消費側プロジェクト(.harness-version の
//    repository が "self" でない)では deny する。共有ハーネスの変更は agent-harness リポジトリへの
//    Issue + PR で行う(→ harness-update skill)。共有ハーネスのリポジトリ自身(repository = "self")
//    ではソース編集として許可し、編集の作法(harness/docs/editing.md)のリマインダーを注入する。
// 3. その他のハーネス(PROJECT.md / .claude/settings.json / プロジェクト固有 skill)は
//    非ブロックで editing.md のリマインダーを注入する。
//
// OS 非依存の純 Node stdlib。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { input += c })
process.stdin.on('end', () => {
  let d = {}
  try { d = JSON.parse(input || '{}') } catch { d = {} }

  const ti = d.tool_input || {}
  const filePath = ti.file_path || ti.filePath || ti.path || ''
  if (!filePath) process.exit(0)

  const cwd = d.cwd || process.cwd()
  let rel = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath
  rel = rel.split(path.sep).join('/').replace(/^\.\//, '')
  if (rel.startsWith('..')) process.exit(0) // リポジトリ外は対象外

  let isSelf = false
  let sharedSkills = []
  try {
    const pin = JSON.parse(readFileSync(path.join(cwd, '.harness-version'), 'utf8'))
    isSelf = pin.repository === 'self'
  } catch { /* pin なしのリポジトリでは共有関連の判定を行わない */ }
  try {
    const sharedDir = path.join(cwd, 'harness', 'skills')
    if (existsSync(sharedDir)) sharedSkills = readdirSync(sharedDir)
  } catch { /* 無視 */ }

  const deny = (reason) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }) + '\n')
    process.exit(0)
  }
  const remind = (text) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
    }) + '\n')
    process.exit(0)
  }

  // 1. 生成物の保護。
  if (rel === 'AGENTS.md' || rel === 'CLAUDE.md') {
    deny(`${rel} は生成物である。ソース(harness/AGENTS.md = 共有規約、PROJECT.md = プロジェクト固有規約)を編集し、` +
      '`node harness/scripts/sync/harness-sync.mjs` で再生成すること。')
  }
  if (rel.startsWith('.agents/skills/')) {
    deny(`${rel} は .claude/skills/ からの生成ミラーである。ソース側を編集して harness-sync で再生成すること。`)
  }
  const skillMatch = rel.match(/^\.claude\/skills\/([^/]+)\//)
  if (skillMatch && sharedSkills.includes(skillMatch[1])) {
    deny(`${rel} は共有 skill のミラーである。共有ハーネス(agent-harness リポジトリ)の harness/skills/${skillMatch[1]}/ を ` +
      'Issue + PR で変更し、マージ後に pin を進めて harness-sync で取り込むこと(→ harness-update skill)。')
  }

  // 2. ベンダー領域。
  if (rel === 'harness' || rel.startsWith('harness/')) {
    if (!isSelf) {
      deny(`${rel} は共有ハーネスのベンダーコピーであり、このリポジトリでは編集しない。` +
        '共有ハーネスの変更は agent-harness リポジトリへの Issue + PR で行い、マージ後に .harness-version の revision を進めて ' +
        '`node harness/scripts/sync/harness-sync.mjs` で取り込むこと(→ harness-update skill)。' +
        'プロジェクト固有の内容なら PROJECT.md・.claude/skills/(共有ミラー以外)・プロジェクトの docs/ に書くこと。')
    }
    remind([
      '<harness-edit-guard>',
      `編集対象 ${rel} は共有ハーネスのソースである。変更前に harness/docs/editing.md に従うこと:`,
      '- 既存を読み、重複はマージし、整理してから書く。プロジェクト固有の語彙・事情を持ち込まない。',
      '- 参照ドキュメントや skill を新設・変更したら、「いつ読むか」を明示し、実際に読まれる仕組みまで用意する。',
      '- 変更は Issue + ゲーティング PR で行い、マージはユーザー。生成物に影響する変更は harness-sync の再実行と --check を通すこと。',
      '</harness-edit-guard>',
    ].join('\n'))
  }

  // 3. その他のハーネス(プロジェクト側)。
  const isProjectHarness =
    rel === 'PROJECT.md' ||
    rel === '.claude/settings.json' ||
    rel === '.harness-version' ||
    rel.startsWith('.claude/skills/') ||
    rel.startsWith('scripts/')
  if (!isProjectHarness) process.exit(0)

  remind([
    '<harness-edit-guard>',
    `編集対象 ${rel} はハーネス(エージェント向けの規約・指示・道具立て)である。変更前に harness/docs/editing.md に従うこと:`,
    '- まず「共有ハーネスかプロジェクト固有か」を判断する(判断軸は editing.md)。共有にすべき内容なら agent-harness リポジトリへ PR(→ harness-update skill)。',
    '- 既存を読み、重複はマージし、整理してから書く。PROJECT.md には常時必要な規約だけを置く。',
    '- ハーネスの変更は Issue + ゲーティング PR で行い、マージはユーザー。',
    '</harness-edit-guard>',
  ].join('\n'))
})
