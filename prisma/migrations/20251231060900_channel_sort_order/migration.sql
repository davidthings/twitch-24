-- AlterTable
ALTER TABLE "TwitchChannel" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) - 1) AS rn
  FROM "TwitchChannel"
)
UPDATE "TwitchChannel" t
SET "sortOrder" = o.rn
FROM ordered o
WHERE t.id = o.id;

CREATE INDEX "TwitchChannel_sortOrder_idx" ON "TwitchChannel"("sortOrder");
