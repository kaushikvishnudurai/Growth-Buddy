package com.growthbuddy.quote;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "quotes")
@Getter
@Setter
@NoArgsConstructor
public class Quote {

    @Id
    private UUID id;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String body;

    @Column(length = 120)
    private String author;

    public Quote(String body, String author) {
        this.body = body;
        this.author = author;
    }

    @PrePersist
    void prePersist() {
        if (id == null) {
            id = UUID.randomUUID();
        }
    }
}
