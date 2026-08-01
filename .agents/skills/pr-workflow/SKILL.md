---
name: pr-workflow
description: gh と GitHub を使った Issue/PR ワークフローの手順。バグを Issue でトラックし feature ブランチの PR で直す、Design Doc のレビューを開始してレビュー PR を作る(ready for review → reviewing)、大きな機能開発や Design Doc の実装を親トラッキング Issue + Sub-issues に分割する、PR レビューコメントに対応する、PR のコンフリクトを解消する、マージ後にローカルを同期する、といった作業のときに使用する。「PR を作って」「design doc のレビューを開始して」「レビューコメントに対応して」「コンフリクトを解消して」「Issue を立てて」などの依頼で参照する。
---

`gh` コマンドと GitHub で Issue/PR をトラックする運用手順。
方針の正は、常時コンテキストにある AGENTS.md「Git・Issue・PR」と、そこから辿る `harness/docs/git-and-pr.md`。
後者は必要になったら `Read` で開く(パスはリポジトリルート起点。このスキル本文の markdown リンクは自動では読み込まれない)。
このスキルは具体的なコマンドとヘルパーをまとめる。

**GitHub 操作もコミットも bot 名義で行う。** Issue/PR の作成・レビュー返信・`gh api` は素の `gh` ではなく `node harness/scripts/gh/gh.mjs <gh の引数...>` を通す(bot アカウントの token を注入するラッパー。素の `gh` はユーザー個人名義になる)。コミットも `git commit` の代わりに `node harness/scripts/gh/commit.mjs "メッセージ"` を使う(`git add` で対象を選んでから実行。bot 名義かつ Verified になる。素の `git commit` はユーザー個人名義)。以下のコマンド例はすべてこの前提。設定(環境変数 `BOT_GH_APP_ID` / `BOT_GH_INSTALLATION_ID` / `BOT_GH_APP_KEY`)と仕組みは `harness/scripts/gh/README.md`。

**日本語を書く前と、PR を出す前に**: 本文・コメント・コードコメント・ドキュメントの日本語は `harness/docs/japanese.md`(言葉選び・表現の規範)に従う。書く前にこのセッションで未読なら `Read` し、PR を出す前に下記「PR を出す前に日本語を見直す」を必ず通す。

**本文の渡し方(重要)**: Issue/PR/コメントの**複数行本文は `--body-file -`(stdin ヒアドキュメント)かファイル**で渡す。`--body "..."` の argv に複数行を載せると、シェルからネイティブ実行ファイルへの argv 変換で**先頭1行しか渡らず本文が切れる**環境がある(理由と他の渡し方は `harness/docs/git-and-pr.md` の「複数行の本文は stdin で渡す」を `Read`)。投稿後は `--jq '.body | length'` で切れていないか確認する。

## ブランチ運用(前提)

`main`(動作保証)← `develop`(開発)← `feature/hoge`(機能単位)。
`develop` から `feature/hoge` を切り、`--no-ff` で `develop` に戻す。
`main` へのマージはユーザー確認後。
`hoge` は機能を表すスネークケース英数字。
詳細は `harness/docs/git-and-pr.md`。

## バグ修正の流れ

1. バグを Issue にする(本文は stdin。**複数行を `--body "..."` の argv で渡さない** → 冒頭「本文の渡し方」)。
   ```sh
   node harness/scripts/gh/gh.mjs issue create --title "..." --body-file - <<'EOF'
   本文の1行目
   本文の続き
   EOF
   ```
2. その Issue 用に `develop` から `feature/hoge` を切る。
3. 実装し、bot 名義でコミットする(`git commit` の代わり)。
   ```sh
   git add <対象>
   node harness/scripts/gh/commit.mjs "Summary line in imperative mood"
   ```
