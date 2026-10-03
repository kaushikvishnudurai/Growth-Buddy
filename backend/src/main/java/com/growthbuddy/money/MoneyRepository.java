package com.growthbuddy.money;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

interface MoneyRepository extends JpaRepository<MoneyState, UUID> {

    /**
     * The row, locked until the transaction ends (SELECT ... FOR UPDATE; TiDB
     * supports it). A save checks If-Match and then writes: without the lock two
     * saves carrying the same version both passed the check and one overwrote
     * the other.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from MoneyState s where s.userId = :id")
    Optional<MoneyState> lockById(@Param("id") UUID id);

    /**
     * WhatsApp-verified users with a subscription due on any day in {@code mask}
     * (see {@link MoneyState#getSubDueDays}), plus any row not yet indexed. Ids only:
     * the documents are read afterwards, for the few that match.
     */
    @Query(value = """
            select m.user_id from money_state m join users u on u.id = m.user_id
            where u.whatsapp_enabled = true and u.whatsapp_verified = true
              and u.whatsapp_number is not null
              and (m.sub_due_days is null or (m.sub_due_days & :mask) <> 0)
            """, nativeQuery = true)
    List<String> findWhatsappUserIdsDueOn(@Param("mask") int mask);

    /** Index a pre-column row without touching its document. */
    @Transactional
    @Modifying
    @Query("update MoneyState s set s.subDueDays = :mask where s.userId = :id and s.subDueDays is null")
    void fillDueDays(@Param("id") UUID id, @Param("mask") int mask);
}
