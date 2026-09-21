-- 编排模式插件授权：激活码与设备激活/审计记录

CREATE TABLE `LicenseKey` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `keyDigest` CHAR(64) NOT NULL,
    `keyHint` VARCHAR(16) NOT NULL,
    `productName` VARCHAR(80) NOT NULL DEFAULT '编排模式 Pro',
    `status` VARCHAR(24) NOT NULL DEFAULT 'active',
    `boundDevice` VARCHAR(64) NULL,
    `machineName` VARCHAR(120) NULL,
    `licensedTo` VARCHAR(120) NULL,
    `packageName` VARCHAR(80) NOT NULL DEFAULT 'orchestration-pro',
    `expiresAt` DATETIME(3) NULL,
    `activatedAt` DATETIME(3) NULL,
    `lastVerifyAt` DATETIME(3) NULL,
    `verifyCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `LicenseKey_keyDigest_key`(`keyDigest`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

CREATE TABLE `LicenseActivation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `keyId` INTEGER NOT NULL,
    `deviceId` VARCHAR(64) NOT NULL,
    `action` VARCHAR(16) NOT NULL,
    `ok` BOOLEAN NOT NULL DEFAULT true,
    `ipHash` CHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LicenseActivation_keyId_createdAt_idx`(`keyId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

ALTER TABLE `LicenseActivation`
    ADD CONSTRAINT `LicenseActivation_keyId_fkey`
    FOREIGN KEY (`keyId`) REFERENCES `LicenseKey`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
