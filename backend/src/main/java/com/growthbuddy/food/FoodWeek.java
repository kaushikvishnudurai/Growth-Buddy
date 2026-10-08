package com.growthbuddy.food;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.mentor.OpenAIClient.ChatTurn;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import com.growthbuddy.water.WaterService;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * The Summary screen: the last 7 days of calories, protein, carbs, fat and fiber
 * against their targets (computed on every read), and an on-demand diet check
 * that asks the AI how to close the gaps.
 *
 * <p>The grams are estimates. The first read of a week asks the AI for every
 * entry it hasn't seen, in one batch, and stores them; until then, and when
 * the AI is down, a keyword table stands in.
 */
@Service
public class FoodWeek {

    private static final Logger log = LoggerFactory.getLogger(FoodWeek.class);

    static final int DAYS = 7;
    private static final int DEFAULT_GOAL_KCAL = 2000;
    /** Index order of every int[4] here, and of the JSON keys. */
    static final List<String> KEYS = List.of("protein", "carbs", "fat", "fiber");

    private static final String PROMPT = """
            You are Buddy, the nutrition coach inside the Growth Buddy app, and you know
            Indian food well. You get the meals a user logged (over the last few days,
            or on one day — the Scope line says which), their estimated daily protein,
            carbs, fat and fiber against targets, their water against its goal when
            given, and their profile. Say how to close the gaps. Be practical, kind and specific.
            Return strict JSON only:
            {"summary":"two short sentences, second person, no numbers",
             "add":["up to 4 short, specific Indian foods to add or swap, respecting diet and allergies"]}
            No Markdown, no emoji.
            """;

    private final FoodEntryRepository entries;
    private final UserRepository users;
    private final UserClock clock;
    private final OpenAIClient openai;
    private final WaterService water;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json = new ObjectMapper();

    // ponytail: in memory, per instance, lost on restart. Fine for one Render
    // instance; move to a table if it ever runs more than one. One entry per user.
    /** After a failed estimate, the week reads the keyword table until this instant. */
    private final Map<UUID, Instant> retryAfter = new ConcurrentHashMap<>();
    static final Duration RETRY_AFTER = Duration.ofMinutes(10);

    public FoodWeek(FoodEntryRepository entries, UserRepository users, UserClock clock, OpenAIClient openai,
                    WaterService water, JdbcTemplate jdbc) {
        this.entries = entries;
        this.users = users;
        this.clock = clock;
        this.openai = openai;
        this.water = water;
        this.jdbc = jdbc;
    }

    // Not @Transactional: estimate is an AI call, and a transaction would hold a
    // pooled connection through it.
    public FoodWeekResponse week(UUID userId) {
        Map<LocalDate, List<FoodEntry>> byDay = byDay(userId, clock.today(userId));
        List<FoodEntry> all = byDay.values().stream().flatMap(List::stream).toList();
        List<FoodEntry> missing = all.stream().filter(FoodWeek::missing).toList();
        // A failed batch isn't retried on every open: the gateway being down or
        // out of budget would otherwise cost a call per Summary view.
        if (!missing.isEmpty() && !Instant.now().isBefore(retryAfter.getOrDefault(userId, Instant.MIN))) {
            if (estimate(missing)) {
                retryAfter.remove(userId);
            } else {
                retryAfter.put(userId, Instant.now().plus(RETRY_AFTER));
            }
        }
        List<FoodWeekDay> days = days(byDay);
        User u = users.findById(userId).orElse(null);
        int goal = goalKcal(u);
        Map<String, List<NutrientSource>> by = new LinkedHashMap<>();
        for (int k = 0; k < KEYS.size(); k++) {
            by.put(KEYS.get(k), sources(all, k));
        }
        Nutrients targets = targets(u, goal);
        Nutrients avg = average(days);
        DietCheckResponse r = rules(avg, targets);
        return new FoodWeekResponse(goal, targets.proteinG(), days,
                by.get("protein").stream().map(x -> new ProteinSource(x.name(), x.count(), x.g())).toList(),
                targets, avg, averageKcal(days),
                Map.of("protein", r.protein(), "carbs", r.carbs(), "fat", r.fat(), "fiber", r.fiber(),
                        "calories", level(averageKcal(days), goal)), by);
    }

