package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.persistence.Column;
import jakarta.validation.Validation;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

/** CRB-12: users.weight_kg is DECIMAL(5,1), and the entity was an Integer that could never hold 72.5. */
class WeightPrecisionTest {

    @Test
    void theEntityMatchesTheColumn() throws Exception {
        var f = User.class.getDeclaredField("weightKg");
        assertThat(f.getType()).isEqualTo(BigDecimal.class);
        assertThat(f.getAnnotation(Column.class).scale()).isEqualTo(1);
    }

    @Test
    void aTenthOfAKiloIsAcceptedAndAHundredthIsNot() {
        var v = Validation.buildDefaultValidatorFactory().getValidator();
        assertThat(v.validate(profile(new BigDecimal("72.5")))).isEmpty();
        assertThat(v.validate(profile(new BigDecimal("72.55")))).isNotEmpty();
        assertThat(v.validate(profile(new BigDecimal("24.9")))).isNotEmpty();
    }

    private static UpdateProfileRequest profile(BigDecimal kg) {
        var ctor = UpdateProfileRequest.class.getDeclaredConstructors()[0];
        Object[] args = new Object[ctor.getParameterCount()];
        var params = ctor.getParameters();
        for (int i = 0; i < args.length; i++) {
            if (params[i].getName().equals("weightKg")) args[i] = kg;
            else if (params[i].getType() == boolean.class) args[i] = false;
        }
        try {
            return (UpdateProfileRequest) ctor.newInstance(args);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }
}
