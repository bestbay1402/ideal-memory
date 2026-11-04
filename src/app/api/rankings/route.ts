import { serverClient } from '../../../server/supabase';
import { ApiError, errorResponse } from '../../../server/errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const sort = new URL(request.url).searchParams.get('sort') ?? 'power';
    if (!['power', 'level', 'weapon'].includes(sort)) throw new ApiError(400, '올바른 랭킹 종류를 선택해주세요.');
    let query = serverClient().from('public_leaderboard').select('nickname,class,level,xp,enhancement,best_enhancement,power,kills');
    if (sort === 'power') query = query.order('power', { ascending: false }).order('level', { ascending: false });
    else if (sort === 'level') query = query.order('level', { ascending: false }).order('xp', { ascending: false });
    else query = query.order('enhancement', { ascending: false }).order('level', { ascending: false });
    const { data, error } = await query.order('nickname').limit(100);
    if (error) throw new ApiError(503, '랭킹을 불러올 수 없습니다. 데이터베이스 연결을 확인해주세요.');
    const rankings = (data ?? []).map(({ best_enhancement, ...row }) => ({ ...row, bestEnhancement: best_enhancement }));
    return Response.json({ rankings }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
