package com.growthbuddy.focus;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * What a focus session may be linked to: the user's own tasks and goals. JPQL
 * over the entities rather than the task/goal repositories, which are
 * package-private to their own packages (and the services behind them do far
 * more than "is this yours?"). An interface so FocusServiceTest can answer it.
 */
interface FocusLinks {

    /** A live (not deleted) task of this user's. */
    boolean ownsTask(UUID userId, UUID taskId);

    boolean ownsGoal(UUID userId, UUID goalId);

    /** id -> title for this user's tasks among {@code ids}, deleted ones included:
     *  the midnight sweep soft-deletes a finished task, and its minutes still count. */
    Map<UUID, String> taskTitles(UUID userId, Collection<UUID> ids);

    Map<UUID, String> goalTitles(UUID userId, Collection<UUID> ids);
}

@Component
class JpaFocusLinks implements FocusLinks {

    @PersistenceContext
    private EntityManager em;

    @Override
    public boolean ownsTask(UUID userId, UUID taskId) {
        return em.createQuery("select count(t) from Task t where t.id = :id and t.userId = :u"
                        + " and t.deletedAt is null", Long.class)
                .setParameter("id", taskId)
                .setParameter("u", userId)
                .getSingleResult() > 0;
    }

    @Override
    public boolean ownsGoal(UUID userId, UUID goalId) {
        return em.createQuery("select count(g) from Goal g where g.id = :id and g.userId = :u", Long.class)
                .setParameter("id", goalId)
                .setParameter("u", userId)
                .getSingleResult() > 0;
    }

    @Override
    public Map<UUID, String> taskTitles(UUID userId, Collection<UUID> ids) {
        return titles("select t.id, t.title from Task t where t.userId = :u and t.id in :ids", userId, ids);
    }

    @Override
    public Map<UUID, String> goalTitles(UUID userId, Collection<UUID> ids) {
        return titles("select g.id, g.title from Goal g where g.userId = :u and g.id in :ids", userId, ids);
    }

    private Map<UUID, String> titles(String jpql, UUID userId, Collection<UUID> ids) {
        Map<UUID, String> out = new HashMap<>();
        if (ids == null || ids.isEmpty()) return out;
        List<Object[]> rows = em.createQuery(jpql, Object[].class)
                .setParameter("u", userId)
                .setParameter("ids", ids)
                .getResultList();
        for (Object[] r : rows) out.put((UUID) r[0], (String) r[1]);
        return out;
    }
}
