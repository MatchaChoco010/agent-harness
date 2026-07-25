// このファイルは生成物である。直接編集しない。再生成: agent-harness sync
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