4. 差分の日本語を見直す(下記「PR を出す前に日本語を見直す」)。直しが出たらコミットしてから次へ進む。
5. Issue に紐づけて PR を作る(`Closes #N` で自動クローズ。本文は stdin)。
   ```sh
   node harness/scripts/gh/gh.mjs pr create --base develop --title "..." --body-file - <<'EOF'
   Closes #<Issue番号>

   説明本文。
   EOF
   ```
6. 複数バグを1 PR にまとめない。1バグでも原因が複数/順次なら PR を分ける。
7. PR はレビュー単位。関係ない差分を混ぜない。一方で論理単位を曲げてまで小さく割らない(全 PR を見ないと追えない過剰分割は禁止)。

## PR を出す前に日本語を見直す

PR を作る前に必ず通す。design doc のレビュー PR とハーネスの PR でも同じく通す。

1. 規範を `Read` する(このセッションで未読のもの。記憶で済ませない)。
   - `harness/docs/japanese.md` — 言葉選びと表現。すべての日本語に適用される。
   - `harness/docs/code-comments.md` — コメントに何を書くか(コードを触った PR のとき)。
   - `harness/docs/markdown.md` — markdown の書き方(markdown を触った PR のとき)。
2. 差分に入る日本語を通しで読む。
   ```sh
   git diff develop...HEAD
   ```
3. コードコメントは 1 つずつ「これを消したら読む人は何を失うか」を問う。失うものがコードと design doc から得られるなら消す。
4. 直した内容をコミットしてから PR を作る。

## 大きな機能開発の実装分割(親 Issue + Sub-issues)

大きな機能開発(approve された design doc の実装を含む)は、レビューしやすい粒度に分割して**親トラッキング Issue + Sub-issues** にする(方針は `harness/docs/git-and-pr.md`「大きな機能開発は親 Issue + Sub-issues に分割する」)。

1. 親トラッキング Issue を作り、本文に作りたいものの全体像(design doc があればそのリンク)を書く。
2. 各実装単位を Issue にし、親に Sub-issue としてぶら下げる。`gh` の sub-issue サブコマンドが使えない環境では GraphQL の `addSubIssue` を使う。
   ```sh
   # 親 #P に子 #C をぶら下げる例(node id を取得して mutation)
   parent=$(node harness/scripts/gh/gh.mjs api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}' -F o=<owner> -F r=<repo> -F n=<P> --jq .data.repository.issue.id)
   child=$(node harness/scripts/gh/gh.mjs api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}' -F o=<owner> -F r=<repo> -F n=<C> --jq .data.repository.issue.id)
   node harness/scripts/gh/gh.mjs api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}' -F p="$parent" -F c="$child"
   ```
3. Sub-issue を実装順に並べ、各 Sub-issue に紐づく `feature/hoge` PR を作って順に実装する。
4. design doc の実装では、着手時に doc ヘッダーを `implementation: in-progress`、実装 PR が全部マージされたら `done (YYYY-MM-DD)` に更新する。この行だけの差分は PR にせず `feature/hoge → develop` を `--no-ff` で landing する(`harness/docs/git-and-pr.md`「Design Doc のブランチ運用」)。
5. 単一バグなど分割不要なものは Sub-issue を使わず単体 Issue + PR でよい。

## Design Doc レビュー PR(ready for review → reviewing)

develop 上にある `ready for review` の design doc を **レビュー PR** に載せる手順。
doc を `ready for review` まで書き上げて landing したら、続けてこの手順に入る。ユーザーからレビュー開始を依頼されたときも同じ手順で行う。
レビュー対象の doc は既に develop に集約されている(landing 済み)ので、この PR は **status を `reviewing` に変えるだけ**でよい。方針の正は `harness/docs/design/README.md`「レビュープロセス」。

