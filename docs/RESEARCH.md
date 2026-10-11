# Market research: competitors, user wishes, gap analysis (2026-10-11)

Scope: the app categories Growth Buddy spans (habits, tasks, calendar, money, food, focus, family,
social accountability, all-in-one "life OS"). Sources are app-store review aggregators (unstar.app,
kimola.com review reports), Trustpilot, Reddit threads (via mirrors), and reviews. Aggregator figures
are as those sites report them; treat star counts and percentages as indicative, not audited.

What Growth Buddy has was read from `CODEMAP.md` and `docs/PROJECT_MAP.md`, not from running it.

---

## 1. Competitor table

| App | Area | Strength users praise | Top complaint | Source |
|---|---|---|---|---|
| Habitica | Habits (RPG) | Gamification and party accountability keep a loyal core | Onboarding makes you build a character before tracking one habit; party mechanics punish you for inactive members; social spaces (Tavern, Guilds) removed, after which "it is no better than any other to-do list" | [unstar](https://unstar.app/blog/habitica-streaks-productive-way-of-life-habit-bull-habit-tracker-apps-ranked-2026), [lemm.ee thread](https://lemm.ee/post/58027), [r/habitica feedback](https://lr.eu.psf.lt/r/habitica/comments/1h7ww0d/my_110_days_feedback) |
| Streaks | Habits (iOS) | One-time price; Health-linked habits tick themselves ("removes the most common failure point: forgetting to log") | iOS only; hard habit cap; a broken streak feels worse than the missed habit, so users fake ticks | [makeheadway](https://makeheadway.com/blog/streaks-app-review/), [unstar](https://unstar.app/blog/streaks-habitica-way-of-life-strides-habit-tracking-apps-ranked-2026) |
| Todoist | Tasks | Fast capture, natural-language dates, cross-platform | Reminders and power NL input paywalled; free project limit cut from 80 to 5 (2023) | [unstar](https://unstar.app/blog/todoist-ticktick-things-3-microsoft-todo-apple-reminders-todo-apps-ranked-2026) |
| TickTick | Tasks + habits + pomodoro | "One app for the whole daily workflow" (tasks, calendar, habits, timer) is the reason people switch from Todoist | Calendar view, Siri and timer history paywalled; recurring rules land on wrong days; 30-90 s iOS/Android sync lag | [morgen](https://www.morgen.so/blog-posts/ticktick-vs-todoist), [unstar](https://unstar.app/blog/todoist-ticktick-things-3-microsoft-todo-apple-reminders-todo-apps-ranked-2026) |
| Notion (life OS templates) | All-in-one | Infinite flexibility | Users spend more time building the system than living it; slow mobile; unreliable offline | [macpowerusers](https://talk.macpowerusers.com/t/notion-life-operating-systems/17809), [latenode](https://community.latenode.com/t/why-i-abandoned-notion-after-5-years-my-experience-and-reflections/3802), [unstar](https://unstar.app/blog/productivity-app-reviews-what-power-users-complain-about-2026) |
| Google Calendar / Tasks | Calendar | Free, everywhere, shared calendars | Tasks: no on-time reminder, no snooze, weak recurrence, no sharing; unreliable notification delivery | [tdem.in rant](https://tdem.in/post/google-tasks-rant), [kimola GCal](https://kimola.com/reports/unlock-google-calendar-insights-a-comprehensive-user-feedback-report-google-play-en-us-145082) |
| Fantastical | Calendar | Best natural-language event entry, incl. repeating events | Subscription switch drew one-star waves; Apple only | [MacStories](https://www.macstories.net/reviews/the-new-fantastical-review/), [iMore](https://www.imore.com/fantastical-3-review-you-can-throw-all-your-other-calendar-apps-trash) |
| YNAB | Budget | "Changed my financial life"; 91% say it changed how they think about money; "give every dollar a job", forgives a blown category | $50 to $99+/yr in price rises; steep method: "I just want to see my money" | [YNAB](https://www.ynab.com/why-were-different), [pocketclear timeline](https://pocketclear.app/blog/ynab-price-increases-history.html), [unstar](https://unstar.app/blog/ynab-vs-rocket-money-vs-monarch-budgeting-apps-ranked-2026) |
| Monarch Money | Budget | Best Mint replacement, dual aggregators | Bank connections break repeatedly (stale balances, missing rows, duplicates); $99.99/yr | [checkthat.ai](https://checkthat.ai/brands/monarch/reviews), [joingerald](https://joingerald.com/learn/financial-wellness/monarch-money-bank-account-connections-guide) |
| Walnut / axio (India) | Expenses | SMS parsing from 40+ banks: tracking without typing | Walnut shut after the Paytm deal; SMS permission is a privacy worry; axio pivoted to lending (BNPL) | [retirewise](https://www.retirewise.in/?p=8461), [getfinny](https://getfinny.app/blog/sms-expense-tracking-app), [Yellow Slice](https://www.yellowslice.in/blog/axio-app-review-by-yellow-slice-how-to-make-it-better) |
| Fold (India) | Expenses via Account Aggregator | AA-based: banks, cards, EPF, NPS, FDs in one view with no SMS reading | Rated about 3.2/5 over 1.2k reviews (AppFollow, India) | [Zerodha Rainmatter](https://zerodha.com/z-connect/rainmatter/introducing-fold), [Fold docs](https://docs.fold.money/what-is-an-account-aggregator), [appfollow](https://appfollow.io/ios/fold-money/1626994334?country=in) |
| Splitwise | Shared expenses | Default for flatmates and trips | Free tier capped at 3-4 expenses a day with no notice; Pro priced per person | [kimola](https://kimola.com/reports/splitwise-app-feedback-report-uncover-user-insights-google-play-en-144452), [itvoice](https://www.itvoice.in/splitwise-has-introduced-restrictions-on-the-number-of-free-expenses-users-can-add), [tricount India](https://tricount.com/blog/top-splitwise-alternatives-in-india-2025-which-app-should-you-switch-to) |
| MyFitnessPal | Calories | Largest food database, years of history | Barcode scanner paywalled (loudest complaint in the category); ads mid-logging; crowdsourced entries wrong | [kimola](https://kimola.com/reports/myfitnesspal-removes-free-barcode-scanner-feature-140890), [unstar](https://unstar.app/blog/calorie-tracking-apps-ranked-1-star-reviews-2026) |
| Cronometer | Nutrition | Verified data, usable free tier, micronutrients | Feels like a research tool; missing foods (thin on regional cuisine) | [unstar](https://unstar.app/blog/calorie-tracking-apps-ranked-1-star-reviews-2026), [Cronometer forum](https://forums.cronometer.com/discussion/2419/how-accurate-is-cronometer) |
| HealthifyMe (India) | Calories + coach | Indian food database, coaching | Premium push, hard-to-stop EMI subscriptions, unresponsive coaches, rigid booked-call model | [kimola](https://kimola.com/reports/unlock-insights-healthifyme-user-feedback-analysis-report-app-store-in-154445), [voxya](https://voxya.com/consumer-complaints/unable-to-stop-my-emi-inspite-of-unsubscribing-the-plan/209654) |
| Cal AI (photo logging) | Calories | "Life saver": a photo replaces search and weighing | NIH-linked test: underestimates by about 345 kcal per meal on average | [HealthDay](https://www.healthday.com/health-news/nutrition/how-accurate-are-photo-based-calorie-apps-4-are-put-to-the-test), [raftlabs](https://www.raftlabs.com/blog/cal-ai-product-teardown) |
| Forest | Focus | A tree that dies if you leave the app is a strong, simple hook | Free timer limits, no built-in pomodoro cycle, login/sync failures after updates | [kimola](https://kimola.com/reports/exclusive-forest-app-user-feedback-analysis-report-google-play-en-us-151945), [makeheadway](https://makeheadway.com/blog/forest-app-review/) |
| Finch | Self-care | No punishment for a missed day; a pet that grows; users with anxiety/depression call it life-changing | Not clinical; light on real planning | [habitbox](https://habitbox.app/blog/finch-app-review), [MakeTechEasier](https://maketecheasier.com/finch-habit-tracking-app/), [r/finch App Pause](https://lr.in.psf.lt/r/finch/comments/1k1ik78/app_pause/mnmgaqd/?context=3) |
| Fabulous | Routines | Guided routines | Web-checkout subscriptions outside the stores, charges after cancel, bot-only support | [kimola](https://kimola.com/reports/unlock-insights-fabulous-app-user-feedback-report-google-play-154052), [Apple discussions](https://discussions.apple.com/thread/256002729) |
| Sunsama | Daily planning | Guided morning plan and evening shutdown ritual | $16-25/mo, no free tier; ritual "grew into a twenty-minute chore" | [upbase](https://upbase.io/blog/sunsama-review/), [dupple](https://dupple.com/reviews/sunsama) |
| Motion | AI scheduling | Auto-scheduling works when the calendar is chaos | $29-49/mo; 2-4 week setup; mobile about 2.7/5 | [ClickUp review](https://clickup.com/blog/motion-review/), [usecarly](https://www.usecarly.com/blog/motion-ai-review/) |
| Mealime / Paprika | Meal planning | Mealime: plan to grocery list; Paprika: recipe capture and sync | Paprika's planner does not feed the shopping list | [Plan to Eat on Paprika](https://plantoeat.com/?p=38013), [expertbeacon Mealime](https://expertbeacon.com/mealime-review/) |
| Cozi | Family | Shared calendar and shopping lists that work | 2024: free calendar cut to a 30-day window, plus audio ads ("akin to blackmail") | [Trustpilot](https://nz.trustpilot.com/review/cozi.com), [heynori](https://heynori.com/blog/best-shared-family-calendar-apps/cozi-vs-google-calendar-for-families) |
| LifeBoard, Day Ledger, Brighter Daily | All-in-one | Built by people "juggling five apps that didn't talk to each other" | Young; few reviews | [LifeBoard](https://hunted.space/product/lifeboard), [Day Ledger](https://www.producthunt.com/products/day-ledger), [Brighter Daily](https://apps.apple.com/app/id6772374305) |

---

## 2. Top 15 recurring user wishes

Ordered by how often they come up across categories.

1. **Logging that takes no typing.** Streaks' Health auto-ticks, Walnut's SMS parsing and Cal AI's photo logging are each the reason those apps get praised. Forgetting to log is the main way people fail. [makeheadway](https://makeheadway.com/blog/streaks-app-review/), [getfinny](https://getfinny.app/blog/sms-expense-tracking-app), [raftlabs](https://www.raftlabs.com/blog/cal-ai-product-teardown)
2. **Core features stay free, and the price is clear from day one.** The biggest complaint in nearly every category is a feature that used to be free getting paywalled: MFP's barcode scanner, Todoist reminders, TickTick's calendar, Splitwise's daily cap, Cozi's 30-day window. [unstar calorie](https://unstar.app/blog/calorie-tracking-apps-ranked-1-star-reviews-2026), [unstar todo](https://unstar.app/blog/todoist-ticktick-things-3-microsoft-todo-apple-reminders-todo-apps-ranked-2026), [itvoice](https://www.itvoice.in/splitwise-has-introduced-restrictions-on-the-number-of-free-expenses-users-can-add), [Trustpilot Cozi](https://nz.trustpilot.com/review/cozi.com)
3. **One app instead of five that don't talk to each other.** This is why people move from Todoist to TickTick and why several indie "life OS" apps exist. [morgen](https://www.morgen.so/blog-posts/ticktick-vs-todoist), [LifeBoard](https://hunted.space/product/lifeboard)
4. **...without having to build the system yourself.** Notion life OS templates fail because "they're built for someone who already has their life organized". [macpowerusers](https://talk.macpowerusers.com/t/notion-life-operating-systems/17809), [latenode](https://community.latenode.com/t/why-i-abandoned-notion-after-5-years-my-experience-and-reflections/3802)
5. **Streaks that don't shame you.** Users want total active days, a pause or vacation mode, and words like "paused" instead of "broken". Users fake ticks to keep a streak alive. [dev.to](https://dev.to/nucleusos/why-streaks-make-adhd-worse-and-what-actually-helps-5147), [habitbox Finch](https://habitbox.app/blog/finch-app-review), [unstar Streaks](https://unstar.app/blog/streaks-habitica-way-of-life-strides-habit-tracking-apps-ranked-2026)
6. **Reminders that actually arrive.** Users report silent notifications, reminders killed by battery optimisation, and Google Tasks having no on-time reminder. [tdem.in](https://tdem.in/post/google-tasks-rant), [unstar habits](https://unstar.app/blog/habitica-streaks-productive-way-of-life-habit-bull-habit-tracker-apps-ranked-2026)
7. **Reliable sync and no data loss across devices and phone upgrades.** Complaints include Habit Bull losing data on Android upgrades, Habitica outages and TickTick sync lag. [unstar habits](https://unstar.app/blog/habitica-streaks-productive-way-of-life-habit-bull-habit-tracker-apps-ranked-2026), [unstar todo](https://unstar.app/blog/todoist-ticktick-things-3-microsoft-todo-apple-reminders-todo-apps-ranked-2026)
8. **Bank sync that stays connected, and privacy without SMS permission.** Monarch's broken connections are its top complaint. In India the newer privacy-first apps advertise that they need "no SMS permission". [checkthat.ai](https://checkthat.ai/brands/monarch/reviews), [pocketclear India](https://pocketclear.app/blog/best-expense-tracker-india.html)
9. **Budgeting without a philosophy course.** YNAB users say "I just want to see my money", yet its forgiving "roll with the punches" rule is exactly why it changes lives. [unstar budget](https://unstar.app/blog/ynab-vs-rocket-money-vs-monarch-budgeting-apps-ranked-2026), [YNAB](https://www.ynab.com/why-were-different)
10. **Accurate regional food data.** Users want Indian home food logged correctly. Cronometer is missing foods, MFP's crowdsourced entries rot, and AI photo estimates come in low. [Cronometer forum](https://forums.cronometer.com/discussion/2419/how-accurate-is-cronometer), [HealthDay](https://www.healthday.com/health-news/nutrition/how-accurate-are-photo-based-calorie-apps-4-are-put-to-the-test)
11. **Real accountability from a real person.** Users want check-in windows and quiet sharing with a friend; committing to a specific appointment is cited as raising follow-through to 95%. [accountability apps](https://tvcvps4-do-ny.tvc.mx/talk/can-accountability-partner-apps-help-me-build-better-habits-iq2j.html), [r/GetMotivatedBuddies](https://reddit.sudovanilla.org/r/getmotivatedbuddies)
12. **A daily plan and review ritual that takes two minutes, not twenty.** Sunsama's ritual is loved until it grows into a chore. [upbase](https://upbase.io/blog/sunsama-review/)
13. **A meal plan that fills the grocery list by itself, shared with the household.** [Plan to Eat on Paprika](https://plantoeat.com/?p=38013), [heynori](https://heynori.com/blog/best-shared-family-calendar-apps/cozi-vs-google-calendar-for-families)
14. **Bill splitting with UPI settle-up, no daily caps, and friends who don't need the app.** [tricount India](https://tricount.com/blog/top-splitwise-alternatives-in-india-2025-which-app-should-you-switch-to), [kimola Splitwise](https://kimola.com/reports/splitwise-app-feedback-report-uncover-user-insights-google-play-en-144452)
15. **Honest cancellation and human support.** Fabulous and HealthifyMe both draw complaints about charges after cancelling and bot-only support. [kimola Fabulous](https://kimola.com/reports/unlock-insights-fabulous-app-user-feedback-report-google-play-154052), [voxya HealthifyMe](https://voxya.com/consumer-complaints/unable-to-stop-my-emi-inspite-of-unsubscribing-the-plan/209654)

### What makes users say an app "changed my life"

Three patterns come up again and again:

- **The app reframes failure.** YNAB expects you to blow a category. Finch's bird simply stays home on a missed day. Neither treats the user as having failed. [YNAB](https://www.ynab.com/why-were-different), [habitbox](https://habitbox.app/blog/finch-app-review)
- **The app shows a visible result the user cares about.** One YNAB user reports net worth up 120%. Cal AI users report losing weight with almost no logging effort. [Fortune](https://fortune.com/article/ynab-budgeting-transform-money-relationship), [kimola Cal AI](https://kimola.com/reports/unveil-user-insights-on-cal-ai-calorie-tracker-app-store-us-155190)
- **The app has an emotional anchor**, such as a pet, a tree, or a person to answer to. Simple visual feedback beats more features. [MakeTechEasier](https://maketecheasier.com/finch-habit-tracking-app/), [makeheadway Forest](https://makeheadway.com/blog/forest-app-review/)

---

## 3. Gap analysis against Growth Buddy

### Where Growth Buddy already beats the field

- **Breadth without setup.** Growth Buddy covers what users today stitch together from TickTick, YNAB, MFP, Forest and Cozi: tasks, habits, calendar, money, food/water/health, focus, notes, goals, family and circles. Starter packs (`starter-packs.js`) build the system for the user, which avoids the Notion life-OS trap (wishes 3, 4).
- **Forgiving streaks.** Freeze tokens, quit-habit "clean days" and the 7-day edit window (`habit-stats.js`) already address the streak-shame complaint better than Streaks or Habitica (wish 5).
- **Reminders on more than one channel.** Reminders go out by WhatsApp, Web Push and on-device alarms, keep their local time when the user changes timezone, and are tested for DST (`DstWindowTest`). This directly answers wish 6 and suits India, where WhatsApp has about 850M users ([acefone](https://www.acefone.com/blog/wp-json/wp/v2/posts/27603)).
- **Logging with little or no typing.** Growth Buddy has Health Connect / HealthKit reads with habits that tick themselves (as Streaks does), receipt photos turned into line items, AI food photo estimates, voice quick add with a preview, and one-tap nudges (`nudges.js`) (wish 1).
- **Bank feed through Account Aggregator** (`BankFeedService`, Setu), the same approach as Fold and with no SMS permission (wish 8). It cannot be counted as an advantage yet; see below.
- **Offline-first.** A Workbox precache plus an outbox with idempotency keys covers what Notion's offline complaints ask for (wish 7).
- **Insights that need no AI** (`insights.js`, `review.js`, `day-plan.js`). Plan my day is free and built without AI, where Sunsama and Motion charge $16-49 a month (wish 12).
- **Family meal plan with a shopping list** in the same app as the calendar (wish 13). Paprika's planner does not do this.
- **Real people to answer to.** Circles and mentorship with agreement checklists give the accountability users ask for, without Habitica's penalty for inactive party members (wish 11).
- **The user can take their data out:** a full JSON export (`/api/auth/export`), a reminders .ics export and a Money CSV export.
- **No paywall.** I found no pricing code. If it stays that way, wish 2 is the clearest marketing angle against every incumbent.

### Where Growth Buddy is behind

- **Bank feed.** It is inert until Setu credentials are set and has not been confirmed against a live sandbox (PROJECT_MAP). Fold and Monarch already ship this.
- **No bill splitting or settle-up.** I found no split or owe logic in Money or Family. Splitwise's daily cap is pushing users to look for an alternative right now.
- **No two-way calendar sync.** Calendar data can be exported as .ics but nothing comes in, so a Google Calendar user keeps two calendars.
- **i18n is 30%.** Two screens are converted and there is no language picker. The Indian market wants Hindi and Tamil first.
- **Food data for Indian home cooking** depends on AI estimates, and the AI gateway currently falls back (the gateway returns 401). HealthifyMe's main advantage is its Indian food database.
- **No home-screen widget or watch app.** I found no widget in `native.js` or `MOBILE.md`. Streaks and TickTick users say widgets are what makes a tick take two seconds.
- **iOS cannot be built on this machine** (mobile parity is 70%).
- **The emotional anchor is thin.** XP, levels and badges exist, but there is no single living thing like Finch's bird or Forest's tree.

### 10 opportunities, ranked by impact

"Input needed" means the effort asked of the end user, not the engineering cost.

| # | Opportunity | Why (wish) | Input needed from the user |
|---|---|---|---|
| 1 | **Make the Account Aggregator bank feed live** (Setu production, then auto-categorise, with uncategorised rows sent to a one-tap inbox) | Expense tracking with zero typing is what made Walnut India's default, and it is what Fold and Monarch charge for (1, 8) | One consent flow, once; after that, a tap to confirm a category |
| 2 | **"Free forever" promise for core logging, stated in onboarding**, never paywalling anything already shipped | Paywall regret is the top complaint in every category (2, 15) | None |
| 3 | **Split a bill from any expense**, with UPI settle-up via `upi://pay` deep links and a share link so friends don't need the app | Splitwise's cap has created demand right now; this fits Money and Family (14) | Pick people on the expense, then one tap to settle |
| 4 | **WhatsApp as an input, not only output**: reply "spent 240 chai", "done gym" or "remind me 9am" to the reminder message. Reuse `parseQuickAdd` on the server | Logging happens where the user already is, and no other app here works over WhatsApp (1, 6) | One reply message |
| 5 | **Two-way Google Calendar sync** (read events into Calendar and Plan my day) | Removes the need to keep two calendars; Plan my day schedules around real meetings (3, 12) | One OAuth consent |
| 6 | **Home-screen widgets** (today's habits, add expense, water +250 ml) in the Capacitor app | The two-second tick (Streaks, TickTick) is what keeps people logging (1) | None after placing the widget |
| 7 | **Indian home-food quick picks**: a curated list of common dishes (roti, dal, idli, rice, sabzi) with katori and piece portions, plus "same as yesterday" | Fixes HealthifyMe's advantage and AI photo estimates that come in low (10) | One or two taps per meal |
| 8 | **"Rough week" mode**: pause habits, budgets and reminders for N days and come back without breaking a streak, with copy that says paused, not broken | The Finch and ADHD research shows streak shame drives quitting; this builds on freeze tokens (5) | One toggle |
| 9 | **Two-minute evening close-out** (built from what exists: `weeklyWinsDraft`, unfinished tasks moved to tomorrow, one mood tap) and a single "life score" trend users can share | Sunsama's ritual without the chore; gives users a visible result to point at (9, 12) | Three taps a day |
| 10 | **Hindi and Tamil UI** via the existing `i18n.js` catalog and a language picker in Settings | Widens the Indian market; HealthifyMe and Fold are English-first (reach) | Pick a language once |

Not ranked here: a Finch-style companion. It has a high ceiling but needs real design investment, and it should be revisited once 1-6 have landed.
