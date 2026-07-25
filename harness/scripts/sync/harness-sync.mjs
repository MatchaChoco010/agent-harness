// harness-sync.mjs — 共有ハーネスの同期と生成物の検証。
//
// プロジェクトは共有ハーネス(agent-harness リポジトリ)の `harness/` を、
// `.harness-version` で pin した rev のベンダーコピーとして取り込む。
// このスクリプトはその展開と、次の生成物の再生成・検証を行う。
//
//   1. `harness/`            … pin した rev の共有ハーネス本体(ベンダーコピー)
//   2. `AGENTS.md`           … `harness/AGENTS.md`(共有規約) + `PROJECT.md`(プロジェクト固有規約)の結合
//   3. `CLAUDE.md`           … `@AGENTS.md` の 1 行(Claude Code 用の import)
//   4. `.claude/skills/<名>` … `harness/skills/` 配下の共有 skill のミラー
//   5. `.agents/skills/`     … `.claude/skills/` 全体のミラー(Codex 用)
//   6. フック設定            … ハンドラ(harness/scripts/hooks/)を各ツールに登録する設定
//                              (.claude/settings.json / .codex/hooks.json へのマージ、
//                               .opencode/plugins/agent-harness.js の生成)
//
// 使い方:
//   node harness/scripts/sync/harness-sync.mjs                    # カレント = リポジトリルートで同期
//   node harness/scripts/sync/harness-sync.mjs --target <dir>     # 対象リポジトリを明示指定
//   node harness/scripts/sync/harness-sync.mjs --check            # 検証のみ。乖離があれば一覧を出して exit 1
//   node harness/scripts/sync/harness-sync.mjs --source <clone>   # pin の fetch の代わりにローカル clone をソースにする(harness-init 用)
//
// `.harness-version`(JSON、リポジトリルート):
//   { "repository": "https://github.com/<owner>/agent-harness", "revision": "<tag または sha>" }
//   共有ハーネスのリポジトリ自身では { "repository": "self" } とし、`harness/` をソースとして扱う
//   (ベンダー展開をスキップし、生成物だけを再生成・検証する)。
//
// 生成物と `harness/` 配下は手で編集しない。共有側を変えたいときは agent-harness リポジトリへ
// PR を出し、マージ後に revision を進めて本スクリプトを再実行する(→ harness-update skill)。

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
function argValue(name) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

// 対象リポジトリのルート。--target で明示するか、カレントディレクトリをルートとして扱う(探索はしない)。
const ROOT = resolve(argValue('--target') ?? process.cwd())
if (!existsSync(join(ROOT, '.harness-version'))) {
  fail(`${ROOT} に .harness-version が無い。リポジトリルートで実行するか --target <dir> で指定すること(初期セットアップは harness-init.mjs)。`)
}
const pin = JSON.parse(readFileSync(join(ROOT, '.harness-version'), 'utf8'))
const isSelf = pin.repository === 'self'

// --- ソース harness/ の解決 -------------------------------------------------

const SOURCE = argValue('--source')
let srcHarness
let tempDir = null
if (SOURCE) {
  srcHarness = join(resolve(SOURCE), 'harness')
  if (!existsSync(srcHarness)) fail(`--source に harness/ が存在しない: ${SOURCE}`)
} else if (isSelf) {
  srcHarness = join(ROOT, 'harness')
} else {
  if (!pin.repository || !pin.revision) fail('.harness-version には repository と revision が必要。')
  tempDir = mkdtempSync(join(tmpdir(), 'harness-sync-'))
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: tempDir, encoding: 'utf8' })
    if (r.status !== 0) fail(`git ${args.join(' ')} が失敗: ${r.stderr}`)
    return r.stdout
  }
  git(['init', '--quiet'])
  git(['remote', 'add', 'origin', pin.repository])
  // 完全 SHA / tag は depth 1 で直接 fetch できる(GitHub)。
  git(['fetch', '--quiet', '--depth', '1', 'origin', pin.revision])
  git(['checkout', '--quiet', 'FETCH_HEAD'])
  srcHarness = join(tempDir, 'harness')
  if (!existsSync(srcHarness)) fail(`pin した rev に harness/ が存在しない: ${pin.repository}@${pin.revision}`)
}

// --- 期待される生成内容の計算 -----------------------------------------------

const GENERATED_NOTE = '<!-- このファイルは生成物である。直接編集しない。ソース: harness/AGENTS.md(共有)+ PROJECT.md(プロジェクト固有)。再生成: node harness/scripts/sync/harness-sync.mjs -->'

function readOr(p, fallback) {
  return existsSync(p) ? readFileSync(p, 'utf8') : fallback
}

