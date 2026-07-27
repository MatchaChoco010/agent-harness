//! agent-harness — 共有ハーネスをプロジェクトへ導入・更新・同期する CLI。
//!
//! プロジェクトは共有ハーネス(このリポジトリ)の `harness/` を、`.harness-version` で
//! pin した rev のベンダーコピーとして取り込む。この CLI がその展開と生成物の再生成・検証を行う。
//!
//!   1. `harness/`            … pin した rev の共有ハーネス本体(ベンダーコピー)
//!   2. `AGENTS.md`           … `harness/AGENTS.md`(共有規約) + `PROJECT.md`(プロジェクト固有規約)の結合
//!   3. `CLAUDE.md`           … `@AGENTS.md` の 1 行(Claude Code 用の import)
//!   4. `.claude/skills/<名>` … `harness/skills/` 配下の共有 skill のミラー
//!   5. `.agents/skills/`     … `.claude/skills/` 全体のミラー(Codex 用)
//!   6. フック設定            … ハンドラ(harness/scripts/hooks/)を各ツールに登録する設定
//!                              (.claude/settings.json / .codex/hooks.json へのマージ、
//!                               .opencode/plugins/agent-harness.js の生成)
//!   7. .gitignore            … ハーネス由来の無視項目だけを入れた管理ブロックの追記・更新
//!                              (ブロック外のプロジェクト固有の記述には触れない)
//!
//! AGENTS.md / CLAUDE.md はセッションに常時読み込まれるため、生成物マーカー等の余計な行を
//! 入れない(生成物の保護は編集ガードのフックと `check` が担う)。
//!
//! 共有ハーネスのリポジトリ自身は pin を持たず、`--source .` で自分の `harness/` をソースに
//! 生成・検証する(ソースとベンダー先が同じ場所なのでベンダー展開は行われない)。

use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

/// ハーネスの取得元。このバイナリ自身のリポジトリを既定とする。
const REPOSITORY: &str = env!("CARGO_PKG_REPOSITORY");

const CRED_KEYS: [&str; 3] = ["BOT_GH_APP_ID", "BOT_GH_INSTALLATION_ID", "BOT_GH_APP_KEY"];

/// sync が管理するフックエントリの識別子(command にこれを含むエントリだけを差し替える)。
const HOOK_MARKER: &str = "harness/scripts/hooks/";

/// .gitignore のうち sync が管理する範囲を囲むマーカー。この外側は書き換えない。
/// .gitignore へ書き出す文言は英語で統一する。
const GITIGNORE_BEGIN: &str = "# --- agent-harness sync: managed block, do not edit ---";
const GITIGNORE_END: &str = "# --- agent-harness sync: end of managed block ---";

/// ハーネス自身が持ち込む、追跡してはいけないファイル(コメント, パターン)。
const GITIGNORE_ENTRIES: [(&str, &str); 2] = [
    ("bot (GitHub App) credentials", ".env"),
    ("dependencies of harness/scripts", "harness/scripts/node_modules/"),
];

const USAGE: &str = "使い方:\n  agent-harness init [--revision <rev>]   対象リポジトリのルートで実行し、共有ハーネスを導入する(rev 省略時は main の先端)\n  agent-harness update [<rev>]            pin を進めて同期する(rev 省略時は main の先端)\n  agent-harness sync [--source <dir>]     pin(または --source のローカルソース)から展開・生成し直す\n  agent-harness check [--source <dir>]    生成物の検証のみ。乖離があれば一覧を出して exit 1";

const OPENCODE_PLUGIN: &str = r#"// このファイルは生成物である。直接編集しない。再生成: agent-harness sync
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
"#;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("init") => init(&args[1..]),
        Some("update") => update(&args[1..]),
        Some("sync") => sync_cmd(&args[1..], false),
        Some("check") => sync_cmd(&args[1..], true),
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::FAILURE;
        }
    };
    match result {
        Ok(code) => code,
        Err(e) => {
            eprintln!("agent-harness: {e}");
            ExitCode::FAILURE
        }
    }
}

// --- サブコマンド -----------------------------------------------------------

