# 有機・分析化学教室 Chemistry Room

有機化学・分析化学を3択問題で学ぶ学習サイト。扱う範囲: 酸塩基と立体化学、置換・脱離・付加反応から、IR・UV・NMR・質量分析、クロマトグラフィーと元素分析。

姉妹サイト「半導体教室」(semiconroom.com、リポジトリ semicon-quiz)と同じエンジンで作っている。HTML/CSS/JavaScript だけで、`src/` と `data/` から `tools/build.js` で `docs/` を生成する。公開は GitHub Actions(`.github/workflows/pages.yml`)が main への push のたびにビルドして GitHub Pages に出す。`docs/` はコミットしない。

## サイトごとの設定

- `config.json` の `siteName`・`brand`(分野名やトップの見出しなど、UI文言の `{{brand_xxx}}` を埋める)・`icon`(アイコンの色と図柄)
- `noindex: true` の間は全ページに noindex を付ける(確認用の公開)。独自ドメインで一般公開するときに `baseUrl`・`cname` を設定し、`noindex` を外す
- 色は `src/css/style.css` の `--accent` など。保存の名前の頭は `src/js/store.js` の `NS`
- サイト固有の計算ツールは `data/tools/{ID}.json`(入力欄と結果は `form` に書く)と `src/js/{ID}.js`

## コマンド

```
npm run validate   # 問題データの検査
npm run build      # docs/ を生成（validate も自動で実行）
npm run serve      # http://localhost:8080/ で確認
npm run check:site # ビルド後の docs/ を点検する(内部リンク切れ・構造化データ・title と description の重複や長さ)
npm run check:ui   # 各言語のクイズ画面に「undefined」などが出ていないかをブラウザで検査(Playwright が必要)
npm run i18n:stale # 日本語の問題を直したあと、訳し直しが必要な言語と問題IDを一覧にする
```

`docs/` はビルドのたびに作り直すため、直接編集しないこと。

## 設定（config.json）

| 項目 | 内容 |
|---|---|
| baseUrl | 公開URL。独自ドメインにするときはここを変更する |
| cname | 独自ドメイン名。設定すると docs/CNAME を出力する |
| onlyReviewed | true にすると reviewed:false の問題を出題しない |
| contactFormUrl | お問い合わせ用 Googleフォームの URL（言語ごとに分けるときは `{ "ja": "…", "en": "…" }`。ない言語は既定言語のものを使う） |
| reportFormUrl | 誤り報告用 Googleフォームの事前入力URL。`{id}`（問題ID）と `{lang}`（言語）を埋めて開く。null ならリンクを出さない |
| adPlaceholders | true のとき広告枠の位置を点線で表示する（adsenseClient を設定すると表示しない） |
| adsenseClient | AdSense のクライアントID（`ca-pub-…`）。設定すると広告スクリプト（クイズ画面以外）と `ads.txt` を出力し、プライバシーポリシーに説明を載せる。null なら何も出さない |
| adsenseSlots | AdSense の広告ユニットID。`{ "default": "1234567890", "top": "…" }` のように、枠の名前（top / question / category / glossary / stats / compare / term / figures）ごと、または `default` で指定する。IDのない枠は何も出さない。null なら枠に広告を入れない |
| amazonTag / amazonDomain | AmazonアソシエイトのトラッキングIDと販売ドメインを言語ごとに指定する（例: ja は `-22` + `www.amazon.co.jp`、en は `-20` + `www.amazon.com`）。タグのない言語では参考書リンクを出さない。検索キーワードは ja が `data/books.json`、他言語は `data/i18n/{言語}/books.json` |
| ga4Id | Google アナリティクス 4 の測定ID（`G-…`）。設定すると全ページに計測タグを出力し、プライバシーポリシーに説明を載せる。null なら何も出さない |

## PWA

ビルド時に `manifest.json`（言語ごと）、アイコン（`tools/icon.js` で生成）、`sw.js` を出力する。Service Worker はネットワークを優先し、つながらないときだけキャッシュを使う。最初の訪問で各言語のトップ・クイズ・成績ページと問題データを保存するので、オフラインでも問題を解ける。中身が変わると版が変わり、古いキャッシュは消える。

## 追加のしかた

- **分野**：`data/categories.json` に1行足し、`data/questions/{分野ID}.json` を置く（問題ごとのページ `/q/{分野ID}/{問題ID}/` も自動で生成される）
- **問題**：`{ id, question, choices, answer(0始まり), explanation, reviewed, source }`。choices の数は自由（2択・4択も可）
- **更新日**：`data/lastmod.json` はビルドが自動で書き換える（ページ本文のハッシュと更新日）。本文が変わったページだけ sitemap.xml の lastmod が新しくなる。手で編集しない
- **学習コース**：`data/courses.json` の `steps` に分野IDを学ぶ順に並べる。名前と説明は言語ごと（`{ "ja": …, "en": … }`）。トップに一覧、`/course/{id}/` にページができる
  - 任意：`level`（1 基礎・2 標準・3 応用。分野ページで絞り込める）、`choiceNotes`（選択肢ごとの「なぜ違うか」。choices と同じ数の配列で、補足がない選択肢は `""`）、`tags`（分野をまたぐタグの配列）
  - 英訳ファイルにも `choiceNotes` を書ける。英訳にない場合、英語版では表示しない
