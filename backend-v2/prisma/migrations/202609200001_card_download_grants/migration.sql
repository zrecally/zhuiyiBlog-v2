-- Make one logical download grant atomic and bind cards to an immutable OSS
-- object identity when the provider exposes ETag / VersionId metadata.

ALTER TABLE `CardCode`
    ADD COLUMN `fileEtag` VARCHAR(255) NULL,
    ADD COLUMN `fileVersionId` VARCHAR(255) NULL,
    ADD COLUMN `downloadGrantId` CHAR(36) NULL,
    ADD COLUMN `downloadGrantIssuedAt` DATETIME(3) NULL,
    ADD COLUMN `downloadGrantExpiresAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `CardCode_downloadGrantId_key`
    ON `CardCode`(`downloadGrantId`);

ALTER TABLE `CardDownloadLog`
    ADD COLUMN `grantId` CHAR(36) NULL;

CREATE UNIQUE INDEX `CardDownloadLog_grantId_key`
    ON `CardDownloadLog`(`grantId`);
