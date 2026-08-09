export function hasAgentPickerChoice(items: Array<{ name?: string; native?: boolean }>) {
  return items.some((item) => item.native === false || item.name === "graph")
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string) {
  return items.find((item) => item.name === name) ?? items.find((item) => item.name === "build") ?? items[0]
}
