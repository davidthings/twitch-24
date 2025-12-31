-- CreateTable
CREATE TABLE "TwitchChannel" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "broadcasterId" TEXT NOT NULL,
    "displayName" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pollSchedule" BOOLEAN NOT NULL DEFAULT true,
    "pollStreams" BOOLEAN NOT NULL DEFAULT true,
    "lastScheduleSyncAt" TIMESTAMP(3),
    "lastStreamSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchScheduleSegment" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "twitchId" TEXT NOT NULL,
    "title" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "isCanceled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwitchScheduleSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwitchStreamSnapshot" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "isLive" BOOLEAN NOT NULL,
    "streamId" TEXT,
    "startedAt" TIMESTAMP(3),
    "viewerCount" INTEGER,
    "title" TEXT,
    "polledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwitchStreamSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwitchChannel_login_key" ON "TwitchChannel"("login");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchChannel_broadcasterId_key" ON "TwitchChannel"("broadcasterId");

-- CreateIndex
CREATE INDEX "TwitchScheduleSegment_channelId_startTime_idx" ON "TwitchScheduleSegment"("channelId", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "TwitchScheduleSegment_channelId_twitchId_key" ON "TwitchScheduleSegment"("channelId", "twitchId");

-- CreateIndex
CREATE INDEX "TwitchStreamSnapshot_channelId_polledAt_idx" ON "TwitchStreamSnapshot"("channelId", "polledAt");

-- AddForeignKey
ALTER TABLE "TwitchScheduleSegment" ADD CONSTRAINT "TwitchScheduleSegment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TwitchChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwitchStreamSnapshot" ADD CONSTRAINT "TwitchStreamSnapshot_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TwitchChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
