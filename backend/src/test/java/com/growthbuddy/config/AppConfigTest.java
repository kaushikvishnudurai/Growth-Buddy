package com.growthbuddy.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.io.ClassPathResource;

/** Settings in application.yml that a finding depends on. */
class AppConfigTest {

    private static Properties yml() {
        YamlPropertiesFactoryBean f = new YamlPropertiesFactoryBean();
        f.setResources(new ClassPathResource("application.yml"));
        return f.getObject();
    }

    /* CRB-7: without it, reminder skip days were one select per reminder. */
    @Test
    void lazyCollectionsAreBatchFetched() {
        assertThat(yml().getProperty("spring.jpa.properties.hibernate.default_batch_fetch_size")).isEqualTo("100");
    }

    /* CRB-9: .env.example documents TRUST_PROXY, and nothing bound it. */
    @Test
    void trustProxyBindsTheDocumentedVariable() {
        assertThat(yml().getProperty("growthbuddy.trust-proxy")).isEqualTo("${TRUST_PROXY:false}");
    }
}
