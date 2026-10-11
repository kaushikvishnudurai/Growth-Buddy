package com.growthbuddy.config;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Valid;
import java.lang.annotation.Annotation;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * CRB-4: a {@code @RequestBody} whose DTO carries bean-validation constraints
 * but lacks {@code @Valid} never runs them — a 5,000-char habit note was stored
 * past its 2,000 cap, and a push subscribe without keys was a 500. Every such
 * parameter must say {@code @Valid}.
 */
class RequestBodyValidCoverageTest {

    @Test
    void everyConstrainedRequestBodyIsValidated() throws Exception {
        var scan = new ClassPathScanningCandidateComponentProvider(false);
        scan.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        List<String> missing = new ArrayList<>();
        for (var bd : scan.findCandidateComponents("com.growthbuddy")) {
            Class<?> c = Class.forName(bd.getBeanClassName());
            for (Method m : c.getDeclaredMethods()) {
                for (Parameter p : m.getParameters()) {
                    if (p.isAnnotationPresent(RequestBody.class) && !p.isAnnotationPresent(Valid.class)
                            && constrained(p.getType())) {
                        missing.add(c.getSimpleName() + "." + m.getName() + "(" + p.getType().getSimpleName() + ")");
                    }
                }
            }
        }
        assertThat(missing).as("@RequestBody without @Valid").isEmpty();
    }

    private static boolean constrained(Class<?> type) {
        if (!type.getName().startsWith("com.growthbuddy")) return false;
        for (Field f : type.getDeclaredFields()) {
            for (Annotation a : f.getAnnotations()) {
                if (a.annotationType().getName().startsWith("jakarta.validation.constraints")
                        || a.annotationType() == Valid.class) {
                    return true;
                }
            }
        }
        return false;
    }
}
