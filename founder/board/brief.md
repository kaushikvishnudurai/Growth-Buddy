# Board brief: Growth Buddy

## The idea (from founder/idea.md)

- What it is: an all-in-one "life OS" app (web PWA + Android/iOS via Capacitor) that runs habits, goals, tasks and reminders, money, health, food and water, notes, a focus timer, a family planner, a peer accountability circle and an AI mentor ("Buddy") in one place, built around asking the user for as little input as possible.
- Who it is for: young professionals, and "lazy" people who want to improve their lifestyle but will not maintain five separate trackers. Founder is in India.
- What it sells, at what price: freemium subscription. Free core; paid tier planned but not defined or priced. Nothing is charged today.
- Where and how: online. Web app on Render free tier + TiDB Cloud; Capacitor mobile wrapper. No acquisition channel decided.
- Budget and constraints: solo founder, ~zero budget (no credit card, free hosting only), nights and weekends. ~4.5 months in (first commit 2026-06-08, 731 commits, build 117). No user, retention or revenue numbers exist yet.

## What is already built (from the codebase)

Screens: Home, Habits, Goals, Calendar/reminders, Money, Health, Food, Focus timer, Notes, Report (charts + insights), Achievements, Family, Growth Circle, Buddy (AI mentor), Summary.

Low-input mechanisms already shipped:
- Quick add: one sentence logs tasks, habits, water, sleep, mood, expenses, food, income, notes; works without AI; WhatsApp messages save through it.
- One photo: food photo calorie estimate, receipt scan into Money line items, grocery/pantry scan, one camera button that routes a photo.
- Passive capture: phone steps via HealthKit / Health Connect; Indian bank feed via RBI Account Aggregator; self-ticking step and focus habits.
- App guesses, user confirms: expense categories predicted from history; one-tap Home guesses for sleep and mood.
- Act from the notification: Done/Snooze on reminders, Done on habits, +250 ml water.
- Forgiving streaks: freeze tokens, rest days, weekly cadences.
- Weekly review, daily digest, month-review story card for sharing; Insights from own data (plain statistics, no AI).
- Goal "starter packs" that set up habits, reminders, goal, budget and water in one tap; first-run setup starts with a goal picker.
- Home: "one thing" card naming the single most useful action today; Outlook card with top insight and savings/streak pace.
- Family tab with shared meal planner; Growth Circle (peer accountability / mentorship); AI mentor chat with crisis-safety card.
- Offline outbox, dark/light themes, accessibility (contrast) tests, i18n.

## Known operational constraints

- Render free instances sleep after 15 minutes; reminder scheduling depended on a keep-awake pinger and once missed a reminder.
- Render free blocks SMTP; email goes via Brevo HTTPS API.
- The local AI gateway token was rejected in October 2026; AI routes silently fall back to non-AI behaviour.
- Some phones (OnePlus) delivered reminders late because of OEM alarm windows; a fix is pending a phone test.

## Founder's own research (research/low-input-high-output.md, Oct 2026)

Benchmarked against Daylio, Bearable, Finch, Habitica, Streaks, Fabulous, Gentler Streak, Apple Activity, Rise, Oura/Whoop, MyFitnessPal, Cal AI, Copilot Money, Monarch, YNAB, Cleo, Rosebud, Todoist, Reclaim/Motion, Duolingo. Its own "build next" list: a single notification budget across modules, if-then plans at habit creation, reward the comeback, no failure states, bridge the wait for first insight, fresh-start prompts, savings projection with a one-tap default, day-1 value from imported history, pause a module, honest habit timelines. It explicitly recommends no paywall on any low-input entry path.

## Open questions nobody has answered yet

- Market size, competitor pricing, customer acquisition cost, retention: unknown.
- What goes in the paid tier and at what price: undecided.