1. **対象を確定する。** レビューする doc を選び、相互参照する/同じ設計テーマを分担する **関連 doc が無いか確認**する(`docs/design/INDEX.md` や doc 間リンクで確認)。あれば、それらをまとめて1つの PR に入れる。セットの一部がまだ `draft` なら、全部が `ready for review` になるまで PR を立てない。
2. **develop からレビュー用ブランチを切る。** 最新 develop から `feature/design-review-<topic>` を切る(`git switch develop && git pull --ff-only && git switch -c feature/design-review-<topic>`)。
3. **status を `reviewing` にする。** 対象 doc 全部のヘッダー `status` を `ready for review` → `reviewing` に変えてコミットする(差分はこの status 行だけでよい)。
4. **PR を作る。** `feature/design-review-<topic> → develop` で PR を作り、本文に対象 doc へのリンクと「doc レビュー用」である旨を書く。URL をユーザーに提示する。差分は status 行だけだが、GitHub は変更ファイルなら差分外の行にもコメントできるので、ユーザーは「Files changed」で全文にコメントできる。
   ```sh
   node harness/scripts/gh/gh.mjs pr create --base develop --title "design: <topic> をレビュー" --body-file - <<'EOF'
   対象 doc へのリンクと「doc レビュー用」の説明。
   EOF
   ```
5. **レビュー対応。** コメントは下記「レビューコメントへの対応」で扱う。各スレッドの結論は **doc 本文へ反映**する(PR ブランチへ追記コミット。out-of-band にしない)。論点を「未解決の論点」節へ移してよいのは、先送り自体を設計判断として根拠付けられる場合だけである(節に書くべき内容は `harness/docs/design/template.md`)。議論が収束しないという理由で移さず、本文の決定として書き切る。
6. **確定。** ユーザーが承認を投稿したら `status: approved` にし、**代替案を簡潔形へ整理**してから(`harness/docs/design/README.md`「代替案はレビュー中に詳しく、approve 後に簡潔へ」)ユーザーがマージする。設計が立たない/不要と結論したら `status: rejected` + `## 却下理由` 節にしてユーザーがマージする。
7. マージはユーザーが行う(レビュー PR はゲーティング扱い)。エージェントが自分の判断で PR なしに develop へマージしてよいのは、レビュー前 doc(`draft` / `ready for review`)の集約 landing と `implementation` 行だけの更新のみ(`harness/docs/git-and-pr.md`)。

## レビューコメントへの対応

ユーザーが PR にコメントを付けたと報告されたら、内容を取得して対応する。

1. コメントを取得する(未解決スレッド + 会話コメント)。
   ```sh
   node harness/scripts/gh/pr-comments.mjs <PR番号>          # 未解決のみ
   node harness/scripts/gh/pr-comments.mjs <PR番号> --all    # 解決済みも含める
   node harness/scripts/gh/pr-comments.mjs <PR番号> --json   # 機械処理用
   ```
2. それぞれのコメントを次のように扱う。
   - **修正が必要**: 修正をコミットし、該当スレッドに何をどう直したか返信する。
   - **修正が不要**: 黙って閉じず、なぜ不要かをスレッドに返信する。
   - **質問**: 実装を急がず、まず質問に答える。返信はスレッド内に付ける(`pr-comments` が出すコメント id を使う)。
   ```sh
   node harness/scripts/gh/pr-reply.mjs <PR番号> <コメントID> "1行だけの返信"
   # 複数行はここでも stdin(argv に載せると先頭1行で切れる)
   node harness/scripts/gh/pr-reply.mjs <PR番号> <コメントID> - <<'EOF'
   返信の1行目
   返信の続き
   EOF
   ```

## PR のコンフリクト解消

develop が進んで PR が `CONFLICTING` になったら、develop を feature ブランチへマージして解消する。
確定のコミットは `git merge --continue` や `git commit` ではなく **`merge-commit.mjs`** で行う(どちらもユーザー個人名義のローカルコミットになるため deny 済み。merge-commit.mjs は bot 名義 + Verified の 2 親マージコミットを Git Data API で作り、ref 更新とローカル同期まで行う)。

