-- Persist per-IP like/dislike dedup so counters cannot be inflated after a restart.

CREATE TABLE `CommentAction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `commentId` INTEGER NOT NULL,
    `action` VARCHAR(16) NOT NULL,
    `ipHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CommentAction_commentId_action_ipHash_key`(`commentId`, `action`, `ipHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

ALTER TABLE `CommentAction`
    ADD CONSTRAINT `CommentAction_commentId_fkey`
    FOREIGN KEY (`commentId`) REFERENCES `Comment`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