fn init(args: &[String]) -> Result<ExitCode, String> {
    let revision = match args {
        [] => resolve_remote_main(REPOSITORY)?,
        [flag, rev] if flag == "--revision" => rev.clone(),
        _ => return Err(format!("引数が不正。\n{USAGE}")),
    };
    let root = env::current_dir().map_err(|e| e.to_string())?;

    write_pin(&root, REPOSITORY, &revision)?;
    println!("agent-harness: .harness-version を作成({REPOSITORY} @ {revision})");

    let project_md = root.join("PROJECT.md");
    if !project_md.exists() {
        fs::write(
            &project_md,
            "# プロジェクト固有の常時規約\n\n<!-- 常時必要なプロジェクト固有の規約だけをここに書く。sync が harness/AGENTS.md(共有規約)と結合してルート AGENTS.md を生成する。 -->\n",
        )
        .map_err(|e| e.to_string())?;
        println!("agent-harness: PROJECT.md の雛形を作成");
    }

    setup_credentials(&root)?;
    run_sync(&root, None, false)
}

fn update(args: &[String]) -> Result<ExitCode, String> {
    let root = env::current_dir().map_err(|e| e.to_string())?;
    let pin = read_pin(&root)?;
    let revision = match args {
        [] => resolve_remote_main(&pin.repository)?,
        [rev] => rev.clone(),
        _ => return Err(format!("引数が不正。\n{USAGE}")),
    };
    write_pin(&root, &pin.repository, &revision)?;
    println!("agent-harness: pin を更新({} @ {revision})", pin.repository);
    run_sync(&root, None, false)
}

fn sync_cmd(args: &[String], check: bool) -> Result<ExitCode, String> {
    let source = match args {
        [] => None,
        [flag, dir] if flag == "--source" => Some(PathBuf::from(dir)),
        _ => return Err(format!("引数が不正。\n{USAGE}")),
    };
    let root = env::current_dir().map_err(|e| e.to_string())?;
    run_sync(&root, source.as_deref(), check)
}

// --- 同期エンジン -----------------------------------------------------------

