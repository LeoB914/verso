/** Import a ZIP from an absolute path (used by dashboard drag & drop). */
export async function importZipFromPathViaInvoke(zipPath: string): Promise<string | null> {
  const { api } = await import('../api')
  const result = await api.invoke('zip:importFrom', { zipPath })
  if (!result.ok) throw new Error(result.error.message)
  return result.ok && result.data ? result.data.path : null
}
