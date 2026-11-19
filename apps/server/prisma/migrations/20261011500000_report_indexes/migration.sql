-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkReport_reportedAt_workOrderId_idx" ON "WorkReport"("reportedAt", "workOrderId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkReport_equipmentId_reportedAt_idx" ON "WorkReport"("equipmentId", "reportedAt");

