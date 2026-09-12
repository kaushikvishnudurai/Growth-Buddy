package com.growthbuddy.common;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    private static final Logger log = LoggerFactory.getLogger(WebConfig.class);

    private final CurrentUserInterceptor currentUserInterceptor;
    private final RateLimitInterceptor   rateLimitInterceptor;
    private final AiRateLimitInterceptor aiRateLimitInterceptor;
    private final String allowedOrigins;

    public WebConfig(CurrentUserInterceptor currentUserInterceptor,
                     RateLimitInterceptor rateLimitInterceptor,
                     AiRateLimitInterceptor aiRateLimitInterceptor,
                     @Value("${growthbuddy.cors.allowed-origins}") String allowedOrigins) {
        this.currentUserInterceptor = currentUserInterceptor;
        this.rateLimitInterceptor   = rateLimitInterceptor;
        this.aiRateLimitInterceptor = aiRateLimitInterceptor;
        this.allowedOrigins         = allowedOrigins;
    }

    /** Warn loudly if the server starts with default localhost CORS origins. */
    @PostConstruct
    void warnIfDefaultCors() {
        if (allowedOrigins.contains("localhost") || allowedOrigins.contains("127.0.0.1")) {
            log.warn("[SECURITY] CORS is allowing localhost origins. "
                   + "Set CORS_ALLOWED_ORIGINS to your production frontend URL before deploying.");
        }
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(currentUserInterceptor).addPathPatterns("/api/**");
        // Rate-limit sensitive auth endpoints: 10 attempts per IP per 5 minutes.
        registry.addInterceptor(rateLimitInterceptor)
                .addPathPatterns(
                    "/api/auth/login",
                    "/api/auth/verify",
                    "/api/auth/forgot-password",
                    "/api/auth/reset-password",
                    "/api/auth/resend-verification",
                    "/api/auth/whatsapp/send-otp",
                    "/api/auth/whatsapp/verify-otp"
                );
        // Per-user cap on the pricey OpenAI-backed endpoints. EVERY path that can
        // reach OpenAIClient belongs here; the four vision ones (photo-estimate,
        // photo-estimate-multi, grocery-scan, pantry/scan) were missing, which left
        // the most expensive calls in the app — a whole image per request — with no
        // ceiling at all beyond the account being logged in.
        // Still an allowlist you have to remember to extend, but no longer the only
        // thing standing between a forgotten endpoint and an unbounded bill:
        // OpenAIClient now charges every call against its own per-user budget, so a
        // path missing from this list is capped anyway. This layer stays because
        // only an interceptor can answer 429 BEFORE the handler runs, which is the
        // difference between a clean refusal and a silent fallback.
        registry.addInterceptor(aiRateLimitInterceptor)
                .addPathPatterns(
                    "/api/mentor/chat/messages",
                    "/api/quick-add",
                    "/api/money/advice",
                    "/api/auth/nutrition-suggestion",
                    "/api/food/photo-estimate",
                    "/api/food/photo-estimate-multi",
                    "/api/food/entries",
                    "/api/family/grocery-scan",
                    "/api/family/pantry/scan",
                    "/api/family/meal-plan",
                    "/api/family/meal-plan/multi",
                    "/api/family/shopping/generate"
                );
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(parseAllowedOrigins())
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*");
    }

    /**
     * Serve the frontend. A built {@code dist/} is preferred and, when present, is
     * the only thing served: its filenames are content-hashed, so they can be
     * cached for a year, and it carries the service worker and PWA manifest that
     * the raw source has no equivalent of. Without a build we fall back to the
     * source tree with caching off, which is what local development wants.
     *
     * <p>Serving the bundle from the API's own origin is also what lets the
     * frontend use relative paths, which removes CORS from the deployment.
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String[] dist = existingRoots("dist/");
        if (dist.length > 0) {
            // Vite hashes every filename, so a changed file is a different URL and a
            // stale cache entry is unreachable — immutable is safe and skips revalidation.
            CacheControl immutable = CacheControl.maxAge(365, TimeUnit.DAYS).cachePublic().immutable();
            log.info("Serving the built frontend from {}", String.join(", ", dist));

            // A "/prefix/**" handler resolves only the part *after* the prefix against
            // its locations, so each prefixed handler needs the matching subdirectory —
            // pointing them all at dist/ turns /assets/x.js into a lookup for dist/x.js.
            registry.addResourceHandler("/assets/**").addResourceLocations(existingRoots("dist/assets/"))
                    .setCacheControl(immutable).resourceChain(false);
            registry.addResourceHandler("/icons/**").addResourceLocations(existingRoots("dist/icons/"))
                    .setCacheControl(immutable).resourceChain(false);

            // Root-level files Vite emits unhashed: the service worker, the manifest,
            // favicons. The SW must never be cached hard or clients pin a dead build.
            registry.addResourceHandler("/*.js", "/*.css", "/*.png", "/*.svg", "/*.ico",
                            "/*.webmanifest", "/*.woff2", "/*.json", "/*.txt")
                    .addResourceLocations(dist)
                    .setCacheControl(CacheControl.noCache()).resourceChain(false);
            return;
        }

        log.info("No dist/ build found — serving raw source (development). "
               + "Run 'npm run build' for the bundled app with offline support.");
        String[] roots = { "file:./", "file:../" };
        // Disable browser + server resource caching so JS/CSS edits are picked up immediately.
        CacheControl noStore = CacheControl.noStore();
        registry.addResourceHandler("/scripts/**").addResourceLocations(prefixed(roots, "scripts/"))
                .setCacheControl(noStore).resourceChain(false);
        registry.addResourceHandler("/styles/**").addResourceLocations(prefixed(roots, "styles/"))
                .setCacheControl(noStore).resourceChain(false);
        registry.addResourceHandler("/assets/**").addResourceLocations(prefixed(roots, "assets/"))
                .setCacheControl(noStore).resourceChain(false);
        // index.html is served by IndexController (single-file mapping).
    }

    /**
     * Resource locations are resolved lazily, so a path that does not exist yields
     * 404s rather than falling through to the next handler. Filter up front.
     */
    private static String[] existingRoots(String suffix) {
        return Arrays.stream(new String[] { "./", "../" })
                .map(root -> root + suffix)
                .filter(path -> Files.isDirectory(Paths.get(path)))
                .map(path -> "file:" + path)
                .toArray(String[]::new);
    }

    // The "/" → index.html mapping lives in IndexController so it can return
    // file bytes (Spring's resource handlers won't bind to a single file).

    private static String[] prefixed(String[] roots, String suffix) {
        String[] out = new String[roots.length];
        for (int i = 0; i < roots.length; i++) {
            out[i] = roots[i] + suffix;
        }
        return out;
    }

    /**
     * The origins the Capacitor shell serves itself from. Always allowed, rather
     * than left to {@code CORS_ALLOWED_ORIGINS}.
     *
     * <p>A native build is not a website: it loads from {@code https://localhost}
     * (Android, {@code androidScheme: "https"}) or {@code capacitor://localhost}
     * (iOS), and nothing about the deploy hints that those belong in an origins
     * list. Forget them and the app talks to nothing — with a CORS error in a
     * WebView console nobody is looking at.
     *
     * <p>Safe to pin here because this API does not authenticate with cookies. It
     * takes a bearer token the caller has to already hold, and {@code
     * allowCredentials} is off, so a page that happens to be served from
     * localhost gains nothing by being allowed to ask.
     */
    private static final String[] NATIVE_SHELL_ORIGINS = {
        "https://localhost", "capacitor://localhost", "ionic://localhost"
    };

    private String[] parseAllowedOrigins() {
        return Stream.concat(
                        Arrays.stream(allowedOrigins.split(",")).map(String::trim).filter(s -> !s.isEmpty()),
                        Arrays.stream(NATIVE_SHELL_ORIGINS))
                .distinct()
                .toArray(String[]::new);
    }
}
