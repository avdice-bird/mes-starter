-- CreateTable
CREATE TABLE "Dict" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system'
);

-- CreateTable
CREATE TABLE "DictItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dictId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "updatedBy" TEXT NOT NULL DEFAULT 'system',
    CONSTRAINT "DictItem_dictId_fkey" FOREIGN KEY ("dictId") REFERENCES "Dict" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Dict_code_key" ON "Dict"("code");

-- CreateIndex
CREATE INDEX "DictItem_dictId_idx" ON "DictItem"("dictId");

-- CreateIndex
CREATE UNIQUE INDEX "DictItem_dictId_value_key" ON "DictItem"("dictId", "value");
