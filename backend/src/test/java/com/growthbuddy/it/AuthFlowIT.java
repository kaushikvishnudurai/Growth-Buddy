package com.growthbuddy.it;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.mail.MailService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.MountableFile;

/**
 * The whole app against a real MySQL 8 built from {@code tableCreationQueries.sql}
 * with {@code ddl-auto: none} — the prod arrangement, so an entity column the
 * schema file forgot fails here the way it would 500 in prod.
 *
 * <p>Real HTTP over a random port (not MockMvc): the encoded-path case below is
 * only meaningful when Tomcat does the decoding. OTPs are stored as bcrypt hashes
 * only, so the code is captured from the mocked {@link MailService}.
 */
@Tag("integration")
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AuthFlowIT {

    @Container
    @SuppressWarnings("resource")
    static final MySQLContainer<?> MYSQL = MySqlScripts.newContainer()
            .withCopyFileToContainer(
                    MountableFile.forHostPath(MySqlScripts.repoFile("tableCreationQueries.sql")),
                    "/docker-entrypoint-initdb.d/01-schema.sql");

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> "jdbc:mysql://" + MYSQL.getHost() + ":" + MYSQL.getMappedPort(3306)
                + "/" + MySqlScripts.DB + "?sslMode=DISABLED&allowPublicKeyRetrieval=true&serverTimezone=UTC");
        r.add("spring.datasource.username", MYSQL::getUsername);
        r.add("spring.datasource.password", MYSQL::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.mail.username", () -> "");
        r.add("growthbuddy.mail.api-key", () -> "");
    }

    private static final String PASSWORD = "correct-horse-1";

    @MockitoBean
    MailService mail;

    @Autowired
    JdbcTemplate jdbc;

    @LocalServerPort
    int port;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper json = new ObjectMapper();

    @BeforeEach
    void clearThrottles() {
        // Per-IP limit is 10 per auth route per 5 min, and every request here is
        // from 127.0.0.1; the counters live in the DB, so a clean slate is a DELETE.
        jdbc.update("DELETE FROM rate_limit_counters");
        jdbc.update("DELETE FROM login_attempts");
    }

    /* ---------------- flows ---------------- */

    @Test
    void signupVerifyLoginMeLogout() throws Exception {
        String email = freshEmail();

        Res signup = post("/api/auth/signup", body("email", email, "password", PASSWORD, "displayName", "IT User"), null);
        assertThat(signup.status).as(signup.text).isEqualTo(201);
        assertThat(signup.json.path("token").isMissingNode() || signup.json.path("token").isNull())
                .as("signup must not hand out a session before the email is verified").isTrue();

        // Right password, unverified → 403 (the frontend's cue for the code screen).
        Res early = post("/api/auth/login", body("email", email, "password", PASSWORD), null);
        assertThat(early.status).as(early.text).isEqualTo(403);

        // Wrong code is refused; the last code mailed works.
        Res wrong = post("/api/auth/verify", body("email", email, "otp", "000000"), null);
        String otp = lastOtp(email, "verification");
        if (!"000000".equals(otp)) {
            assertThat(wrong.status).as(wrong.text).isEqualTo(400);
        }
        Res verified = post("/api/auth/verify", body("email", email, "otp", otp), null);
        assertThat(verified.status).as(verified.text).isEqualTo(200);
        assertThat(verified.json.path("token").asText()).isNotBlank();

        Res login = post("/api/auth/login", body("email", email, "password", PASSWORD), null);
        assertThat(login.status).as(login.text).isEqualTo(200);
        String token = login.json.path("token").asText();
        assertThat(token).isNotBlank();

        Res me = get("/api/auth/me", token);
        assertThat(me.status).as(me.text).isEqualTo(200);
        assertThat(me.json.path("email").asText()).isEqualTo(email);

        Res logout = post("/api/auth/logout", "{}", token);
        assertThat(logout.status).as(logout.text).isEqualTo(204);
        assertThat(get("/api/auth/me", token).status).as("a logged-out token is dead").isEqualTo(401);

        // The other session (from verify) is untouched by logging out this one.
        assertThat(get("/api/auth/me", verified.json.path("token").asText()).status).isEqualTo(200);
    }

    @Test
    void wrongPasswordIsRefused() throws Exception {
        String email = verifiedUser();
        Res bad = post("/api/auth/login", body("email", email, "password", "not-the-password"), null);
        assertThat(bad.status).as(bad.text).isEqualTo(400);
        assertThat(bad.json.path("token").isMissingNode() || bad.json.path("token").isNull()).isTrue();
    }

    @Test
    void passwordResetRevokesOldSessionsAndSwapsThePassword() throws Exception {
        String email = verifiedUser();
        String oldToken = login(email, PASSWORD);

        Res forgot = post("/api/auth/forgot-password", body("email", email), null);
        assertThat(forgot.status).as(forgot.text).isEqualTo(204);
        // Unknown email answers the same (no enumeration).
        assertThat(post("/api/auth/forgot-password", body("email", freshEmail()), null).status).isEqualTo(204);

        String otp = lastOtp(email, "password reset");
        String newPassword = "battery-staple-2";
        Res reset = post("/api/auth/reset-password",
                body("email", email, "otp", otp, "password", newPassword), null);
        assertThat(reset.status).as(reset.text).isEqualTo(200);
        assertThat(reset.json.path("token").asText()).isNotBlank();

        assertThat(get("/api/auth/me", oldToken).status).as("reset must revoke existing sessions").isEqualTo(401);
        assertThat(get("/api/auth/me", reset.json.path("token").asText()).status).isEqualTo(200);
        assertThat(post("/api/auth/login", body("email", email, "password", PASSWORD), null).status)
                .as("old password").isEqualTo(400);
        assertThat(login(email, newPassword)).isNotBlank();

        // The code is single-use.
        Res again = post("/api/auth/reset-password",
                body("email", email, "otp", otp, "password", "third-password-3"), null);
        assertThat(again.status).as(again.text).isEqualTo(400);
    }

    @Test
    void deletedAccountCanNoLongerSignIn() throws Exception {
        String email = verifiedUser();
        String token = login(email, PASSWORD);

        Res wrong = post("/api/auth/delete-account", body("password", "not-the-password"), token);
        assertThat(wrong.status).as(wrong.text).isEqualTo(400);
        assertThat(login(email, PASSWORD)).as("a refused delete leaves the account alone").isNotBlank();

        Res del = post("/api/auth/delete-account", body("password", PASSWORD), token);
        assertThat(del.status).as(del.text).isBetween(200, 299);

        // Holds for an immediate purge and for a grace-period request alike:
        // once asked, the account does not hand out new sessions.
        Res after = post("/api/auth/login", body("email", email, "password", PASSWORD), null);
        assertThat(after.status).as(after.text).isGreaterThanOrEqualTo(400);
        assertThat(after.json.path("token").isMissingNode() || after.json.path("token").isNull()).isTrue();
    }

    /* ---------------- CurrentUserInterceptor ---------------- */

    @Test
    void apiRouteWithoutTokenIs401() throws Exception {
        for (String path : List.of("/api/auth/me", "/api/auth/sessions")) {
            Res r = get(path, null);
            assertThat(r.status).as(path + " " + r.text).isEqualTo(401);
        }
        assertThat(get("/api/auth/me", "not-a-real-token").status).isEqualTo(401);
    }

    @Test
    void percentEncodedApiPathIsNotLetThrough() throws Exception {
        // Tomcat decodes /%61pi to /api and Spring routes it to /api/auth/me; the
        // interceptor must not wave it through because the raw URI looks non-API.
        String email = verifiedUser();
        Res r = get("/%61pi/auth/me", null);
        assertThat(r.status).as(r.text).isNotEqualTo(200);
        assertThat(r.status).as(r.text).isIn(400, 401, 404);
        assertThat(r.text).doesNotContain(email);
    }

    /* ---------------- helpers ---------------- */

    private record Res(int status, String text, JsonNode json) {}

    private static String freshEmail() {
        return "it-" + UUID.randomUUID().toString().substring(0, 12) + "@example.com";
    }

    /** Signs up and verifies a new account; returns its email. */
    private String verifiedUser() throws Exception {
        String email = freshEmail();
        Res s = post("/api/auth/signup", body("email", email, "password", PASSWORD), null);
        assertThat(s.status).as(s.text).isEqualTo(201);
        Res v = post("/api/auth/verify", body("email", email, "otp", lastOtp(email, "verification")), null);
        assertThat(v.status).as(v.text).isEqualTo(200);
        return email;
    }

    private String login(String email, String password) throws Exception {
        Res r = post("/api/auth/login", body("email", email, "password", password), null);
        assertThat(r.status).as(r.text).isEqualTo(200);
        return r.json.path("token").asText();
    }

    private String lastOtp(String email, String purpose) {
        ArgumentCaptor<String> otp = ArgumentCaptor.forClass(String.class);
        verify(mail, atLeastOnce()).sendOtp(eq(email), any(), otp.capture(), eq(purpose));
        return otp.getValue();
    }

    private String body(String... kv) throws Exception {
        var node = json.createObjectNode();
        for (int i = 0; i < kv.length; i += 2) node.put(kv[i], kv[i + 1]);
        return json.writeValueAsString(node);
    }

    private Res post(String path, String body, String token) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(uri(path))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        return send(b, token);
    }

    private Res get(String path, String token) throws Exception {
        return send(HttpRequest.newBuilder(uri(path)).GET(), token);
    }

    /** URI.create keeps a percent-escape as typed, so /%61pi reaches Tomcat raw. */
    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private Res send(HttpRequest.Builder b, String token) throws Exception {
        if (token != null) b.header("Authorization", "Bearer " + token);
        HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
        String text = r.body() == null ? "" : r.body();
        JsonNode node;
        try {
            node = text.isBlank() ? json.createObjectNode() : json.readTree(text);
        } catch (Exception notJson) {
            node = json.createObjectNode();
        }
        return new Res(r.statusCode(), text, node);
    }
}
