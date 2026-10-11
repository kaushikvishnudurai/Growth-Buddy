# Low input, high output: research for Growth Buddy

The question this answers: how does an all-in-one life app ask the user for as little as possible and
still give them enough back that it feels like it will change their life? Two sweeps fed it (October
2026): what the strongest consumer apps actually do, and what the behavioural-science literature says
works. The last sections map both onto Growth Buddy as it stands and list what to build next.

How to read the evidence grades: lab effects in this field are large, field effects much smaller, and
nudge effects shrink again after publication-bias correction. Figures marked *(unverified)* are from
memory of the paper and were not confirmed against the source; *(vendor)* means the company's own
claim; *(estimate)* means a third-party estimate.

---

## 1. The short version

The ten implications best supported by evidence, ranked:

1. **Ask once, default forever.** Pre-fill everything, one tap to accept, edit later. Defaults are the
   most robust nudge class (d 0.63-0.68, Jachimowicz et al. 2019) and one of the few that partly
   survives bias correction (Maier et al. 2022). Expect field gains well below lab gains.
2. **One if-then plan per habit, reused as its trigger.** "After I ___, I will ___." Implementation
   intentions: 642 tests, d 0.27-0.66 (Sheeran, Listrom & Gollwitzer 2024/25). The one extra input
   worth asking for.
3. **Monitoring only works when it feeds a goal, feedback and a review.** Progress monitoring d 0.40,
   larger when recorded physically and when shared (Harkin et al. 2016, 138 RCTs).
4. **Forgive a missed day.** A broken streak lowers continuation even when the break was not the
   person's fault (Silverman & Barasch 2023); built-in slack raises persistence (Sharif & Shu);
   one miss does not dent habit formation (Lally et al. 2010).
5. **Reward the comeback.** The best arm of a 54-intervention, 61,293-person megastudy was a tiny bonus
   for returning after a missed workout: +27% visits (Milkman et al. 2021). Time since last occurrence
   is among the strongest predictors of the next one (Buyalskaya et al. 2023).
6. **Logging at near-zero effort.** One tap, log from the notification, same as yesterday, photo
   first, check-ins of 1-3 items. Questionnaire length, not frequency, drives burden (Eisele et al.
   2022).
7. **Honest timelines.** Habits take a median of 59-66 days, range 4-335 (Lally 2010; Singh et al.
   2024); gym-going 4-7 months (Buyalskaya 2023). Never promise 21 days.
8. **One notification budget across every module, spent at risk moments.** Prompt effects habituate
   (HeartSteps: +66% at week 1 fading to near zero by week 6, Klasnja et al. 2019); notify mainly when
   disengagement is near (Drink Less MRT, Bell et al. 2023). 37% of users disable push at 2-5 a week.
9. **Show progress already earned and make the last stretch visible.** Car-wash cards with 2 of 10
   pre-stamped: 34% completion vs 19% for 0 of 8 (Nunes & Dreze 2006).
10. **Time new starts to landmarks.** Mondays, the 1st, birthdays, the return after a gap (Dai, Milkman
    & Riis 2014). Pair money projections with a one-tap automatic default; future-self framing alone
    is weak in the field (Hershfield; Mexico RCT 2023: +16% relative on one-time contributions only).

Deliberately left out for weak or failed evidence: one-word identity labels ("you're a runner";
Gerber et al. 2016 failed to replicate), mood inferred from phone sensors (AUC 0.82 in one sample,
0.57 nationally; GLOBEM 2022 barely beat the majority class), real-money deposit contracts as a
default (13.7% uptake, Halpern et al. 2015), and heavy generic personalisation (d about 0.14).

---

## 2. What the best apps do

