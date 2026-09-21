export interface ApiOptions extends Omit<RequestInit, 'body'> {
  token?: string;
  body?: unknown;
}

type ApiRequestError = Error & { data?: unknown; status?: number };

export const authorizationHeaders = (token?: string) => {
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

export const apiRequest = async <T>(url: string, options: ApiOptions = {}): Promise<T> => {
  const { token, body, headers, ...rest } = options;

  const defaultHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined && !(body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  const fetchOptions: RequestInit = {
    ...rest,
    headers: {
      ...defaultHeaders,
      ...headers,
    },
  };

  if (body !== undefined) {
    fetchOptions.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    // 修复 H7: 丢弃了后端的错误数据结构导致 TOTP 无法正常流转
    // 将整个 errorData 包装成错误抛出，保留 errorData 对象
    const message = errorData && typeof errorData === 'object' && 'message' in errorData
      ? String(errorData.message)
      : 'Network response was not ok';
    const err: ApiRequestError = new Error(message);
    err.data = errorData;
    err.status = response.status;
    throw err;
  }

  return response.json();
};
