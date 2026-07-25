#!/usr/bin/env node
// harness-edit-guard.mjs — PreToolUse フック(matcher: Edit|Write|MultiEdit / apply_patch)。
//
// ハーネス関連ファイルの編集を検知して次を行う。
//
// 1. **生成物**(AGENTS.md / CLAUDE.md / .agents/skills/** / 共有ミラーの .claude/skills/<名> /
//    .opencode/plugins/agent-harness.js)への編集は deny する。ソース(harness/AGENTS.md、
//    PROJECT.md、harness/skills/)を編集して `agent-harness sync` で再生成する。
// 2. **ベンダー領域**(`harness/` 配下)への編集は、消費側プロジェクト(`.harness-version` を持つ)
//    では deny する。共有ハーネスの変更は agent-harness リポジトリへの Issue + PR で行う
//    (→ harness-update skill)。共有ハーネスのリポジトリ自身(pin を持たない)ではソース編集として
//    許可し、編集の作法(harness/docs/editing.md)のリマインダーを注入する。
// 3. その他のハーネス(PROJECT.md / .claude/settings.json / プロジェクト固有 skill)は
//    非ブロックで editing.md のリマインダーを注入する。
//
// 対象パスは tool_input の file_path(Edit/Write)に加え、apply_patch 形式のパッチ本文
// (`*** Add/Update/Delete File:` 行)からも抽出する(Codex は tool_input.command、
// opencode プラグイン経由では tool_input.patchText にパッチ本文が入る)。
//
// OS 非依存の純 Node stdlib。

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

// apply_patch 形式のパッチ本文から対象パスを抽出する。
function pathsFromPatch(text) {
  const paths = []
  for (const m of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) paths.push(m[1].trim())
  for (const m of text.matchAll(/^\*\*\* Move to: (.+)$/gm)) paths.push(m[1].trim())
  return paths
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { input += c })
process.stdin.on('end', () => {
  let d = {}
  try { d = JSON.parse(input || '{}') } catch { d = {} }

  const ti = d.tool_input || {}
  const targets = []
  const single = ti.file_path || ti.filePath || ti.path || ''
  if (single) targets.push(single)
  const patchText = [ti.patchText, ti.command].find((v) => typeof v === 'string' && v.includes('*** ')) || ''
  if (patchText) targets.push(...pathsFromPatch(patchText))
  if (targets.length === 0) process.exit(0)

  const cwd = d.cwd || process.cwd()

  // pin(.harness-version)を持つリポジトリは消費側、持たないリポジトリは共有ハーネスのソース。
  const isConsumer = existsSync(path.join(cwd, '.harness-version'))
  let sharedSkills = []
  try {
    const sharedDir = path.join(cwd, 'harness', 'skills')
    if (existsSync(sharedDir)) sharedSkills = readdirSync(sharedDir)
  } catch { /* 無視 */ }

  // 1 パスを分類する。{ deny: 理由 } / { remind: 本文 } / null を返す。
  function classify(filePath) {
    let rel = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath
    rel = rel.split(path.sep).join('/').replace(/^\.\//, '')
    if (rel.startsWith('..')) return null // リポジトリ外は対象外

    // 1. 生成物の保護。
    if (rel === 'AGENTS.md' || rel === 'CLAUDE.md') {
      return { deny: `${rel} は生成物である。ソース(harness/AGENTS.md = 共有規約、PROJECT.md = プロジェクト固有規約)を編集し、` +
        '`agent-harness sync` で再生成すること。' }
    }
    if (rel.startsWith('.agents/skills/')) {
      return { deny: `${rel} は .claude/skills/ からの生成ミラーである。ソース側を編集して \`agent-harness sync\` で再生成すること。` }
    }
    if (rel === '.opencode/plugins/agent-harness.js') {
      return { deny: `${rel} は sync が生成するフック接続プラグインである。ハンドラ本体(harness/scripts/hooks/)や ` +
        '生成ロジック(CLI の src/)を共有ハーネス側で変更し、`agent-harness sync` で再生成すること。' }
    }
    const skillMatch = rel.match(/^\.claude\/skills\/([^/]+)\//)
    if (skillMatch && sharedSkills.includes(skillMatch[1])) {
      return { deny: `${rel} は共有 skill のミラーである。共有ハーネス(agent-harness リポジトリ)の harness/skills/${skillMatch[1]}/ を ` +
        'Issue + PR で変更し、マージ後に `agent-harness update <rev>` で取り込むこと(→ harness-update skill)。' }
    }

    // 2. ベンダー領域。
    if (rel === 'harness' || rel.startsWith('harness/')) {
      if (isConsumer) {
        return { deny: `${rel} は共有ハーネスのベンダーコピーであり、このリポジトリでは編集しない。` +
          '共有ハーネスの変更は agent-harness リポジトリへの Issue + PR で行い、マージ後に ' +
          '`agent-harness update <rev>` で取り込むこと(→ harness-update skill)。' +
          'プロジェクト固有の内容なら PROJECT.md・.claude/skills/(共有ミラー以外)・プロジェクトの docs/harness/ に書くこと。' }
      }
      return { remind: [
        '<harness-edit-guard>',
        `編集対象 ${rel} は共有ハーネスのソースである。変更前に harness/docs/editing.md に従うこと:`,
        '- 既存を読み、重複はマージし、整理してから書く。プロジェクト固有の語彙・事情を持ち込まない。',
        '- 参照ドキュメントや skill を新設・変更したら、「いつ読むか」を明示し、実際に読まれる仕組みまで用意する。',
        '- 変更は Issue + ゲーティング PR で行い、マージはユーザー。生成物に影響する変更は `agent-harness sync` を再実行し `agent-harness check` を通すこと。',
        '</harness-edit-guard>',
      ].join('\n') }
    }

    // 3. その他のハーネス(プロジェクト側)。
    const isProjectHarness =
      rel === 'PROJECT.md' ||
      rel === '.claude/settings.json' ||
      rel === '.codex/hooks.json' ||
      rel === '.harness-version' ||
      rel.startsWith('.claude/skills/') ||
      rel.startsWith('docs/harness/') ||
      rel.startsWith('scripts/')
    if (!isProjectHarness) return null

    return { remind: [
      '<harness-edit-guard>',
      `編集対象 ${rel} はハーネス(エージェント向けの規約・指示・道具立て)である。変更前に harness/docs/editing.md に従うこと:`,
      '- まず「共有ハーネスかプロジェクト固有か」を判断する(判断軸は editing.md)。共有にすべき内容なら agent-harness リポジトリへ PR(→ harness-update skill)。',
      '- 既存を読み、重複はマージし、整理してから書く。PROJECT.md には常時必要な規約だけを置く。',
      '- ハーネスの変更は Issue + ゲーティング PR で行い、マージはユーザー。',
      '</harness-edit-guard>',
    ].join('\n') }
  }

  const reminders = new Set()
  for (const t of targets) {
    const r = classify(t)
    if (!r) continue
    if (r.deny) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: r.deny,
        },
      }) + '\n')
      process.exit(0)
    }
    reminders.add(r.remind)
  }
  if (reminders.size > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: [...reminders].join('\n') },
    }) + '\n')
  }
  process.exit(0)
})
