package com.growthbuddy.user;

/**
 * One entry in a user's customizable bottom-navigation layout: a destination
 * id and whether it sits in the primary bar ({@code primary=true}) or behind
 * the "More" sheet ({@code primary=false}). Position within the list is the
 * display order. Stored as JSON on {@link User#getNavLayout()}; null means
 * "use the default layout".
 */
public record NavLayoutItem(String id, boolean primary) {
}