function expectedAgentsMd(harnessDir) {
  const shared = readFileSync(join(harnessDir, 'AGENTS.md'), 'utf8').trimEnd()
  const project = readOr(join(ROOT, 'PROJECT.md'), '').trimEnd()
  const parts = [GENERATED_NOTE, '', shared]
  if (project) parts.push('', project)
  return parts.join('\n') + '\n'
}

const EXPECTED_CLAUDE = `${GENERATED_NOTE}\n@AGENTS.md\n`

function listSkillDirs(skillsDir) {
  if (!existsSync(skillsDir)) return []
  return readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory()).sort()
}

// ディレクトリの再帰比較(--check 用)。相違点のリストを返す。
function diffDir(a, b, rel = '') {
  const diffs = []
  const aEntries = existsSync(a) ? readdirSync(a).sort() : null
  const bEntries = existsSync(b) ? readdirSync(b).sort() : null
  if (aEntries === null || bEntries === null) {
    if (aEntries !== bEntries) diffs.push(`${rel || '.'} (存在の不一致)`)
    return diffs
  }
  for (const name of new Set([...aEntries, ...bEntries])) {
    const ap = join(a, name)
    const bp = join(b, name)
    const arel = rel ? `${rel}/${name}` : name
    if (!existsSync(ap) || !existsSync(bp)) {
      diffs.push(arel)
      continue
    }
    const as = statSync(ap)
    const bs = statSync(bp)
    if (as.isDirectory() !== bs.isDirectory()) {
      diffs.push(arel)
    } else if (as.isDirectory()) {
      diffs.push(...diffDir(ap, bp, arel))
    } else if (!readFileSync(ap).equals(readFileSync(bp))) {
      diffs.push(arel)
    }
  }
  return diffs
}

function replaceDir(from, to) {
  rmSync(to, { recursive: true, force: true })
  mkdirSync(resolve(to, '..'), { recursive: true })
  cpSync(from, to, { recursive: true })
}

// --- フック設定(全ツール共通のハンドラを各ツールに登録する) -----------------
//
// ハンドラは harness/scripts/hooks/ の 2 本(bash-wrapper-guard / harness-edit-guard)。
// sync が管理するのは command にこのパスを含むエントリだけで、プロジェクト独自の
// フック・permissions は保持する(マージ)。opencode はプラグインファイルを丸ごと生成する。

const HOOK_MARKER = 'harness/scripts/hooks/'

