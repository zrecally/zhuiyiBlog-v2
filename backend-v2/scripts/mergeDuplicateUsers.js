/*
 * One-off production maintenance utility.
 *
 * Keeps the newest record (largest id) for every duplicate username, moves all
 * supported user relations to it, then removes the redundant records.  It is
 * intentionally dry-run by default.  Run it inside the backend container:
 *
 *   node scripts/mergeDuplicateUsers.js --apply --backup /app/backups/user-merge.json
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const backupIndex = process.argv.indexOf('--backup');
const backupPath = backupIndex >= 0 ? process.argv[backupIndex + 1] : null;

if (apply && !backupPath) {
  throw new Error('Refusing to modify users without --backup <path>.');
}

async function main() {
  const groups = await prisma.$queryRawUnsafe(`
    SELECT username, MAX(id)::int AS "keepId", ARRAY_AGG(id ORDER BY id)::int[] AS ids
    FROM "User"
    GROUP BY username
    HAVING COUNT(*) > 1
  `);

  const mappings = groups.flatMap((group) =>
    group.ids.filter((id) => id !== group.keepId).map((oldId) => ({ oldId, keepId: group.keepId })),
  );
  console.log(JSON.stringify({ duplicateGroups: groups.length, usersToMerge: mappings.length }));

  if (!apply || mappings.length === 0) return;

  const ids = [...new Set(groups.flatMap((group) => group.ids))];
  const [users, comments, danmakus, notifications, viewHistories, likes, accessRequests] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } } }),
    prisma.comment.findMany({ where: { userId: { in: ids } } }),
    prisma.danmaku.findMany({ where: { userId: { in: ids } } }),
    prisma.notification.findMany({ where: { userId: { in: ids } } }),
    prisma.viewHistory.findMany({ where: { userId: { in: ids } } }),
    prisma.articleLike.findMany({ where: { userId: { in: ids } } }),
    prisma.accessRequest.findMany({ where: { userId: { in: ids } } }),
  ]);

  fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), users, comments, danmakus, notifications, viewHistories, likes, accessRequests }),
    { mode: 0o600 },
  );

  for (const { oldId, keepId } of mappings) {
    const [likeConflict, accessConflict] = await Promise.all([
      prisma.$queryRawUnsafe(
        'SELECT COUNT(*)::int AS count FROM "ArticleLike" old_row JOIN "ArticleLike" keep_row ON keep_row."postId" = old_row."postId" WHERE old_row."userId" = $1 AND keep_row."userId" = $2',
        oldId,
        keepId,
      ),
      prisma.$queryRawUnsafe(
        'SELECT COUNT(*)::int AS count FROM "AccessRequest" old_row JOIN "AccessRequest" keep_row ON keep_row."postId" = old_row."postId" WHERE old_row."userId" = $1 AND keep_row."userId" = $2',
        oldId,
        keepId,
      ),
    ]);
    if (likeConflict[0].count || accessConflict[0].count) {
      throw new Error(`Cannot merge user ${oldId}: duplicate relation rows require manual resolution.`);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    let commentsMoved = 0;
    for (const { oldId, keepId } of mappings) {
      commentsMoved += (await tx.comment.updateMany({ where: { userId: oldId }, data: { userId: keepId } })).count;
      await tx.danmaku.updateMany({ where: { userId: oldId }, data: { userId: keepId } });
      await tx.notification.updateMany({ where: { userId: oldId }, data: { userId: keepId } });
      await tx.viewHistory.updateMany({ where: { userId: oldId }, data: { userId: keepId } });
      await tx.articleLike.updateMany({ where: { userId: oldId }, data: { userId: keepId } });
      await tx.accessRequest.updateMany({ where: { userId: oldId }, data: { userId: keepId } });
      await tx.user.delete({ where: { id: oldId } });
    }
    return { commentsMoved, usersRemoved: mappings.length };
  });

  console.log(JSON.stringify({ ...result, backupPath }));
}

main().finally(() => prisma.$disconnect());
