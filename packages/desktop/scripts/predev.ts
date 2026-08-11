import { $ } from "bun"
import { buildNodeEnv, downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${channel}`

await $`bun script/build-node.ts`.cwd("../opencode").env(buildNodeEnv(channel))
await downloadCliToResources()
