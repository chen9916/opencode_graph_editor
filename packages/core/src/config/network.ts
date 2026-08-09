export * as ConfigNetwork from "./network"

import { Schema } from "effect"

const NoProxy = Schema.Union([Schema.String, Schema.Array(Schema.String)]).annotate({
  description: "NO_PROXY-style host exclusions. Accepts a comma-separated string or an array of entries.",
})

export class Proxy extends Schema.Class<Proxy>("ConfigV2.Network.Proxy")({
  proxy: Schema.Union([Schema.String, Schema.Literal(false)])
    .pipe(Schema.optional)
    .annotate({
      description:
        "HTTP, HTTPS, SOCKS, or local proxy URL used for outbound network requests. Set false to disable proxying.",
    }),
  noProxy: NoProxy.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Network")({
  proxy: Schema.Union([Schema.String, Schema.Literal(false)])
    .pipe(Schema.optional)
    .annotate({
      description:
        "HTTP, HTTPS, SOCKS, or local proxy URL used for outbound network requests. Set false to disable proxying.",
    }),
  noProxy: NoProxy.pipe(Schema.optional),
}) {}
