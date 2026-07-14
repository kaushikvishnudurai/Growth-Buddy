package com.growthbuddy.score;

import org.springframework.data.jpa.repository.JpaRepository;

interface DailyScoreRepository extends JpaRepository<DailyScore, DailyScore.Key> {
}
