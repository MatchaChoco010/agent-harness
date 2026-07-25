//! agent-harness — 共有ハーネスをプロジェクトへ導入・更新する CLI。
//!
//! ユーザーが直接叩くのはこのバイナリ(`init` / `update`)で、
//! ハーネスの展開・生成の実体は取得した rev の `harness/scripts/sync/harness-sync.mjs`(Node.js)に委ねる。

use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

/// ハーネスの取得元。このバイナリ自身のリポジトリを既定とする。
const REPOSITORY: &str = env!("CARGO_PKG_REPOSITORY");

const CRED_KEYS: [&str; 3] = ["BOT_GH_APP_ID", "BOT_GH_INSTALLATION_ID", "BOT_GH_APP_KEY"];

const USAGE: &str = "使い方:\n  agent-harness init [--revision <rev>]   対象リポジトリのルートで実行し、共有ハーネスを導入する\n  agent-harness update [<rev>]            pin を進めて同期する(省略時はリモートの最新)";

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("init") => init(&args[1..]),
        Some("update") => update(&args[1..]),
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

fn init(args: &[String]) -> Result<ExitCode, String> {
    let revision = match args {
        [] => resolve_remote_head(REPOSITORY)?,
        [flag, rev] if flag == "--revision" => rev.clone(),
        _ => return Err(format!("引数が不正。\n{USAGE}")),
    };
    let target = env::current_dir().map_err(|e| e.to_string())?;

    write_pin(&target, REPOSITORY, &revision)?;
    println!("agent-harness: .harness-version を作成({REPOSITORY} @ {revision})");

    let project_md = target.join("PROJECT.md");
    if !project_md.exists() {
        fs::write(
            &project_md,
            "# プロジェクト固有の常時規約\n\n<!-- 常時必要なプロジェクト固有の規約だけをここに書く。harness-sync が harness/AGENTS.md(共有規約)と結合してルート AGENTS.md を生成する。 -->\n",
        )
        .map_err(|e| e.to_string())?;
        println!("agent-harness: PROJECT.md の雛形を作成");
    }

    setup_credentials(&target)?;
    sync(&target, REPOSITORY, &revision)
}

fn update(args: &[String]) -> Result<ExitCode, String> {
    let target = env::current_dir().map_err(|e| e.to_string())?;
    let pin_text = fs::read_to_string(target.join(".harness-version"))
        .map_err(|_| ".harness-version が無い。まず agent-harness init を実行すること。".to_string())?;
    let pin: serde_json::Value =
        serde_json::from_str(&pin_text).map_err(|e| format!(".harness-version の JSON が壊れている: {e}"))?;
    let repository = pin["repository"]
        .as_str()
        .ok_or(".harness-version に repository が無い")?
        .to_string();
    let revision = match args {
        [] => resolve_remote_head(&repository)?,
        [rev] => rev.clone(),
        _ => return Err(format!("引数が不正。\n{USAGE}")),
    };

    write_pin(&target, &repository, &revision)?;
    println!("agent-harness: pin を更新({repository} @ {revision})");
    sync(&target, &repository, &revision)
}

/// pin した rev を一時ディレクトリへ取得し、その中の harness-sync.mjs で展開・生成する。
fn sync(target: &Path, url: &str, rev: &str) -> Result<ExitCode, String> {
    let tmp = env::temp_dir().join(format!("agent-harness-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let result = (|| {
        git(&tmp, &["init", "--quiet"])?;
        git(&tmp, &["remote", "add", "origin", url])?;
        git(&tmp, &["fetch", "--quiet", "--depth", "1", "origin", rev])?;
        git(&tmp, &["checkout", "--quiet", "FETCH_HEAD"])?;
        let script = tmp.join("harness/scripts/sync/harness-sync.mjs");
        if !script.exists() {
            return Err(format!("取得した rev に同期スクリプトが無い: {url}@{rev}"));
        }
        let status = Command::new("node")
            .arg(&script)
            .arg("--target")
            .arg(target)
            .arg("--source")
            .arg(&tmp)
            .status()
            .map_err(|e| format!("node の実行に失敗: {e}(Node.js が必要)"))?;
        Ok(if status.success() { ExitCode::SUCCESS } else { ExitCode::FAILURE })
    })();
    let _ = fs::remove_dir_all(&tmp);
    result
}

/// 資格情報が環境変数・リポジトリ直下の .env・グローバル既定のどこにも無ければ、対話で聞いて保存する。
fn setup_credentials(target: &Path) -> Result<(), String> {
    let global = read_env_file(&global_env_file());
    let local = read_env_file(&target.join(".env"));
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

fn write_pin(target: &Path, repository: &str, revision: &str) -> Result<(), String> {
    let pin = serde_json::json!({ "repository": repository, "revision": revision });
    fs::write(
        target.join(".harness-version"),
        format!("{}\n", serde_json::to_string_pretty(&pin).unwrap()),
    )
    .map_err(|e| e.to_string())
}

fn resolve_remote_head(url: &str) -> Result<String, String> {
    let cwd = env::current_dir().map_err(|e| e.to_string())?;
    let out = git(&cwd, &["ls-remote", url, "HEAD"])?;
    out.split_whitespace()
        .next()
        .map(str::to_string)
        .ok_or_else(|| format!("リモートの HEAD を解決できない: {url}"))
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
