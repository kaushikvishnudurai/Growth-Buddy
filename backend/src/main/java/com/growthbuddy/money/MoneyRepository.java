package com.growthbuddy.money;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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
}
