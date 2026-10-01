-- Create Prisma's migration tracking table and mark our migration as applied
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36)  NOT NULL PRIMARY KEY,
    "checksum"              VARCHAR(64)  NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER      NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count")
VALUES (
    gen_random_uuid()::varchar,
    'manual_apply',
    '20250619_init',
    now(),
    1
);
