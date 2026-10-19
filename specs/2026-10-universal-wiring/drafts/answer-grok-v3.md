問い3を中心に、X と公開記事から Reason Network と近い配線への評判を集めます。公式の配送経路も、公開ドキュメントの範囲で照合します。発表直後の称賛は取れました。不満、GitHub issue、近いツール、公式の配送経路を続けて集めます。字数を3000字以内に収まるか確認してから、出典つきでまとめます。下書きが6300字を超えたので、出典は残したまま3000字以内に削ります。結論
同じMacの称賛は、画面操作とコピペをやめることである。seamless の現行が持つ。2〜5人の差は、repo、branch、busy の名簿と不在からの再送である。「公式経路だけなら、より壊れにくく同等以上に速い」は、2026-10-19 の公開仕様では成り立たない。

問い1
名簿が核である（DESIGN.md、https://github.com/reason-machines/reason-network/blob/main/DESIGN.md）。しょうへい氏は Computer Use の遅さから乗り換え、同僚の Claude と repo 一覧を挙げた（2026-10-16、https://x.com/showheyohtaki/status/2111209287460815092）。焼山氏の8秒は1人の計測（2026-10-19、https://x.com/8kyama/status/2112065669722419260）。大田原氏は Orca で足りると書いた（2026-10-19、https://x.com/cursorvers/status/2112083831368847470）。

小チームに効くのは名簿と再送。50台は設計メモ。強制上限は未確認。push は Claude Code、Codex、OpenCode。Cursor、Gemini CLI、Copilot、Grok CLI は turn で、暇なら人が起こすまで待つ。

DESIGN の自認。Claude の本線は内部 socket。Channels は許可リストまで開発フラグ。未読は1日で本文ごと消える。署名は speed bump。受信方針は人単位。操作権限はなく、除名後も暗号的に無力化しない。「人ごとの権限がない」は操作権限だけ事実。2台目で創設者が名簿から落ちた（#1、2026-10-17、https://github.com/reason-machines/reason-network/issues/1）。

問い2
Channels は公式の押し込み口（https://code.claude.com/docs/en/channels と channels-reference）。research preview。claude.ai か Console API。Bedrock、Google Agent Platform、Foundry は不可。Team と Enterprise は有効化が要る。--channels は許可リストだけ。自作フラグは -p と Agent SDK で無視される。段は、伝送の await が処理ではないこと、未ロードは無言で破棄、作業中は次ターン、閉じた会話に郵便箱がない。暇なら push に近い。作業中は socket より遅いことがある。

Codex の app-server は公式（https://developers.openai.com/codex/app-server/）。queue は thread/queue/add（#39092、2026-08-17、https://github.com/openai/codex/pull/39092）。未ロードは再開しない（#44491、2026-09-12にclose、https://github.com/openai/codex/issues/44491）。作業中は hook で、途中より遅いことがある。

A2A v1.0 は内部に触らず、開いている会話へ入れる規格ではない（https://a2a-protocol.org/latest/specification/）。agmsg 作者は、公式モニターが30分で切れるため socket と queue を選んだ（2026-10-15、https://x.com/fujibee/status/2110875185763283324）。

問い3
決め手は画面操作とコピペをやめること、同僚の枝、公開エンジン。Gmail をバスにしていた声がある（2026-10-16、https://x.com/reasonmachines/status/2111265523455701212）。同じフォルダの数秒 push で的外れが減った、と焼山氏（2026-10-19、https://x.com/8kyama/status/2112106510662959314）。見送りは Orca と既定 accept。受理をツール許可にするな、と hexablob 氏（2026-10-18、https://x.com/hexablob/status/2111725409679355968）。

#15 の題は serve の進捗が見えない（2026-10-18、https://github.com/reason-machines/reason-network/issues/15）。agmsg の #625 は成功と返して配置を消す（2026-08-05、https://github.com/fujibee/agmsg/issues/625）。Claude 純正は届かず成功（#25135、2026-02-12、https://github.com/anthropics/claude-code/issues/25135）。Tincan 0.18 は電話承認（2026-10-18、https://x.com/mvanhorn/status/2111665525768311227）。同梱は未確認。HN、Reddit、claude-swarm は特定できず。

案
1. Codex は queue。Claude の socket は暫定。Channels は許可後。本質は公式の注入と開いている会話の速さ。前は Desktop IPC。後は未ロードを失敗と返す。根拠は DESIGN、agmsg、#44491。危険は作業中の hook。
2. 同じMacは現行。2〜5人には repo、branch、busy を既定 hold で足す。本質は名簿。前は同じMacだけ。後は状態だけ見え、本文は保存しない。根拠は DESIGN、しょうへい氏、hexablob 氏。危険は名簿が漏洩面になること。
3. 受理とツール許可を分ける。本質は届いた文が作業許可ではないこと。後は人間が許したかを足し、署名は保証と呼ばない。根拠は hexablob 氏と speed bump。危険は全部聞くと8秒の体感を失うこと。
4. 1日で消える郵便を真似しない。不在は未着として返す。保存は人が期間を指定したときだけ。根拠は DESIGN の1日。危険は既定の保存が原則を崩すこと。
5. 届いたフリを失敗にする。処理開始が無ければ成功と言わない。根拠は #15、#25135。危険は証拠ログへ本文を書くこと。

仮定。8秒は1投稿。#1 の修正、#15 の本文、OpenCode の公式頁は未確認。確信度は問い2が high、問い3と名簿が medium。判断は queue へ替えるか、名簿を既定 hold で足すか。
