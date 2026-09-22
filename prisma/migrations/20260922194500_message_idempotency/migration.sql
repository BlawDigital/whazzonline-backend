ALTER TABLE "ChatMessage"
ADD COLUMN "clientMessageId" TEXT;

CREATE UNIQUE INDEX "ChatMessage_conversationId_clientMessageId_key"
ON "ChatMessage"("conversationId", "clientMessageId");
