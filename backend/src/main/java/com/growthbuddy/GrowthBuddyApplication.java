package com.growthbuddy;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class GrowthBuddyApplication {

    public static void main(String[] args) {
        SpringApplication.run(GrowthBuddyApplication.class, args);
    }
}
