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
                .map(f -> f.getField() + " " + f.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return ResponseEntity.badRequest().body(ApiError.of(HttpStatus.BAD_REQUEST, message));
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
        return ResponseEntity.status(status).body(ApiError.of(status, status.getReasonPhrase()));
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
