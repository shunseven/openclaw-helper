import { Hono } from 'hono'
import { modelsRouter } from './partials/models'
import { skillsRouter } from './partials/skills'
import { remoteSupportRouter } from './partials/remote-support'
import { channelsRouter } from './partials/channels'

export const partialsRouter = new Hono()

// Mount sub-routers
partialsRouter.route('/', modelsRouter)
partialsRouter.route('/', skillsRouter)
partialsRouter.route('/', remoteSupportRouter)
partialsRouter.route('/', channelsRouter)