fn run_sync(root: &Path, source: Option<&Path>, check: bool) -> Result<ExitCode, String> {
    // ソース harness/ の解決。--source が無ければ pin を一時ディレクトリへ取得する。
    let mut temp_dir: Option<PathBuf> = None;
    let mut pin_rev: Option<String> = None;
    let src_harness = match source {
        Some(dir) => {
            let src = dir.join("harness");
            if !src.exists() {
                return Err(format!("--source に harness/ が存在しない: {}", dir.display()));
            }
            src
        }
        None => {
            let pin = read_pin(root)?;
            let tmp = fetch_repo(&pin.repository, &pin.revision)?;
            let src = tmp.join("harness");
            if !src.exists() {
                let _ = fs::remove_dir_all(&tmp);
                return Err(format!("pin した rev に harness/ が存在しない: {}@{}", pin.repository, pin.revision));
            }
            temp_dir = Some(tmp);
            pin_rev = Some(pin.revision);
            src
        }
    };

    let mut drift: Vec<String> = Vec::new();
    let harness_dir = root.join("harness");

    // ベンダー展開前の共有 skill 一覧(上流で削除された skill のミラー掃除に使う)。
    let prev_shared = list_skill_dirs(&harness_dir.join("skills"));

    // 1. harness/ のベンダー展開(ソースとベンダー先が同じ場所 = 共有ハーネスのリポジトリ自身では不要)。
    let same_place = match (src_harness.canonicalize(), harness_dir.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    if !same_place {
        if check {
            diff_dir(&src_harness, &harness_dir, "harness", &mut drift);
        } else {
            replace_dir(&src_harness, &harness_dir)?;
        }
    }

    // 2. AGENTS.md / 3. CLAUDE.md。
    let agents = expected_agents_md(root, &harness_dir)?;
    let claude = "@AGENTS.md\n";
    if check {
        if fs::read_to_string(root.join("AGENTS.md")).ok().as_deref() != Some(agents.as_str()) {
            drift.push("AGENTS.md".into());
        }
        if fs::read_to_string(root.join("CLAUDE.md")).ok().as_deref() != Some(claude) {
            drift.push("CLAUDE.md".into());
        }
    } else {
        fs::write(root.join("AGENTS.md"), &agents).map_err(|e| e.to_string())?;
        fs::write(root.join("CLAUDE.md"), claude).map_err(|e| e.to_string())?;
    }

    // 4. 共有 skill のミラー(.claude/skills/<名>)。共有かどうかは harness/skills/ の実体で判定する。
    let shared = list_skill_dirs(&harness_dir.join("skills"));
    let claude_skills = root.join(".claude").join("skills");
    if check {
        for name in &shared {
            diff_dir(
                &harness_dir.join("skills").join(name),
                &claude_skills.join(name),
                &format!(".claude/skills/{name}"),
                &mut drift,
            );
        }
    } else {
        fs::create_dir_all(&claude_skills).map_err(|e| e.to_string())?;
        for stale in prev_shared.iter().filter(|n| !shared.contains(n)) {
            let _ = fs::remove_dir_all(claude_skills.join(stale));
        }
        for name in &shared {
            replace_dir(&harness_dir.join("skills").join(name), &claude_skills.join(name))?;
        }
    }

    // 5. .agents/skills/ の全体ミラー(Codex 用)。
    let agents_skills = root.join(".agents").join("skills");
    if check {
        diff_dir(&claude_skills, &agents_skills, ".agents/skills", &mut drift);
    } else {
        replace_dir(&claude_skills, &agents_skills)?;
    }

    // 6. フック設定(Claude Code / Codex / opencode)。ハンドラは harness/scripts/hooks/ を共用し、
    //    sync 管理エントリ(command に HOOK_MARKER を含む)だけを差し替える(プロジェクト独自の設定は保持)。
    let claude_entries = serde_json::json!([
        { "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/harness/scripts/hooks/harness-edit-guard.mjs\"" }] },
        { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/harness/scripts/hooks/bash-wrapper-guard.mjs\"" }] },
    ]);
    let codex_entries = serde_json::json!([
        { "matcher": "Edit|Write|apply_patch", "hooks": [{ "type": "command", "command": "node harness/scripts/hooks/harness-edit-guard.mjs" }] },
        { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node harness/scripts/hooks/bash-wrapper-guard.mjs" }] },
    ]);
    let claude_deny = ["Bash(gh:*)", "Bash(git commit:*)", "Bash(git merge --continue:*)"];
    let configs = [
        (root.join(".claude").join("settings.json"), ".claude/settings.json", merged_hook_config(&root.join(".claude").join("settings.json"), &claude_entries, Some(&claude_deny))),
        (root.join(".codex").join("hooks.json"), ".codex/hooks.json", merged_hook_config(&root.join(".codex").join("hooks.json"), &codex_entries, None)),
        (root.join(".opencode").join("plugins").join("agent-harness.js"), ".opencode/plugins/agent-harness.js", OPENCODE_PLUGIN.to_string()),
    ];
    for (path, rel, content) in &configs {
        if check {
            if fs::read_to_string(path).ok().as_deref() != Some(content.as_str()) {
                drift.push((*rel).into());
            }
        } else {
            fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            fs::write(path, content).map_err(|e| e.to_string())?;
        }
    }

    // 7. .gitignore。ハーネス由来の項目を管理ブロックとして持たせる(ブロック外はプロジェクトの領域)。
    let gitignore = root.join(".gitignore");
    let expected_gitignore = merged_gitignore(&gitignore);
    if check {
        if fs::read_to_string(&gitignore).ok().as_deref() != Some(expected_gitignore.as_str()) {
            drift.push(".gitignore".into());
        }
    } else {
        fs::write(&gitignore, &expected_gitignore).map_err(|e| e.to_string())?;
    }

    if let Some(tmp) = temp_dir {
        let _ = fs::remove_dir_all(tmp);
    }

    if check {
        if !drift.is_empty() {
            eprintln!("agent-harness check: 生成物が同期されていない。次を確認して `agent-harness sync` を実行すること:");
            for d in &drift {
                eprintln!("  - {d}");
            }
            return Ok(ExitCode::FAILURE);
        }
        println!("agent-harness check: OK");
    } else {
        let pin_note = pin_rev.map(|r| format!("、pin = {r}")).unwrap_or_default();
        println!("agent-harness: 同期完了(共有 skill {} 件{pin_note})", shared.len());
    }
    Ok(ExitCode::SUCCESS)
}

fn expected_agents_md(root: &Path, harness_dir: &Path) -> Result<String, String> {
    let shared = fs::read_to_string(harness_dir.join("AGENTS.md"))
        .map_err(|e| format!("harness/AGENTS.md を読めない: {e}"))?;
    let project = fs::read_to_string(root.join("PROJECT.md")).unwrap_or_default();
    let mut out = shared.trim_end().to_string();
    let project = project.trim_end();
    if !project.is_empty() {
        out.push_str("\n\n");
        out.push_str(project);
    }
    out.push('\n');
    Ok(out)
}

