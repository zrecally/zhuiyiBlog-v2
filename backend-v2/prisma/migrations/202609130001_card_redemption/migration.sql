-- Card redemption and idempotent issue batches for the MySQL/PolarDB-X release.

CREATE TABLE `CardIssueBatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `environment` VARCHAR(32) NOT NULL,
    `requestId` VARCHAR(80) NOT NULL,
    `requestFingerprint` CHAR(64) NOT NULL,
    `ossKey` VARCHAR(512) NOT NULL,
    `productName` VARCHAR(120) NOT NULL,
    `fileName` VARCHAR(180) NOT NULL,
    `fileSize` INTEGER NOT NULL,
    `cardCount` INTEGER NOT NULL,
    `codesCiphertext` LONGTEXT NULL,
    `feishuStatus` VARCHAR(24) NOT NULL DEFAULT 'pending',
    `feishuRegistered` INTEGER NOT NULL DEFAULT 0,
    `feishuError` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CardIssueBatch_environment_requestId_key`(`environment`, `requestId`),
    INDEX `CardIssueBatch_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `CardCode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `feishuRecordId` VARCHAR(255) NULL,
    `environment` VARCHAR(32) NOT NULL,
    `source` VARCHAR(24) NOT NULL DEFAULT 'feishu',
    `productKey` VARCHAR(80) NULL,
    `productName` VARCHAR(120) NOT NULL,
    `codeDigest` CHAR(64) NOT NULL,
    `codeHash` VARCHAR(255) NOT NULL,
    `codeHint` VARCHAR(8) NOT NULL,
    `contentCiphertext` LONGTEXT NULL,
    `fileKey` VARCHAR(512) NULL,
    `fileName` VARCHAR(180) NULL,
    `fileMediaType` VARCHAR(120) NULL,
    `fileSize` INTEGER NULL,
    `fileChecksum` CHAR(64) NULL,
    `feishuFileToken` VARCHAR(255) NULL,
    `salesChannel` VARCHAR(80) NULL,
    `orderReference` VARCHAR(160) NULL,
    `issueBatchId` INTEGER NULL,
    `issueIndex` INTEGER NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'active',
    `expiresAt` DATETIME(3) NULL,
    `usedAt` DATETIME(3) NULL,
    `usedIpHash` CHAR(64) NULL,
    `replayTokenHash` CHAR(64) NULL,
    `replayExpiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CardCode_feishuRecordId_key`(`feishuRecordId`),
    UNIQUE INDEX `CardCode_environment_codeDigest_key`(`environment`, `codeDigest`),
    UNIQUE INDEX `CardCode_issueBatchId_issueIndex_key`(`issueBatchId`, `issueIndex`),
    INDEX `CardCode_environment_status_expiresAt_idx`(`environment`, `status`, `expiresAt`),
    INDEX `CardCode_orderReference_idx`(`orderReference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `CardDownloadLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cardId` INTEGER NOT NULL,
    `codeHint` VARCHAR(8) NOT NULL,
    `fileKey` VARCHAR(512) NOT NULL,
    `bytes` INTEGER NOT NULL,
    `ipMasked` VARCHAR(64) NOT NULL,
    `storage` VARCHAR(24) NOT NULL DEFAULT 'unknown',
    `status` VARCHAR(24) NOT NULL DEFAULT 'link_issued',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CardDownloadLog_createdAt_idx`(`createdAt`),
    INDEX `CardDownloadLog_cardId_createdAt_idx`(`cardId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

ALTER TABLE `CardCode`
    ADD CONSTRAINT `CardCode_issueBatchId_fkey`
    FOREIGN KEY (`issueBatchId`) REFERENCES `CardIssueBatch`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CardDownloadLog`
    ADD CONSTRAINT `CardDownloadLog_cardId_fkey`
    FOREIGN KEY (`cardId`) REFERENCES `CardCode`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
