package com.growthbuddy.common;

import java.time.Instant;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** Uniform error body returned for every handled exception. */
    public record ApiError(Instant timestamp, int status, String error, String message) {
        static ApiError of(HttpStatus status, String message) {
            return new ApiError(Instant.now(), status.value(), status.getReasonPhrase(), message);
        }
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiError> handleApi(ApiException ex) {
        return ResponseEntity.status(ex.getStatus()).body(ApiError.of(ex.getStatus(), ex.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(f -> humanMessage(f.getField(), f.getCode(), f.getDefaultMessage()))
                .distinct()
                .collect(Collectors.joining(" "));
        return ResponseEntity.badRequest().body(ApiError.of(HttpStatus.BAD_REQUEST, message));
    }

    /**
     * This text reaches the user as-is, so "weightKg must be less than or equal
     * to 400" becomes "Weight (kg) must be 400 or less." One place for every DTO,
     * rather than a message= on each of a few hundred annotations.
     */
    static String humanMessage(String field, String code, String defaultMessage) {
        if ("Email".equals(code)) return "Enter a valid email address.";
        String m = defaultMessage == null ? "is not valid" : defaultMessage
                .replaceFirst("^must be less than or equal to (\\S+)$", "must be $1 or less")
                .replaceFirst("^must be greater than or equal to (\\S+)$", "must be at least $1")
                .replaceFirst("^size must be between 0 and (\\d+)$", "is too long (at most $1)")
                .replaceFirst("^size must be between (\\d+) and (\\d+)$", "must be between $1 and $2 long")
                .replaceFirst("^must not be (blank|null|empty)$", "is required");
        return fieldLabel(field) + " " + m + ".";
    }

    /** "profile.weightKg" → "Weight (kg)", "displayName" → "Display name". */
    static String fieldLabel(String field) {
        String leaf = field.substring(field.lastIndexOf('.') + 1).replaceAll("\\[\\d*]", "");
        String unit = "";
        java.util.regex.Matcher u = java.util.regex.Pattern.compile("(?<=[a-z])(Kg|Cm|Ml|Kcal|Min|Mins)$").matcher(leaf);
        if (u.find()) {
            unit = " (" + u.group(1).toLowerCase() + ")";
            leaf = leaf.substring(0, u.start());
        }
        String words = leaf.replaceAll("([a-z0-9])([A-Z])", "$1 $2").toLowerCase();
        if (words.isEmpty()) return "This field";
        return Character.toUpperCase(words.charAt(0)) + words.substring(1) + unit;
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiError> handleMissingStatic(NoResourceFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiError.of(HttpStatus.NOT_FOUND, "Oops, " + ex.getResourcePath() + " took a coffee break."));
    }

    /**
     * Standard Spring MVC exceptions (wrong HTTP method, unsupported or unacceptable
     * media type, malformed or missing body, bad param type, etc.) each carry their
     * own proper 4xx status via {@link ErrorResponse}. Honor it instead of letting
     * them fall through to the catch-all and masquerade as a 500.
     */
    @ExceptionHandler({
        org.springframework.web.HttpRequestMethodNotSupportedException.class,
        org.springframework.web.HttpMediaTypeNotSupportedException.class,
        org.springframework.web.HttpMediaTypeNotAcceptableException.class,
        org.springframework.http.converter.HttpMessageNotReadableException.class,
        org.springframework.web.bind.MissingServletRequestParameterException.class,
        org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
        org.springframework.web.ErrorResponseException.class,
    })
    public ResponseEntity<ApiError> handleSpringWebError(Exception ex) {
        // Param is typed Exception (a Throwable) so Spring can bind it; the listed
        // exceptions all implement ErrorResponse, which carries the real status.
        HttpStatusCode code = (ex instanceof ErrorResponse er)
                ? er.getStatusCode()
                : HttpStatus.BAD_REQUEST;
        HttpStatus status = HttpStatus.resolve(code.value());
        if (status == null) {
            status = HttpStatus.BAD_REQUEST;
        }
        // The reason phrase is all the client gets, on purpose: Jackson's message
        // names DTO classes and enum constants, which is internal shape. But it was
        // all ANYONE got — this branch swallowed the cause without logging it, so an
        // unknown enum value or a trailing comma came back as a bare "Bad Request"
        // with no trace on either side and nothing to debug from. Log the cause.
        log.warn("Rejected request: {}: {}", ex.getClass().getSimpleName(), rootMessage(ex));
        return ResponseEntity.status(status).body(ApiError.of(status, status.getReasonPhrase()));
    }

    /** Jackson nests the useful detail (which field, which value) in the cause. */
    private static String rootMessage(Throwable ex) {
        Throwable t = ex;
        while (t.getCause() != null && t.getCause() != t) {
            t = t.getCause();
        }
        return t.getMessage();
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleOther(Exception ex) {
        // Never surface the raw exception message to the client — it can leak
        // SQL/table names, upstream API detail, or stack internals. Log it here,
        // return a generic message to the caller.
        log.error("Unhandled exception", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiError.of(HttpStatus.INTERNAL_SERVER_ERROR, "Something went wrong. Please try again."));
    }
}