/// 既存の設定 JSON に sync 管理分をマージした期待内容を返す(冪等)。
fn merged_hook_config(path: &Path, entries: &serde_json::Value, deny: Option<&[&str]>) -> String {
    let mut obj: serde_json::Value = fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    let map = obj.as_object_mut().unwrap();

    if let Some(deny_list) = deny {
        let perms = map.entry("permissions").or_insert_with(|| serde_json::json!({}));
        if !perms.is_object() {
            *perms = serde_json::json!({});
        }
        let deny_val = perms.as_object_mut().unwrap().entry("deny").or_insert_with(|| serde_json::json!([]));
        if !deny_val.is_array() {
            *deny_val = serde_json::json!([]);
        }
        let arr = deny_val.as_array_mut().unwrap();
        for d in deny_list {
            if !arr.iter().any(|v| v == d) {
                arr.push(serde_json::json!(d));
            }
        }
    }

    let hooks = map.entry("hooks").or_insert_with(|| serde_json::json!({}));
    if !hooks.is_object() {
        *hooks = serde_json::json!({});
    }
    let pre = hooks.as_object_mut().unwrap().entry("PreToolUse").or_insert_with(|| serde_json::json!([]));
    let others: Vec<serde_json::Value> = pre
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|e| {
                    !e["hooks"]
                        .as_array()
                        .map(|hs| hs.iter().any(|h| h["command"].as_str().unwrap_or("").contains(HOOK_MARKER)))
                        .unwrap_or(false)
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    let mut merged = entries.as_array().unwrap().clone();
    merged.extend(others);
    *pre = serde_json::Value::Array(merged);

    format!("{}\n", serde_json::to_string_pretty(&obj).unwrap())
}

/// 既存の .gitignore に管理ブロックをマージした期待内容を返す(冪等)。
///
/// ブロックが無ければ末尾に足し、あればその範囲だけを差し替える。ブロック外の記述はそのまま残す
/// (.gitignore はプロジェクトが自分で書き足す領域でもあるため、ファイルごと所有しない)。
fn merged_gitignore(path: &Path) -> String {
    let mut block = String::from(GITIGNORE_BEGIN);
    for (note, pattern) in GITIGNORE_ENTRIES {
        block.push_str(&format!("\n# {note}\n{pattern}"));
    }
    block.push('\n');
    block.push_str(GITIGNORE_END);

    let existing = fs::read_to_string(path).unwrap_or_default();
    let bounds = match (existing.find(GITIGNORE_BEGIN), existing.find(GITIGNORE_END)) {
        (Some(start), Some(end)) if end > start => Some((start, end + GITIGNORE_END.len())),
        _ => None,
    };
    let (head, tail) = match bounds {
        Some((start, end)) => (&existing[..start], &existing[end..]),
        None => (existing.as_str(), ""),
    };

    let mut out = String::new();
    let head = head.trim_end();
    if !head.is_empty() {
        out.push_str(head);
        out.push_str("\n\n");
    }
    out.push_str(&block);
    out.push('\n');
    let tail = tail.trim();
    if !tail.is_empty() {
        out.push('\n');
        out.push_str(tail);
        out.push('\n');
    }
    out
}

// --- pin と取得 -------------------------------------------------------------

struct Pin {
    repository: String,
    revision: String,
}

fn read_pin(root: &Path) -> Result<Pin, String> {
    let text = fs::read_to_string(root.join(".harness-version"))
        .map_err(|_| format!("{} に .harness-version が無い。まず agent-harness init を実行すること。", root.display()))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!(".harness-version の JSON が壊れている: {e}"))?;
    let repository = v["repository"].as_str().ok_or(".harness-version に repository が無い")?.to_string();
    let revision = v["revision"].as_str().ok_or(".harness-version に revision が無い")?.to_string();
    Ok(Pin { repository, revision })
}

fn write_pin(root: &Path, repository: &str, revision: &str) -> Result<(), String> {
    let pin = serde_json::json!({ "repository": repository, "revision": revision });
    fs::write(
        root.join(".harness-version"),
        format!("{}\n", serde_json::to_string_pretty(&pin).unwrap()),
    )
    .map_err(|e| e.to_string())
}

