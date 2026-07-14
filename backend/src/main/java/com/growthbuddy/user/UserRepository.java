package com.growthbuddy.user;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, UUID> {
    boolean existsByEmail(String email);

    /** Users who opted into a progress digest (frequency other than "off"). */
    List<User> findByDigestFrequencyNot(String frequency);

    Optional<User> findByEmailIgnoreCase(String email);

    @Query("select u from User u where (lower(u.displayName) like lower(concat('%', :q, '%')) "
            + "or lower(u.email) like lower(concat('%', :q, '%'))) and u.id <> :excludeId "
            + "order by u.displayName")
    List<User> search(@Param("q") String q, @Param("excludeId") UUID excludeId, Pageable pageable);

    @Query("select u from User u where u.id <> :excludeId order by u.createdAt desc")
    List<User> browseExcluding(@Param("excludeId") UUID excludeId, Pageable pageable);

    /**
     * Same signature as before the UUID migration: {@code q} is free text; when
     * it happens to be a well-formed UUID we also match on the id column.
     */
    default List<User> searchForFamily(String q, UUID excludeId, Pageable pageable) {
        UUID idMatch = null;
        try {
            idMatch = UUID.fromString(q);
        } catch (IllegalArgumentException ignored) {
            // q is a name/email/phone fragment, not an id
        }
        return searchForFamily(q, idMatch, excludeId, pageable);
    }

    @Query("select u from User u where (u.id = :idMatch "
            + "or lower(u.displayName) like lower(concat('%', :q, '%')) "
            + "or lower(u.email) like lower(concat('%', :q, '%')) "
            + "or u.whatsappNumber like concat('%', :q, '%')) and u.id <> :excludeId "
            + "order by u.displayName")
    List<User> searchForFamily(@Param("q") String q, @Param("idMatch") UUID idMatch,
            @Param("excludeId") UUID excludeId, Pageable pageable);
}
