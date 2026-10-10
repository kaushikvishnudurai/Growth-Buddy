package com.growthbuddy.common;

import org.springframework.http.HttpStatus;

/** Thrown by services/controllers to return a specific HTTP status with a message. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    /** Optional machine-readable reason for the client to branch on (e.g. "totp_required"). */
    private final String code;

    public ApiException(HttpStatus status, String message) {
        this(status, message, null);
    }

    public ApiException(HttpStatus status, String message, String code) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public static ApiException notFound(String what) {
        return new ApiException(HttpStatus.NOT_FOUND, "Oops, " + what + " wandered off for a snack. Try again.");
    }

    public static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, message);
    }

    public static ApiException forbidden(String message) {
        return new ApiException(HttpStatus.FORBIDDEN, message);
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}
