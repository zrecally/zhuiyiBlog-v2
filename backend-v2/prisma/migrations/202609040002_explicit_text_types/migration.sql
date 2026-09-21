-- DropForeignKey
ALTER TABLE `ArticleAccessGrant` DROP FOREIGN KEY `ArticleAccessGrant_sessionId_fkey`;

-- AlterTable
ALTER TABLE `ArticleAccessCode` MODIFY `environment` VARCHAR(255) NOT NULL,
    MODIFY `postId` VARCHAR(255) NOT NULL,
    MODIFY `codeDigest` VARCHAR(255) NOT NULL,
    MODIFY `passwordHash` LONGTEXT NOT NULL,
    MODIFY `codeHint` LONGTEXT NOT NULL,
    MODIFY `usedIpHash` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `ArticleAccessGrant` MODIFY `sessionId` VARCHAR(255) NOT NULL,
    MODIFY `postId` VARCHAR(255) NOT NULL,
    MODIFY `boundIpHash` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `MagicToken` MODIFY `email` LONGTEXT NOT NULL;

-- AlterTable
ALTER TABLE `Post` MODIFY `title` LONGTEXT NOT NULL,
    MODIFY `summary` LONGTEXT NULL,
    MODIFY `image` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `Comment` MODIFY `postId` LONGTEXT NOT NULL,
    MODIFY `ip` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `Friend` MODIFY `url` LONGTEXT NOT NULL,
    MODIFY `avatar` LONGTEXT NULL,
    MODIFY `description` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `Danmaku` MODIFY `ip` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `I18nDict` MODIFY `zh_CN` LONGTEXT NOT NULL,
    MODIFY `en_US` LONGTEXT NOT NULL;

-- AddForeignKey
ALTER TABLE `ArticleAccessGrant` ADD CONSTRAINT `ArticleAccessGrant_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `AnonymousAccessSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
