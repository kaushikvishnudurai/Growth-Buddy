package com.growthbuddy.user;

import com.growthbuddy.common.ApiException;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProgressService {

    /** One level per this much XP. The client reads level progress from the user DTO
     *  ({@code xpIntoLevel} / {@code xpForNextLevel}) so it never keeps its own copy. */
    public static final int XP_PER_LEVEL = 100;
    private static final int TASK_COMPLETE_XP = 15;
    private static final int HABIT_CHECKIN_XP = 10;

    private final UserRepository users;

    public ProgressService(UserRepository users) {
        this.users = users;
    }

    @Transactional
    public void awardTaskCompletion(UUID userId) {
        addXp(userId, TASK_COMPLETE_XP);
    }

    @Transactional
    public void awardHabitCheckin(UUID userId) {
        addXp(userId, HABIT_CHECKIN_XP);
    }

    /** A "break a habit" habit's clean days, each paid like one check-in (HabitService credits each once). */
    @Transactional
    public void awardHabitCleanDays(UUID userId, int days) {
        if (days > 0) {
            addXp(userId, HABIT_CHECKIN_XP * days);
        }
    }

    private void addXp(UUID userId, int delta) {
        if (delta <= 0) {
            return;
        }
        User user = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User not found"));

        int nextXp = Math.max(0, user.getXpTotal()) + delta;
        user.setXpTotal(nextXp);
        user.setLevel(levelForXp(nextXp));
        users.save(user);
    }

    static int levelForXp(int xp) {
        return Math.max(1, 1 + (Math.max(0, xp) / XP_PER_LEVEL));
    }

    /** XP earned since the current level began. */
    public static int xpIntoLevel(int xp) {
        return Math.max(0, xp) % XP_PER_LEVEL;
    }

    /** XP still needed to reach the next level. */
    public static int xpForNextLevel(int xp) {
        return XP_PER_LEVEL - xpIntoLevel(xp);
    }
}
