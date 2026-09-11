# Build and run the whole app: the Spring API plus the built frontend it serves.
# Build from the repo root so the context includes the web sources:
#   docker build -f backend/Dockerfile -t growth-buddy .
FROM node:22-slim AS web
WORKDIR /web
# Dependencies first so an ordinary source edit doesn't re-run npm ci.
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY scripts ./scripts
COPY styles ./styles
COPY public ./public
# Empty on purpose: the API serves this bundle, so relative paths are correct and
# CORS never enters into it. An *absent* VITE_API_BASE is what the app rejects at
# startup — set-but-empty is the same-origin answer. Override at build time
# (--build-arg) only if you host the frontend somewhere else.
ARG VITE_API_BASE=""
RUN VITE_API_BASE="$VITE_API_BASE" npm run build

FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
# Same trick: this layer is cached until pom.xml itself changes.
COPY backend/pom.xml .
RUN mvn -q -B dependency:go-offline
COPY backend/src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
# Unprivileged: nothing here needs root, and the app writes no files.
RUN useradd --create-home --shell /usr/sbin/nologin app
COPY --from=build /src/target/*.jar app.jar
# WebConfig prefers ./dist over the raw source tree, and serves its hashed assets
# with a one-year immutable cache.
COPY --from=web /web/dist ./dist
USER app
EXPOSE 8080

# The profile is not passed at runtime on purpose. Every guard in the codebase
# (SessionService, MailService, DataSeeder, AuthService) keys off this string,
# and forgetting it on a deploy silently disarms all four at once — so the
# image is prod-only and the runtime cannot omit it.
ENV SPRING_PROFILES_ACTIVE=prod

# Container memory is the limit, not the host's. Without this the JVM sizes its
# heap from the machine and gets OOM-killed by the orchestrator.
#
# 40%, not 75%: the target is a 512MB instance, and the heap is only one of the
# things that has to fit. Spring + JPA with 44 entities settles around 130MB of
# class metadata, and metaspace grows from native memory the heap has already
# claimed. At 75% (384MB heap) the first email send is where it breaks — sending
# lazily loads java.net.http's whole TLS/selector stack, metaspace can't commit,
# and signup dies with OutOfMemoryError: Metaspace while the app otherwise looks
# healthy. Capping metaspace does not fix that; leaving it room does.
#
# SerialGC because G1's bookkeeping isn't worth it at this size, 512k stacks
# because Tomcat's worker threads don't recurse, and ExitOnOutOfMemoryError
# because a JVM that has hit OOM is wedged — every later request fails the same
# way — and a restart is the only thing that helps.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=40 -XX:+UseSerialGC -Xss512k -XX:+ExitOnOutOfMemoryError"

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