    private static int goalKcal(User u) {
        Integer g = u == null ? null : u.getDailyFoodGoalKcal();
        return g != null ? g : DEFAULT_GOAL_KCAL;
    }

    private static List<FoodWeekDay> days(Map<LocalDate, List<FoodEntry>> byDay) {
        List<FoodWeekDay> days = new ArrayList<>();
        byDay.forEach((d, list) -> {
            int[] t = new int[4];
            for (FoodEntry e : list) {
                int[] g = grams(e);
                for (int k = 0; k < 4; k++) {
                    t[k] += g[k];
                }
            }
            days.add(new FoodWeekDay(d.toString(), list.stream().mapToInt(FoodEntry::getKcalEstimated).sum(),
                    list.size(), t[0], t[1], t[2], t[3]));
        });
        return days;
    }

    /**
     * The days an average is taken over: the finished days with meals, because
     * today is still being eaten. Only today logged? Then today.
     */
    static List<FoodWeekDay> averaged(List<FoodWeekDay> days) {
        List<FoodWeekDay> logged = days.stream().filter(d -> d.count() > 0).toList();
        List<FoodWeekDay> past = days.subList(0, Math.max(0, days.size() - 1)).stream()
                .filter(d -> d.count() > 0).toList();
        return past.isEmpty() ? logged : past;
    }

    static Nutrients average(List<FoodWeekDay> days) {
        List<FoodWeekDay> a = averaged(days);
        return new Nutrients(avg(a, FoodWeekDay::proteinG), avg(a, FoodWeekDay::carbsG),
                avg(a, FoodWeekDay::fatG), avg(a, FoodWeekDay::fiberG));
    }

    static int averageKcal(List<FoodWeekDay> days) {
        return avg(averaged(days), FoodWeekDay::kcal);
    }

    private static int avg(List<FoodWeekDay> days, java.util.function.ToIntFunction<FoodWeekDay> f) {
        return (int) Math.round(days.stream().mapToInt(f).average().orElse(0));
    }

    /** Top 5 dishes by one nutrient over the week, same dish name counted together. */
    static List<NutrientSource> sources(List<FoodEntry> all, int k) {
        Map<String, int[]> sum = new LinkedHashMap<>();
        Map<String, String> label = new LinkedHashMap<>();
        for (FoodEntry e : all) {
            String key = e.getFoodName().strip().toLowerCase(Locale.ROOT);
            label.putIfAbsent(key, e.getFoodName().strip());
            int[] v = sum.computeIfAbsent(key, x -> new int[2]);
            v[0]++;
            v[1] += grams(e)[k];
        }
        return sum.entrySet().stream()
                .filter(en -> en.getValue()[1] > 0)
                .sorted((a, b) -> b.getValue()[1] - a.getValue()[1])
                .limit(5)
                .map(en -> new NutrientSource(label.get(en.getKey()), en.getValue()[0], en.getValue()[1]))
                .toList();
    }

    // ponytail: 1.6 g/kg when the goal says gain/bulk/muscle, else 1.2 g/kg, else
    // 60 g with no weight on file. A dietitian's number would weigh age and
    // activity; take a user-set target if anyone asks for one.
    static int proteinTarget(User u) {
        if (u == null || u.getWeightKg() == null) {
            return 60;
        }
        String g = u.getFitnessGoal() == null ? "" : u.getFitnessGoal().toLowerCase(Locale.ROOT);
        double perKg = g.contains("gain") || g.contains("bulk") || g.contains("muscle") ? 1.6 : 1.2;
        return (int) Math.round(u.getWeightKg() * perKg);
    }

