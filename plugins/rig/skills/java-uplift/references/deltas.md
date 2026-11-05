# Java and Spring uplift delta catalog

Each row is a breaking change between versions, the trigger that finds it in the code, how it can change the
observation surface, and the generator that reaches it. The `version-delta-analyst` sweeps for every trigger and
records hits in `DELTA_CATALOG.md`. Ids are stable: `hazard:<id>`.

## Spring Boot 2.7 to 3.x (Spring Framework 6)

| Id | Trigger | What can change | Generator |
|---|---|---|---|
| `boot3-trailing-slash` | Any `@RequestMapping`/`@GetMapping`/… | Boot 3 no longer matches `/owners/` to `/owners` (404 instead of the page) | Every route requested with and without a trailing slash |
| `boot3-javax-jakarta` | `import javax.persistence`, `javax.validation`, `javax.servlet`, `javax.annotation` | Compile only, but a missed import silently drops validation (an annotation from the wrong package is ignored) | Every validated form field submitted empty, too long and malformed |
| `boot3-validation-messages` | `@NotEmpty`, `@NotBlank`, `@Size`, `@Digits`, custom `Validator` | Default message texts and interpolation changed in Hibernate Validator 8 | Each constraint violated, one at a time and all together |
| `boot3-hibernate6-ids` | `@GeneratedValue`, `IDENTITY`/`AUTO`/`SEQUENCE` | Hibernate 6 defaults AUTO to a sequence, so new ids differ (visible in redirects such as `/owners/11`) | Create entities after the seed data; check the ids in redirects and pages |
| `boot3-hibernate6-queries` | JPQL or `@Query` with `LIKE`, implicit joins, `fetch join` with paging, `count` queries | Result order, duplicates and case sensitivity of `LIKE` | Searches that match several rows, several rows that compare equal, mixed-case input |
| `boot3-hibernate6-types` | `java.util.Date`, `LocalDate`, enums, `@Lob`, `boolean` columns | Column mapping and conversion | Boundary dates, null dates, every enum value |
| `boot3-thymeleaf31` | `#request`, `#response`, `#session`, `#servletContext` in templates; `th:replace`/`th:insert` without `~{}` | Expressions removed in 3.1 render nothing or fail | Every page that uses them |
| `boot3-properties` | `application.properties` keys renamed or removed (`spring.datasource.initialization-mode`, `spring.jpa.*`, `server.max-http-header-size`, `management.*`) | Silently ignored settings change behaviour, for example the schema and data scripts no longer run | Start up with each profile; list the tables and seed rows |
| `boot3-sql-init` | `schema.sql`, `data.sql`, `spring.sql.init.*`, `spring.jpa.defer-datasource-initialization` | Order of schema creation and data loading | The first request after start-up on each profile |
| `boot3-error-page` | `server.error.*`, `ErrorController`, a template named `error` | Error page content and status codes (`/error` attributes, the whitelabel page) | A missing id, a type mismatch (`/owners/abc`), an exception path |
| `boot3-webjars` | `webjars` dependencies and `/webjars/**` in templates | A version bump changes asset URLs in every page | Every page's head and script tags |
| `boot3-actuator` | `spring-boot-starter-actuator`, `management.endpoints.*` | Exposed endpoints and their JSON shapes | `GET` every actuator path |
| `boot3-caching` | `@Cacheable`, `spring.cache.*`, JCache or Caffeine config | Cache key generation and the provider set-up | The same request twice, before and after a write |
| `boot3-jackson` | JSON endpoints, `@JsonFormat`, date serialization | Default date formats and null handling | Every JSON route with dates and nulls |

## Java 8 to 21

| Id | Trigger | What can change | Generator |
|---|---|---|---|
| `java-default-charset` | `new String(bytes)`, `getBytes()`, `FileReader`, `InputStreamReader` without a charset | JEP 400: the default is UTF-8 everywhere | Non-ASCII input (é, ß, Ω, emoji) through every text path |
| `java-cldr-locale` | `DateFormat`, `SimpleDateFormat`, `DateTimeFormatter.ofLocalizedDate`, `NumberFormat`, `String.format` with a locale | CLDR became the default locale data (JDK 9), which changes month names, separators and the `yyyy`/`YYYY` week-year behaviour | Every formatted date and number, in the locales the app uses, at year ends |
| `java-hashmap-order` | Iterating `HashMap`/`HashSet` to build visible output | Iteration order is unspecified and can change between JDK versions | Collections with several entries rendered on a page |
| `java-removed-apis` | `sun.*`, `javax.xml.bind`, `javax.activation`, `Thread.stop`, `SecurityManager`, Nashorn | They no longer compile or run | A build on the target, plus each path that used them |
| `java-reflection-access` | `setAccessible`, deep reflection by libraries | Strong encapsulation (JDK 16) makes it fail at run time | The paths that trigger the library at start-up and on first use |
| `java-float-strictfp` | `float`/`double` arithmetic shown to users | JEP 306: always strict, so rare last-digit differences | The formulas with values near representation limits |
| `java-time-precision` | `Instant.now()`, `LocalDateTime.now()` shown or stored | Clock precision went from milliseconds to microseconds (JDK 15 on some OSes) | Records created and displayed with timestamps |
