# Launching KAVOX on Product Hunt

Everything for the launch in one place: what must be true before the day, the listing (copy and
images, ready to paste), the day itself, and what the site does for Product Hunt visitors.

## 1. Before launch day (must be true)

| | What | Where | Why |
|---|---|---|---|
| ☐ | Your own domain, with **Always Use HTTPS** | /admin → Settings; Cloudflare | The listing, every shared link and Google all use it. Do it first: changing it later breaks links. |
| ☐ | A contact email | /admin → Settings | Shown on the Terms and Privacy pages; Product Hunt visitors look for it. |
| ☐ | **Credits stay off** | /admin → Features | The listing says "free, no sign-up": it must be true on the day. |
| ☐ | A live test | The website and @Kavoxbot | One short link, one uploaded clip, one song as a lyrics video, one video to the bot. Fix anything before launch, not during it. |
| ☐ | Launch-day limits | /admin → Features → Limits | See "Capacity" below. |
| ☐ | Refresh the bot | /admin → Features → Telegram bot | So it shows the newest command menu (/invite). |
| ☐ | Product Hunt account | producthunt.com | Make the maker profile complete (photo, bio, links) a week before; new empty accounts look like spam. |
| ☐ | Optional: Google Search Console | /admin → Features → Launch | Launch traffic leads to searches for "KAVOX" afterwards. |

### Capacity: the one real risk

The video engine runs on a free Hugging Face Space: 2 CPUs and at most 20 videos in its queue. A
2–3 minute video takes a few minutes; a launch can bring hundreds of people in an hour. Then
videos wait, and some visitors leave before theirs is done.

On the day:

- **Admin → Features → Limits**: 2 videos per hour per person (instead of 5) shares the engine more
  fairly. Keep the upload limit; most people try short clips.
- Lyrics videos are capped at 15 minutes of sound already (`VISUAL_MAX_MIN`).
- Watch **Admin → Jobs** and **Admin → Growth** through the day.
- Optional and not free: a faster Space hardware for the day (Hugging Face → Space → Settings →
  Hardware; paid by the hour, back to free afterwards). Only worth it if the queue stays full.

## 2. The listing (ready to paste)

**Name:** KAVOX

**Tagline** (60 characters at most; pick one):

1. `Translate any video, or turn a song into a lyrics video` (55)
2. `Free video translation and lyrics videos, Arabic-first` (54)
3. `Subtitles, dubbing and lyrics videos. Free, no sign-up` (54)

**Description** (260 at most; 228):

> KAVOX turns any video into subtitles or a dubbed voice in your language, and any song into a
> lyrics video: words lit as they are sung, a translation in its own caption. Free, no sign-up,
> Arabic-first, on the web and in Telegram.

**Topics:** Video · Artificial Intelligence · Languages (and, if there is a fourth slot, Music).

**Links:** the website (your domain) and the Telegram bot (`https://t.me/Kavoxbot`).

**Pricing:** Free.

**Thumbnail:** `docs/launch/thumbnail.png` (240 × 240).

**Gallery** (1270 × 760, in this order; every picture is a real screenshot or a real render):

1. `docs/launch/gallery-1-cover.jpg`: Watch any video in your language
2. `docs/launch/gallery-2-lyrics.jpg`: Turn any song into a lyrics video
3. `docs/launch/gallery-3-karaoke.jpg`: Every word lit as it is sung
4. `docs/launch/gallery-4-design.jpg`: Design it, see it, render it
5. `docs/launch/gallery-5-arabic.jpg`: Built for Arabic, right to left
6. `docs/launch/gallery-6-telegram.jpg`: Send a video to the bot, get it back translated

**Video** (optional; Product Hunt takes a YouTube link): `docs/launch/demo-lyrics-shenandoah.mp4`
is a real 40-second lyrics video ("Shenandoah", US Air Force Band, public domain). A 30–60 second
screen recording of making one (choose a song → pick the look → result) is even better.

### First comment (post it the moment the launch goes live)

> Hi Product Hunt! 👋 I'm the maker of KAVOX.
>
> I built it because most of the world's videos (and songs) are in a language you don't speak, and
> the tools that fix that are either paid, made for English, or both.
>
> **What it does**
> - **Translate any video**: paste a link or upload a file → subtitles (.srt/.vtt), the video
>   with subtitles in it, or a dubbed voice in your language.
> - **Lyrics videos**: give it a song (or any video, only its sound is used) → a new video with
>   visuals that move with the music, every word lit as it is sung, and a translation in its own
>   caption. Vertical, square or wide, for Reels, TikTok and Shorts.
> - **Arabic-first**: the whole app in Arabic or English, right to left done properly.
> - **Also a Telegram bot**: send a video or a song to @Kavoxbot and get it back.
>
> **Free, no sign-up.** It runs on free infrastructure, so on a busy day your video may wait a
> few minutes in line. Thank you for your patience!
>
> I'd love your feedback: what would you translate first, and which language is missing?

## 3. Launch day

- Launches start at **12:01 a.m. Pacific time** (11:01 a.m. in Saudi Arabia). Tuesday to Thursday
  get the most visitors (and the most competition); a weekend is quieter and easier to rank.
- **/admin → Features → Product Hunt**: paste the post address, then **Start launch day**. Every
  visitor sees "KAVOX is live on Product Hunt today" with a button to support it.
- Post the first comment straight away.
- Tell your own people (Telegram groups, WhatsApp, X, friends). Ask them to *try it and leave
  honest feedback*: Product Hunt penalizes asking for upvotes, and votes from brand-new accounts
  count for little.
- Answer every comment, all day, within an hour if you can.
- Watch **/admin → Growth**: visits from Product Hunt show as "producthunt".
- The next day: **End launch day**. A small "Featured on Product Hunt" link stays in the footer.

## 4. What the site does for Product Hunt visitors

- Product Hunt adds `?ref=producthunt` to its links. Those visitors (and anyone arriving from
  producthunt.com) get a short welcome: "Welcome, Product Hunt! Free, no sign-up", with the two
  things to try: **Translate a video** and **Make a lyrics video**.
- On launch day, the "live on Product Hunt today" banner for everyone (above).
- They count on the Growth page under "producthunt"; the videos they start show there per
  journey (translations, lyrics videos).
- Every video they make ends with the share card ("Your video is ready. Post it!"), and every
  shared video invites its viewers to make their own: one launch visitor can bring the next.

## 5. How KAVOX stands out (for comments and replies)

Product Hunt's video-subtitle tools (VEED, Kapwing, Wavel, TranslateVideo, …) are general
creator suites, mostly paid, mostly English-first. None of those listed mention Arabic or
right-to-left, a Telegram bot, lyrics videos from songs, or a translation shown as its own
caption. KAVOX is narrower and free: translate a video, or make a lyrics video, in a minute.