const CLAUDE_HOOK_ENTRIES = [
  { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/harness/scripts/hooks/harness-edit-guard.mjs"' }] },
  { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/harness/scripts/hooks/bash-wrapper-guard.mjs"' }] },
]
const CLAUDE_DENY = ['Bash(gh:*)', 'Bash(git commit:*)', 'Bash(git merge --continue:*)']

const CODEX_HOOK_ENTRIES = [
  { matcher: 'Edit|Write|apply_patch', hooks: [{ type: 'command', command: 'node harness/scripts/hooks/harness-edit-guard.mjs' }] },
  { matcher: 'Bash', hooks: [{ type: 'command', command: 'node harness/scripts/hooks/bash-wrapper-guard.mjs' }] },
]

// 既存の設定 JSON に sync 管理分をマージした期待内容を返す(冪等)。
function mergedHookConfig(configPath, entries, deny) {
  let obj = {}
  try { obj = JSON.parse(readFileSync(configPath, 'utf8')) } catch { /* 無ければ空から */ }
  if (deny) {
    obj.permissions ??= {}
    const cur = obj.permissions.deny ?? []
    obj.permissions.deny = [...cur, ...deny.filter((d) => !cur.includes(d))]
  }
  obj.hooks ??= {}
  const others = (obj.hooks.PreToolUse ?? []).filter(
    (e) => !(e.hooks ?? []).some((h) => String(h.command ?? '').includes(HOOK_MARKER)),
  )
  obj.hooks.PreToolUse = [...entries, ...others]
  return JSON.stringify(obj, null, 2) + '\n'
}

const OPENCODE_PLUGIN = `// このファイルは生成物である。直接編集しない。再生成: node harness/scripts/sync/harness-sync.mjs
// 共有ハーネスのフックハンドラ(harness/scripts/hooks/)を opencode に接続するプラグイン。
import { spawn } from "node:child_process"

const runHook = (script, toolInput, directory) =>
  new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [script], { cwd: directory, stdio: ["pipe", "pipe", "ignore"] })
    let out = ""
    child.stdout.on("data", (c) => { out += c })
    child.on("close", () => resolvePromise(out))
    child.on("error", () => resolvePromise(""))
    child.stdin.end(JSON.stringify({ tool_input: toolInput, cwd: directory }))
  })

export const AgentHarnessGuards = async ({ directory }) => ({
  "tool.execute.before": async (input, output) => {
    const args = output.args ?? {}
    let script = null
    let toolInput = null
    if (input.tool === "bash") {
      script = "harness/scripts/hooks/bash-wrapper-guard.mjs"
      toolInput = { command: args.command ?? "" }
    } else if (["edit", "write", "apply_patch", "patch"].includes(input.tool)) {
      script = "harness/scripts/hooks/harness-edit-guard.mjs"
      toolInput = { file_path: args.filePath ?? "", patchText: args.patchText ?? "" }
    }
    if (!script) return
    const out = await runHook(script, toolInput, directory)
    let decision
    try { decision = JSON.parse(out).hookSpecificOutput } catch { return }
    if (decision && decision.permissionDecision === "deny") throw new Error(decision.permissionDecisionReason)
  },
})
`

// --- 実行 --------------------------------------------------------------------

const drift = []

// ベンダー展開前の共有 skill 一覧(上流で削除された skill のミラー掃除に使う)。
const prevSharedSkills = listSkillDirs(join(ROOT, 'harness', 'skills'))

// 1. harness/ のベンダー展開(self では対象外)。
if (!isSelf) {
  if (CHECK) {
    drift.push(...diffDir(srcHarness, join(ROOT, 'harness'), 'harness'))
  } else {
    replaceDir(srcHarness, join(ROOT, 'harness'))
  }
}
const harnessDir = join(ROOT, 'harness')

// 2. AGENTS.md / 3. CLAUDE.md。
const agents = expectedAgentsMd(harnessDir)
if (CHECK) {
  if (readOr(join(ROOT, 'AGENTS.md'), null) !== agents) drift.push('AGENTS.md')
  if (readOr(join(ROOT, 'CLAUDE.md'), null) !== EXPECTED_CLAUDE) drift.push('CLAUDE.md')
} else {
  writeFileSync(join(ROOT, 'AGENTS.md'), agents)
  writeFileSync(join(ROOT, 'CLAUDE.md'), EXPECTED_CLAUDE)
}

// 4. 共有 skill のミラー(.claude/skills/<名>)。共有かどうかは harness/skills/ の実体で判定する。
const sharedSkills = listSkillDirs(join(harnessDir, 'skills'))
if (CHECK) {
  for (const name of sharedSkills) {
    drift.push(...diffDir(join(harnessDir, 'skills', name), join(ROOT, '.claude', 'skills', name), `.claude/skills/${name}`))
  }
} else {
  mkdirSync(join(ROOT, '.claude', 'skills'), { recursive: true })
  for (const stale of prevSharedSkills.filter((n) => !sharedSkills.includes(n))) {
    rmSync(join(ROOT, '.claude', 'skills', stale), { recursive: true, force: true })
  }
  for (const name of sharedSkills) {
    replaceDir(join(harnessDir, 'skills', name), join(ROOT, '.claude', 'skills', name))
  }
}

// 5. .agents/skills/ の全体ミラー(Codex 用)。
const claudeSkills = join(ROOT, '.claude', 'skills')
const agentsSkills = join(ROOT, '.agents', 'skills')
if (CHECK) {
  drift.push(...diffDir(claudeSkills, agentsSkills, '.agents/skills'))
} else {
  replaceDir(claudeSkills, agentsSkills)
}

// 6. フック設定(Claude Code / Codex / opencode)。
const hookConfigs = [
  { path: join(ROOT, '.claude', 'settings.json'), rel: '.claude/settings.json', content: mergedHookConfig(join(ROOT, '.claude', 'settings.json'), CLAUDE_HOOK_ENTRIES, CLAUDE_DENY) },
  { path: join(ROOT, '.codex', 'hooks.json'), rel: '.codex/hooks.json', content: mergedHookConfig(join(ROOT, '.codex', 'hooks.json'), CODEX_HOOK_ENTRIES, null) },
  { path: join(ROOT, '.opencode', 'plugins', 'agent-harness.js'), rel: '.opencode/plugins/agent-harness.js', content: OPENCODE_PLUGIN },
]
for (const { path: p, rel, content } of hookConfigs) {
  if (CHECK) {
    if (readOr(p, null) !== content) drift.push(rel)
  } else {
    mkdirSync(resolve(p, '..'), { recursive: true })
    writeFileSync(p, content)
  }
}

if (tempDir) rmSync(tempDir, { recursive: true, force: true })

if (CHECK) {
  if (drift.length > 0) {
    console.error('harness-sync --check: 生成物が同期されていない。次を確認して `node harness/scripts/sync/harness-sync.mjs` を実行すること:')
    for (const d of drift) console.error(`  - ${d}`)
    process.exit(1)
  }
  console.log('harness-sync --check: OK')
} else {
  console.log(`harness-sync: 同期完了(共有 skill ${sharedSkills.length} 件${isSelf ? '、self モード' : `、pin = ${pin.revision}`})`)
}
