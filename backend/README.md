# Growth Buddy — Backend

Spring Boot 3 (Java 17) REST API for the Growth Buddy app: calendar reminders, tasks,
habits with streaks, a daily score, quotes, an AI mentor, and growth circles.

## Stack

- Spring Boot 3.2.5 — Web, Data JPA, Validation
- MySQL 8 (via `mysql-connector-j`)
- Lombok (compile-time only)

## Prerequisites

- Java 17+ (the project targets Java 17; newer JDKs work for building)
- MySQL 8 running locally (or reachable)

## Database

The app uses Hibernate `ddl-auto: update`, so it will **create any missing tables**
(including the `calendar_reminders` table used by the reminder feature) on startup.

You have two options:

1. **Quick start (let Hibernate create everything):** just create an empty schema:
   ```sql
   CREATE DATABASE growth_buddy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
2. **Full schema:** create the database and run the canonical DDL in
   [`../tableCreationQueries.sql`](../tableCreationQueries.sql). Hibernate will leave the
   existing tables untouched and only add what's missing.

> Note: the existing `reminders` table in the SQL schema models **scheduled push
> notifications** (`entity_type`, `fire_at`, `status`). The calendar reminder feature
> uses a separate `calendar_reminders` table (+ `calendar_reminder_skips`) that
> Hibernate creates automatically.

## Configuration

All settings live in [`src/main/resources/application.yml`](src/main/resources/application.yml)
and are overridable via environment variables:

| Variable          | Default            | Purpose                              |
| ----------------- | ------------------ | ------------------------------------ |
| `DB_HOST`         | `localhost`        | MySQL host                           |
| `DB_PORT`         | `3306`             | MySQL port                           |
| `DB_NAME`         | `growth_buddy`     | Schema name                          |
| `DB_USER`         | `root`             | MySQL user                           |
| `DB_PASSWORD`     | `root`             | MySQL password                       |
| `OPENAI_API_KEY`  | _(empty)_          | LLM API key for the mentor (preferred) |
| `MENTOR_API_KEY`  | _(empty)_          | Legacy alias for mentor API key |
| `SERVER_PORT`     | `8080`             | HTTP port                            |

The server listens on `http://localhost:8080`.

## Run

```bash
# from the backend/ directory
./mvnw spring-boot:run
```

Build a runnable jar:

```bash
./mvnw clean package
java -jar target/growth-buddy-backend-0.0.1-SNAPSHOT.jar
```

On first run, a `DataSeeder` inserts a demo user, a starter set of tasks/habits, and a
handful of quotes **only when the tables are empty** (safe to re-run).

## Authentication / current user

There is no auth layer yet. Every `/api/**` request is associated with a user via the
`X-User-Id` request header. If the header is absent, the configured demo user
(`00000000-0000-0000-0000-000000000001`) is used, so the API works out of the box.

```bash
curl http://localhost:8080/api/tasks                  # uses demo user
curl -H "X-User-Id: <uuid>" http://localhost:8080/api/tasks
```

## Mentor AI

`OPENAI_API_KEY` (or legacy `MENTOR_API_KEY`) is read at startup. While it is empty, the mentor replies in an
**offline placeholder mode** (a canned coaching response) so the endpoints work without a
key. Set the key and wire the real LLM call in
[`MentorService.generateReply`](src/main/java/com/growthbuddy/mentor/MentorService.java)
(marked with a `TODO`) to enable real responses.

```bash
export OPENAI_API_KEY=sk-...
```

## REST API

All routes are prefixed with `/api`. Request/response bodies are JSON.

### Reminders — `/api/reminders`
| Method | Path                         | Description                                   |
| ------ | ---------------------------- | --------------------------------------------- |
| GET    | `/`                          | List the user's raw reminder definitions      |
| GET    | `/occurrences?from&to`       | Expanded occurrences in a date range          |
| GET    | `/day/{date}`                | Occurrences on a single day (`YYYY-MM-DD`)    |
| POST   | `/`                          | Create a reminder (text, date, time, tag, repeat, until) |
| DELETE | `/{id}?scope=&date=`         | Delete; `scope` = `all` \| `this` \| `future` \| `before` |

### Tasks — `/api/tasks`
| Method | Path             | Description              |
| ------ | ---------------- | ------------------------ |
| GET    | `/`              | List tasks               |
| POST   | `/`              | Create a task            |
| PUT    | `/{id}`          | Update a task            |
| PATCH  | `/{id}/toggle`   | Toggle done / not done   |
| DELETE | `/{id}`          | Soft-delete a task       |

### Habits — `/api/habits`
| Method | Path              | Description                          |
| ------ | ----------------- | ------------------------------------ |
| GET    | `/`               | List habits (with streak + doneToday) |
| POST   | `/`               | Create a habit                       |
| PUT    | `/{id}`           | Update a habit                       |
| POST   | `/{id}/checkin`   | Record a check-in for a date         |
| PATCH  | `/{id}/toggle`    | Toggle today's completion            |
| DELETE | `/{id}`           | Soft-delete a habit                  |

### Score — `/api/score`
| Method | Path              | Description                                  |
| ------ | ----------------- | -------------------------------------------- |
| GET    | `/today`          | Today's computed score (tasks + habits)      |
| POST   | `/today/snapshot` | Persist today's score to `daily_scores`      |

### Quotes — `/api/quotes`
| Method | Path      | Description                       |
| ------ | --------- | --------------------------------- |
| GET    | `/`       | All quotes                        |
| GET    | `/today`  | Stable quote-of-the-day           |

### Mentor — `/api/mentor/threads`
| Method | Path                       | Description                         |
| ------ | -------------------------- | ----------------------------------- |
| GET    | `/`                        | List threads                        |
| POST   | `/`                        | Create a thread                     |
| GET    | `/{threadId}/messages`     | List messages in a thread           |
| POST   | `/{threadId}/messages`     | Post a message, get the reply       |
| DELETE | `/{threadId}`              | Delete a thread                     |

### Circles — `/api/circles`
| Method | Path             | Description                       |
| ------ | ---------------- | --------------------------------- |
| GET    | `/`              | All circles (with `joined` flag)  |
| GET    | `/mine`          | Circles the user belongs to       |
| POST   | `/`              | Create a circle (creator = owner) |
| POST   | `/{id}/join`     | Join a circle                     |
| POST   | `/{id}/leave`    | Leave a circle (owner cannot)     |
| GET    | `/{id}/posts`    | List posts (members only)         |
| POST   | `/{id}/posts`    | Create a post (members only)      |

## Project layout

```
com.growthbuddy
├── GrowthBuddyApplication      # entry point
├── common                      # current-user resolution, CORS, error handling
├── config                      # DataSeeder
├── user
├── reminder                    # calendar reminders + recurrence
├── task
├── habit                       # habits, check-ins, streaks
├── score                       # daily score
├── quote
├── mentor                      # AI threads/messages (placeholder)
└── circle                      # growth circles
```
