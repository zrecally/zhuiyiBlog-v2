import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosError } from 'axios';

// FeishuClient 在模块加载时读取凭证并构造 SDK Client，所以必须先写好环境
// 变量再动态 import。凭证是假的：所有 HTTP 都由下面注入的 stub adapter 拦截。
process.env.FEISHU_APP_ID = 'test-app-id';
process.env.FEISHU_APP_SECRET = 'test-app-secret';

interface StubRoute {
  match: (url: string) => boolean;
  status: number;
  body: unknown;
}

// axios 内置 adapter 里的 settle() 负责按 validateStatus 把非 2xx 转成
// 拒绝；自定义 adapter 必须自己复刻这一步，直接 return 400 响应是不会 reject 的。
const makeAdapter = (routes: StubRoute[]) => async (config: { url?: string }) => {
  const url = String(config.url || '');
  const route = routes.find(item => item.match(url));
  if (!route) throw new Error(`stub adapter 未匹配到请求: ${url}`);
  const response = {
    status: route.status,
    statusText: route.status === 200 ? 'OK' : 'Bad Request',
    data: route.body,
    headers: {},
    config,
  };
  if (route.status < 200 || route.status >= 300) {
    throw new AxiosError(
      `Request failed with status code ${route.status}`,
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      response,
    );
  }
  return response;
};

const TOKEN_ROUTE: StubRoute = {
  match: url => url.includes('/auth/v3/tenant_access_token/internal'),
  status: 200,
  body: { code: 0, msg: 'ok', tenant_access_token: 't-stub-token', expire: 7200 },
};

test('飞书自定义 http 实例：成功响应解包 body，SDK 拿到 {code,msg,data}', async () => {
  const { feishuClient, feishuHttpInstance } = await import('../src/core/FeishuClient');
  assert.ok(feishuClient, '设置了假凭证后应能构造出 SDK Client');
  feishuHttpInstance.defaults.adapter = makeAdapter([
    TOKEN_ROUTE,
    {
      match: url => url.includes('/tables/tblGOOD/records'),
      status: 200,
      body: { code: 0, msg: 'success', data: { items: [{ record_id: 'recA', fields: {} }], has_more: false } },
    },
  ]);

  const res = await feishuClient.bitable.appTableRecord.list({
    path: { app_token: 'bascnStubBaseToken1', table_id: 'tblGOOD' },
    params: { page_size: 100 },
  });
  // 若未复刻默认实例"返回 resp.data"的解包行为，这里拿到的是完整
  // AxiosResponse，res.code 会是 undefined，业务层 code!==0 判断会整体错位
  assert.equal(res.code, 0);
  assert.equal(res.data?.items?.length, 1);
});

test('飞书自定义 http 实例：非 2xx 异常消息包含飞书 code/msg 与请求 URL', async () => {
  const { feishuClient, feishuHttpInstance } = await import('../src/core/FeishuClient');
  feishuHttpInstance.defaults.adapter = makeAdapter([
    TOKEN_ROUTE,
    { match: () => true, status: 400, body: { code: 1254040, msg: 'NotFound' } },
  ]);

  await assert.rejects(
    feishuClient.bitable.appTableRecord.list({
      path: { app_token: 'bascnStubBaseToken1', table_id: 'tblBAD' },
      params: { page_size: 100 },
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      assert.match(message, /HTTP 400/);
      assert.match(message, /code=1254040/);
      assert.match(message, /msg=NotFound/);
      assert.match(message, /\/open-apis\/bitable\/v1\/apps\/bascnStubBaseToken1\/tables\/tblBAD\//);
      return true;
    },
  );
});

const makeCountingAdapter = (failuresBeforeOk: number, status: number, code: number) => {
  let calls = 0;
  const adapter = async (config: { url?: string }) => {
    calls += 1;
    const routes: StubRoute[] = calls <= failuresBeforeOk
      ? [{ match: () => true, status, body: { code, msg: 'Data not ready, please try again later' } }]
      : [{ match: () => true, status: 200, body: { code: 0, msg: 'success', data: { items: [], has_more: false } } }];
    return makeAdapter(routes)(config);
  };
  return { adapter, getCalls: () => calls };
};

test('飞书瞬态 1254607：GET 自动重试后成功', async () => {
  const { feishuClient, feishuHttpInstance } = await import('../src/core/FeishuClient');
  const stub = makeCountingAdapter(2, 400, 1254607);
  feishuHttpInstance.defaults.adapter = async (config) => {
    if (String(config.url).includes('/auth/v3/')) return makeAdapter([TOKEN_ROUTE])(config);
    return stub.adapter(config);
  };

  const res = await feishuClient.bitable.appTableRecord.list({
    path: { app_token: 'bascnStubBaseToken1', table_id: 'tblFLAKY' },
    params: { page_size: 100 },
  });
  assert.equal(res.code, 0);
  // 2 秒+4 秒两次重试上限内，第 3 次成功
  assert.equal(stub.getCalls(), 3);
});

test('飞书瞬态 1254607：重试耗尽后进入错误增强，共请求 3 次', async () => {
  const { feishuClient, feishuHttpInstance } = await import('../src/core/FeishuClient');
  const stub = makeCountingAdapter(Number.MAX_SAFE_INTEGER, 400, 1254607);
  feishuHttpInstance.defaults.adapter = async (config) => {
    if (String(config.url).includes('/auth/v3/')) return makeAdapter([TOKEN_ROUTE])(config);
    return stub.adapter(config);
  };

  await assert.rejects(
    feishuClient.bitable.appTableRecord.list({
      path: { app_token: 'bascnStubBaseToken1', table_id: 'tblDEAD' },
      params: { page_size: 100 },
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      assert.match(message, /code=1254607/);
      return true;
    },
  );
  assert.equal(stub.getCalls(), 3);
});

test('飞书非瞬态 1254040：GET 不重试，只请求 1 次', async () => {
  const { feishuClient, feishuHttpInstance } = await import('../src/core/FeishuClient');
  const stub = makeCountingAdapter(Number.MAX_SAFE_INTEGER, 400, 1254040);
  feishuHttpInstance.defaults.adapter = async (config) => {
    if (String(config.url).includes('/auth/v3/')) return makeAdapter([TOKEN_ROUTE])(config);
    return stub.adapter(config);
  };

  await assert.rejects(
    feishuClient.bitable.appTableRecord.list({
      path: { app_token: 'bascnStubBaseToken1', table_id: 'tblMISS' },
      params: { page_size: 100 },
    }),
  );
  assert.equal(stub.getCalls(), 1);
});

test('飞书瞬态 1254607：POST 写操作不重试，只请求 1 次', async () => {
  const { feishuClient, feishuHttpInstance } = await import('../src/core/FeishuClient');
  let calls = 0;
  feishuHttpInstance.defaults.adapter = async (config) => {
    if (String(config.url).includes('/auth/v3/')) return makeAdapter([TOKEN_ROUTE])(config);
    calls += 1;
    throw new AxiosError(
      `Request failed with status code 400`,
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      { status: 400, statusText: 'Bad Request', data: { code: 1254607, msg: 'Data not ready' }, headers: {}, config } as never,
    );
  };

  await assert.rejects(
    feishuClient.bitable.appTableRecord.create({
      path: { app_token: 'bascnStubBaseToken1', table_id: 'tblWRITE' },
      data: { fields: { name: 'x' } } as never,
    }),
  );
  assert.equal(calls, 1);
});
