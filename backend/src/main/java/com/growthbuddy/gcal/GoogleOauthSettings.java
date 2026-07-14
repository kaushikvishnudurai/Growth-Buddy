package com.growthbuddy.gcal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The app's Google OAuth client, entered once from Settings by whoever runs
 * the server. Single row (id = 1); env vars are the fallback when absent.
 */
@Entity
@Table(name = "google_oauth_settings")
@Getter
@Setter
@NoArgsConstructor
public class GoogleOauthSettings {

    public static final int SINGLETON_ID = 1;

    @Id
    private Integer id;

    @Column(name = "client_id", nullable = false, length = 200)
    private String clientId;

    @Column(name = "client_secret", nullable = false, length = 200)
    private String clientSecret;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
