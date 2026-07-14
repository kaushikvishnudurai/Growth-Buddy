package com.growthbuddy.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
public class User {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true, length = 254)
    private String email;

    @Column(name = "email_verified", nullable = false)
    private boolean emailVerified = false;

    /** Gates server-wide settings (e.g. the Google OAuth client keys). */
    @Column(name = "is_admin", nullable = false, columnDefinition = "BOOLEAN DEFAULT FALSE")
    private boolean admin = false;

    @Column(name = "display_name", nullable = false, length = 120)
    private String displayName;

    @Column(name = "avatar_url")
    private String avatarUrl;

    @Column(nullable = false, length = 64)
    private String timezone = "UTC";

    /** E.164 phone number used for WhatsApp delivery (e.g. +14155552671). */
    @Column(name = "whatsapp_number", length = 20)
    private String whatsappNumber;

    @Column(name = "whatsapp_enabled", nullable = false, columnDefinition = "BOOLEAN DEFAULT FALSE")
    private boolean whatsappEnabled = false;

    @Column(name = "whatsapp_verified", nullable = false, columnDefinition = "BOOLEAN DEFAULT FALSE")
    private boolean whatsappVerified = false;

    @Column(name = "age_years")
    private Integer ageYears;

    @Column(name = "dob")
    private LocalDate dob;

    @Column(name = "height_cm")
    private Integer heightCm;

    @Column(name = "weight_kg")
    private Integer weightKg;

    @Column(name = "diet_preference", length = 64)
    private String dietPreference;

    @Column(name = "about_me", length = 500)
    private String aboutMe;

    @Column(name = "allergic_to", length = 255)
    private String allergicTo;

    @Column(name = "favourite_dish", length = 120)
    private String favouriteDish;

    @Column(name = "daily_food_goal_kcal")
    private Integer dailyFoodGoalKcal;

    @Column(name = "daily_water_goal_ml")
    private Integer dailyWaterGoalMl;

    @Column(name = "gender", length = 20)
    private String gender;

    @Column(name = "fitness_goal", length = 100)
    private String fitnessGoal;

    /** Progress digest cadence: "off" (default), "daily", or "weekly". */
    @Column(name = "digest_frequency", nullable = false, length = 16,
            columnDefinition = "VARCHAR(16) DEFAULT 'off'")
    private String digestFrequency = "off";

    /** Local hour (0-23) at which the digest is sent. */
    @Column(name = "digest_hour", nullable = false, columnDefinition = "INT DEFAULT 8")
    private int digestHour = 8;

    /** Guards against sending more than one digest per local day. */
    @Column(name = "last_digest_on")
    private LocalDate lastDigestOn;

    /**
     * Per-feature on/off toggles, e.g. {"water":false,"food":true}. A missing
     * key means the feature is ON (opt-out model). Stored as a JSON column.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "feature_prefs", columnDefinition = "json")
    private Map<String, Boolean> featurePrefs;

    /**
     * Ordered home-screen layout: which widgets show and in what order, e.g.
     * [{"id":"score","enabled":true},{"id":"tasks","enabled":false}]. Null means
     * "use the default layout". Stored as a JSON column.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "home_layout", columnDefinition = "json")
    private List<HomeLayoutItem> homeLayout;

    /**
     * Ordered bottom-navigation layout: which destinations sit in the primary
     * bar vs the "More" sheet, and in what order, e.g.
     * [{"id":"home","primary":true},{"id":"money","primary":false}]. Null means
     * "use the default layout". Stored as a JSON column.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "nav_layout", columnDefinition = "json")
    private List<NavLayoutItem> navLayout;

    /**
     * Client UI state that should follow the user across devices: theme,
     * quick-add voice language, the onboarding-dismissed flag, and the set of
     * already-celebrated achievement ids. Free-form JSON — the client owns the
     * shape. Stored as a JSON column. ponytail: one blob, like feature_prefs.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ui_prefs", columnDefinition = "json")
    private Map<String, Object> uiPrefs;

    @Column(nullable = false)
    private int level = 1;

    @Column(name = "xp_total", nullable = false)
    private int xpTotal = 0;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
