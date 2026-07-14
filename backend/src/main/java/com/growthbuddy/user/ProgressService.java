package com.growthbuddy.user;

import com.growthbuddy.common.ApiException;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProgressService {

    private static final int XP_PER_LEVEL = 100;
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

    private int levelForXp(int xp) {
        return Math.max(1, 1 + (xp / XP_PER_LEVEL));
    }
}
