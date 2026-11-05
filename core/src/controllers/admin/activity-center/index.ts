import type { Application } from 'express';
import type { AdminContext } from '../context';
import { createActivityRouteContext } from './context';
import { mountActivityOverviewRoutes } from './overview-routes';
import { mountStellarActivityRoutes } from './stellar-routes';
import { mountPetDiaryRoutes } from './pet-diary-routes';

function mountActivityCenterRoutes(app: Application, ctx: AdminContext): void {
    const routes = createActivityRouteContext(app, ctx);
    mountActivityOverviewRoutes(routes);
    mountStellarActivityRoutes(routes);
    mountPetDiaryRoutes(routes);
}

module.exports = { mountActivityCenterRoutes };
