---
theme: seriph
background: https://images.unsplash.com/photo-1518770660439-4636190af475?w=1920
title: Crawlit — 5分LT
info: 5分ライトニングトーク
class: text-center
highlighter: shiki
lineNumbers: false
drawings:
  persist: false
transition: fade
mdc: true
hide: true
fonts:
  sans: 'Noto Sans JP'
  mono: 'JetBrains Mono'
css: unocss
---

<style>
.slidev-nav,
.slidev-goto,
.nav-slide-list,
[class*="slide-list"],
[class*="overview"] {
  display: none !important;
}
</style>

<div class="flex justify-center mb-4">
  <img src="/logo.svg" class="w-32" alt="Crawlit logo" />
</div>

# Crawlit

Firecrawlを、タダで動かす話

<div class="pt-8 text-sm opacity-60">@arufian · 5分LT</div>

<!--
⏱ 0:00〜0:20

「今日はCrawlitというツールを作った話をします。」
フックを一言で。
-->

---
layout: center
class: text-center
---

# 自己紹介

@arufian

Web開発者。最近はAIエージェント周りで遊んでます。

GitHub: github.com/arufian/Crawlit

<!--
⏱ 0:20〜0:40

名前だけ。LTなので短く切り上げる。
-->

---

# きっかけ

<v-clicks>

- AIエージェントを作ってた
- ウェブのデータをLLMに食わせたかった
- 「URLを投げたらMarkdownが返ってくるやつ欲しい」

</v-clicks>

<div v-click class="mt-8 p-4 bg-white bg-opacity-10 rounded text-lg">

→ Firecrawlを見つけた 🎉

</div>

<!--
⏱ 0:40〜1:20

「AIエージェントを作っていて、ウェブからドキュメントや記事を大量に取り込みたかったんです。」

「URLを投げたらきれいなMarkdownが返ってくるものを探してたら、Firecrawlを見つけました。」

クリックに合わせてゆっくり話す。
-->

---
layout: two-cols
---

# Firecrawlは最高だった

<v-clicks>

- URLを投げるだけで **きれいなMarkdown**
- JSレンダリングも対応
- クロール、LLM抽出も全部入り
- APIが直感的

</v-clicks>

::right::

<div class="flex flex-col items-center justify-center h-full gap-6">

<div v-click class="text-center p-4 bg-red-500 bg-opacity-20 rounded-lg w-full">
  <div class="text-3xl mb-2">💸</div>
  <div class="text-lg font-bold">でも大量に使うと高い</div>
  <div class="text-sm opacity-70 mt-1">スケールするほど課金が増える</div>
</div>

<div v-click class="text-xl text-center">

→ 自分で作るか

</div>

</div>

<!--
⏱ 1:20〜2:00

「Firecrawlは本当によくできていて、URLを投げるだけでLLMに食わせやすいMarkdownが返ってきます。」

「ただ、大量に使おうとすると課金がきつくなってくるんですよね。」

「だったら同じものを自前で動かせばいいじゃないか、と思って作り始めました。」
-->

---

# 作ったもの: Crawlit

Firecrawl互換のSelf-hosted Scraper

```bash
docker compose up --build
# → http://localhost:3000 で動く
```

<v-clicks>

- **`/v1/scrape`** — 1ページ → Markdown
- **`/v1/crawl`** — サイト全体を非同期クロール  
- **`/v1/map`** — URL一覧を高速取得
- **LLM抽出** — スキーマを渡すとJSONで返ってくる
- **ステルスモード** — Playwright + stealth でBot対策も

</v-clicks>

<!--
⏱ 2:00〜2:50

「作ったのがCrawlitです。FirecrawlとAPIの形を合わせたので、移行コストがほぼゼロです。」

「docker compose up 一発で動きます。Dockerだけあれば他に何も要りません。」

機能を一個ずつ：
- scrapeは1ページ
- crawlはサイト全体を非同期で
- mapはURL一覧だけ欲しいとき
- LLM抽出はスキーマを渡すとJSON
- ステルスはCloudflare対策

「実際に動かしてみます。」
-->

---
layout: center
---

# 🎬 デモ

<div class="text-sm opacity-60 mt-4">（ブラウザに切り替え）</div>

<!--
⏱ 2:50〜4:20

デモ手順（事前確認必須）：
1. docker compose up 済みの状態から開始
2. curl で /v1/scrape を叩く → Markdownが返ってくる様子を見せる
3. save: true でファイルに保存されることを見せる
4. 余裕があれば /v1/crawl も

⚠️ デモ失敗時：
「すみません、事前に取ったものを見てください」と言って次のスライドへ。
焦らず進む。
-->

---
layout: center
class: text-center
---

# まとめ

<v-clicks>

AIエージェントにウェブのデータを食わせたかった

Firecrawlは良かったけど高かった

**自前で作ったら無料になった**

</v-clicks>

<div v-click class="mt-10 text-xl">

⭐ github.com/arufian/Crawlit

</div>

<div v-click class="mt-4 text-sm opacity-60">

質問・フィードバック歓迎です 🙏

</div>

<!--
⏱ 4:20〜4:40

「まとめると、AIエージェントにウェブデータを食わせたくてFirecrawlを見つけて、高かったから自分で作った話でした。」

「OSSで公開してるのでスターもらえると嬉しいです。」

「以上です、ありがとうございました。」

残り時間は質疑へ。
-->
