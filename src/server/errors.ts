export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
}
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  // DB/인증 오류 원문은 응답에 포함하지 않습니다. 키나 내부 구조 노출을 막습니다.
  console.error('[game-api]', error instanceof Error ? error.name : 'UnknownError');
  return Response.json({ error: '서버 처리 중 문제가 생겼습니다. 잠시 후 다시 시도해주세요.' }, { status: 500 });
}
