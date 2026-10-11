package com.growthbuddy.quickadd;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.food.FoodService;
import com.growthbuddy.goal.GoalService;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.money.MoneyService;
import com.growthbuddy.note.NoteService;
import com.growthbuddy.quickadd.QuickAddService.Intent;
import com.growthbuddy.reminder.ReminderService;
import com.growthbuddy.task.TaskService;
import com.growthbuddy.water.WaterService;
import com.growthbuddy.wellness.WellnessService;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Quick add's intents applied on the server — what the app does after its
 * preview, for a message that arrived where there is no app: a WhatsApp text.
 * Each intent goes through the same service its own screen's API uses, one at a
 * time, so one refusal (a past reminder, an unknown habit) costs that line only.
 *
 * <p>Returns one plain line per intent, saved or not, for the reply. The
 * client-only controls (open a screen, start the timer, switch the theme) have
 * nothing to act on here and say so. A tracker the user switched off takes
 * nothing, as in the app.
 */
@Service
public class QuickAddApplier {

    private static final Logger log = LoggerFactory.getLogger(QuickAddApplier.class);

    /** Intent type -> the feature toggle that has to be on (the client's INTENT_FEATURE). */
    static final Map<String, String> FEATURE = Map.of(
            "habit", "habits", "habit_new", "habits", "water", "water", "expense", "money",
            "income", "money", "food", "food", "goal", "goals", "note", "notes", "reminder", "calendar");

    private final TaskService tasks;
    private final HabitService habits;
    private final WaterService water;
    private final WellnessService wellness;
    private final ReminderService reminders;
    private final FoodService food;
    private final NoteService notes;
    private final GoalService goals;
    private final MoneyService money;
    private final ObjectMapper json;

    public QuickAddApplier(TaskService tasks, HabitService habits, WaterService water, WellnessService wellness,
                           ReminderService reminders, FoodService food, NoteService notes, GoalService goals,
                           MoneyService money, ObjectMapper json) {
        this.tasks = tasks;
        this.habits = habits;
        this.water = water;
        this.wellness = wellness;
        this.reminders = reminders;
        this.food = food;
        this.notes = notes;
        this.goals = goals;
        this.money = money;
        this.json = json;
    }

    public List<String> habitNames(UUID userId) {
        return habits.names(userId);
    }

    public List<String> apply(UUID userId, Map<String, Boolean> features, List<Intent> intents, LocalDate today) {
        List<String> lines = new ArrayList<>();
        for (Intent it : intents) {
            String feature = FEATURE.get(it.type());
            if (feature != null && features != null && Boolean.FALSE.equals(features.get(feature))) {
                lines.add("Skipped " + it.type().replace('_', ' ') + ": that tracker is switched off.");
                continue;
            }
            try {
                lines.add(one(userId, it, today));
            } catch (Exception ex) {
                log.info("WhatsApp quick add {} refused: {}", it.type(), ex.getMessage());
                lines.add("Couldn't save the " + it.type().replace('_', ' ') + ": " + ex.getMessage());
            }
        }
        return lines;
    }

    private String one(UUID userId, Intent it, LocalDate today) {
        switch (it.type()) {
            case "task" -> {
                tasks.createTitled(userId, it.title());
                return "Task added: " + it.title();
            }
            case "task_done" -> {
                String done = tasks.completeMatching(userId, it.title());
                return done == null ? "No open task matches \"" + it.title() + "\"." : "Done: " + done;
            }
            case "habit" -> {
                String name = habits.tickNamed(userId, it.name());
                return name == null ? "No habit called \"" + it.name() + "\"." : "Habit ticked: " + name;
            }
            case "habit_new" -> {
                habits.createNamed(userId, it.name());
                return "New habit: " + it.name();
            }
            case "water" -> {
                water.addMl(userId, it.amountMl());
                return "Water: " + it.amountMl() + " ml";
            }
            case "sleep" -> {
                String[] times = sleepTimes(it.hours());
                wellness.saveSleepTimes(userId, times[0], times[1], "ok".equals(it.quality()) ? "okay" : it.quality());
                return "Sleep: " + trim(it.hours()) + " h";
            }
            case "mood" -> {
                wellness.saveMoodWords(userId, it.mood(), it.energy());
                return "Mood: " + it.mood();
            }
            case "expense", "income" -> {
                var res = money.applyLedger(userId, ledgerWrite(it, today, money.defaultAccountId(userId, it.type())));
                if (!res.path("rejected").isEmpty()) {
                    throw new IllegalArgumentException(res.path("rejected").get(0).path("reason").asText());
                }
                return ("expense".equals(it.type()) ? "Expense: " : "Income: ") + it.amount()
                        + (it.note() == null || it.note().isBlank() ? "" : " (" + it.note() + ")");
            }
            case "food" -> {
                food.addNamed(userId, it.name(), it.meal(), it.kcal());
                return "Food: " + it.name();
            }
            case "reminder" -> {
                reminders.createSpoken(userId, it.text(), it.date(), it.time(), it.endTime(), it.tag(),
                        it.repeat(), it.until(), it.notifyBefore());
                return "Reminder: " + it.text() + " - " + (it.date().equals(today) ? "today" : it.date().toString())
                        + (it.time() == null ? "" : " " + it.time().format(DateTimeFormatter.ofPattern("HH:mm")));
            }
            case "note" -> {
                notes.createText(userId, it.text());
                return "Note saved.";
            }
            case "goal" -> {
                goals.createTitled(userId, it.title());
                return "Goal added: " + it.title();
            }
            default -> {
                return "Open the app for that one (" + it.type() + ").";
            }
        }
    }

    /** The client's sleepPayloadFromHours: a wake at 07:00, the bedtime that makes the duration right. */
    static String[] sleepTimes(double hours) {
        int wake = 7 * 60;
        int bed = Math.floorMod(wake - (int) Math.round(hours * 60), 1440);
        return new String[] {String.format("%02d:%02d", bed / 60, bed % 60), "07:00"};
    }

    /**
     * One ledger upsert, in the shape POST /api/money/tx takes from the app, on the
     * account the app's own dialog would pick (FRC-3: with none, balances never moved).
     */
    ObjectNode ledgerWrite(Intent it, LocalDate today, String accountId) {
        ObjectNode body = json.createObjectNode();
        ObjectNode row = body.putArray("upserts").addObject()
                .put("kind", it.type())
                .put("id", UUID.randomUUID().toString())
                .put("amount", it.amount())
                .put("date", (it.date() != null ? it.date() : today).toString())
                .put("createdAt", System.currentTimeMillis());
        if (accountId != null) row.put("accountId", accountId);
        if ("expense".equals(it.type())) {
            row.put("category", "others").put("note", it.note() == null ? "" : it.note());
        } else {
            boolean salary = it.note() != null && it.note().toLowerCase(java.util.Locale.ROOT).contains("salary");
            row.put("source", salary ? "salary" : "other")
                    .put("label", it.note() == null || it.note().isBlank() ? "Income" : it.note());
        }
        return body;
    }

    private static String trim(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
    }
}