    // ponytail: carbs 50% and fat 30% of the calorie goal, fiber a flat 30 g.
    // The common dietary-guideline split; per-user shares if anyone asks.
    static Nutrients targets(User u, int goalKcal) {
        return new Nutrients(proteinTarget(u), (int) Math.round(goalKcal * 0.5 / 4),
                (int) Math.round(goalKcal * 0.3 / 9), 30);
    }

    private static boolean missing(FoodEntry e) {
        return e.getProteinG() == null || e.getCarbsG() == null || e.getFatG() == null || e.getFiberG() == null;
    }

    /**
     * Stored grams where the AI has estimated them, else the keyword table's guess,
     * scaled so protein, carbs and fat add up to the entry's calories. The grams
     * are a second, separate estimate; unscaled, a week of 4,678 kcal showed
     * macros worth 2,500, and the plate read "on target" beside a calorie ring
     * nearly double its goal. The kcal is what the user logged and sees
     * everywhere else, so it wins; the grams keep only their proportions.
     */
    static int[] grams(FoodEntry e) {
        int[] g = missing(e) ? guess(e.getFoodName(), e.getQuantityGrams()) : new int[4];
        Integer[] stored = {e.getProteinG(), e.getCarbsG(), e.getFatG(), e.getFiberG()};
        for (int k = 0; k < 4; k++) {
            if (stored[k] != null) {
                g[k] = stored[k];
            }
        }
        int macroKcal = 4 * g[0] + 4 * g[1] + 9 * g[2];
        if (e.getKcalEstimated() > 0 && macroKcal > 0) {
            double f = (double) e.getKcalEstimated() / macroKcal;
            for (int k = 0; k < 4; k++) {
                g[k] = (int) Math.round(g[k] * f);
            }
        }
        return g;
    }

    // ponytail: protein, carbs, fat, fiber per 100 g as eaten; the first keyword
    // in this order wins ("chicken fried rice" is chicken, any biryani is
    // mostly rice). Only stands in while the AI hasn't estimated an entry, and is never
    // stored, so the AI still can.
    private static final Map<String, double[]> PER_100G = new LinkedHashMap<>();
    private static final double[] UNKNOWN = {4, 15, 4, 1.5};
    static {
        Object[][] t = {
            {"biryani", 8, 25, 7, 1}, {"chicken", 18, 3, 10, 0.5}, {"mutton", 20, 2, 14, 0.3}, {"fish", 18, 3, 8, 0.3},
            {"prawn", 18, 3, 6, 0.3}, {"keema", 18, 4, 14, 1}, {"egg", 13, 1, 10, 0},
            {"omelette", 11, 2, 12, 0.3}, {"paneer", 18, 4, 20, 0}, {"tofu", 8, 2, 5, 1},
            {"soya", 13, 10, 2, 4}, {"peanut", 25, 16, 49, 8.5}, {"rajma", 7, 18, 3, 6},
            {"chana", 7, 20, 3, 6}, {"chole", 7, 18, 5, 6}, {"sprout", 7, 15, 1, 4},
            {"moong", 7, 15, 2, 5}, {"dal", 6, 15, 3, 4}, {"sambar", 3, 10, 2, 3},
            {"curd", 3.5, 4.5, 4, 0}, {"milk", 3.3, 5, 3.5, 0}, {"oats", 2.5, 12, 1.5, 1.7},
            {"bread", 9, 49, 3, 3}, {"roti", 9, 46, 4, 5}, {"chapati", 9, 46, 4, 5},
            {"paratha", 7, 40, 13, 4}, {"poori", 7, 45, 20, 3}, {"dosa", 4, 30, 5, 1.5},
            {"idli", 4, 25, 0.5, 1.5}, {"upma", 4, 22, 6, 2}, {"poha", 3, 25, 4, 1.5},
            {"ragi", 3, 20, 1, 3}, {"millet", 3, 23, 1, 1.3}, {"rice", 2.7, 28, 0.3, 0.4},
            {"salad", 1.5, 5, 3, 2}, {"poriyal", 2, 9, 5, 3}, {"sabzi", 2, 9, 5, 3},
            {"vegetable", 2, 9, 5, 3}, {"veg", 2, 9, 5, 3}, {"banana", 1.1, 23, 0.3, 2.6},
            {"apple", 0.3, 14, 0.2, 2.4}, {"guava", 2.6, 14, 1, 5.4}, {"fruit", 0.8, 13, 0.3, 2.2},
        };
        for (Object[] r : t) {
            double[] v = new double[4];
            for (int k = 0; k < 4; k++) {
                v[k] = ((Number) r[k + 1]).doubleValue();
            }
            PER_100G.put((String) r[0], v);
        }
    }

