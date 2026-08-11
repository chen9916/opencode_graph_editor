#!/usr/bin/env bun
import { $ } from "bun"

import { buildNodeEnv, downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`bun script/build-node.ts`.cwd("../opencode").env(buildNodeEnv(channel))
if (channel === "dev") await downloadCliToResources()