/// pin した rev を一時ディレクトリへ shallow fetch して checkout する。
fn fetch_repo(url: &str, rev: &str) -> Result<PathBuf, String> {
    let tmp = env::temp_dir().join(format!("agent-harness-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    git(&tmp, &["init", "--quiet"])?;
    git(&tmp, &["remote", "add", "origin", url])?;
    git(&tmp, &["fetch", "--quiet", "--depth", "1", "origin", rev])?;
    git(&tmp, &["checkout", "--quiet", "FETCH_HEAD"])?;
    Ok(tmp)
}

/// rev 省略時の取得元。動作保証ブランチ main の先端に固定し、default branch には依存しない。
fn resolve_remote_main(url: &str) -> Result<String, String> {
    let cwd = env::current_dir().map_err(|e| e.to_string())?;
    let out = git(&cwd, &["ls-remote", url, "refs/heads/main"])?;
    out.split_whitespace()
        .next()
        .map(str::to_string)
        .ok_or_else(|| format!("リモートに main ブランチが無い: {url}"))
}

fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git の実行に失敗: {e}"))?;
    if !out.status.success() {
        return Err(format!("git {} が失敗: {}", args.join(" "), String::from_utf8_lossy(&out.stderr)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// --- ファイル操作 -----------------------------------------------------------

fn list_skill_dirs(skills_dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(skills_dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

fn replace_dir(from: &Path, to: &Path) -> Result<(), String> {
    let _ = fs::remove_dir_all(to);
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    copy_dir(from, to)
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            fs::copy(&src, &dst).map_err(|e| format!("{} のコピーに失敗: {e}", src.display()))?;
        }
    }
    Ok(())
}

/// ディレクトリの再帰比較(check 用)。相違点を drift に積む。
fn diff_dir(a: &Path, b: &Path, rel: &str, drift: &mut Vec<String>) {
    let a_exists = a.exists();
    let b_exists = b.exists();
    if !a_exists || !b_exists {
        if a_exists != b_exists {
            drift.push(format!("{rel} (存在の不一致)"));
        }
        return;
    }
    let mut names: Vec<String> = Vec::new();
    for dir in [a, b] {
        if let Ok(rd) = fs::read_dir(dir) {
            for e in rd.filter_map(|e| e.ok()) {
                if let Ok(name) = e.file_name().into_string() {
                    if !names.contains(&name) {
                        names.push(name);
                    }
                }
            }
        }
    }
    names.sort();
    for name in names {
        let ap = a.join(&name);
        let bp = b.join(&name);
        let arel = format!("{rel}/{name}");
        if !ap.exists() || !bp.exists() {
            drift.push(arel);
            continue;
        }
        if ap.is_dir() != bp.is_dir() {
            drift.push(arel);
        } else if ap.is_dir() {
            diff_dir(&ap, &bp, &arel, drift);
        } else if fs::read(&ap).ok() != fs::read(&bp).ok() {
            drift.push(arel);
        }
    }
}

// --- 資格情報 ---------------------------------------------------------------

/// 資格情報が環境変数・リポジトリ直下の .env・グローバル既定のどこにも無ければ、対話で聞いて保存する。
fn setup_credentials(root: &Path) -> Result<(), String> {
    let global = read_env_file(&global_env_file());
    let local = read_env_file(&root.join(".env"));
    let available = CRED_KEYS
        .iter()
        .all(|k| env::var_os(k).is_some() || local.contains_key(*k) || global.contains_key(*k));
    if available {
        return Ok(());
    }
    let file = global_env_file();
    if !io::stdin().is_terminal() {
        eprintln!(
            "agent-harness: 警告: bot の資格情報が未設定。環境変数・リポジトリ直下の .env・{} のいずれかに {} を設定すること。",
            file.display(),
            CRED_KEYS.join(" / "),
        );
        return Ok(());
    }
    println!("bot(GitHub App)の資格情報が未設定なので入力する({} に保存)。", file.display());
    let mut lines = Vec::new();
    for (key, prompt) in [
        ("BOT_GH_APP_ID", "App ID"),
        ("BOT_GH_INSTALLATION_ID", "Installation ID"),
        ("BOT_GH_APP_KEY", "秘密鍵 .pem の絶対パス"),
    ] {
        lines.push(format!("{key}={}", ask(prompt)?));
    }
    fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&file, format!("{}\n", lines.join("\n"))).map_err(|e| e.to_string())?;
    println!("agent-harness: 資格情報を保存({})", file.display());
    Ok(())
}

fn ask(prompt: &str) -> Result<String, String> {
    loop {
        print!("{prompt}: ");
        io::stdout().flush().ok();
        let mut buf = String::new();
        io::stdin().read_line(&mut buf).map_err(|e| e.to_string())?;
        let value = buf.trim().to_string();
        if !value.is_empty() {
            return Ok(value);
        }
    }
}

fn read_env_file(path: &Path) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    if let Ok(text) = fs::read_to_string(path) {
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                vars.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    vars
}

fn global_env_file() -> PathBuf {
    home_dir().join(".config/agent-harness/env")
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
