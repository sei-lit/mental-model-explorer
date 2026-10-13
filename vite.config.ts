import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { createApiMiddleware } from './server/api'
import { defaultSettings, prepareApi } from './server/setup'

/** Mounts the same API the CLI server uses, so `npm run dev` is a single process. */
function explorerApi(): Plugin {
  return {
    name: 'mental-model-explorer-api',
    async configureServer(server) {
      const { options, mockReason } = await prepareApi({
        ...defaultSettings,
        forceMock: process.env.MME_MOCK === '1',
        projectPath: process.env.MME_PROJECT ? resolve(process.env.MME_PROJECT) : null,
        changes: process.env.MME_PR ? { kind: 'pr', number: Number(process.env.MME_PR) } : process.env.MME_DIFF ? { kind: 'base', ref: process.env.MME_DIFF } : null,
      })
      server.config.logger.info(mockReason ? `AI: モック応答 (${mockReason})` : `AI: claude CLI (model=${options.model})`)
      server.middlewares.use(createApiMiddleware(options))
    },
  }
}

export default defineConfig({
  plugins: [react(), explorerApi()],
  build: { outDir: 'dist/client' },
})
