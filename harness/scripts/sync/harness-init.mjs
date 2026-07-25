// harness-init.mjs — 対象リポジトリへの共有ハーネスの初期セットアップ。
//
// agent-harness の clone(任意の場所)から実行し、対象リポジトリを明示指定する。
//
//   node harness/scripts/sync/harness-init.mjs <対象リポジトリのパス> [--revision <rev>]
//
// 行うこと:
//
//   1. `.harness-version` を書く(repository = clone の origin URL、revision = 指定 or clone の HEAD)
//   2. `PROJECT.md` の雛形を作る(無い場合のみ。既存は変更しない)
//   3. clone 直下の `.env`(BOT_GH_* の資格情報)を `~/.config/agent-harness/env` に導入する
//   4. clone をソースに harness-sync を実行し、ベンダー展開と生成物
//      (AGENTS.md / CLAUDE.md / skills ミラー / 各ツールのフック設定)を作る
//
// 以後の同期は対象リポジトリ内のベンダーコピー(`node harness/scripts/sync/harness-sync.mjs`)で行う。

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

const argv = process.argv.slice(2)
function argValue(name) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null
}
const targetArg = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--revision')
if (!targetArg) fail('使い方: node harness/scripts/sync/harness-init.mjs <対象リポジトリのパス> [--revision <rev>]')

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const TARGET = resolve(targetArg)
if (!existsSync(TARGET)) fail(`対象ディレクトリが存在しない: ${TARGET}`)
if (!existsSync(join(CLONE, 'harness'))) fail(`clone に harness/ が見つからない: ${CLONE}`)

const git = (args) => {
  const r = spawnSync('git', args, { cwd: CLONE, encoding: 'utf8' })
  if (r.status !== 0) fail(`git ${args.join(' ')} が失敗: ${r.stderr}`)
  return r.stdout.trim()
}

// 1. .harness-version。
const repository = git(['remote', 'get-url', 'origin']).replace(/\.git$/, '')
const revision = argValue('--revision') ?? git(['rev-parse', 'HEAD'])
writeFileSync(join(TARGET, '.harness-version'), JSON.stringify({ repository, revision }, null, 2) + '\n')
console.log(`harness-init: .harness-version を作成(${repository} @ ${revision.slice(0, 12)})`)

// 2. PROJECT.md の雛形(無い場合のみ)。
const projectMd = join(TARGET, 'PROJECT.md')
if (!existsSync(projectMd)) {
  writeFileSync(projectMd, [
    '# プロジェクト固有の常時規約',
    '',
    '<!-- 常時必要なプロジェクト固有の規約だけをここに書く。harness-sync が harness/AGENTS.md(共有規約)と結合してルート AGENTS.md を生成する。 -->',
    '',
  ].join('\n'))
  console.log('harness-init: PROJECT.md の雛形を作成(プロジェクト固有規約をここに書く)')
}

// 3. 資格情報の導入(clone/.env → ~/.config/agent-harness/env)。
const envSrc = join(CLONE, '.env')
const credDir = join(homedir(), '.config', 'agent-harness')
const credFile = join(credDir, 'env')
if (existsSync(envSrc)) {
  mkdirSync(credDir, { recursive: true })
  copyFileSync(envSrc, credFile)
  console.log(`harness-init: 資格情報を導入(${credFile})`)
} else if (existsSync(credFile)) {
  console.log(`harness-init: clone に .env が無いため既存の資格情報を維持(${credFile})`)
} else {
  console.warn(`harness-init: 警告: 資格情報が未設定。clone 直下の .env に BOT_GH_APP_ID / BOT_GH_INSTALLATION_ID / BOT_GH_APP_KEY を書いて再実行するか、環境変数で設定すること。`)
}

// 4. sync 実行(clone をソースにする。pin の rev はまだ remote に無くてもよい)。
const sync = spawnSync(
  process.execPath,
  [join(CLONE, 'harness', 'scripts', 'sync', 'harness-sync.mjs'), '--target', TARGET, '--source', CLONE],
  { stdio: 'inherit' },
)
process.exit(sync.status ?? 1)
