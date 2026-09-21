-- Optimize Comment.postId from LONGTEXT to VARCHAR(255) and add composite index on (postId, createdAt)

ALTER TABLE `Comment` MODIFY COLUMN `postId` VARCHAR(255) NOT NULL;
CREATE INDEX `Comment_postId_createdAt_idx` ON `Comment`(`postId`, `createdAt`);
