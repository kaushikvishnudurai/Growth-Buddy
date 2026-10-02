package com.growthbuddy.food;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.mentor.OpenAIClient.ChatTurn;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The Food screen's Summary card: the last 7 days of calories against the goal
 * (free, computed on every read), and an on-demand diet check that asks the AI
 * whether the week is short on protein or fiber.
 *
 * <p>Entries carry only a name, grams and kcal, so the check judges from the
 * meal names. That is what the prompt says, and why its answer is three levels
 * rather than grams.
 */
@Service
public class FoodWeek {

    private static final Logger log = LoggerFactory.getLogger(FoodWeek.class);

    static final int DAYS = 7;
    private static final int DEFAULT_GOAL_KCAL = 2000;

    private static final String PROMPT = """
            You are Buddy, the nutrition coach inside the Growth Buddy app, and you know
            Indian food well. You get the meal names a user logged over the last few days
            and their profile. Judge from the dish names alone whether the week is low,
            ok or high in protein and in fiber. Be practical, kind and specific.
            Return strict JSON only:
            {"protein":"low|ok|high","fiber":"low|ok|high",
             "summary":"two short sentences, second person, no numbers",
             "add":["up to 4 short, specific Indian foods to add, respecting diet and allergies"]}
            No Markdown, no emoji.
            """;

    // ponytail: keyword lists, not a nutrition database. Only used when the AI is
    // unavailable; a dish named in Tamil or Hindi slang reads as "neither".
    private static final List<String> PROTEIN = List.of(
            "egg", "omelette", "chicken", "fish", "mutton", "prawn", "meat", "paneer", "dal", "sambar",
            "rajma", "chana", "chole", "soya", "tofu", "curd", "yogurt", "milk", "sprout", "moong",
            "peanut", "whey", "keema");
    private static final List<String> FIBER = List.of(
            "salad", "vegetable", "veg", "sabzi", "poriyal", "kootu", "avial", "spinach", "palak",
            "fruit", "apple", "banana", "guava", "papaya", "orange", "oats", "millet", "ragi", "brown rice",
            "chapati", "roti", "dal", "sambar", "rajma", "chana", "sprout", "beans", "carrot", "cucumber");

    private final FoodEntryRepository entries;
    private final UserRepository users;
    private final UserClock clock;
    private final OpenAIClient openai;
    private final ObjectMapper json = new ObjectMapper();

    public FoodWeek(FoodEntryRepository entries, UserRepository users, UserClock clock, OpenAIClient openai) {
        this.entries = entries;
        this.users = users;
        this.clock = clock;
        this.openai = openai;
    }

    // Not @Transactional: estimateProtein is an AI call, and a transaction would
    // hold a pooled connection through it.
    public FoodWeekResponse week(UUID userId) {
        LocalDate today = clock.today(userId);
        Map<LocalDate, List<FoodEntry>> byDay = byDay(userId, today);
        estimateProtein(byDay.values().stream().flatMap(List::stream).filter(e -> e.getProteinG() == null).toList());
        List<FoodWeekDay> days = new ArrayList<>();
        byDay.forEach((d, list) -> days.add(new FoodWeekDay(d.toString(),
                list.stream().mapToInt(FoodEntry::getKcalEstimated).sum(), list.size(),
                list.stream().mapToInt(FoodWeek::protein).sum())));
        User u = users.findById(userId).orElse(null);
        Integer goal = u == null ? null : u.getDailyFoodGoalKcal();
        return new FoodWeekResponse(goal != null ? goal : DEFAULT_GOAL_KCAL, proteinTarget(u), days,
                sources(byDay.values().stream().flatMap(List::stream).toList()));
    }

