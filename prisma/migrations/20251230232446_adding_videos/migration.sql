-- AlterTable
ALTER TABLE "TwitchChannel" ADD COLUMN     "lastVideoSyncAt" TIMESTAMP(3),
ADD COLUMN     "pollVideos" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "TwitchVideo" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "twitchId" TEXT NOT NULL,
    "streamId" TEXT,
    "type" TEXT,
    "title" TEXT,
    "description" TEXT,
    "url" TEXT,
    "thumbnailUrl" TEXT,
    "viewCount" INTEGER,
    "language" TEXT,
    "durationSeconds" INTEGER,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwitchVideo_twitchId_key" ON "TwitchVideo"("twitchId");

-- CreateIndex
CREATE INDEX "TwitchVideo_channelId_startedAt_idx" ON "TwitchVideo"("channelId", "startedAt");

-- AddForeignKey
ALTER TABLE "TwitchVideo" ADD CONSTRAINT "TwitchVideo_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TwitchChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
