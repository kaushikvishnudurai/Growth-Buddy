package com.growthbuddy.family;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.family.FamilyService.ShoppingCandidate;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.reminder.ReminderService;
import com.growthbuddy.reminder.RepeatFreq;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * The household access matrix (invited is not mapped), the invite lifecycle —
 * including the solo owner who used to be stuck — leave / transfer rules, and
 * the shopping-list dedupe. Repositories are mocks: no database.
 */
class FamilyServiceTest {

    private static final UUID OWNER = UUID.randomUUID();
    private static final UUID PARTNER = UUID.randomUUID();
    private static final UUID INVITEE = UUID.randomUUID();

    private final FamilyRepository families = mock(FamilyRepository.class);
    private final FamilyMemberRepository members = mock(FamilyMemberRepository.class);
    private final FamilyMealPlanRepository plans = mock(FamilyMealPlanRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final OpenAIClient openai = mock(OpenAIClient.class);
    private final FamilyFavouriteMenuRepository favourites = mock(FamilyFavouriteMenuRepository.class);
    private final FamilyMultiDayPlanRepository multiDay = mock(FamilyMultiDayPlanRepository.class);
    private final FamilyPantryItemRepository pantry = mock(FamilyPantryItemRepository.class);
    private final FamilyShoppingItemRepository shopping = mock(FamilyShoppingItemRepository.class);
    private final FamilyDishPreferenceRepository dishPrefs = mock(FamilyDishPreferenceRepository.class);
    private final UserClock clock = mock(UserClock.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final FamilyEvents events = mock(FamilyEvents.class);
    private final FamilyChoreRepository chores = mock(FamilyChoreRepository.class);
    private final FamilyRecipeRepository recipes = mock(FamilyRecipeRepository.class);
    private final ReminderService reminders = mock(ReminderService.class);
    private final RateLimiter limiter = allowAll();
    private final FamilyService service = new FamilyService(families, members, plans, users, openai,
            favourites, multiDay, pantry, shopping, dishPrefs, clock, notifications, events, chores, recipes, reminders,
            limiter);

    private static RateLimiter allowAll() {
        RateLimiter l = mock(RateLimiter.class);
        org.mockito.Mockito.lenient().when(l.allow(anyString(), org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyLong()))
                .thenReturn(true);
        return l;
    }

    private Family family(UUID owner) {
        Family f = new Family();
        f.setId(UUID.randomUUID());
        f.setOwnerUserId(owner);
        when(families.findById(f.getId())).thenReturn(Optional.of(f));
        return f;
    }

    private FamilyMember row(Family f, UUID linked, MemberStatus status, Relationship rel) {
        FamilyMember m = new FamilyMember();
        m.setId(UUID.randomUUID());
        m.setFamilyId(f.getId());
        m.setLinkedUserId(linked);
        m.setStatus(status);
        m.setRelationship(rel);
        m.setName("Someone");
        when(members.findById(m.getId())).thenReturn(Optional.of(m));
        return m;
    }

    /** Wire currentFamily(user) → f through the user's mapped row. */
    private void livesIn(UUID user, FamilyMember mappedRow) {
        when(members.findByLinkedUserIdAndStatusAndDeletedAtIsNull(user, MemberStatus.mapped))
                .thenReturn(List.of(mappedRow));
    }

    private void roster(Family f, FamilyMember... rows) {
        when(members.findByFamilyIdAndDeletedAtIsNullOrderByCreatedAtAsc(f.getId()))
                .thenReturn(new ArrayList<>(List.of(rows)));
    }

    private static FoodProfile profile() {
        return new FoodProfile(List.of(), List.of(), "Vegetarian", List.of(), List.of(), List.of());
    }

    private static void assertForbidden(Runnable call) {
        assertThatThrownBy(call::run).isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    /* ---- access matrix ---- */

    /** The regression: an invited row names the invitee, and that used to be enough to edit it. */
    @Test
    void anInviteeCannotEditTheirSlotBeforeAccepting() {
        Family f = family(OWNER);
        FamilyMember slot = row(f, INVITEE, MemberStatus.invited, Relationship.spouse);
        assertForbidden(() -> service.updateProfile(INVITEE, slot.getId(), profile()));
        verify(members, never()).save(any());
    }

    @Test
    void aMappedMemberEditsTheirOwnProfile() {
        Family f = family(OWNER);
        FamilyMember mine = row(f, PARTNER, MemberStatus.mapped, Relationship.spouse);
        service.updateProfile(PARTNER, mine.getId(), profile());
        verify(members).save(mine);
    }

    @Test
    void aMappedMemberCannotEditSomeoneElse() {
        Family f = family(OWNER);
        FamilyMember kid = row(f, null, MemberStatus.unmapped, Relationship.child);
        assertForbidden(() -> service.updateProfile(PARTNER, kid.getId(), profile()));
    }

    @Test
    void theOwnerEditsAnyProfile() {
        Family f = family(OWNER);
        FamilyMember kid = row(f, null, MemberStatus.unmapped, Relationship.child);
        service.updateProfile(OWNER, kid.getId(), profile());
        verify(members).save(kid);
    }

    /* ---- invite lifecycle ---- */

    /**
     * A solo owner (a family only they are in) can now accept: their unlinked
     * profiles move over, their own row retires, and every other pending invite
     * is declined in the same go.
     */
    @Test
    void aSoloOwnerAcceptsAndBringsTheirHouseholdAlong() {
        Family target = family(OWNER);
        Family other = family(PARTNER);
        Family solo = family(INVITEE);
        FamilyMember mySelf = row(solo, INVITEE, MemberStatus.mapped, Relationship.self);
        FamilyMember myKid = row(solo, null, MemberStatus.unmapped, Relationship.child);
        roster(solo, mySelf, myKid);
        livesIn(INVITEE, mySelf);
        FamilyMember invite = row(target, INVITEE, MemberStatus.invited, Relationship.spouse);
        invite.setInviteOnly(true);
        FamilyMember otherInvite = row(other, INVITEE, MemberStatus.invited, Relationship.other);
        otherInvite.setInviteOnly(true);
        when(members.lockByLinkedUser(INVITEE)).thenReturn(List.of(mySelf, invite, otherInvite));

        service.acceptInvite(INVITEE, invite.getId());

        assertThat(invite.getStatus()).isEqualTo(MemberStatus.mapped);
        assertThat(myKid.getFamilyId()).isEqualTo(target.getId());
        assertThat(mySelf.getDeletedAt()).isNotNull();
        assertThat(otherInvite.getDeletedAt()).as("the other pending invite is declined").isNotNull();
        verify(notifications).publish(eq(OWNER), eq(NotificationKind.system), eq(NotifyCategory.people), anyString(), any(), eq(target.getId()));
    }

    /** Someone in a real household (another adult has joined) must leave it first. */
    @Test
    void someoneInAFamilyWithOthersCannotAcceptAnother() {
        Family target = family(OWNER);
        Family mine = family(INVITEE);
        FamilyMember mySelf = row(mine, INVITEE, MemberStatus.mapped, Relationship.self);
        FamilyMember partner = row(mine, PARTNER, MemberStatus.mapped, Relationship.spouse);
        roster(mine, mySelf, partner);
        livesIn(INVITEE, mySelf);
        FamilyMember invite = row(target, INVITEE, MemberStatus.invited, Relationship.other);
        when(members.lockByLinkedUser(INVITEE)).thenReturn(List.of(mySelf, invite));

        assertThatThrownBy(() -> service.acceptInvite(INVITEE, invite.getId()))
                .hasMessageContaining("already part of a family");
        assertThat(invite.getStatus()).isEqualTo(MemberStatus.invited);
    }

    /** Read off the locked rows: an invite another request already consumed is gone. */
    @Test
    void anInviteNoLongerPendingCannotBeAccepted() {
        Family target = family(OWNER);
        FamilyMember invite = row(target, INVITEE, MemberStatus.mapped, Relationship.other);
        when(members.lockByLinkedUser(INVITEE)).thenReturn(List.of(invite));
        assertThatThrownBy(() -> service.acceptInvite(INVITEE, invite.getId()))
                .hasMessageContaining("no longer available");
    }

    @Test
    void decliningRevertsASlotAndTellsTheOwner() {
        Family f = family(OWNER);
        FamilyMember slot = row(f, INVITEE, MemberStatus.invited, Relationship.spouse);
        service.declineInvite(INVITEE, slot.getId());
        assertThat(slot.getStatus()).isEqualTo(MemberStatus.unmapped);
        assertThat(slot.getLinkedUserId()).isNull();
        verify(notifications).publish(eq(OWNER), eq(NotificationKind.system), eq(NotifyCategory.people), anyString(), any(), eq(f.getId()));
    }

    /* ---- leave / remove / transfer ---- */

    @Test
    void theOwnerCannotLeaveWithoutHandingOn() {
        Family f = family(OWNER);
        FamilyMember owner = row(f, OWNER, MemberStatus.mapped, Relationship.self);
        FamilyMember partner = row(f, PARTNER, MemberStatus.mapped, Relationship.spouse);
        roster(f, owner, partner);
        livesIn(OWNER, owner);
        assertThatThrownBy(() -> service.leaveFamily(OWNER)).hasMessageContaining("owner first");
    }

    @Test
    void aMemberLeavesAndTheOwnerHears() {
        Family f = family(OWNER);
        FamilyMember partner = row(f, PARTNER, MemberStatus.mapped, Relationship.spouse);
        livesIn(PARTNER, partner);
        service.leaveFamily(PARTNER);
        assertThat(partner.getDeletedAt()).isNotNull();
        verify(notifications).publish(eq(OWNER), eq(NotificationKind.system), eq(NotifyCategory.people), anyString(), any(), eq(f.getId()));
    }

    @Test
    void ownershipGoesOnlyToSomeoneWhoHasJoined() {
        Family f = family(OWNER);
        FamilyMember owner = row(f, OWNER, MemberStatus.mapped, Relationship.self);
        FamilyMember invited = row(f, INVITEE, MemberStatus.invited, Relationship.other);
        FamilyMember partner = row(f, PARTNER, MemberStatus.mapped, Relationship.spouse);
        livesIn(OWNER, owner);
        assertThatThrownBy(() -> service.transferOwnership(OWNER, invited.getId()))
                .isInstanceOf(ApiException.class);
        service.transferOwnership(OWNER, partner.getId());
        assertThat(f.getOwnerUserId()).isEqualTo(PARTNER);
    }

    @Test
    void onlyTheOwnerTransfers() {
        Family f = family(OWNER);
        FamilyMember partner = row(f, PARTNER, MemberStatus.mapped, Relationship.spouse);
        livesIn(PARTNER, partner);
        assertForbidden(() -> service.transferOwnership(PARTNER, partner.getId()));
    }

    @Test
    void removingALinkedMemberTellsThem() {
        Family f = family(OWNER);
        FamilyMember partner = row(f, PARTNER, MemberStatus.mapped, Relationship.spouse);
        service.removeMember(OWNER, partner.getId());
        assertThat(partner.getDeletedAt()).isNotNull();
        verify(notifications).publish(eq(PARTNER), eq(NotificationKind.system), eq(NotifyCategory.people),
                org.mockito.ArgumentMatchers.contains("removed you"), any(), eq(f.getId()));
    }

    @Test
    void aMemberCannotRemoveAnyone() {
        Family f = family(OWNER);
        FamilyMember kid = row(f, null, MemberStatus.unmapped, Relationship.child);
        assertForbidden(() -> service.removeMember(PARTNER, kid.getId()));
    }

    /* ---- shopping + cooked ---- */

    @Test
    void buildingTheListTwiceAddsNothingTheSecondTime() {
        List<ShoppingCandidate> wanted = List.of(
                new ShoppingCandidate("Toor dal", "500 g", 80),
                new ShoppingCandidate("toor DAL ", null, null),
                new ShoppingCandidate("Onions", "1 kg", 40),
                new ShoppingCandidate("Curd", null, null));
        List<ShoppingCandidate> fresh = FamilyService.newShoppingLines(wanted, List.of("ONIONS"), List.of("curd"));
        assertThat(fresh).extracting(ShoppingCandidate::name).containsExactly("Toor dal");
        assertThat(FamilyService.newShoppingLines(fresh, List.of("Toor dal"), List.of())).isEmpty();
    }

    /** No AI gateway: the list comes from the dishes, not from nothing. */
    @Test
    void theNoAiListComesFromTheDishes() {
        assertThat(FamilyService.fallbackShopping(List.of("Tomato rasam", "Idli")))
                .extracting(ShoppingCandidate::name)
                .contains("Toor dal", "Tamarind", "Idli rice", "Urad dal");
        assertThat(FamilyService.fallbackShopping(List.of("Something unheard of"))).isEmpty();
    }

    @Test
    void cookedCountsOncePerPlan() {
        Family f = family(OWNER);
        FamilyMember owner = row(f, OWNER, MemberStatus.mapped, Relationship.self);
        livesIn(OWNER, owner);
        FamilyMealPlan p = new FamilyMealPlan();
        p.setId(UUID.randomUUID());
        p.setFamilyId(f.getId());
        p.setPlanJson("{\"breakfast\":[\"Idli\"]}");
        when(plans.findById(p.getId())).thenReturn(Optional.of(p));

        service.markPlanCooked(OWNER, p.getId());
        assertThat(p.getCookedAt()).isNotNull();
        Instant first = p.getCookedAt();
        service.markPlanCooked(OWNER, p.getId());

        assertThat(p.getCookedAt()).isEqualTo(first);
        verify(dishPrefs, org.mockito.Mockito.times(1)).save(any());
    }

    @Test
    void aTickSetsRatherThanFlips() {
        Family f = family(OWNER);
        FamilyMember owner = row(f, OWNER, MemberStatus.mapped, Relationship.self);
        livesIn(OWNER, owner);
        FamilyShoppingItem item = new FamilyShoppingItem();
        item.setId(UUID.randomUUID());
        item.setFamilyId(f.getId());
        when(shopping.findById(item.getId())).thenReturn(Optional.of(item));

        service.toggleShopping(OWNER, item.getId(), true);
        service.toggleShopping(OWNER, item.getId(), true); // a replay must not untick it
        assertThat(item.isChecked()).isTrue();
        service.toggleShopping(OWNER, item.getId(), null); // old clients still flip
        assertThat(item.isChecked()).isFalse();
    }

    /* ---- chores ---- */

    /* ---- "Plan meals for just me" ---- */

    @Test
    void aSoloCookGetsAHouseholdOfOneCopiedFromProfile() {
        com.growthbuddy.user.User me = new com.growthbuddy.user.User();
        me.setId(OWNER);
        me.setDisplayName("Asha");
        me.setDietPreference("Vegetarian");
        me.setHeightCm(160);
        me.setWeightKg(55);
        when(users.findById(OWNER)).thenReturn(Optional.of(me));

        service.startSolo(OWNER);

        org.mockito.ArgumentCaptor<Family> fam = org.mockito.ArgumentCaptor.forClass(Family.class);
        verify(families).save(fam.capture());
        assertThat(fam.getValue().getOwnerUserId()).isEqualTo(OWNER);
        org.mockito.ArgumentCaptor<FamilyMember> self = org.mockito.ArgumentCaptor.forClass(FamilyMember.class);
        verify(members).save(self.capture());
        assertThat(self.getValue().getRelationship()).isEqualTo(Relationship.self);
        assertThat(self.getValue().getStatus()).isEqualTo(MemberStatus.mapped);
        assertThat(self.getValue().getLinkedUserId()).isEqualTo(OWNER);
        assertThat(self.getValue().getName()).isEqualTo("Asha");
        assertThat(self.getValue().getDietPreference()).isEqualTo("Vegetarian");
        assertThat(self.getValue().getHeightCm()).isEqualTo(160);
    }

    @Test
    void startingSoloInsideAFamilyChangesNothing() {
        Family f = family(OWNER);
        FamilyMember mine = row(f, OWNER, MemberStatus.mapped, Relationship.self);
        livesIn(OWNER, mine);
        roster(f, mine);

        FamilyResponse res = service.startSolo(OWNER);

        assertThat(res.familyId()).isEqualTo(f.getId());
        verify(families, never()).save(any());
        verify(members, never()).save(any());
    }

    /* ---- an account scheduled for deletion is not invitable ---- */

    @Test
    void anAccountScheduledForDeletionCannotBeInvited() {
        Family f = family(OWNER);
        livesIn(OWNER, row(f, OWNER, MemberStatus.mapped, Relationship.self));
        com.growthbuddy.user.User leaving = new com.growthbuddy.user.User();
        leaving.setId(INVITEE);
        leaving.setDeletionRequestedAt(Instant.now());
        when(users.findById(INVITEE)).thenReturn(Optional.of(leaving));

        assertThatThrownBy(() -> service.linkMember(OWNER, new LinkMemberRequest(INVITEE, null)))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
        verify(members, never()).save(any());
        verify(notifications, never()).publish(eq(INVITEE), any(), any(NotifyCategory.class), any(), any(), any());
    }

    /* ---- SEC-02: an invite carries no profile until it is accepted ---- */

    private com.growthbuddy.user.User inviteeWithProfile() {
        com.growthbuddy.user.User u = new com.growthbuddy.user.User();
        u.setId(INVITEE);
        u.setDisplayName("Invitee");
        u.setDob(LocalDate.of(1990, 5, 1));
        u.setGender("female");
        u.setHeightCm(165);
        u.setWeightKg(60);
        u.setDietPreference("Vegan");
        when(users.findById(INVITEE)).thenReturn(Optional.of(u));
        return u;
    }

    @Test
    void anInviteCopiesOnlyTheName() {
        Family f = family(OWNER);
        livesIn(OWNER, row(f, OWNER, MemberStatus.mapped, Relationship.self));
        inviteeWithProfile();

        service.linkMember(OWNER, new LinkMemberRequest(INVITEE, null));

        var saved = org.mockito.ArgumentCaptor.forClass(FamilyMember.class);
        verify(members).save(saved.capture());
        FamilyMember m = saved.getValue();
        assertThat(m.getName()).isEqualTo("Invitee");
        assertThat(m.getStatus()).isEqualTo(MemberStatus.invited);
        assertThat(m.getDob()).isNull();
        assertThat(m.getGender()).isNull();
        assertThat(m.getHeightCm()).isNull();
        assertThat(m.getWeightKg()).isNull();
        assertThat(m.getDietPreference()).isNull();
    }

    @Test
    void acceptingCopiesTheProfileIn() {
        Family target = family(OWNER);
        inviteeWithProfile();
        FamilyMember invite = row(target, INVITEE, MemberStatus.invited, Relationship.other);
        invite.setInviteOnly(true);
        when(members.lockByLinkedUser(INVITEE)).thenReturn(List.of(invite));

        service.acceptInvite(INVITEE, invite.getId());

        assertThat(invite.getStatus()).isEqualTo(MemberStatus.mapped);
        assertThat(invite.getDob()).isEqualTo(LocalDate.of(1990, 5, 1));
        assertThat(invite.getHeightCm()).isEqualTo(165);
        assertThat(invite.getWeightKg()).isEqualTo(60);
        assertThat(invite.getGender()).isEqualTo("female");
        assertThat(invite.getDietPreference()).isEqualTo("Vegan");
    }

    /** A row invited before the fix still holds a copy; the family never sees it. */
    @Test
    void anOldInviteRowShowsNoProfile() {
        Family f = family(OWNER);
        FamilyMember owner = row(f, OWNER, MemberStatus.mapped, Relationship.self);
        livesIn(OWNER, owner);
        FamilyMember legacy = row(f, INVITEE, MemberStatus.invited, Relationship.other);
        legacy.setInviteOnly(true);
        legacy.setDob(LocalDate.of(1990, 5, 1));
        legacy.setHeightCm(165);
        legacy.setWeightKg(60);
        legacy.setGender("female");
        legacy.setDietPreference("Vegan");
        roster(f, owner, legacy);

        var row = service.getFamily(OWNER).members().stream()
                .filter(r -> r.id().equals(legacy.getId())).findFirst().orElseThrow();
        assertThat(row.dob()).isNull();
        assertThat(row.age()).isNull();
        assertThat(row.heightCm()).isNull();
        assertThat(row.weightKg()).isNull();
        assertThat(row.gender()).isNull();
        assertThat(row.profile().dietPreference()).isNull();
        assertThat(row.name()).isEqualTo("Someone");
    }

    /** ...nor is it planned for: its old profile copy never reaches the AI prompt. */
    @Test
    @SuppressWarnings("unchecked")
    void anOldInviteRowIsNotADinerInEitherPlan() throws Exception {
        Family f = family(OWNER);
        FamilyMember owner = row(f, OWNER, MemberStatus.mapped, Relationship.self);
        owner.setName("Owner Person");
        livesIn(OWNER, owner);
        FamilyMember legacy = row(f, INVITEE, MemberStatus.invited, Relationship.other);
        legacy.setInviteOnly(true);
        legacy.setName("Legacy Invitee");
        legacy.setDietPreference("Vegan");
        roster(f, owner, legacy);
        when(openai.isConfigured()).thenReturn(true);
        when(openai.complete(anyString(), any())).thenReturn("{}");

        service.generateMealPlan(OWNER, new MealPlanRequest(List.of(), List.of()));
        service.generateMultiDay(OWNER, new MultiDayPlanRequest(3, "normal", List.of(), List.of(), false));

        var turns = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(openai, org.mockito.Mockito.times(2)).complete(anyString(), turns.capture());
        for (List<?> t : turns.getAllValues()) {
            String prompt = ((OpenAIClient.ChatTurn) t.get(0)).content();
            assertThat(prompt).contains("Family members (1)").contains("Owner Person")
                    .doesNotContain("Legacy Invitee").doesNotContain("Vegan");
        }
    }

    /* ---- SEC-12: invites are capped ---- */

    @Test
    void invitesPastTheDailyCapAreRefused() {
        Family f = family(OWNER);
        livesIn(OWNER, row(f, OWNER, MemberStatus.mapped, Relationship.self));
        inviteeWithProfile();
        when(limiter.allow(org.mockito.ArgumentMatchers.startsWith("family-invite:"),
                org.mockito.ArgumentMatchers.anyInt(), org.mockito.ArgumentMatchers.anyLong())).thenReturn(false);

        assertThatThrownBy(() -> service.linkMember(OWNER, new LinkMemberRequest(INVITEE, null)))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        verify(members, never()).save(any());
        verify(notifications, never()).publish(eq(INVITEE), any(), any(NotifyCategory.class), any(), any(), any());
    }

    /* ---- SEC-06: a one-character search finds nobody ---- */

    @Test
    void aOneCharacterSearchAsksNothing() {
        assertThat(service.searchUsers(OWNER, "a")).isEmpty();
        assertThat(service.searchUsers(OWNER, " _ ")).isEmpty();
        verify(users, never()).searchForFamily(anyString(), any(UUID.class), any());
    }

    private void clockAt(LocalDate today) {
        when(clock.today(any())).thenReturn(today);
        when(clock.zoneOf(any())).thenReturn(ZoneOffset.UTC);
    }

    @Test
    void assigningAChoreToALinkedMemberNotifiesThemButNotTheAssigner() {
        clockAt(LocalDate.of(2026, 10, 10));
        Family f = family(OWNER);
        FamilyMember owner = row(f, OWNER, MemberStatus.mapped, Relationship.self);
        FamilyMember partner = row(f, PARTNER, MemberStatus.mapped, Relationship.spouse);
        livesIn(OWNER, owner);
        roster(f, owner, partner);

        service.addChore(OWNER, new ChoreRequest("Take out the bins", partner.getId(),
                LocalDate.of(2026, 10, 11), "weekly"));
        verify(notifications).publish(eq(PARTNER), eq(NotificationKind.system), eq(NotifyCategory.people),
                org.mockito.ArgumentMatchers.contains("gave you a chore: Take out the bins"),
                eq("Due 2026-10-11"), eq(f.getId()));

        service.addChore(OWNER, new ChoreRequest("Water the plants", owner.getId(), null, null));
        verify(notifications, never()).publish(eq(OWNER), any(), any(), anyString(), any(), any());
    }

    /** The reminder goes to the calendar of whoever does the chore; unassigned, to the asker's. */
    @Test
    void aChoreReminderLandsInTheAssigneesCalendar() {
        clockAt(LocalDate.of(2026, 10, 10));
        Family f = family(OWNER);
        FamilyMember owner = row(f, OWNER, MemberStatus.mapped, Relationship.self);
        FamilyMember partner = row(f, PARTNER, MemberStatus.mapped, Relationship.spouse);
        partner.setName("Asha");
        livesIn(OWNER, owner);
        roster(f, owner, partner);
        FamilyChore c = new FamilyChore();
        c.setId(UUID.randomUUID());
        c.setFamilyId(f.getId());
        c.setTitle("Take out the bins");
        c.setAssigneeMemberId(partner.getId());
        c.setDueDate(LocalDate.of(2099, 1, 1));
        c.setRepeatRule("weekly");
        when(chores.findById(c.getId())).thenReturn(Optional.of(c));

        assertThat(service.remindChore(OWNER, c.getId(), LocalTime.of(19, 0)).sentTo()).isEqualTo("Asha");
        verify(reminders).create(PARTNER, "Chore: Take out the bins", LocalDate.of(2099, 1, 1),
                LocalTime.of(19, 0), RepeatFreq.weekly);

        c.setAssigneeMemberId(null);
        assertThat(service.remindChore(OWNER, c.getId(), LocalTime.of(19, 0)).sentTo()).isNull();
        verify(reminders).create(eq(OWNER), eq("Chore: Take out the bins"), any(), eq(LocalTime.of(19, 0)),
                eq(RepeatFreq.weekly));
    }

    /** Invited is not mapped: an invitee cannot add to the chores of a family they have not joined. */
    @Test
    void anInviteeCannotAddChores() {
        Family f = family(OWNER);
        row(f, INVITEE, MemberStatus.invited, Relationship.child);
        assertThatThrownBy(() -> service.addChore(INVITEE, new ChoreRequest("Sweep", null, null, null)))
                .isInstanceOf(ApiException.class);
        verify(chores, never()).save(any());
    }

    @Test
    void anotherFamilysChoreIsNotFound() {
        clockAt(LocalDate.of(2026, 10, 10));
        Family f = family(OWNER);
        Family other = family(PARTNER);
        livesIn(PARTNER, row(other, PARTNER, MemberStatus.mapped, Relationship.self));
        FamilyChore c = new FamilyChore();
        c.setId(UUID.randomUUID());
        c.setFamilyId(f.getId());
        when(chores.findById(c.getId())).thenReturn(Optional.of(c));
        assertThatThrownBy(() -> service.toggleChore(PARTNER, c.getId(), true))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(c.getDoneAt()).isNull();
    }

    @Test
    void aChoreCannotGoToSomeoneOutsideTheFamily() {
        Family f = family(OWNER);
        Family other = family(PARTNER);
        livesIn(OWNER, row(f, OWNER, MemberStatus.mapped, Relationship.self));
        FamilyMember stranger = row(other, PARTNER, MemberStatus.mapped, Relationship.self);
        assertThatThrownBy(() -> service.addChore(OWNER, new ChoreRequest("Sweep", stranger.getId(), null, null)))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
        verify(notifications, never()).publish(any(), any(), any(), anyString(), any(), any());
    }

    /** A daily chore ticked yesterday is open again today; a one-off stays done. */
    @Test
    void aRepeatingChoreComesBack() {
        LocalDate today = LocalDate.of(2026, 10, 10);
        FamilyChore daily = new FamilyChore();
        daily.setRepeatRule("daily");
        daily.setDoneAt(Instant.parse("2026-10-09T18:00:00Z"));
        assertThat(FamilyService.choreDone(daily, today, ZoneOffset.UTC)).isFalse();
        FamilyChore weekly = new FamilyChore();
        weekly.setRepeatRule("weekly");
        weekly.setDoneAt(Instant.parse("2026-10-06T09:00:00Z"));
        assertThat(FamilyService.choreDone(weekly, today, ZoneOffset.UTC)).isTrue();
        FamilyChore once = new FamilyChore();
        once.setDoneAt(Instant.parse("2026-01-01T09:00:00Z"));
        assertThat(FamilyService.choreDone(once, today, ZoneOffset.UTC)).isTrue();
    }

    /* ---- plan history + cook ---- */

    private FamilyMealPlan plan(Family f, String json, Instant at) {
        FamilyMealPlan p = new FamilyMealPlan();
        p.setId(UUID.randomUUID());
        p.setFamilyId(f.getId());
        p.setPlanJson(json);
        p.setSource("ai");
        p.setCreatedAt(at);
        when(plans.findById(p.getId())).thenReturn(Optional.of(p));
        return p;
    }

    @Test
    void planHistoryIsNewestFirstAndUseAgainCopiesForward() {
        Family f = family(OWNER);
        livesIn(OWNER, row(f, OWNER, MemberStatus.mapped, Relationship.self));
        FamilyMealPlan older = plan(f, "{\"lunch\":[\"Curd rice\"]}", Instant.parse("2026-10-01T08:00:00Z"));
        FamilyMealPlan newer = plan(f, "{\"lunch\":[\"Pongal\"]}", Instant.parse("2026-10-09T08:00:00Z"));
        when(plans.findTop8ByFamilyIdOrderByCreatedAtDesc(f.getId())).thenReturn(List.of(newer, older));

        assertThat(service.planHistory(OWNER)).extracting(MealPlanResponse::planId)
                .containsExactly(newer.getId(), older.getId());

        service.reusePlan(OWNER, older.getId());
        org.mockito.ArgumentCaptor<FamilyMealPlan> saved = org.mockito.ArgumentCaptor.forClass(FamilyMealPlan.class);
        verify(plans).save(saved.capture());
        assertThat(saved.getValue()).isNotSameAs(older);
        assertThat(saved.getValue().getPlanJson()).isEqualTo(older.getPlanJson());
        assertThat(older.getCreatedAt()).isEqualTo(Instant.parse("2026-10-01T08:00:00Z")); // history untouched
    }

    @Test
    void theCookIsStoredOnThePlanAndTold() {
        Family f = family(OWNER);
        livesIn(OWNER, row(f, OWNER, MemberStatus.mapped, Relationship.self));
        FamilyMember partner = row(f, PARTNER, MemberStatus.mapped, Relationship.spouse);
        FamilyMealPlan p = plan(f, "{\"lunch\":[\"Pongal\"]}", Instant.now());

        MealPlanResponse r = service.assignCook(OWNER, p.getId(), new AssignCookRequest("Lunch", partner.getId(), null));
        assertThat(r.plan().path("cooks").path("lunch").asText()).isEqualTo(partner.getId().toString());
        verify(notifications).publish(eq(PARTNER), eq(NotificationKind.system), eq(NotifyCategory.people),
                org.mockito.ArgumentMatchers.contains("cook lunch"), any(), eq(f.getId()));

        service.assignCook(OWNER, p.getId(), new AssignCookRequest("lunch", null, null));
        assertThat(p.getPlanJson()).doesNotContain(partner.getId().toString());
    }

    /* ---- recipes → shopping ---- */

    @Test
    void recipeLinesParseIntoNameAndQuantity() {
        FamilyService.RecipeSplit split = FamilyService.splitByRecipe(List.of("Sambar ", "Idli"),
                java.util.Map.of("sambar", "- Toor dal: 200 g\n\nTamarind\n2) Drumstick - 2 pieces"));
        assertThat(split.fromRecipes()).extracting(ShoppingCandidate::name)
                .containsExactly("Toor dal", "Tamarind", "Drumstick");
        assertThat(split.fromRecipes()).extracting(ShoppingCandidate::quantity)
                .containsExactly("200 g", null, "2 pieces");
        assertThat(split.rest()).containsExactly("Idli");
    }

    /** A dish with a recipe shops from it, not from the built-in map; the others still use the map. */
    @Test
    void theListUsesTheFamilysRecipeBeforeTheBuiltInMap() {
        Family f = family(OWNER);
        livesIn(OWNER, row(f, OWNER, MemberStatus.mapped, Relationship.self));
        FamilyMealPlan p = plan(f, "{\"lunch\":[\"Sambar\",\"Idli\"]}", Instant.now());
        when(plans.findFirstByFamilyIdOrderByCreatedAtDesc(f.getId())).thenReturn(Optional.of(p));
        FamilyRecipe sambar = new FamilyRecipe();
        sambar.setFamilyId(f.getId());
        sambar.setDishKey("sambar");
        sambar.setDishName("Sambar");
        sambar.setIngredients("Masoor dal: 250 g\nTamarind");
        when(recipes.findByFamilyIdOrderByDishNameAsc(f.getId())).thenReturn(List.of(sambar));

        service.generateShopping(OWNER, null);

        org.mockito.ArgumentCaptor<FamilyShoppingItem> saved = org.mockito.ArgumentCaptor.forClass(FamilyShoppingItem.class);
        verify(shopping, org.mockito.Mockito.atLeastOnce()).save(saved.capture());
        assertThat(saved.getAllValues()).extracting(FamilyShoppingItem::getName)
                .contains("Masoor dal", "Tamarind", "Idli rice", "Urad dal")
                .doesNotContain("Sambar powder", "Drumstick");
        assertThat(saved.getAllValues()).filteredOn(i -> i.getName().equals("Masoor dal"))
                .extracting(FamilyShoppingItem::getQuantity).containsExactly("250 g");
    }

    /* ---- pantry → shopping ---- */

    private FamilyPantryItem pantryItem(String name, boolean low, LocalDate expiry) {
        FamilyPantryItem i = new FamilyPantryItem();
        i.setName(name);
        i.setLow(low);
        i.setExpiryDate(expiry);
        return i;
    }

    @Test
    void lowAndSoonExpiringPantryItemsGoOnTheListOnce() {
        LocalDate today = LocalDate.of(2026, 10, 10);
        clockAt(today);
        Family f = family(OWNER);
        livesIn(OWNER, row(f, OWNER, MemberStatus.mapped, Relationship.self));
        when(pantry.findByFamilyIdAndDeletedAtIsNullOrderByCreatedAtDesc(f.getId())).thenReturn(List.of(
                pantryItem("Milk", true, null),
                pantryItem("Curd", false, today.plusDays(2)),
                pantryItem("Bread", false, today.minusDays(1)),
                pantryItem("Rice", false, today.plusDays(3)),
                pantryItem("Salt", false, null)));
        FamilyShoppingItem onList = new FamilyShoppingItem();
        onList.setName("milk ");
        when(shopping.findByFamilyIdOrderByCheckedAscCreatedAtDesc(f.getId())).thenReturn(List.of(onList));

        ShoppingListResponse r = service.restockFromPantry(OWNER);

        org.mockito.ArgumentCaptor<FamilyShoppingItem> saved = org.mockito.ArgumentCaptor.forClass(FamilyShoppingItem.class);
        verify(shopping, org.mockito.Mockito.times(2)).save(saved.capture());
        assertThat(saved.getAllValues()).extracting(FamilyShoppingItem::getName).containsExactly("Curd", "Bread");
        assertThat(r.added()).isEqualTo(2);
    }

    /** Ticked = bought last time. Needed again, it re-opens rather than counting as "already on your list". */
    @Test
    void aTickedLineNeededAgainComesBackUnticked() {
        clockAt(LocalDate.of(2026, 10, 10));
        Family f = family(OWNER);
        livesIn(OWNER, row(f, OWNER, MemberStatus.mapped, Relationship.self));
        when(pantry.findByFamilyIdAndDeletedAtIsNullOrderByCreatedAtDesc(f.getId()))
                .thenReturn(List.of(pantryItem("Milk", true, null)));
        FamilyShoppingItem bought = new FamilyShoppingItem();
        bought.setName("Milk");
        bought.setChecked(true);
        when(shopping.findByFamilyIdOrderByCheckedAscCreatedAtDesc(f.getId())).thenReturn(List.of(bought));

        ShoppingListResponse r = service.restockFromPantry(OWNER);

        assertThat(bought.isChecked()).isFalse();
        verify(shopping).save(bought);
        assertThat(r.added()).isEqualTo(1);
    }

    /** The badge's window is the user's day and the same one restock adds from. */
    @Test
    void expiringSoonIsTheUsersDayAndTheRestockWindow() {
        LocalDate today = LocalDate.of(2026, 10, 10);
        assertThat(FamilyService.toPantryResponse(pantryItem("Curd", false, today.plusDays(2)), today).expiringSoon()).isTrue();
        assertThat(FamilyService.toPantryResponse(pantryItem("Rice", false, today.plusDays(3)), today).expiringSoon()).isFalse();
        assertThat(FamilyService.toPantryResponse(pantryItem("Bread", false, today.minusDays(1)), today).expired()).isTrue();
    }

    /** A saved menu becomes today's plan; the other members hear about it. */
    @Test
    void aSavedMenuGoesBackOnTheTable() {
        Family f = family(OWNER);
        livesIn(OWNER, row(f, OWNER, MemberStatus.mapped, Relationship.self));
        FamilyFavouriteMenu fav = new FamilyFavouriteMenu();
        fav.setId(UUID.randomUUID());
        fav.setFamilyId(f.getId());
        fav.setPlanJson("{\"lunch\":[\"Sambar\"]}");
        when(favourites.findById(fav.getId())).thenReturn(Optional.of(fav));

        MealPlanResponse r = service.useFavourite(OWNER, fav.getId());

        assertThat(r.plan().path("lunch").get(0).asText()).isEqualTo("Sambar");
        verify(plans).save(any(FamilyMealPlan.class));
        verify(events).changed(any(), eq("plan"));
    }
}
