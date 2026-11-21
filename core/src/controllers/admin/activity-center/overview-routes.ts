import type { ActivityRouteContext } from './types';

export function mountActivityOverviewRoutes(routes: ActivityRouteContext): void {
    const { mountGet, app, withAccount, ctx } = routes;
    mountGet('/api/activity-center/activities', 'getActivityDirectorySnapshot');
    mountGet('/api/activity-center/snapshot', 'getActivityCenterSnapshot');

    // 只读诊断：按 groupId 扫描活动分组的原始字节（字段号/长度/文本），
    // 用来给尚未支持的新活动补协议定义。只调 GetGroup，不产生任何写操作。
    // 返回值含 rawBase64，可在本地反复离线解析，不必为看完整 body 反复重启。
    app.get('/api/activity-center/probe/:groupId', withAccount((accountId: string, req) => (
        (ctx.provider as any).probeActivityGroup(accountId, String(req.params.groupId || ''))
    )));
}
