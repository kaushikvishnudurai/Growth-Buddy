package com.growthbuddy.money;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface MoneyRepository extends JpaRepository<MoneyState, UUID> {
}
