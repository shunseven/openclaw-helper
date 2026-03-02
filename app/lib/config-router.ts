import { Hono } from 'hono';
import { modelsRouter } from './config/models';
import { telegramRouter } from './config/telegram';
import { whatsappRouter } from './config/whatsapp';
import { channelsRouter } from './config/channels';
import { webSearchRouter } from './config/web-search';
import { remoteSupportRouter } from './config/remote-support';
import { statusRouter } from './config/status';

export const configRouter = new Hono();

configRouter.route('/', modelsRouter);
configRouter.route('/', telegramRouter);
configRouter.route('/', whatsappRouter);
configRouter.route('/', channelsRouter);
configRouter.route('/', webSearchRouter);
configRouter.route('/', remoteSupportRouter);
configRouter.route('/', statusRouter);
