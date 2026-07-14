package com.growthbuddy.user;

/**
 * One entry in a user's customizable home-screen layout: a widget id and
 * whether it's shown. Order within the list is the display order. Stored as
 * JSON on {@link User#getHomeLayout()}.
 */
public record HomeLayoutItem(String id, boolean enabled) {
}
