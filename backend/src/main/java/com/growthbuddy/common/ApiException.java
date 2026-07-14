package com.growthbuddy.common;

import org.springframework.http.HttpStatus;

/** Thrown by services/controllers to return a specific HTTP status with a message. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;

    public ApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
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
}
