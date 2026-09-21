-- Persist comment like/dislike counters so they survive restarts.

ALTER TABLE `Comment`
    ADD COLUMN `likes` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `dislikes` INTEGER NOT NULL DEFAULT 0;
