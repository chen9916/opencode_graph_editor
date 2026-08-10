export function downloadJsonExport(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function jsonExportFilename(name: string | undefined, fallback: string, suffix = "") {
  const clean = filenameStem(name ?? "") || filenameStem(fallback) || "export"
  return `${clean}${suffix}.json`
}

function filenameStem(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
}
