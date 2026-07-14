package com.growthbuddy.config;

import com.growthbuddy.habit.Cadence;
import com.growthbuddy.habit.Habit;
import com.growthbuddy.habit.HabitDomain;
import com.growthbuddy.quote.Quote;
import com.growthbuddy.quote.QuoteRepository;
import com.growthbuddy.task.Priority;
import com.growthbuddy.task.Task;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seeds a demo user (matching {@code growthbuddy.demo-user-id}), a starter set of
 * tasks/habits mirroring the frontend prototype, and a few quotes — but only when
 * the database is empty, so it is safe to run on every startup.
 */
@Component
public class DataSeeder implements CommandLineRunner {

    @PersistenceContext
    private EntityManager em;

    private final UserRepository users;
    private final QuoteRepository quotes;
    private final UUID demoUserId;
    private final boolean prod;

    public DataSeeder(UserRepository users, QuoteRepository quotes,
                      @Value("${growthbuddy.demo-user-id}") String demoUserId,
                      @Value("${spring.profiles.active:}") String activeProfiles) {
        this.users = users;
        this.quotes = quotes;
        this.demoUserId = UUID.fromString(demoUserId);
        this.prod = activeProfiles != null && activeProfiles.toLowerCase().contains("prod");
    }

    @Override
    @Transactional
    public void run(String... args) {
        ensureReminderTables();
        // Don't plant a predictable demo account (well-known id + email) in prod.
        if (!prod) {
            seedDemoUser();
        }
        seedQuotes();
    }

    private void ensureReminderTables() {
        em.createNativeQuery("""
                create table if not exists calendar_reminders (
                    id char(36) not null,
                    user_id char(36) not null,
                    text varchar(255) not null,
                    anchor_date date not null,
                    time_of_day time null,
                    tag varchar(16) not null,
                    repeat_freq varchar(16) not null,
                    from_date date null,
                    until_date date null,
                    created_at timestamp not null,
                    primary key (id),
                    index ix_cal_rem_user_date (user_id, anchor_date)
                ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci
                """).executeUpdate();

        em.createNativeQuery("""
                create table if not exists calendar_reminder_skips (
                    reminder_id char(36) not null,
                    skip_date date not null,
                    primary key (reminder_id, skip_date),
                    constraint fk_cal_rem_skip_reminder foreign key (reminder_id)
                        references calendar_reminders(id) on delete cascade
                ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci
                """).executeUpdate();

        // Older schema versions created enum columns that reject newly added values.
        em.createNativeQuery("""
                alter table calendar_reminders
                    modify column repeat_freq varchar(16) not null,
                    modify column tag varchar(16) not null
                """).executeUpdate();
    }

    private void seedDemoUser() {
        if (users.existsById(demoUserId)) {
            return;
        }
        User u = new User();
        u.setId(demoUserId);
        u.setEmail("demo@growthbuddy.app");
        u.setDisplayName("Alex");
        u.setTimezone("UTC");
        users.save(u);

        // Seed tasks (mirrors SEED_TASKS in the frontend).
        persistTask("Read 10 pages", Priority.Medium, false);
        persistTask("Finish design review", Priority.High, false);
        persistTask("Call mom", Priority.Low, true);

        // Seed habits (mirrors SEED_HABITS in the frontend).
        persistHabit("Meditate", HabitDomain.habit, "brain");
        persistHabit("Workout", HabitDomain.fitness, "dumbbell");
        persistHabit("Read", HabitDomain.study, "book-open");
        persistHabit("Journal", HabitDomain.journal, "notebook-pen");
    }

    private void persistTask(String title, Priority priority, boolean done) {
        Task t = new Task();
        t.setUserId(demoUserId);
        t.setTitle(title);
        t.setPriority(priority);
        t.setDone(done);
        if (done) {
            t.setDoneAt(java.time.Instant.now());
        }
        em.persist(t);
    }

    private void persistHabit(String name, HabitDomain domain, String icon) {
        Habit h = new Habit();
        h.setUserId(demoUserId);
        h.setName(name);
        h.setDomain(domain);
        h.setIcon(icon);
        h.setCadence(Cadence.daily);
        em.persist(h);
    }

    private void seedQuotes() {
        if (quotes.count() > 0) {
            return;
        }
        quotes.saveAll(List.of(
                new Quote("Small steps every day add up to big results.", "Growth Buddy"),
                new Quote("Discipline is choosing between what you want now and what you want most.",
                        "Abraham Lincoln"),
                new Quote("The secret of getting ahead is getting started.", "Mark Twain"),
                new Quote("You do not rise to the level of your goals. You fall to the level of your systems.",
                        "James Clear"),
                new Quote("It always seems impossible until it's done.", "Nelson Mandela")
        ));
    }
}
