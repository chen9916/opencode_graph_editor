export function architectureResourcePath(resourceID: string) {
  return `.opencode/architecture/resources/${resourceID}.json`
}

export function architectureResourceMention(resource: { id: string; name: string }) {
  return {
    type: "file" as const,
    path: architectureResourcePath(resource.id),
    content: `@${resource.name}`,
    start: 0,
    end: 0,
    // The composer uses a file pill, while submission keeps this managed graph reference as visible text only.
    mime: "text/plain",
    filename: `${resource.id}.json`,
  }
}
