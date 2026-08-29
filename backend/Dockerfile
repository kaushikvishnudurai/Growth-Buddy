# Build and run the Spring Boot API. Build from the repo root so the context
# includes tableCreationQueries.sql:  docker build -f backend/Dockerfile .
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
# Dependencies first: this layer is cached until pom.xml itself changes, so an
# ordinary code edit doesn't re-download the world.
COPY backend/pom.xml .
RUN mvn -q -B dependency:go-offline
COPY backend/src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
# Unprivileged: nothing here needs root, and the app writes no files.
RUN useradd --create-home --shell /usr/sbin/nologin app
COPY --from=build /src/target/*.jar app.jar
USER app
EXPOSE 8080

# The profile is not passed at runtime on purpose. Every guard in the codebase
# (SessionService, MailService, DataSeeder, AuthService) keys off this string,
# and forgetting it on a deploy silently disarms all four at once — so the
# image is prod-only and the runtime cannot omit it.
ENV SPRING_PROFILES_ACTIVE=prod

# Container memory is the limit, not the host's. Without this the JVM sizes its
# heap from the machine and gets OOM-killed by the orchestrator.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75"

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