    /** Top 5 dishes by protein over the week, same dish name counted together. */
    static List<ProteinSource> sources(List<FoodEntry> all) {
        Map<String, int[]> sum = new LinkedHashMap<>();
        Map<String, String> label = new LinkedHashMap<>();
        for (FoodEntry e : all) {
            String key = e.getFoodName().strip().toLowerCase(Locale.ROOT);
            label.putIfAbsent(key, e.getFoodName().strip());
            int[] v = sum.computeIfAbsent(key, k -> new int[2]);
            v[0]++;
            v[1] += protein(e);
        }
        return sum.entrySet().stream()
                .filter(en -> en.getValue()[1] > 0)
                .sorted((a, b) -> b.getValue()[1] - a.getValue()[1])
                .limit(5)
                .map(en -> new ProteinSource(label.get(en.getKey()), en.getValue()[0], en.getValue()[1]))
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

    static int protein(FoodEntry e) {
        return e.getProteinG() != null ? e.getProteinG() : guessProtein(e.getFoodName(), e.getQuantityGrams());
    }

    // ponytail: grams of protein per 100 g, first keyword in this order wins
    // ("chicken fried rice" is chicken, not rice). Only stands in while the AI
    // hasn't estimated an entry, and is never stored, so the AI still can.
    private static final Map<String, Double> PROTEIN_PER_100G = new LinkedHashMap<>();
    static {
        Object[][] t = {
            {"chicken", 18.0}, {"mutton", 20.0}, {"fish", 18.0}, {"prawn", 18.0}, {"keema", 18.0},
            {"egg", 13.0}, {"omelette", 11.0}, {"paneer", 18.0}, {"tofu", 8.0}, {"soya", 13.0},
            {"peanut", 25.0}, {"rajma", 7.0}, {"chana", 7.0}, {"chole", 7.0}, {"sprout", 7.0},
            {"moong", 7.0}, {"dal", 6.0}, {"sambar", 3.0}, {"curd", 3.5}, {"milk", 3.3},
            {"bread", 9.0}, {"roti", 9.0}, {"chapati", 9.0}, {"paratha", 7.0}, {"poori", 7.0},
            {"dosa", 4.0}, {"idli", 4.0}, {"upma", 4.0}, {"poha", 3.0}, {"rice", 2.7},
        };
        for (Object[] r : t) {
            PROTEIN_PER_100G.put((String) r[0], (Double) r[1]);
        }
    }

    static int guessProtein(String name, int grams) {
        double per100 = 4.0;
        for (Map.Entry<String, Double> en : PROTEIN_PER_100G.entrySet()) {
            if (mentions(name, List.of(en.getKey()))) {
                per100 = en.getValue();
                break;
            }
        }
        return (int) Math.round(per100 * grams / 100.0);
    }

    private static final String PROTEIN_PROMPT = """
            You estimate protein for Indian food. Each numbered line is a dish and its
            weight in grams as eaten. Return strict JSON only:
            {"items":[{"i":1,"proteinG":12}, ...]} with one entry per line, proteinG an
            integer. Use typical Indian home and hotel recipes.
            """;

    /** One AI call for every entry the week hasn't estimated yet; failures leave them null. */
    private void estimateProtein(List<FoodEntry> missing) {
        if (missing.isEmpty() || !openai.isConfigured()) {
            return;
        }
        List<FoodEntry> batch = missing.subList(0, Math.min(40, missing.size()));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < batch.size(); i++) {
            sb.append(i + 1).append(". ").append(cap(batch.get(i).getFoodName(), 120))
                    .append(", ").append(batch.get(i).getQuantityGrams()).append(" g\n");
        }
        try {
            JsonNode n = json.readTree(OpenAIClient.jsonOf(
                    openai.complete(PROTEIN_PROMPT, List.of(new ChatTurn("user", sb.toString())))));
            for (JsonNode it : n.path("items")) {
                int i = it.path("i").asInt(0) - 1;
                if (i >= 0 && i < batch.size() && it.path("proteinG").isNumber()) {
                    int g = Math.max(0, Math.min(300, it.path("proteinG").asInt()));
                    batch.get(i).setProteinG(g);
                    entries.setProteinIfMissing(batch.get(i).getId(), g);
                }
            }
        } catch (Exception ex) {
            log.warn("Protein estimate failed, using the keyword table: {}", ex.toString());
        }
    }

