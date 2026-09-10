import type {
  ApiErrorBody,
  GroupId,
  GroupListItem,
  GroupMatrix,
  ObjectTypeAccessDetail,
  ObjectTypeId,
  RoleId,
  ServerMeta,
} from '../../shared/types/domain.ts';

/** Error carrying the server's status so the UI can distinguish 404 from 502. */
export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.message === 'string'
  );
}

async function getJson<TResult>(path: string, signal?: AbortSignal): Promise<TResult> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = isApiErrorBody(body)
      ? body.error.message
      : `Request to ${path} failed (${response.status})`;
    throw new ApiRequestError(message, response.status);
  }

  return (await response.json()) as TResult;
}

export const api = {
  meta: (signal?: AbortSignal): Promise<ServerMeta> => getJson('/api/meta', signal),

  groups: (signal?: AbortSignal): Promise<GroupListItem[]> => getJson('/api/groups', signal),

  groupMatrix: (groupId: GroupId, signal?: AbortSignal): Promise<GroupMatrix> =>
    getJson(`/api/groups/${groupId}`, signal),

  objectTypeDetail: (
    roleId: RoleId,
    objectTypeId: ObjectTypeId,
    signal?: AbortSignal,
  ): Promise<ObjectTypeAccessDetail> =>
    getJson(`/api/roles/${roleId}/object-types/${objectTypeId}`, signal),
};
