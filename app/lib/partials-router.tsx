import { Hono } from 'hono'
import { modelsRouter } from './partials/models'
import { skillsRouter } from './partials/skills'
import { remoteSupportRouter } from './partials/remote-support'
import { channelsRouter } from './partials/channels'
import { aiChatRouter } from './partials/ai-chat'

export const partialsRouter = new Hono()

// Mount sub-routers
partialsRouter.route('/', modelsRouter)
partialsRouter.route('/', skillsRouter)
partialsRouter.route('/', remoteSupportRouter)
partialsRouter.route('/', channelsRouter)
partialsRouter.route('/', aiChatRouter)
