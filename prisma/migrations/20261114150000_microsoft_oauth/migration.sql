-- Existing attempts remain Google; provider binding prevents cross-provider replay.
ALTER TABLE "oauth_attempts" ADD COLUMN "provider" "Provider" NOT NULL DEFAULT 'GOOGLE',
ADD COLUMN "nonceHash" TEXT;