    static int[] guess(String name, int grams) {
        double[] per100 = UNKNOWN;
        for (Map.Entry<String, double[]> en : PER_100G.entrySet()) {
            if (mentions(name, List.of(en.getKey()))) {
                per100 = en.getValue();
                break;
            }
        }
        int[] g = new int[4];
        for (int k = 0; k < 4; k++) {
            g[k] = (int) Math.round(per100[k] * grams / 100.0);
        }
        return g;
    }

    private static final String ESTIMATE_PROMPT = """
            You estimate nutrients for Indian food. Each numbered line is a dish, its
            weight in grams as eaten and its calories; 4 x protein + 4 x carbs + 9 x fat
            should come close to those calories. Return strict JSON only:
            {"items":[{"i":1,"proteinG":12,"carbsG":40,"fatG":8,"fiberG":3}, ...]} with one
            entry per line, every value an integer number of grams. Use typical Indian
            home and hotel recipes.
            """;

    /**
     * One AI call for every entry the week hasn't estimated yet; failures leave
     * them null. False when nothing came back, so the caller backs off.
     */
    private boolean estimate(List<FoodEntry> missing) {
        if (!openai.isConfigured()) {
            return false;
        }
        int filled = 0;
        List<FoodEntry> batch = missing.subList(0, Math.min(40, missing.size()));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < batch.size(); i++) {
            sb.append(i + 1).append(". ").append(cap(batch.get(i).getFoodName(), 120))
                    .append(", ").append(batch.get(i).getQuantityGrams()).append(" g, ")
                    .append(batch.get(i).getKcalEstimated()).append(" kcal\n");
        }
        try {
            JsonNode n = json.readTree(OpenAIClient.jsonOf(
                    openai.complete(ESTIMATE_PROMPT, List.of(new ChatTurn("user", sb.toString())))));
            for (JsonNode it : n.path("items")) {
                int i = it.path("i").asInt(0) - 1;
                int[] g = new int[4];
                boolean ok = i >= 0 && i < batch.size();
                for (int k = 0; ok && k < 4; k++) {
                    JsonNode v = it.path(KEYS.get(k) + "G");
                    ok = v.isNumber();
                    g[k] = Math.max(0, Math.min(900, v.asInt()));
                }
                if (!ok) {
                    continue;
                }
                FoodEntry e = batch.get(i);
                // Mirrors the UPDATE's coalesce: a value already stored wins.
                if (e.getProteinG() == null) e.setProteinG(g[0]);
                if (e.getCarbsG() == null) e.setCarbsG(g[1]);
                if (e.getFatG() == null) e.setFatG(g[2]);
                if (e.getFiberG() == null) e.setFiberG(g[3]);
                entries.setNutrientsIfMissing(e.getId(), g[0], g[1], g[2], g[3]);
                filled++;
            }
        } catch (Exception ex) {
            log.warn("Nutrient estimate failed, using the keyword table: {}", ex.toString());
        }
        return filled > 0;
    }

    // Not @Transactional: that would hold a pooled connection through a
    // multi-second AI call. Each repository read takes its own.
    // day == null: the week. A day: that one day of the last 7, judged on its own.
    public DietCheckResponse check(UUID userId, LocalDate day) {
        LocalDate today = clock.today(userId);
        if (day != null && (day.isAfter(today) || day.isBefore(today.minusDays(DAYS - 1)))) {
            throw ApiException.badRequest("Day checks cover the last 7 days.");
        }
        Map<LocalDate, List<FoodEntry>> byDay = day == null ? byDay(userId, today) : oneDay(userId, day);
        if (byDay.values().stream().allMatch(List::isEmpty)) {
            return new DietCheckResponse(null, null, null, null, null, day == null
                    ? "Log a few meals this week and Buddy can tell you what your plate is missing."
                    : "Nothing logged on this day yet. Add a meal and Buddy can read it.", List.of(), "rules");
        }
        // ponytail: today is judged against full-day targets while it is still being
        // eaten, so a morning check reads light; the wording says "so far" rather than
        // pro-rating targets by the hour.
        String label = day == null ? "Your week" : day.equals(today) ? "Today so far" : "That day";
        User u = users.findById(userId).orElse(null);
        Nutrients target = targets(u, goalKcal(u));
        Nutrients avg = average(days(byDay));
        Integer waterMl = waterFor(userId, today, day);
        int waterGoal = waterMl == null ? 0 : water.goalMl(userId);
        // Judged from the same numbers the screen's thali shows, never by the AI,
        // so the verdict can't contradict the chart above it.
        DietCheckResponse rules = rules(avg, target, label, waterMl, waterGoal);
        if (!openai.isConfigured()) {
            return rules;
        }
        StringBuilder sb = new StringBuilder("Scope: ").append(day == null ? "the last few days"
                : day.equals(today) ? "one day, today, still in progress: meals so far" : "one finished day")
                .append("\nMeals by day:\n");
        byDay.forEach((d, list) -> {
            if (!list.isEmpty()) {
                sb.append(d.getDayOfWeek().toString().substring(0, 3)).append(": ")
                        .append(String.join(", ", list.stream().map(FoodEntry::getFoodName).toList())).append('\n');
            }
        });
        sb.append("\nEstimated grams a day (target): protein ").append(avg.proteinG()).append(" (").append(target.proteinG())
                .append("), carbs ").append(avg.carbsG()).append(" (").append(target.carbsG())
                .append("), fat ").append(avg.fatG()).append(" (").append(target.fatG())
                .append("), fiber ").append(avg.fiberG()).append(" (").append(target.fiberG()).append(").");
        if (waterMl != null) {
            sb.append("\nWater ml a day (goal): ").append(waterMl).append(" (").append(waterGoal).append(").");
        }
        sb.append("\nVerdict: ").append(verdict(rules)).append('.');
        if (u != null) {
            sb.append("\nProfile: fitnessGoal=").append(safe(u.getFitnessGoal()))
                    .append(", diet=").append(safe(u.getDietPreference()))
                    .append(", allergic=").append(safe(u.getAllergicTo()));
        }
        // Same meals, water, numbers and profile: same prompt, so the stored answer
        // still holds and "Check again" costs no AI call. Anything changed: a miss.
        String prompt = sb.toString();
        String scope = day == null ? "week" : day.toString();
        DietCheckResponse stored = storedCheck(userId, scope, prompt);
        if (stored != null) {
            return stored;
        }
        try {
            JsonNode n = json.readTree(OpenAIClient.jsonOf(
                    openai.complete(PROMPT, List.of(new ChatTurn("user", prompt)))));
            List<String> add = new ArrayList<>();
            n.path("add").forEach(x -> {
                if (add.size() < 4 && !x.asText().isBlank()) {
                    add.add(cap(x.asText().strip(), 60));
                }
            });
            String summary = n.path("summary").asText("").strip();
            DietCheckResponse out = new DietCheckResponse(rules.protein(), rules.carbs(), rules.fat(), rules.fiber(),
                    rules.water(),
                    summary.isEmpty() ? rules.summary() : cap(summary, 400),
                    add.isEmpty() ? rules.add() : add,
                    "ai");
            store(userId, scope, prompt, out);
            return out;
        } catch (Exception ex) {
            log.warn("Diet check fell back to the rules: {}", ex.toString());
            return rules;
        }
    }

    /** Upserted: two taps racing on a cold day both ask, and the second must not 500. */
    private void store(UUID userId, String scope, String prompt, DietCheckResponse out) {
        try {
            jdbc.update("""
                    INSERT INTO food_diet_checks (user_id, scope, prompt, answer, created_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON DUPLICATE KEY UPDATE prompt = VALUES(prompt), answer = VALUES(answer),
                      created_at = VALUES(created_at)
                    """, userId.toString(), scope, prompt, json.writeValueAsString(out));
        } catch (Exception ex) {
            // The answer is still good; only the next repeat costs a call.
            log.warn("Diet check not stored: {}", ex.toString());
        }
    }

    /** The stored answer for this scope, only if it answered this exact prompt. */
    private DietCheckResponse storedCheck(UUID userId, String scope, String prompt) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT prompt, answer FROM food_diet_checks WHERE user_id = ? AND scope = ?",
                userId.toString(), scope);
        if (rows.isEmpty() || !prompt.equals(rows.get(0).get("prompt"))) {
            return null;
        }
        try {
            return json.readValue((String) rows.get(0).get("answer"), DietCheckResponse.class);
        } catch (Exception ex) {
            // A row from an older response shape: ask again and overwrite it.
            return null;
        }
    }

    private static String verdict(DietCheckResponse r) {
        List<String> v = List.of(r.protein(), r.carbs(), r.fat(), r.fiber());
        List<String> parts = new ArrayList<>();
        for (int k = 0; k < 4; k++) {
            parts.add(KEYS.get(k) + " " + v.get(k));
        }
        if (r.water() != null) {
            parts.add("water " + r.water());
        }
        return String.join(", ", parts);
    }

    /**
     * The day's water, or the week's average over the same days the food average
     * uses; null when nothing was logged all week.
     */
    // ponytail: "no water all week" stands in for "Water is turned off", which only
    // the client knows; a user who has it on and logs none just isn't told about it.
    private Integer waterFor(UUID userId, LocalDate today, LocalDate day) {
        Map<LocalDate, Integer> ml = water.totalsByDay(userId, today.minusDays(DAYS - 1), today);
        if (ml.isEmpty()) {
            return null;
        }
        if (day != null) {
            return ml.getOrDefault(day, 0);
        }
        List<Integer> past = ml.entrySet().stream().filter(e -> e.getKey().isBefore(today))
                .map(Map.Entry::getValue).toList();
        List<Integer> use = past.isEmpty() ? List.copyOf(ml.values()) : past;
        return (int) Math.round(use.stream().mapToInt(Integer::intValue).average().orElse(0));
    }

    /** Every day of the window, oldest first, empty days included so the chart has 7 bars. */
    private Map<LocalDate, List<FoodEntry>> byDay(UUID userId, LocalDate today) {
        LocalDate from = today.minusDays(DAYS - 1);
        Map<LocalDate, List<FoodEntry>> out = new LinkedHashMap<>();
        for (LocalDate d = from; !d.isAfter(today); d = d.plusDays(1)) {
            out.put(d, new ArrayList<>());
        }
        for (FoodEntry e : entries.findByUserIdAndLogDateBetween(userId, from, today)) {
            out.computeIfPresent(e.getLogDate(), (k, v) -> {
                v.add(e);
                return v;
            });
        }
        return out;
    }

    private Map<LocalDate, List<FoodEntry>> oneDay(UUID userId, LocalDate day) {
        Map<LocalDate, List<FoodEntry>> out = new LinkedHashMap<>();
        out.put(day, new ArrayList<>(entries.findByUserIdAndLogDateBetween(userId, day, day)));
        return out;
    }

    /** Under 80% of the target is low, over 120% high. */
    static String level(int avg, int target) {
        double r = (double) avg / Math.max(1, target);
        return r < 0.8 ? "low" : r > 1.2 ? "high" : "ok";
    }

    /** No AI: the verdict from the numbers, and a stock suggestion per gap. */
    static DietCheckResponse rules(Nutrients avg, Nutrients target) {
        return rules(avg, target, "Your week");
    }

    /** {@code label} names what is judged: "Your week", "Today so far", "That day". */
    static DietCheckResponse rules(Nutrients avg, Nutrients target, String label) {
        return rules(avg, target, label, null, 0);
    }

    /** {@code waterMl} null: water isn't judged or mentioned. */
    static DietCheckResponse rules(Nutrients avg, Nutrients target, String label, Integer waterMl, int waterGoalMl) {
        String w = waterMl == null ? null : level(waterMl, waterGoalMl);
        String p = level(avg.proteinG(), target.proteinG());
        String c = level(avg.carbsG(), target.carbsG());
        String f = level(avg.fatG(), target.fatG());
        String fi = level(avg.fiberG(), target.fiberG());
        // One tip per gap the summary names, extras after: with a cap of 4, two
        // tips each for protein and fiber used to push "heavy on carbs" out of
        // the list while the summary still said it.
        List<String> first = new ArrayList<>();
        List<String> more = new ArrayList<>();
        List<String> light = new ArrayList<>();
        List<String> heavy = new ArrayList<>();
        if ("low".equals(p)) {
            light.add("protein");
            first.add("Dal or sambar with lunch");
            more.add("Eggs or paneer at breakfast");
        }
        if ("low".equals(fi)) {
            light.add("fiber");
            first.add("A vegetable poriyal or salad");
            more.add("A fruit as an evening snack");
        }
        if ("high".equals(c)) {
            heavy.add("carbs");
            first.add("Half a serving less rice, more vegetables");
        } else if ("low".equals(c)) {
            light.add("carbs");
            first.add("A chapati or a small rice portion at dinner");
        }
        if ("high".equals(f)) {
            heavy.add("fat");
            first.add("Fewer fried snacks like poori and bajji");
        } else if ("low".equals(f)) {
            light.add("fat");
            first.add("A spoon of ghee or a handful of nuts");
        }
        if ("low".equals(w)) {
            light.add("water");
            first.add("A glass of water with each meal");
        }
        List<String> add = new ArrayList<>(first);
        add.addAll(more);
        String summary;
        if (light.isEmpty() && heavy.isEmpty()) {
            summary = label + " is close to target on protein, carbs, fat and fiber"
                    + (w == null ? "" : ", and water is on track") + ". Keep the variety going.";
        } else {
            List<String> said = new ArrayList<>();
            if (!light.isEmpty()) {
                said.add("light on " + and(light));
            }
            if (!heavy.isEmpty()) {
                said.add("heavy on " + and(heavy));
            }
            // "light on protein, carbs and water, and heavy on fat": the comma keeps the
            // second half from reading as one more item of the first.
            summary = label + " looks " + String.join(light.size() > 1 && said.size() > 1 ? ", and " : " and ", said)
                    + ". A small change to one meal a day closes most of the gap.";
        }
        // At least 4, and never fewer than the gaps named: with water there can be five.
        return new DietCheckResponse(p, c, f, fi, w, summary,
                add.stream().limit(Math.max(4, first.size())).toList(), "rules");
    }

    private static String and(List<String> xs) {
        return xs.size() == 1 ? xs.get(0)
                : String.join(", ", xs.subList(0, xs.size() - 1)) + " and " + xs.get(xs.size() - 1);
    }

    /**
     * A word that STARTS with the keyword: "eggs" counts, "veggie" is not an egg,
     * and "non veg" is not a vegetable.
     */
    static boolean mentions(String name, List<String> words) {
        String s = " " + name.toLowerCase(Locale.ROOT).replaceAll("non[ -]?veg\\w*", " ").replaceAll("[^a-z]+", " ");
        return words.stream().anyMatch(w -> s.contains(" " + w));
    }

    private static String safe(String s) {
        return s == null || s.isBlank() ? "-" : cap(s.strip(), 120);
    }

    private static String cap(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
