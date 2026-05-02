---
theme: seriph
background: https://images.unsplash.com/photo-1518770660439-4636190af475?w=1920
title: Crawlit — Firecrawlを自前で動かす
info: |
  ## Crawlit
  Self-hosted web crawler. Firecrawlの代替。
class: text-center
highlighter: shiki
lineNumbers: true
drawings:
  persist: false
transition: slide-left
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
  <img src="/logo.svg" class="w-40" alt="Crawlit logo" />
</div>

# Crawlit

Firecrawlを自前で動かす話

<div class="pt-12">
  <span class="px-2 py-1 rounded cursor-pointer text-sm" hover="bg-white bg-opacity-10">
    Meetup 2026 · @arufian
  </span>
</div>

<!--
オープニング。Crawlitの紹介。
-->

---
layout: center
class: text-center
---

# 自己紹介

@arufian

Web開発者。最近はAIエージェント周りで遊んでます。

GitHub: github.com/arufian/Crawlit

---
layout: two-cols
---

# 今日話すこと

<v-clicks>

- Firecrawlって何
- なんで自前で作ったか
- Crawlitの中身
- デモ
- ハマりどころ

</v-clicks>

::right::

# 話さないこと

<v-clicks>

- LLMの細かい話
- 法律とrobots.txtの話（大事だけど別の機会に）

</v-clicks>

---
layout: section
---

# まずは課題から

---

# Firecrawlって何？

LLM時代のWebスクレイパー

<v-clicks>

- URLを投げると **きれいなMarkdown** が返ってくる
- JSレンダリングも対応
- クロール、マップ、LLM抽出も全部入り
- API一発で使える

</v-clicks>

<div v-click class="mt-8 p-4 bg-blue-500 bg-opacity-10 rounded">

便利。**でもお金がかかる**。

</div>

---
layout: statement
---

# 大量にスクレイピングしたい

# でも課金は厳しい

---

# やりたいこと

<v-clicks>

- 同じAPI形式で動かしたい（移行コスト最小化）
- ローカルで動かしたい
- Dockerだけで完結させたい
- ステルスモードでJS重いサイトも対応
- LLM抽出も使いたい

</v-clicks>

<div v-click class="mt-8 text-2xl text-center">

→ 自分で作るしかない 💪

</div>

---
layout: section
---

# Crawlitの中身

---

# アーキテクチャ

```mermaid {scale: 0.7}
flowchart LR
  C[Client] -->|POST /v1/scrape| API[Fastify API]
  API --> Fetch{mode?}
  Fetch -->|http| Undici[undici fetch]
  Fetch -->|browser| PW[Playwright + Stealth]
  Undici --> R[Readability]
  PW --> R
  R --> TD[Turndown]
  TD --> MD[Markdown]
  API -->|/v1/crawl| Q[BullMQ Queue]
  Q --> Redis[(Redis)]
  Q --> W[Worker]
  W --> Fetch
```

---

# 技術スタック

| レイヤー | ライブラリ | 役割 |
|---|---|---|
| API | Fastify | 速くて素直 |
| HTTPフェッチ | undici | Node標準系の速いやつ |
| ブラウザ | Playwright + stealth | JS重いサイト用 |
| 抽出 | Mozilla Readability | 本文抽出 |
| 変換 | Turndown | HTML → Markdown |
| キュー | BullMQ | 非同期クロール |
| キャッシュ | Redis | 重複fetch防止 |
| LLM | Vercel AI SDK | スキーマ抽出 |

---

# `/v1/scrape` — 1ページ取得

```bash {all|2|3|4-7|all}
curl -X POST http://localhost:3000/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "links"],
    "onlyMainContent": true,
    "save": true
  }'
```

<v-click>

返ってくるもの：

- きれいなMarkdown（広告・ナビ除去済み）
- リンク一覧
- メタデータ（title, description, lang）

</v-click>

---

# `/v1/crawl` — サイト全体

```bash {all|2-3|4-5|all}
curl -X POST http://localhost:3000/v1/crawl \
  -d '{
    "url": "https://docs.example.com",
    "maxDepth": 2,
    "limit": 100,
    "save": true
  }'
# → { "id": "abc-123" }

# ステータス取得
curl http://localhost:3000/v1/crawl/abc-123
# → { "status": "running", "completed": 12, "total": 47 }
```

非同期。BFSで深さ・件数を制限。

---

# `/v1/map` — URL一覧だけ欲しい

```bash
curl -X POST http://localhost:3000/v1/map \
  -d '{ "url": "https://docs.example.com" }'
```

```json
{
  "success": true,
  "links": ["...", "..."],
  "total": 342
}
```

`sitemap.xml` を最初に試して、無ければリンク抽出にフォールバック。

---

# LLM抽出

スキーマを渡すとJSONで返ってくる。

```json {all|3-13|14|all}
{
  "url": "https://news.ycombinator.com",
  "extract": {
    "schema": {
      "type": "object",
      "properties": {
        "topStory": { "type": "string" },
        "points": { "type": "number" }
      },
      "required": ["topStory"]
    },
    "prompt": "トップ記事のタイトルとポイント数を抽出"
  }
}
```

OpenAIでもAnthropicでもOK。

---
layout: section
---

# デモ

---
layout: center
---

# 🎬 デモタイム

```bash
docker compose up --build
```

<div class="mt-8 text-sm opacity-60">
（ブラウザに切り替え）
</div>

---
layout: section
---

# ハマりどころ

---

# Bot対策がきついサイト

CloudflareやAkamaiが入ってると普通には抜けない。

<v-clicks>

- `mode: "browser"` でPlaywright使う
- `puppeteer-extra-plugin-stealth` でフィンガープリント偽装
- それでもダメなら **住宅プロキシ** が必要

</v-clicks>

<div v-click class="mt-6">

```bash
PROXY_URL=http://user:pass@residential-proxy:port
```

Oxylabs, BrightData, IPRoyalあたり。エンタープライズ案件はこれ無いと無理です。

</div>

---

# Dockerにブラウザ入れる罠

Playwrightのコンテナイメージ、デカい。

<v-clicks>

- `mcr.microsoft.com/playwright` ベース → 1.5GBくらい
- でも自前でChromium入れるとさらに罠が増える
- ARM/x86の両対応も地味に面倒
- 結論：公式イメージに乗っかる

</v-clicks>

---

# キャッシュ戦略

同じURLを何度も叩かないように。

```ts
const cacheKey = `scrape:${normalizeUrl(url)}:${mode}:${formatHash}`
```

<v-clicks>

- URLの正規化（trailing slash、クエリ順）が地味に大事
- formatの違いでキャッシュが分岐するように
- TTLは短め（1時間）デフォルト
- `skipCache: true` で明示的にバイパス

</v-clicks>

---
layout: two-cols
---

# できたこと

<v-clicks>

- Firecrawl互換のAPI形式
- ローカルで無料
- LLM抽出
- Markdown保存
- ステルスモード
- メトリクス（Prometheus）

</v-clicks>

::right::

# まだのこと

<v-clicks>

- 認証必要なサイトの自動ログイン
- スクリーンショット保存
- PDF抽出
- 分散クロール（複数Worker）

</v-clicks>

---
layout: center
class: text-center
---

# まとめ

<v-clicks>

Firecrawlは便利。でも自前で作れば無料で動く。

DockerとTypeScriptで全部いけます。

OSSなのでぜひ触ってみてください。

</v-clicks>

<div v-click class="mt-12">

⭐ github.com/arufian/Crawlit

</div>

---
layout: end
---

# ありがとうございました

質問・フィードバック歓迎です 🙏

@arufian
