export function architectureResourcePath(resourceID: string) {
  return `.opencode/architecture/resources/${resourceID}.json`
}

export function architectureResourceAliases(resource: { name: string }) {
  const compact = resource.name.replace(/\s+/g, "")
  if (compact === resource.name) return [resource.name]
  return [resource.name, compact, compact.toLowerCase()]
}

export function architectureResourceMention(resource: { id: string; name: string }) {
  const path = architectureResourcePath(resource.id)
  const content = `@${resource.name}`
  return {
    type: "file" as const,
    path,
    content,
    start: 0,
    end: 0,
    mime: "application/json",
    filename: `${resource.id}.json`,
    source: {
      type: "file" as const,
      text: { value: content, start: 0, end: content.length },
      path,
    },
  }
}
