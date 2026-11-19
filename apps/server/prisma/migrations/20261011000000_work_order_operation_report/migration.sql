-- CreateTable
CREATE TABLE "WorkOrderOperation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workOrderId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "operationCode" TEXT NOT NULL,
    "operationName" TEXT NOT NULL,
    "workCenterId" INTEGER NOT NULL,
    "standardMinutes" INTEGER NOT NULL,
    "isInspectionPoint" BOOLEAN NOT NULL DEFAULT false,
    "plannedQty" INTEGER NOT NULL,
    "completedQty" INTEGER NOT NULL DEFAULT 0,
    "defectQty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "teamId" INTEGER,
    "employeeId" INTEGER,
    "equipmentId" INTEGER,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    CONSTRAINT "WorkOrderOperation_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkOrderOperation_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkOrderOperation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkOrderOperation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkOrderOperation_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workOrderOperationId" INTEGER NOT NULL,
    "workOrderId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "teamId" INTEGER,
    "shiftId" INTEGER,
    "equipmentId" INTEGER,
    "goodQty" INTEGER NOT NULL,
    "defectQty" INTEGER NOT NULL,
    "workMinutes" INTEGER NOT NULL DEFAULT 0,
    "reportedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "reversedById" INTEGER,
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    CONSTRAINT "WorkReport_workOrderOperationId_fkey" FOREIGN KEY ("workOrderOperationId") REFERENCES "WorkOrderOperation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkReport_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkReport_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkReport_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WorkOrderOperation_workOrderId_status_idx" ON "WorkOrderOperation"("workOrderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderOperation_workOrderId_seq_key" ON "WorkOrderOperation"("workOrderId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "WorkReport_idempotencyKey_key" ON "WorkReport"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WorkReport_reversedById_key" ON "WorkReport"("reversedById");

-- CreateIndex
CREATE INDEX "WorkReport_workOrderId_idx" ON "WorkReport"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkReport_workOrderOperationId_idx" ON "WorkReport"("workOrderOperationId");

-- CreateIndex
CREATE INDEX "WorkReport_employeeId_reportedAt_idx" ON "WorkReport"("employeeId", "reportedAt");

