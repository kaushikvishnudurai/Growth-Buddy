package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.annotation.Configuration;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockServletContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.config.annotation.ContentNegotiationConfigurer;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * The files a crawler, a link-preview bot or a store reviewer fetches without
 * the service worker must come back 200 from a built dist/ with a content type
 * the client accepts. privacy.html used to 404 in production: the root handler
 * listed extensions, and *.html was not one of them.
 */
class FrontendFilesTest {

    @TempDir
    static Path dist;

    private static AnnotationConfigWebApplicationContext ctx;
    private static MockMvc mvc;

    @Configuration
    @EnableWebMvc
    static class Served implements WebMvcConfigurer {
        @Override
        public void configureContentNegotiation(ContentNegotiationConfigurer configurer) {
            WebConfig.mediaTypes(configurer);
        }

        @Override
        public void addResourceHandlers(ResourceHandlerRegistry registry) {
            WebConfig.serveBuild(registry, new String[] { dist.toUri().toString() });
        }
    }

    @BeforeAll
    static void build() throws Exception {
        Files.createDirectories(dist.resolve("assets"));
        Files.createDirectories(dist.resolve("icons"));
        Files.createDirectories(dist.resolve("splash"));
        Files.createDirectories(dist.resolve("screenshots"));
        for (String f : new String[] {
                "robots.txt", "sitemap.xml", "privacy.html", "favicon.ico", "favicon-32.png",
                "og-image.png", "manifest.webmanifest", "sw.js", "assets/index-abc.js",
                "icons/badge-96.png", "splash/1179x2556.png", "screenshots/home-wide.jpg" }) {
            Files.writeString(dist.resolve(f), "x");
        }
        ctx = new AnnotationConfigWebApplicationContext();
        ctx.setServletContext(new MockServletContext());
        ctx.register(Served.class);
        ctx.refresh();
        mvc = MockMvcBuilders.webAppContextSetup(ctx).build();
    }

    @AfterAll
    static void close() {
        ctx.close();
    }

    private static MockHttpServletResponse fetch(String path) throws Exception {
        return mvc.perform(get(path)).andReturn().getResponse();
    }

    private static void served(String path, String type) throws Exception {
        MockHttpServletResponse res = fetch(path);
        assertThat(res.getStatus()).as(path).isEqualTo(200);
        assertThat(res.getContentType()).as(path).startsWith(type);
    }

    @Test
    void crawlerAndPreviewFilesAreServed() throws Exception {
        served("/robots.txt", "text/plain");
        served("/sitemap.xml", "application/xml");
        served("/privacy.html", "text/html");
        served("/favicon.ico", "image/");
        served("/og-image.png", "image/png");
    }

    @Test
    void pwaFilesAreServed() throws Exception {
        served("/manifest.webmanifest", "application/manifest+json");
        served("/sw.js", "text/javascript");
        served("/icons/badge-96.png", "image/png");
        served("/splash/1179x2556.png", "image/png");
        served("/screenshots/home-wide.jpg", "image/jpeg");
    }

    @Test
    void hashedAssetsAreImmutableAndTheRestRevalidate() throws Exception {
        assertThat(fetch("/assets/index-abc.js").getHeader("Cache-Control")).contains("immutable");
        assertThat(fetch("/sw.js").getHeader("Cache-Control")).isEqualTo("no-cache");
    }

    @Test
    void aMissingFileIsStillA404() throws Exception {
        assertThat(fetch("/nope.html").getStatus()).isEqualTo(404);
    }
}