| App | Mechanism | Input cost | Payoff | Source |
|---|---|---|---|---|
| Daylio | Mood face + activity icons, two taps; Year in Pixels | under a minute | mood-by-activity correlations; 20M+ users | [wiki](https://en.wikipedia.org/wiki/Daylio) |
| Bearable | Tap factors; correlations need 3 days with and 3 without a factor | a few taps | first insight around day 6-7, best at 30 | [support](https://bearable.app/support/troubleshooting/my-correlations-are-wrong-dont-make-sense/) |
| Finch | Self-care pet; tiny acts; the pet never dies, no penalty for missed days | micro-tasks | D1 54%, D7 37% *(estimate)* | [Deconstructor of Fun](https://www.deconstructoroffun.com/blog/x0hd2ssr80y5n7gv0w967pg7hwd7tl) |
| Habitica | RPG; misses cost HP, death loses a level and gear | high | accountability, but punitive and the loop ends | [wiki](https://habitica.fandom.com/wiki/Death) |
| Streaks (iOS) | Tasks tied to Apple Health complete themselves | zero for linked tasks | the count does the logging | [App Store](https://apps.apple.com/us/app/streaks/id963034692) |
| Fabulous | Commitment ticks at onboarding; start with one tiny habit (water) | very low on day 1 | redesign took daily downloads 300 to 5,000 | [Google Design](https://design.google/library/fabulous-motivating-app-engagement) |
| Gentler Streak | Passive watch data; planned rest days keep the streak | zero | guilt-free guidance; Apple Design Award 2024 | [Yahoo](https://sg.news.yahoo.com/fitness-app-shows-apple-better-180000454.html) |
| Apple Activity (watchOS 11) | Pause rings without losing the streak; per-weekday goals | zero | a platform admitting rigid streaks were wrong | [MacRumors](https://macrumors.com/2024/09/16/apple-releases-watchos-11) |
| Rise Science | Sleep from phone motion; imports history so **day 1** shows sleep debt and an energy forecast | zero after permission | instant first value, plus a forecast for today | [App Store](https://apps.apple.com/us/app/rise-sleep-tracker/id1453884781) |
| Oura / Whoop | One morning number (Readiness, Recovery %); weekly and monthly recaps | zero | push or rest, answered; but 4-14 days of calibration first | [Oura](https://support.ouraring.com/hc/en-us/articles/360025587493), [Whoop](https://whoop.com/thelocker/new-feature-weekly-performance-assessment) |
| Apple Vitals / Journal | Notifies only when 2+ overnight metrics are outliers; Journal suggests from what you did | zero or one tap | alerts only when something is wrong; no blank page | [Wareable](https://www.wareable.com/apple/how-vitals-app-finally-makes-apple-watch-a-wellness-powerhouse) |
| MyFitnessPal | Barcode, Meal Scan, Voice Log | medium | convenience; paywalling the barcode scanner in 2022 drove users to Lose It | [Droid Life](https://www.droid-life.com/2022/08/24/myfitnesspal-puts-barcode-scanner-behind-premium-paywall/) |
| Cal AI / SnapCalorie | One photo per meal; LiDAR portions | one photo | Cal AI $10M+ in 2025 *(vendor)*; SnapCalorie error under 20% *(vendor)* | [Founderpath](https://founderpath.com/resources/zach-yadegari-cal-ai-onboarding-tests-and-influencer-marketing/watch), [TechCrunch](https://techcrunch.com/?p=2561037) |
| Copilot Money | Bank history imports; first budget and recurring charges built during onboarding; a "To Review" inbox; per-user model after 30 reviews | 15-20 min once, then swipes | a budget pre-filled from your own history | [help](https://help.copilot.money/en/articles/8182433-copilot-intelligence-for-spending) |
| Monarch | Detects recurring items; three-bucket flex budget; **forward cash-flow forecast** | low after linking | a forecast, not a history | [Penny Hoarder](https://www.thepennyhoarder.com/budgeting/monarch-money-review/) |
| YNAB | Manual method budgeting; 34-day trial because the method needs a cycle | high on purpose | delayed aha by design | [YNAB](https://www.ynab.com/campaign/ynab-stats) |
| Cleo | Chat-first money assistant with a written personality; "roast mode" | very low | 20% tried roast mode on day 1 | [Sifted](https://sifted.eu/articles/want-to-make-your-ai-chatbot-funny-hiring-comedians-is-a-start) |
| Rosebud | AI journal with long memory; links entries weeks apart; weekly summary | medium, guided | "it remembers me" | [Rosebud](https://www.rosebud.app/blog/rosebud-raises-6m-to-expand-the-worlds-leading-ai-journal) |
| Todoist | Natural-language Quick Add; Ramble turns speech into dated tasks | one sentence | no forms | [Ramble](https://www.todoist.com/help/articles/dictate-to-add-tasks-with-ramble-P1Raq7vVF) |
| Reclaim / Motion | State priorities once; auto-schedules and re-plans | intent once | 7.6 h/week saved *(vendor)*; Motion criticised for bloat and price | [Morgen](https://www.morgen.so/blog-posts/motion-review) |
| Duolingo | Lesson before signup (+20% DAU); streak decoupled from daily goal (+3.3% D14, +40% on 7+ day streaks); Streak Freeze (+0.38% DAU); bandit-tuned notifications (+2% new-user retention) | very low | 7-day streak users 2.4x likelier to return tomorrow | [streak](https://blog.duolingo.com/improving-the-streak/), [KDD 2020](https://research.duolingo.com/papers/yancey.kdd20.pdf) |

### Patterns across them, by frequency and evidence

1. **Passive capture first, manual as fallback** (9+ apps). The key move is Rise's: value on day 1 from
   history the phone already holds, not from data collected after install.
2. **One verdict each morning** (Oura, Whoop, Gentler Streak, Rise, watchOS sleep score).
3. **Entry in one tap, one photo, or one sentence** (Daylio, Cal AI, MFP, Todoist, Cleo).
4. **Forgiving, easy streaks.** The strongest A/B evidence in the sweep (Duolingo), explained by the
   academic work in section 3.
5. **The app guesses, the user confirms** (Copilot's review inbox, Monarch's recurring detection).
6. **A recap on a fixed rhythm.** Whoop on Mondays with 5+ days logged; Oura weekly through yearly;
   Spotify Wrapped 2025 reached 200M users in 24 hours
   ([MBW](https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase)).
7. **Value before commitment** (Duolingo's delayed signup, Rise's day-1 sleep debt).
8. **Projection or forecast** (Monarch, Rise, Motion). Weakest public data, but it is what turns a
   tracker into something that feels like it is changing your future.
9. **Correlations from your own data**, which necessarily arrive late, so the wait needs bridging.
10. **Few, contextual, tuned notifications** (Duolingo, Apple Vitals).

### Retention context

- The average app loses 77% of daily users within 3 days and 90% by day 30; the first 3-7 days decide
  it ([Andrew Chen](https://andrewchen.com/new-data-shows-why-losing-80-of-your-mobile-users-is-normal-and-that-the-best-apps-do-much-better/)).
- Health and fitness D1 is about 26-27%, about 10% by day 28
  ([Business of Apps](https://businessofapps.com/data/health-fitness-app-benchmarks)).
- Setup steps are not value; a result the user cares about is
  ([Amplitude](https://amplitude.com/blog/time-to-value-drives-user-retention)).
- Users who receive any push in their first 90 days retain about 3x better
  ([Airship](https://www.airship.com/newsroom/new-urban-airship-mobile-app-retention-study/)); 10%
  disable push at 1 a week, 37% at 2-5 a week
  ([Business of Apps](https://www.businessofapps.com/marketplace/push-notifications/research/push-notifications-statistics/)).

### Anti-patterns

- Loss-framed streaks and guilt screens; the what-the-hell effect turns one lapse into quitting.
- Punishment (Habitica's HP and death).
- Tying the streak to a large daily goal (Duolingo's pre-change design).
- A long empty wait before first value (Oura, Whoop, Bearable) with nothing to bridge it.
- Paywalling the low-friction input (MyFitnessPal's barcode scanner).
- Notification overload, and the same message repeated until it is invisible.
- A game loop that ends when the goal is reached.
- Manual categorisation and rule-writing.

---

## 3. The evidence, by topic

Each entry: the finding, how strong it is, and what it means for an app like this.

**Habit formation time.** Lally et al. 2010 (*EJSP*, [summary](https://bps.org.uk/research-digest/how-form-habit)):
automaticity plateaus after a median 66 days (18-254); one missed day did not change the curve.
Singh et al. 2024 (*Healthcare*, 20 studies, N 2,601): median 59-66 days, habit-strength gain SMD 0.69;
morning and self-chosen habits stronger. Buyalskaya et al. 2023 (*PNAS*,
[PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10151500)): handwashing about 2 weeks, gym 4-7 months.
*Moderate; "no fixed number" is robust, any exact figure is not.* Show an automaticity curve, not a
day counter; default to one small habit with a fixed cue; use days-since-last as the risk signal.

**Implementation intentions.** Gollwitzer & Sheeran 2006, d 0.65 over 94 tests; the 2024/25 update
([KOPS](https://kops.uni-konstanz.de/handle/123456789/69905)), d 0.27-0.66 over 642. *Strong, though the
pooled effect fell as the base grew and is smaller for already-habitual behaviour.* One "after I…"
question at habit creation, stored and reused as reminder text.

**Defaults.** Jachimowicz et al. 2019 ([IDEAS](https://ideas.repec.org/a/cup/bpubpo/v3y2019i02p159-186_00.html)),
58 studies, d 0.63-0.68; stronger in consumer domains, and when the default reads as a recommendation.
Maier et al. 2022 ([PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9351501/)) found no evidence for
nudging overall after bias correction, with some for structural nudges. Nudge-unit trials average
about 1.4 points vs 33.5% in papers (DellaVigna & Linos 2022) *(unverified)*. Frame defaults as "most
people start with…".

**Friction.** About 43% of daily actions are habitual (Wood, Quinn & Kashy 2002). Fogg's model
(motivation, ability, prompt) is practitioner theory with little RCT support but fits the habit data.
The auto-enrolment literature is the best-quantified friction evidence: removing one opt-in step moves
participation from about 37% to 86% (Madrian & Shea 2001) *(unverified)*. Add friction only to what the
user wants less of.

**Self-monitoring.** Harkin et al. 2016 ([White Rose](https://eprints.whiterose.ac.uk/91437/)), 138 RCTs,
d 0.40. Michie et al. 2009: self-monitoring plus one other control-theory technique (goals, feedback,
review) worked best. *Strong.* Every logged item should feed a visible goal and a review moment.

**Fresh start effect.** Dai, Milkman & Riis 2014
([PDF](https://faculty.wharton.upenn.edu/wp-content/uploads/2014/06/Dai_Fresh_Start_2014_Mgmt_Sci.pdf)):
searches, gym visits and commitment sign-ups spike after new weeks, months, years and birthdays.
*Robust observationally; framing experiments smaller.* Frame a return as a new chapter, not a failure.

**Goal gradient and endowed progress.** Kivetz, Urminsky & Zheng 2006
([PDF](https://business.columbia.edu/sites/default/files-efs/pubfiles/1200/goalgradient.pdf)); Nunes &
Dreze 2006, 34% vs 19%. *Moderate to strong;* backfires if the progress feels unearned, and effort drops
right after a reward. Credit onboarding answers and imported data as progress; raise the next target
gently.

**Streaks and breaks.** Silverman & Barasch 2023 (*JCR*, [UD](https://udspace.udel.edu/items/42ce576b-8e1f-429a-8541-e29e48dbcfbb)),
seven studies; damage is worse when people blame themselves and softened when the streak can be
repaired. Milkman et al. 2021 megastudy ([Penn](https://penntoday.upenn.edu/news/wharton-study-best-ways-boost-workout-habits)),
best arm +27% for returning after a miss; most effects did not outlast the four weeks. Sharif & Shu
([PDF](https://anderson-review.ucla.edu/wp-content/uploads/2021/03/Sharif-Shu_EmergencyReserveFailure_OBHDP2019.pdf)),
emergency reserves raise persistence. Watch for goal displacement: protecting the number, not the
behaviour.

**Loss aversion and commitment.** Patel et al. 2016 ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC4907949)):
step goal met on 45% of days with loss framing vs 35% gain, 30% control; faded when incentives
stopped. Halpern et al. 2015: 90% accept reward programmes vs 13.7% deposits. Use loss framing on
earned, non-monetary assets (a streak, a freeze pot), never as the default tone.

**Identity.** Oyserman's identity-based motivation ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3079278/)):
difficulty read as "this matters" when identity-congruent. One-word labels failed a large replication
(Gerber et al. 2016). Say "hard weeks are where habits are built"; tie actions to a future self the
user chose.

**What-the-hell effect.** Herman & Mack 1975; Polivy & Herman 1985; Marlatt's abstinence violation.
*Moderate, mostly lab.* No red zero after one bad day; express food and money targets as weekly
ranges; after an overspend, show what is still reachable this week.

**Notifications and JITAIs.** Nahum-Shani et al. 2018 (framework); HeartSteps
([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6401341)), +14% steps in the next 30 minutes on average,
habituating over six weeks; Drink Less ([JMIR](https://mhealth.jmir.org/2023/1/e38342)), a notification
made opening the app 3.5x likelier but did not change time to disengagement. *Good for short-term
engagement, weak for lasting change.* One shared budget of 1-2 proactive prompts a day; suppress when
the user is already active; back off when prompts go unanswered.

**Check-in burden.** EMA compliance about 75-82% in paid samples (Jones et al. 2019,
[PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6492133/); [JMIR 2021](https://jmir.org/2021/3/e17023));
length, not frequency, cuts compliance and quality (Eisele et al. 2022). Voluntary users comply less.
Keep each check-in to 1-3 taps.

**Passive sensing.** Mood from sensors does not generalise (Muller et al. 2021,
[PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8263566/); GLOBEM 2022,
[NSF](https://par.nsf.gov/biblio/10325547)). Coarse sleep timing is usable; over-precise sleep scores can
raise anxiety ("orthosomnia", Baron et al. 2017) *(unverified)*. Pre-fill sleep as a question ("23:40 to
07:10, right?"), never infer mood.

**Self-tracking abandonment.** Epstein et al. CHI 2016 ([PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5428074/)):
people stop because tracking is a burden, the goal was met, or the data was not useful; they lapse and
resume rather than simply quit (UbiComp 2015). Make returning frictionless with no backlog guilt; let a
module be paused; retire a tracker that stopped answering a question; unlock modules gradually.

**Personalised feedback.** Tailored print r .074 (Noar et al. 2007); web-tailored d 0.139 (Lustria et
al. 2013). *Small but reliable.* What feels life-changing is a specific, accurate insight about the
user's own data with one action attached, not generic tailoring. Fewer insights, each actionable.

**Future-self continuity.** Hershfield et al. 2011
([DOL CLEAR](https://clear.dol.gov/study/increasing-saving-behavior-through-age-progressed-renderings-future-self-hershfield-et-al-2011)):
$172 vs $80 hypothetical allocation. Mexico field RCT 2023
([Sage](https://journals.sagepub.com/doi/10.1177/23794607231190607)), N 48,853: one-time contributions
1.5% to 1.7%, no effect on recurring ones. *Large in the lab, small in the field.* A concrete projection
works best paired with a one-tap automatic default (Save More Tomorrow).

---

## 4. Where Growth Buddy stands

Already on `main` before this round:

| Research pattern | Growth Buddy |
|---|---|
| One sentence logs everything | Quick add parses tasks, habits, water, sleep, mood, expenses, food, income, notes and more, with a no-AI reader; WhatsApp text saves through it |
| One photo | food photo estimate, receipt scan into Money line items, grocery and pantry scan |
| Passive capture | phone steps from HealthKit / Health Connect; bank feed via RBI Account Aggregator; self-ticking step and focus habits |
| App guesses, user confirms | Quick add previews before writing; expense tags predicted from history; one-tap Home guesses for sleep and mood |
| Log from the notification | Done / Snooze on reminders, Done on habits, +250 ml on water |
| Forgiving streaks | freeze tokens (one a week, cap 2), rest days, weekly `targetPerWeek` cadences |
| Monitoring + review | weekly review (wins + one focus), prefilled wins; Report look-backs and personal records |
| Recap rhythm | daily digest of the last finished day; month review story card to share |
| Insights from own data | Insights on Report: plain statistics, no AI |
| Goals with a plan | goal starter packs that set up habits, reminders, goal, budget and water in one tap |

Added on branch `feat/life-plan` in this round:

| Branch | What the user gets | Pattern it serves |
|---|---|---|
| `feat/lp-onboard` | the goal picker is step 1 of first-run setup, so a new account lands on a Home that is already set up | ask once, default forever; value before commitment |
| `feat/lp-oneline` | a Quick add bar at the top of Home, shared with the + sheet | one sentence |
| `feat/lp-onething` | one card first on Home naming the single most useful action today, with one button that does it | one verdict each morning |
| `feat/lp-insight` | an Outlook card on Home: the strongest insight plus savings and streak pace | specific insight; projection |
| `feat/lp-camera` | one camera button that routes a photo to Money, Food or the pantry | one photo |
| `feat/lp-prefill` | check-ins filled in from past nights (the phone's own night once `feat/health` lands; until then that part is a no-op), and a measured habit's last number offered | same as yesterday; passive capture as a question |

---

## 5. What to build next

Ordered by evidence strength over build cost. None of these exist yet.

1. **One notification budget across modules.** Reminders, habit nudges, water, the digest, subscription
   dues and Circle all prompt independently today. A shared daily cap (1-2 proactive prompts), skipped
   on days the user has already opened the app, decaying when prompts go unanswered. User-set
   reminders stay exempt: they are the user's own if-then plan. *Evidence: HeartSteps, Drink Less,
   push-tolerance surveys.*
2. **An if-then question at habit creation.** "After I ___" as one optional field, used as the reminder
   text and, where it names a time, the reminder time. *Evidence: 642 tests, d 0.27-0.66.*
3. **Reward the comeback.** When days-since-last crosses the user's own usual gap, the next check-in
   gets a "back on it" moment (XP bonus, a kind line) instead of a reset counter; a welcome-back
   summary after a multi-day absence with no backlog. *Evidence: megastudy +27%; Epstein lapse-resume.*
4. **No failure state.** Audit every screen for red zeros and "streak lost": a broken streak shows the
   best run kept and the days in the last 30; money and food overruns show what is still reachable
   this week. *Evidence: Silverman & Barasch; what-the-hell effect.*
5. **Bridge the wait for the first insight.** Until Insights has enough days, Home shows "2 more days of
   sleep and mood for your first pattern" rather than nothing. *Evidence: Bearable's 3/3 threshold;
   Amplitude time-to-value.*
6. **Fresh-start prompts.** On Mondays, the 1st, the user's birthday and the first open after a gap,
   offer one new goal or one starter pack, framed as a new week or chapter. *Evidence: Dai, Milkman &
   Riis 2014.*
7. **Projection plus a default.** The Outlook card's savings pace gets one button that sets up a
   recurring transfer or a monthly savings goal at the projected amount. *Evidence: Save More Tomorrow;
   Hershfield field results.*
8. **Day-1 value from history.** On first sign-in in the phone app, read the past 30 days of steps
   (and sleep, if the health store has it) and the bank feed's last month, so Home's first screen
   already says something about the user. *Evidence: Rise; Copilot onboarding.*
9. **Pause a module.** A one-tap "pause Money for two weeks" that hides its cards and silences its
   prompts without deleting anything, so a lapse does not become an uninstall. *Evidence: Epstein et
   al.*
10. **Honest habit timelines.** Show habit strength as a curve towards automatic (weeks to months), not
    only a streak count. *Evidence: Lally; Singh 2024; Buyalskaya 2023.*

Not recommended: inferring mood from sensors, identity-label copy, deposit-style money stakes, and
any paywall on a low-input entry path.