- **図**：`data/figures/{図ID}.svg` を置き、問題に `"figure": "{図ID}"` を書くと、解説の下に表示される（クイズ画面と問題ページ）
  - 文字は日本語で書く。英語は `data/i18n/en/figures.json` に `{ 図ID: { "元の文字": "訳" } }` で書く。訳が足りない図はその言語では表示しない（Ec や VGS など、かな・漢字を含まない文字は訳さなくてよい）
  - 色はクラスで指定する（`ln` 線、`ac` 強調線、`n` / `p` / `ox` / `metal` 塗り、`text.sm` 小さい文字 など。一覧は `style.css` の「図」）。ダークモードでも色が切り替わる
  - `id` 属性は使わない（同じページに複数の図が並ぶため）
- **操作できる図解**：`data/figures-live.json` に図IDごとの文言（言語ごと）・スライダー（`controls`）・対応する計算ツール（`tool`）を書き、描画を `src/js/fig-live.js` の `FIGS` に足すと、図ごとのページ `/figures/{図ID}/` ができる（静的な図と説明の下に操作できる版が出る。図解集・問題・用語・計算ツールからのリンクもそのページに向く）。訳のない言語ではページを作らない
- **言語**：`config.json` の `languages` に1行足し（先頭が既定言語）、翻訳ファイルを置く：`src/i18n/{言語}.json`（UI文言。モード名は `mode_{モードID}_label` / `_desc` / `_empty`）、`src/pages/{言語}/`、`data/i18n/{言語}/`（categories・exams・glossary・questions）。翻訳のない問題はその言語では出題しない。欠落数は `npm run validate` で表示される
- **用語**：`data/glossary.json` に `{ term, reading, desc, cat, about?, faq? }` を足し、訳を `data/i18n/{言語}/glossary.json` に `{ 用語: { term, desc, about?, faq? } }` で書く。用語ページ `/term/{slug}/` は訳のある言語でだけ作る（訳のない語を日本語のまま出さない）。どの問題文・解説にも出てこない語のページは noindex になる
  - 検索結果のタイトルと説明文は決まった形で作る。検索でよく表示される語は、`title`・`description` を書くとそちらを使う（言語ごと。例: 英語版の `"title": "ABA Problem in Lock-Free Programming: Cause and Fixes"`）
  - UI文言に `term_title_en` がある言語（今は繁体字）では、用語名に英語名が含まれていなければ「網表(Netlist)是什麼？」のように英語名を添える（英語の用語名で調べる人が多いため）
- **ニュースに出た用語**（一覧 `/news-terms/`）：`data/news-terms.json` に1語ずつ足す。ページは用語ページ `/term/{slug}/` をそのまま使い、「ひとことで言うと」「なぜ今話題なのか」「既存技術との違い」の節が加わる（一覧は `period` の終わりが新しい順）
  1. 用語集にその語があるか確かめる。なければ先に `data/glossary.json` に足す（`about`・`faq` を書き、英語の用語名から slug が作れないときは `"slug"` を書く）。同じ語のページは作らない
  2. 項目：`term`（用語集の語）、`label`（一覧での表示名。省略すると用語名）、`period`（話題になった時期 `["YYYY-MM", "YYYY-MM"]`）、`added`（載せた日）、`short`（2〜3文）、`why`（`[{ "date": "YYYY-MM-DD / YYYY-MM / YYYY-Qn", "text": … }]`）、`background`、`diff`、`question`（確認問題にする既存の問題ID）、`figures`（図ID）、`terms`（関連用語）、`sources`（`[{ name, date?, url }]`）
  3. `why` には発表・報道で確かめられた事実だけを日付つきで書き、出典を `sources` に入れる。企業や製品の数値・日付で確かでないものは書かない
  4. 訳は `data/i18n/{言語}/news-terms.json` に `{ 用語: { label?, short, why: [本文…（日本語と同じ順・同じ数）], background, diff } }`。日付・問題・リンク先は日本語のファイルのものを使う。訳のない言語では出さない
  5. 用語ページの比較・計算ツールへのリンクは、`data/compare.json` と `data/tools/*.json` の `terms` から自動で付く
- **ページ**：`src/pages/{言語}/xxx.html` を置くと `/xxx/`（英語は `/en/xxx/`）が生成される（先頭のコメントに title などを JSON で書く）
- **計算ツール**：`data/tools/{ID}.json`（文言は言語ごとの `text`）と `src/js/{ID}.js` を置き、入力欄と結果の枠を `tools/build.js` の `toolBody` に足す。`terms`・`figures`（図ID）・`compares`（比較ページのslug）を書くと、ページ下部に関連リンクが出る。入力はURLのクエリに残り（`tool-share.js`）、お気に入りと最近使ったツールは `store.js` が保存する。URLに残さないツールは `"share": false`
- **クイズモード**：`src/js/modes/xxx.js` を置くと自動で登録される（`category.js` を参考に）
- **広告**：`src/js/ads.js` の `slot()` を変更する。クイズ画面には読み込まれない
- **保存処理**：localStorage の読み書きは `src/js/store.js` だけで行う
