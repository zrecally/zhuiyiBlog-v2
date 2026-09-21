// Migration v1 schema contract. Keep synchronized with prisma/schema.prisma.
export const MODEL_SPEC: Record<string, Record<string, { type: string; nullable: boolean; maxLength?: number }>> = {
  "Admin": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "username": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "password": {
      "type": "String",
      "nullable": false
    },
    "totpSecret": {
      "type": "String",
      "nullable": true
    },
    "isTotpSetup": {
      "type": "Boolean",
      "nullable": false
    },
    "isActive": {
      "type": "Boolean",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "User": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "email": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "username": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "password": {
      "type": "String",
      "nullable": true
    },
    "avatar": {
      "type": "String",
      "nullable": true
    },
    "avatarDark": {
      "type": "String",
      "nullable": true
    },
    "isActive": {
      "type": "Boolean",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "AccessRequest": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "userId": {
      "type": "Int",
      "nullable": false
    },
    "postId": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "status": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    },
    "updatedAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "ArticleAccessCode": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "feishuRecordId": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "environment": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "postId": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "codeDigest": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "passwordHash": {
      "type": "String",
      "nullable": false
    },
    "codeHint": {
      "type": "String",
      "nullable": false
    },
    "bindIp": {
      "type": "Boolean",
      "nullable": false
    },
    "grantHours": {
      "type": "Int",
      "nullable": false
    },
    "status": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "expiresAt": {
      "type": "DateTime",
      "nullable": true
    },
    "usedAt": {
      "type": "DateTime",
      "nullable": true
    },
    "usedIpHash": {
      "type": "String",
      "nullable": true
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    },
    "updatedAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "AnonymousAccessSession": {
    "id": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "tokenHash": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "expiresAt": {
      "type": "DateTime",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    },
    "updatedAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "ArticleAccessGrant": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "sessionId": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "postId": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "codeId": {
      "type": "Int",
      "nullable": false
    },
    "boundIpHash": {
      "type": "String",
      "nullable": true
    },
    "expiresAt": {
      "type": "DateTime",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "ArticleLike": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "userId": {
      "type": "Int",
      "nullable": false
    },
    "postId": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "MagicToken": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "email": {
      "type": "String",
      "nullable": false
    },
    "token": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "expiresAt": {
      "type": "DateTime",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "Post": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "title": {
      "type": "String",
      "nullable": false
    },
    "summary": {
      "type": "String",
      "nullable": true
    },
    "content": {
      "type": "String",
      "nullable": false
    },
    "image": {
      "type": "String",
      "nullable": true
    },
    "category": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "source": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "published": {
      "type": "Boolean",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    },
    "updatedAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "Comment": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "feishuRecordId": {
      "type": "String",
      "nullable": true,
      "maxLength": 255
    },
    "feishuMessageId": {
      "type": "String",
      "nullable": true,
      "maxLength": 255
    },
    "parentId": {
      "type": "Int",
      "nullable": true
    },
    "postId": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "content": {
      "type": "String",
      "nullable": false
    },
    "userId": {
      "type": "Int",
      "nullable": false
    },
    "ip": {
      "type": "String",
      "nullable": true
    },
    "likes": {
      "type": "Int",
      "nullable": false
    },
    "dislikes": {
      "type": "Int",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "CommentAction": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "commentId": {
      "type": "Int",
      "nullable": false
    },
    "action": {
      "type": "String",
      "nullable": false,
      "maxLength": 16
    },
    "ipHash": {
      "type": "String",
      "nullable": false,
      "maxLength": 64
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "Friend": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "name": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "url": {
      "type": "String",
      "nullable": false
    },
    "avatar": {
      "type": "String",
      "nullable": true
    },
    "description": {
      "type": "String",
      "nullable": true
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    },
    "updatedAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "ImageCache": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "token": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "ossUrl": {
      "type": "String",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "SiteStat": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "views": {
      "type": "Int",
      "nullable": false
    },
    "updatedAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "Danmaku": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "text": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "color": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "ip": {
      "type": "String",
      "nullable": true
    },
    "userId": {
      "type": "Int",
      "nullable": true
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "SystemConfig": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "key": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "value": {
      "type": "String",
      "nullable": false
    },
    "isSecret": {
      "type": "Boolean",
      "nullable": false
    },
    "feishuRecordId": {
      "type": "String",
      "nullable": true,
      "maxLength": 255
    },
    "updatedAt": {
      "type": "DateTime",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "AuditLog": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "ip": {
      "type": "String",
      "nullable": false
    },
    "action": {
      "type": "String",
      "nullable": false
    },
    "details": {
      "type": "String",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "PollVote": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "pollId": {
      "type": "String",
      "nullable": false,
      "maxLength": 80
    },
    "voterKey": {
      "type": "String",
      "nullable": false,
      "maxLength": 64
    },
    "selections": {
      "type": "Json",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "AlbumPhoto": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "feishuRecordId": {
      "type": "String",
      "nullable": false,
      "maxLength": 128
    },
    "feishuFileToken": {
      "type": "String",
      "nullable": false,
      "maxLength": 256
    },
    "title": {
      "type": "String",
      "nullable": false,
      "maxLength": 120
    },
    "caption": {
      "type": "String",
      "nullable": true,
      "maxLength": 500
    },
    "displayFileName": {
      "type": "String",
      "nullable": false,
      "maxLength": 64
    },
    "thumbnailFileName": {
      "type": "String",
      "nullable": false,
      "maxLength": 64
    },
    "mimeType": {
      "type": "String",
      "nullable": false,
      "maxLength": 64
    },
    "width": {
      "type": "Int",
      "nullable": false
    },
    "height": {
      "type": "Int",
      "nullable": false
    },
    "fileSize": {
      "type": "Int",
      "nullable": false
    },
    "checksum": {
      "type": "String",
      "nullable": false,
      "maxLength": 64
    },
    "sortOrder": {
      "type": "Int",
      "nullable": false
    },
    "takenAt": {
      "type": "DateTime",
      "nullable": true
    },
    "featured": {
      "type": "Boolean",
      "nullable": false
    },
    "tags": {
      "type": "Json",
      "nullable": false
    },
    "status": {
      "type": "String",
      "nullable": false,
      "maxLength": 32
    },
    "syncedAt": {
      "type": "DateTime",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    },
    "updatedAt": {
      "type": "DateTime",
      "nullable": false
    },
    "deletedAt": {
      "type": "DateTime",
      "nullable": true
    }
  },
  "Notification": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "userId": {
      "type": "Int",
      "nullable": false
    },
    "type": {
      "type": "String",
      "nullable": false
    },
    "title": {
      "type": "String",
      "nullable": false
    },
    "content": {
      "type": "String",
      "nullable": false
    },
    "link": {
      "type": "String",
      "nullable": true
    },
    "isRead": {
      "type": "Boolean",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "CardIssueBatch": {
    "id": { "type": "Int", "nullable": false },
    "environment": { "type": "String", "nullable": false, "maxLength": 32 },
    "requestId": { "type": "String", "nullable": false, "maxLength": 80 },
    "requestFingerprint": { "type": "String", "nullable": false, "maxLength": 64 },
    "ossKey": { "type": "String", "nullable": false, "maxLength": 512 },
    "productName": { "type": "String", "nullable": false, "maxLength": 120 },
    "fileName": { "type": "String", "nullable": false, "maxLength": 180 },
    "fileSize": { "type": "Int", "nullable": false },
    "cardCount": { "type": "Int", "nullable": false },
    "codesCiphertext": { "type": "String", "nullable": true },
    "feishuStatus": { "type": "String", "nullable": false, "maxLength": 24 },
    "feishuRegistered": { "type": "Int", "nullable": false },
    "feishuError": { "type": "String", "nullable": true },
    "createdAt": { "type": "DateTime", "nullable": false },
    "updatedAt": { "type": "DateTime", "nullable": false }
  },
  "CardCode": {
    "id": { "type": "Int", "nullable": false },
    "feishuRecordId": { "type": "String", "nullable": true, "maxLength": 255 },
    "environment": { "type": "String", "nullable": false, "maxLength": 32 },
    "source": { "type": "String", "nullable": false, "maxLength": 24 },
    "productKey": { "type": "String", "nullable": true, "maxLength": 80 },
    "productName": { "type": "String", "nullable": false, "maxLength": 120 },
    "codeDigest": { "type": "String", "nullable": false, "maxLength": 64 },
    "codeHash": { "type": "String", "nullable": false, "maxLength": 255 },
    "codeHint": { "type": "String", "nullable": false, "maxLength": 8 },
    "contentCiphertext": { "type": "String", "nullable": true },
    "fileKey": { "type": "String", "nullable": true, "maxLength": 512 },
    "fileName": { "type": "String", "nullable": true, "maxLength": 180 },
    "fileMediaType": { "type": "String", "nullable": true, "maxLength": 120 },
    "fileSize": { "type": "Int", "nullable": true },
    "fileChecksum": { "type": "String", "nullable": true, "maxLength": 64 },
    "fileEtag": { "type": "String", "nullable": true, "maxLength": 255 },
    "fileVersionId": { "type": "String", "nullable": true, "maxLength": 255 },
    "feishuFileToken": { "type": "String", "nullable": true, "maxLength": 255 },
    "salesChannel": { "type": "String", "nullable": true, "maxLength": 80 },
    "orderReference": { "type": "String", "nullable": true, "maxLength": 160 },
    "issueBatchId": { "type": "Int", "nullable": true },
    "issueIndex": { "type": "Int", "nullable": true },
    "status": { "type": "String", "nullable": false, "maxLength": 24 },
    "expiresAt": { "type": "DateTime", "nullable": true },
    "usedAt": { "type": "DateTime", "nullable": true },
    "usedIpHash": { "type": "String", "nullable": true, "maxLength": 64 },
    "replayTokenHash": { "type": "String", "nullable": true, "maxLength": 64 },
    "replayExpiresAt": { "type": "DateTime", "nullable": true },
    "downloadGrantId": { "type": "String", "nullable": true, "maxLength": 36 },
    "downloadGrantIssuedAt": { "type": "DateTime", "nullable": true },
    "downloadGrantExpiresAt": { "type": "DateTime", "nullable": true },
    "createdAt": { "type": "DateTime", "nullable": false },
    "updatedAt": { "type": "DateTime", "nullable": false }
  },
  "CardDownloadLog": {
    "id": { "type": "Int", "nullable": false },
    "grantId": { "type": "String", "nullable": true, "maxLength": 36 },
    "cardId": { "type": "Int", "nullable": false },
    "codeHint": { "type": "String", "nullable": false, "maxLength": 8 },
    "fileKey": { "type": "String", "nullable": false, "maxLength": 512 },
    "bytes": { "type": "Int", "nullable": false },
    "ipMasked": { "type": "String", "nullable": false, "maxLength": 64 },
    "storage": { "type": "String", "nullable": false, "maxLength": 24 },
    "status": { "type": "String", "nullable": false, "maxLength": 24 },
    "createdAt": { "type": "DateTime", "nullable": false }
  },
  "ViewHistory": {
    "id": {
      "type": "Int",
      "nullable": false
    },
    "userId": {
      "type": "Int",
      "nullable": false
    },
    "postId": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "postTitle": {
      "type": "String",
      "nullable": false
    },
    "viewedAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "I18nDict": {
    "id": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "key": {
      "type": "String",
      "nullable": false,
      "maxLength": 255
    },
    "zh_CN": {
      "type": "String",
      "nullable": false
    },
    "en_US": {
      "type": "String",
      "nullable": false
    },
    "createdAt": {
      "type": "DateTime",
      "nullable": false
    },
    "updatedAt": {
      "type": "DateTime",
      "nullable": false
    }
  },
  "LicenseKey": {
    "id": { "type": "Int", "nullable": false },
    "keyDigest": { "type": "String", "nullable": false, "maxLength": 64 },
    "keyHint": { "type": "String", "nullable": false, "maxLength": 16 },
    "productName": { "type": "String", "nullable": false, "maxLength": 80 },
    "status": { "type": "String", "nullable": false, "maxLength": 24 },
    "boundDevice": { "type": "String", "nullable": true, "maxLength": 64 },
    "machineName": { "type": "String", "nullable": true, "maxLength": 120 },
    "licensedTo": { "type": "String", "nullable": true, "maxLength": 120 },
    "packageName": { "type": "String", "nullable": false, "maxLength": 80 },
    "expiresAt": { "type": "DateTime", "nullable": true },
    "activatedAt": { "type": "DateTime", "nullable": true },
    "lastVerifyAt": { "type": "DateTime", "nullable": true },
    "verifyCount": { "type": "Int", "nullable": false },
    "createdAt": { "type": "DateTime", "nullable": false }
  },
  "LicenseActivation": {
    "id": { "type": "Int", "nullable": false },
    "keyId": { "type": "Int", "nullable": false },
    "deviceId": { "type": "String", "nullable": false, "maxLength": 64 },
    "action": { "type": "String", "nullable": false, "maxLength": 16 },
    "ok": { "type": "Boolean", "nullable": false },
    "ipHash": { "type": "String", "nullable": true, "maxLength": 64 },
    "createdAt": { "type": "DateTime", "nullable": false }
  }
};