    // Not @Transactional: that would hold a pooled connection through a
    // multi-second AI call. Each repository read takes its own.
    public DietCheckResponse check(UUID userId) {
        Map<LocalDate, List<FoodEntry>> byDay = byDay(userId, clock.today(userId));
        List<String> names = byDay.values().stream().flatMap(List::stream).map(FoodEntry::getFoodName).toList();
        if (names.isEmpty()) {
            return new DietCheckResponse(null, null,
                    "Log a few meals this week and Buddy can tell you what your plate is missing.", List.of(), "rules");
        }
        User u = users.findById(userId).orElse(null);
        int target = proteinTarget(u);
        int avgProtein = (int) Math.round(byDay.values().stream().filter(l -> !l.isEmpty())
                .mapToInt(l -> l.stream().mapToInt(FoodWeek::protein).sum()).average().orElse(0));
        // Protein is judged from the same numbers the screen's thali shows, never
        // from keywords, so the verdict can't contradict the chart above it.
        DietCheckResponse rules = rules(names, proteinLevel(avgProtein, target));
        if (!openai.isConfigured()) {
            return rules;
        }
        StringBuilder sb = new StringBuilder("Meals by day:\n");
        byDay.forEach((d, list) -> {
            if (!list.isEmpty()) {
                sb.append(d.getDayOfWeek().toString().substring(0, 3)).append(": ")
                        .append(String.join(", ", list.stream().map(FoodEntry::getFoodName).toList())).append('\n');
            }
        });
        sb.append("\nEstimated protein: ").append(avgProtein).append(" g a day on days with meals logged, target ")
                .append(target).append(" g.");
        if (u != null) {
            sb.append("\nProfile: fitnessGoal=").append(safe(u.getFitnessGoal()))
                    .append(", diet=").append(safe(u.getDietPreference()))
                    .append(", allergic=").append(safe(u.getAllergicTo()));
        }
        try {
            JsonNode n = json.readTree(OpenAIClient.jsonOf(
                    openai.complete(PROMPT, List.of(new ChatTurn("user", sb.toString())))));
            List<String> add = new ArrayList<>();
            n.path("add").forEach(x -> {
                if (add.size() < 4 && !x.asText().isBlank()) {
                    add.add(cap(x.asText().strip(), 60));
                }
            });
            String summary = n.path("summary").asText("").strip();
            return new DietCheckResponse(
                    // Protein from the numbers, as above; the AI only words it.
                    rules.protein(),
                    level(n.path("fiber").asText(), rules.fiber()),
                    summary.isEmpty() ? rules.summary() : cap(summary, 400),
                    add.isEmpty() ? rules.add() : add,
                    "ai");
        } catch (Exception ex) {
            log.warn("Diet check fell back to the rules: {}", ex.toString());
            return rules;
        }
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

    /** No AI: count how many logged dishes name a protein or a fiber food. */
    /** Under 80% of the target is low, over 120% high. */
    static String proteinLevel(int avg, int target) {
        double r = (double) avg / Math.max(1, target);
        return r < 0.8 ? "low" : r > 1.2 ? "high" : "ok";
    }

    static DietCheckResponse rules(List<String> names) {
        long p = names.stream().filter(n -> mentions(n, PROTEIN)).count();
        return rules(names, share(p, names.size()));
    }

    static DietCheckResponse rules(List<String> names, String protein) {
        long f = names.stream().filter(n -> mentions(n, FIBER)).count();
        String fiber = share(f, names.size());
        List<String> add = new ArrayList<>();
        if ("low".equals(protein)) {
            add.addAll(List.of("Dal or sambar with lunch", "Eggs or paneer at breakfast"));
        }
        if ("low".equals(fiber)) {
            add.addAll(List.of("A vegetable poriyal or salad", "A fruit as an evening snack"));
        }
        String summary = add.isEmpty()
                ? "Your week has a fair mix of protein and fiber. Keep the variety going."
                : "Your week looks light on " + ("low".equals(protein) && "low".equals(fiber) ? "protein and fiber"
                        : "low".equals(protein) ? "protein" : "fiber") + ". A small addition to one meal a day closes the gap.";
        return new DietCheckResponse(protein, fiber, summary, add, "rules");
    }

    /**
     * A word that STARTS with the keyword: "eggs" counts, "veggie" is not an egg,
     * and "non veg" is not a vegetable.
     */
    static boolean mentions(String name, List<String> words) {
        String s = " " + name.toLowerCase(Locale.ROOT).replaceAll("non[ -]?veg\\w*", " ").replaceAll("[^a-z]+", " ");
        return words.stream().anyMatch(w -> s.contains(" " + w));
    }

    private static String share(long hits, int total) {
        double r = (double) hits / total;
        return r < 0.3 ? "low" : r > 0.7 ? "high" : "ok";
    }

    private static String level(String v, String fallback) {
        return List.of("low", "ok", "high").contains(v) ? v : fallback;
    }

    private static String safe(String s) {
        return s == null || s.isBlank() ? "-" : cap(s.strip(), 120);
    }

    private static String cap(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
