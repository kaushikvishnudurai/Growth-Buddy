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
import java.util.Arrays;

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
        // Per-user cap on the pricey OpenAI-backed endpoints.
        registry.addInterceptor(aiRateLimitInterceptor)
                .addPathPatterns(
                    "/api/mentor/chat/messages",
                    "/api/quick-add",
                    "/api/money/advice",
                    "/api/auth/nutrition-suggestion"
                );
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(parseAllowedOrigins())
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*");
    }

    /** Serve the static frontend (index.html, scripts/, styles/, assets/) from the repo root. */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
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

    // The "/" → index.html mapping lives in IndexController so it can return
    // file bytes (Spring's resource handlers won't bind to a single file).

    private static String[] prefixed(String[] roots, String suffix) {
        String[] out = new String[roots.length];
        for (int i = 0; i < roots.length; i++) {
            out[i] = roots[i] + suffix;
        }
        return out;
    }

    private String[] parseAllowedOrigins() {
        return Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toArray(String[]::new);
    }
}