```sh
git fetch origin
git merge origin/develop        # コンフリクトが出る
# コンフリクトを解消して…
git add <解消したファイル>
node harness/scripts/gh/merge-commit.mjs "Merge origin/develop into feature/hoge"
# 複数行メッセージは stdin: printf '...' | node harness/scripts/gh/merge-commit.mjs -
```

解消後は PR が `MERGEABLE` になったことを `pr view` で確認し、コード差分をマージした場合はプロジェクトの検証コマンド(AGENTS.md「検証コマンド」など、プロジェクト規約に定めた一式)を再実行する。

## マージと同期

- マージは **ユーザーが** 行う。エージェントは自分の判断でマージしない。ユーザーが対象の PR を名指しして明示的に指示したときだけ、次で代行する(`--merge` でマージコミットを作る。`--squash` / `--rebase` は使わない)。
  ```sh
  node harness/scripts/gh/gh.mjs pr merge <PR番号> --merge
  ```
- マージ状態を確認する。
  ```sh
  node harness/scripts/gh/gh.mjs pr view <PR番号> --json state,mergedAt,mergeStateStatus
  node harness/scripts/gh/gh.mjs pr checks <PR番号>
  ```
- マージを確認したら、PR に紐づく Issue が閉じたかも確認する。`Closes #N` は default branch へのマージでしか自動クローズされない(→ `harness/docs/git-and-pr.md`「ブランチ運用」)ので、開いたままなら明示的に閉じる。
  ```sh
  node harness/scripts/gh/gh.mjs issue view <Issue番号> --json state --jq .state
  node harness/scripts/gh/gh.mjs issue close <Issue番号> --comment "PR #<PR番号> のマージで対応済み。"
  ```
- マージ後はローカルをリモートに追従させる。
  ```sh
  git fetch --prune
  git switch develop && git pull --ff-only
  ```
- マージ済みのローカル feature ブランチは削除してよい。
  ```sh
  git branch -d feature/hoge
  ```

## develop → main のマージ(ユーザーの指示があったときのみ)

ユーザーから develop を main へマージするよう指示されたら、GitHub の Merges API で行う(サーバ側で bot 名義のマージコミットが作られる。ローカルの `git merge` + `merge-commit.mjs` は develop / main への直接コミット拒否により使えない)。

```sh
node harness/scripts/gh/gh.mjs api repos/<owner>/<repo>/merges -f base=main -f head=develop -f commit_message="Merge develop into main"
git fetch --prune
```

## ヘルパー

- `harness/scripts/gh/gh.mjs` — 素の `gh` を bot トークン経由で実行するラッパー。GitHub 操作はこれを通す。
- `harness/scripts/gh/commit.mjs` — ステージ済み変更を bot 名義(Verified)でコミットする(`git commit` の代わり)。
- `harness/scripts/gh/merge-commit.mjs` — 解消済みマージを bot 名義(Verified)の 2 親マージコミットとして確定する(`git merge --continue` の代わり)。
- `harness/scripts/gh/pr-comments.mjs` — レビュースレッド(解決状態つき)+ 会話コメント取得。
- `harness/scripts/gh/pr-reply.mjs` — レビューコメントへのスレッド内返信。

いずれも bot(GitHub App)の設定済み・カレントが対象リポジトリであることが前提(設定は `harness/scripts/gh/README.md`。認証情報は環境変数 `BOT_GH_APP_ID` / `BOT_GH_INSTALLATION_ID` / `BOT_GH_APP_KEY`)。
コミットは `node harness/scripts/gh/commit.mjs` を使う(素の `git commit` はユーザー個人名義になる)。同期確認や merged 判定も `node harness/scripts/gh/gh.mjs pr view/checks` を使う(素の `gh` はユーザー個人名義になるので使わない)。`git fetch` / `git pull` などリポジトリローカルの `git` 操作はそのままでよい。
