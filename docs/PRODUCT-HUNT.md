# Launching KAVOX on Product Hunt

Everything for the launch in one place: what must be true before the day, the listing (copy and
images, ready to paste), the day itself, and what the site does for Product Hunt visitors.
Checked against Product Hunt's own launch guide (help.producthunt.com → Launch guide).

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
| ☐ | One or two goals | Write them down | Product Hunt's guide asks for measurable goals, e.g. "300 visits from Product Hunt" and "100 videos started", both on /admin → Growth. |
| ☐ | Be part of Product Hunt first | producthunt.com | Weeks before: comment on other launches, answer in the Forums, help other makers. Launching from an account that never took part works poorly. |
| ☐ | Test as a stranger | A private window and a phone you never used | The featuring team checks that the product works for a first-time visitor: translate one video and make one lyrics video that way. |

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

Fill it in as a **draft** first (drafts are not reviewed). **Schedule** only when everything is
ready: a scheduled launch goes to review, and an incomplete one can be removed. You can schedule
from tomorrow up to 30 days ahead, and move the date later. Role: **"I made this"** (you are the
hunter and the maker; no famous hunter is needed).

**Name** (40 characters at most): KAVOX

**Tagline** (60 characters at most; pick one):

1. `Translate any video, or turn a song into a lyrics video` (55)
2. `Free video translation and lyrics videos, Arabic-first` (54)
3. `Subtitles, dubbing and lyrics videos. Free, no sign-up` (54)

**Description** (500 characters at most; value first, then features; 439):

> Watch any video in your language. Paste a link or upload a file: KAVOX makes subtitles, burns
> them into the video, or dubs it with a translated voice. Or turn any song into a lyrics video:
> visuals that move with the music, every word lit as it is sung, and a translation in its own
> caption, in vertical, square or wide. Free and no sign-up. Arabic-first (the whole app in Arabic
> or English), 15 languages, on the web and as a Telegram bot.

**Launch tags** (3 at most): Video · Artificial Intelligence · Languages.

**Links:** the website (your domain) and the Telegram bot (`https://t.me/Kavoxbot`).

**Pricing:** Free.

**Logo:** `docs/launch/thumbnail.png` (240 × 240, PNG; under 2 MB).

**Gallery** (1270 × 760, at least 3, in this order; every picture is a real screenshot or a real
render of the product in use):

1. `docs/launch/gallery-1-cover.jpg`: Watch any video in your language
2. `docs/launch/gallery-2-lyrics.jpg`: Turn any song into a lyrics video
3. `docs/launch/gallery-3-karaoke.jpg`: Every word lit as it is sung
4. `docs/launch/gallery-4-design.jpg`: Design it, see it, render it
5. `docs/launch/gallery-5-arabic.jpg`: Built for Arabic, right to left
6. `docs/launch/gallery-6-telegram.jpg`: Send a video to the bot, get it back translated

**Video** (optional, added as a link, e.g. YouTube or Loom): `docs/launch/demo-lyrics-shenandoah.mp4`
is a real 40-second lyrics video ("Shenandoah", US Air Force Band, public domain). Product Hunt
recommends a simple screen recording with your voice: make one lyrics video and one translation
on camera (30–60 seconds).

### First comment (written in the draft; pinned at the top when you launch; 5,000 characters at most)

Product Hunt's advice: who you are, why you built it, what it does (2–3 things), who it is for,
what makes it different, and one specific question. Like a person, not a press release. Never
"please upvote".

> Hi Product Hunt! 👋 I'm the maker of KAVOX.
>
> I built it because most of the world's videos (and songs) are in a language you don't speak, and
> the tools that fix that are either paid, made for English, or both. It's for anyone who watches
> or makes videos in more than one language: creators posting to Reels, TikTok and Shorts,
> learners, and Arabic speakers first of all.
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

- Launches go live at **12:01 a.m. Pacific time** (11:01 a.m. in Saudi Arabia) and run until
  midnight Pacific. There is no magic weekday: weekdays bring more visitors and more competition,
  weekends are quieter. Pick a day you can be online for the first hours, with no holiday in your
  main market and nothing else big on your side.
- **/admin → Features → Product Hunt**: paste the post address, then **Start launch day**. Every
  visitor sees "KAVOX is live on Product Hunt today" with a button to support it.
- Post the first comment straight away.
- Tell your own people where you already are (your Telegram channels, WhatsApp, X, LinkedIn,
  communities you take part in). Ask them to *try it and share feedback*. Product Hunt's rules:
  never ask for upvotes, no giveaways that require or reward upvotes, no paid votes or comments,
  no mass DMs or copy-paste messages to strangers, no extra accounts, and no posting in
  communities you have never been part of. Breaking them can get the launch removed. When
  unsure, ask hello@producthunt.com first.
- Answer every comment, all day, as close to real time as you can (split shifts if someone can
  help, including the night in your time zone). Reply with a link or a short video where it helps.
- Watch **/admin → Growth**: visits from Product Hunt show as "producthunt".
- The next day: **End launch day**. A small "Featured on Product Hunt" link stays in the footer.

## After launch

- Keep answering comments for days; thank the people who tried it.
- Compare the results with your goals (/admin → Growth: visits from "producthunt", videos started).
- Ask happy users for a review on the Product Page; awards (e.g. Product of the Day) arrive by
  email with a badge.
- Turn the feedback into fixes, and post updates in the Product Hunt Forums.

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
